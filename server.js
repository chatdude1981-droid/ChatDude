const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");
const { createPersistence } = require("./persistence");

const app = express();
const server = http.createServer(app);

const AUTH_SECRET = process.env.AUTH_SECRET || "chatdude-dev-secret-change-me";
const MAX_ROOM_MESSAGES = 120;
const MAX_PRIVATE_MESSAGES = 60;
const PRESENCE_IDLE_MS = 1000 * 60 * 10;
const PREMIUM_USERNAMES = new Set(
  String(process.env.PREMIUM_USERNAMES || "")
    .split(",")
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
);
const DEFAULT_ROOMS = [
  {
    id: "room-general",
    slug: "general",
    name: "General",
    description: "Main room for everyday conversation.",
    createdAt: new Date().toISOString(),
    createdBy: "system",
    system: true
  },
  {
    id: "room-random",
    slug: "random",
    name: "Random",
    description: "Casual off-topic chat.",
    createdAt: new Date().toISOString(),
    createdBy: "system",
    system: true
  },
  {
    id: "room-gaming",
    slug: "gaming",
    name: "Gaming",
    description: "Game nights, clips, and trash talk.",
    createdAt: new Date().toISOString(),
    createdBy: "system",
    system: true
  }
];

const allowedOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : "*";

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE"]
  }
});

const onlineUsers = new Map();
let store = {
  users: [],
  rooms: [],
  roomMessages: [],
  privateMessages: []
};
let persistence;
const rateLimitBuckets = new Map();

function createTimestampPayload(date = new Date()) {
  return {
    time: date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    }),
    timestamp: date.toISOString()
  };
}

function corsMiddleware(req, res, next) {
  const requestOrigin = req.headers.origin;

  if (allowedOrigins === "*") {
    res.header("Access-Control-Allow-Origin", "*");
  } else if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    res.header("Access-Control-Allow-Origin", requestOrigin);
    res.header("Vary", "Origin");
  }

  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
}

function slugifyRoomName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

function normalizeUsername(value) {
  return value.trim().replace(/\s+/g, " ");
}

function isValidUsername(value) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(value);
}

function isValidGuestName(value) {
  return /^[a-zA-Z0-9 _-]{2,20}$/.test(value);
}

function isValidPassword(value) {
  return typeof value === "string" && value.length >= 8 && value.length <= 72;
}

function isValidDisplayName(value) {
  return typeof value === "string" && /^[a-zA-Z0-9 _-]{2,24}$/.test(value.trim());
}

function getPasswordStrength(value) {
  const password = String(value || "");
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  return score;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedValue) {
  const [salt, hash] = String(storedValue || "").split(":");
  if (!salt || !hash) return false;

  const suppliedHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(suppliedHash, "hex"));
}

function signToken(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  const expected = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(encodedPayload)
    .digest("base64url");

  if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  if (!payload.exp || payload.exp < Date.now()) {
    return null;
  }

  return payload;
}

function issueAuthToken(user) {
  return signToken({
    userId: user.id,
    username: user.username,
    exp: Date.now() + (1000 * 60 * 60 * 24 * 30)
  });
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

function findUserById(userId) {
  return store.users.find((user) => user.id === userId) || null;
}

function findUserByUsername(username) {
  return store.users.find((user) => user.username.toLowerCase() === username.toLowerCase()) || null;
}

function sanitizePreferences(preferences = {}) {
  const fonts = [
    "Space Grotesk",
    "DM Sans",
    "Manrope",
    "IBM Plex Sans",
    "Outfit",
    "Sora",
    "Nunito",
    "Plus Jakarta Sans",
    "Bricolage Grotesque",
    "Figtree"
  ];
  const backgrounds = ["aurora", "midnight", "sunrise"];
  const privacy = preferences.privacy || {};
  const statusMessage = normalizeUsername(String(preferences.statusMessage || ""))
    .replace(/\s+/g, " ")
    .slice(0, 80);
  const textColor = /^#[0-9a-fA-F]{6}$/.test(preferences.textColor || "")
    ? preferences.textColor
    : (/^#[0-9a-fA-F]{6}$/.test(preferences.accentColor || "")
      ? preferences.accentColor
      : (/^#[0-9a-fA-F]{6}$/.test(preferences.bubbleColor || "")
        ? preferences.bubbleColor
        : "#edf4ff"));

  return {
    textColor,
    fontFamily: fonts.includes(preferences.fontFamily)
      ? preferences.fontFamily
      : "Space Grotesk",
    backgroundStyle: backgrounds.includes(preferences.backgroundStyle)
      ? preferences.backgroundStyle
      : "aurora",
    statusMessage,
    onboardingCompleted: Boolean(preferences.onboardingCompleted),
    lastSeenAt: typeof preferences.lastSeenAt === "string" ? preferences.lastSeenAt : null,
    showJoinLeaveMessages: preferences.showJoinLeaveMessages !== false,
    allowPrivateCalls: preferences.allowPrivateCalls !== false,
    privacy: {
      allowGuestCameraView: privacy.allowGuestCameraView !== false
    }
  };
}

function sanitizeBlockedUsers(blockedUsers = []) {
  return Array.from(new Set(
    blockedUsers
      .map((username) => normalizeUsername(String(username || "")))
      .filter((username) => isValidUsername(username))
  ));
}

function sanitizeFriends(friends = []) {
  return Array.from(new Set(
    friends
      .map((username) => normalizeUsername(String(username || "")))
      .filter((username) => isValidUsername(username))
  ));
}

function sessionFriendsUsername(session, username) {
  const friends = sanitizeFriends(session?.friends || []);
  return friends.includes(normalizeUsername(String(username || "")));
}

function sanitizePresenceStatus(value) {
  return ["online", "busy"].includes(value) ? value : "online";
}

function getUserPlan(userLike) {
  if (!userLike || userLike.accountType === "guest") {
    return "guest";
  }

  return PREMIUM_USERNAMES.has(String(userLike.username || "").toLowerCase())
    ? "premium"
    : "free_registered";
}

function getFeatureFlags(userLike) {
  const plan = getUserPlan(userLike);
  return {
    canCreateRooms: plan !== "guest",
    canPrivateMessage: plan !== "guest",
    canBroadcastCamera: true,
    canCreatePrivateRooms: plan === "premium",
    canUseRoomBranding: plan === "premium",
    hasExtendedPmHistory: plan === "premium",
    hasAdvancedModeration: plan === "premium"
  };
}

function consumeRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const recent = (rateLimitBuckets.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) {
    rateLimitBuckets.set(key, recent);
    return false;
  }

  recent.push(now);
  rateLimitBuckets.set(key, recent);
  return true;
}

function getEffectivePresenceStatus(session) {
  if (!session) {
    return "online";
  }

  if (Date.now() - Number(session.lastActiveAt || Date.now()) >= PRESENCE_IDLE_MS) {
    return "idle";
  }

  return sanitizePresenceStatus(session.presenceStatus);
}

function touchSession(session) {
  if (session) {
    session.lastActiveAt = Date.now();
  }

  return session;
}

function toPublicUser(user) {
  const featureFlags = getFeatureFlags({ ...user, accountType: "registered" });
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    accountType: "registered",
    plan: getUserPlan({ ...user, accountType: "registered" }),
    featureFlags,
    preferences: sanitizePreferences(user.preferences || {}),
    blockedUsers: sanitizeBlockedUsers(user.blockedUsers || []),
    friends: sanitizeFriends(user.friends || [])
  };
}

function serializeSession(session) {
  const featureFlags = getFeatureFlags(session);
  return {
    id: session.id,
    username: session.username,
    displayName: session.displayName,
    accountType: session.accountType,
    isGuest: session.accountType === "guest",
    plan: getUserPlan(session),
    canCustomize: session.accountType === "registered",
    canCreateRooms: featureFlags.canCreateRooms,
    canPrivateMessage: featureFlags.canPrivateMessage,
    featureFlags,
    presenceStatus: sanitizePresenceStatus(session.presenceStatus),
    effectivePresenceStatus: getEffectivePresenceStatus(session),
    preferences: sanitizePreferences(session.preferences || {}),
    blockedUsers: sanitizeBlockedUsers(session.blockedUsers || []),
    friends: sanitizeFriends(session.friends || [])
  };
}

function serializeRoom(room) {
  const onlineCount = Array.from(onlineUsers.values()).filter((session) => session.roomSlug === room.slug).length;
  const lastMessage = [...store.roomMessages]
    .reverse()
    .find((message) => message.roomSlug === room.slug && message.kind === "chat");

  return {
    id: room.id,
    slug: room.slug,
    name: room.name,
    description: room.description,
    createdAt: room.createdAt,
    createdBy: room.createdBy,
    system: Boolean(room.system),
    onlineCount,
    lastMessageAt: lastMessage ? lastMessage.timestamp : null
  };
}

function buildMessagePayload(message, socketIdOverride) {
  return {
    id: message.id,
    kind: message.kind,
    roomSlug: message.roomSlug,
    message: message.message,
    username: message.username,
    displayName: message.displayName || message.username,
    senderId: message.senderId || null,
    accountType: message.accountType || "guest",
    preferences: sanitizePreferences(message.preferences || {}),
    socketId: socketIdOverride || message.socketId || null,
    time: message.time,
    timestamp: message.timestamp
  };
}

function buildPrivateMessagePayload(message, viewerUsername) {
  const isOutgoing = message.fromUsername === viewerUsername;
  const counterpartUsername = isOutgoing ? message.toUsername : message.fromUsername;
  const counterpartLabel = isOutgoing
    ? (message.toDisplayName || message.toUsername)
    : (message.fromDisplayName || message.fromUsername);

  return {
    id: message.id,
    direction: isOutgoing ? "outgoing" : "incoming",
    from: message.fromLabel,
    fromUsername: message.fromUsername,
    toUsername: message.toUsername,
    counterpartUsername,
    counterpartLabel,
    fromSocketId: message.fromSocketId || null,
    toSocketId: message.toSocketId || null,
    preferences: sanitizePreferences(message.preferences || {}),
    message: message.message,
    time: message.time,
    timestamp: message.timestamp
  };
}

async function saveMessage(message) {
  store.roomMessages.push(message);
  const roomMessages = store.roomMessages.filter((entry) => entry.roomSlug === message.roomSlug);

  if (roomMessages.length > MAX_ROOM_MESSAGES) {
    const removableCount = roomMessages.length - MAX_ROOM_MESSAGES;
    const removableIds = new Set(roomMessages.slice(0, removableCount).map((entry) => entry.id));
    store.roomMessages = store.roomMessages.filter((entry) => !removableIds.has(entry.id));
  }

  await persistence.saveRoomMessage(message);
}

async function savePrivateMessage(message) {
  store.privateMessages.push(message);
  if (store.privateMessages.length > MAX_PRIVATE_MESSAGES) {
    store.privateMessages = store.privateMessages.slice(-MAX_PRIVATE_MESSAGES);
  }
  await persistence.savePrivateMessage(message);
}

function sessionBlocksUsername(session, username) {
  const blockedUsers = sanitizeBlockedUsers(session?.blockedUsers || []);
  return blockedUsers.includes(username);
}

function hasPrivateConversationBetween(leftUsername, rightUsername) {
  const left = normalizeUsername(String(leftUsername || "")).toLowerCase();
  const right = normalizeUsername(String(rightUsername || "")).toLowerCase();
  if (!left || !right) {
    return false;
  }

  return store.privateMessages.some((entry) => {
    const from = normalizeUsername(String(entry.fromUsername || "")).toLowerCase();
    const to = normalizeUsername(String(entry.toUsername || "")).toLowerCase();
    return (from === left && to === right) || (from === right && to === left);
  });
}

function canViewerAccessPublisher(viewerSession, publisherSession) {
  if (!viewerSession || !publisherSession) {
    return false;
  }

  if (sessionBlocksUsername(publisherSession, viewerSession.username)) {
    return false;
  }

  if (sessionBlocksUsername(viewerSession, publisherSession.username)) {
    return false;
  }

  if (viewerSession.accountType === "guest" && publisherSession.accountType === "registered") {
    return sanitizePreferences(publisherSession.preferences || {}).privacy.allowGuestCameraView;
  }

  return true;
}

function canInitiatePrivateCall(callerSession, targetSession) {
  if (!callerSession || !targetSession) {
    return false;
  }

  if (callerSession.accountType === "guest" && targetSession.accountType === "registered") {
    return false;
  }

  return true;
}

function getUsersInRoom(roomSlug, viewerSession) {
  return Array.from(onlineUsers.entries())
    .filter(([, session]) => session.roomSlug === roomSlug)
    .map(([socketId, session]) => ({
      socketId,
      userId: session.id,
      username: session.username,
      displayName: session.displayName,
      accountType: session.accountType,
      isGuest: session.accountType === "guest",
      preferences: sanitizePreferences(session.preferences || {}),
      presenceStatus: sanitizePresenceStatus(session.presenceStatus),
      effectivePresenceStatus: getEffectivePresenceStatus(session),
      isPublishing: Boolean(session.isPublishing),
      cameraEnabled: Boolean(session.cameraEnabled),
      canViewCamera: Boolean(session.isPublishing && canViewerAccessPublisher(viewerSession, session)),
      isBlocked: Boolean(sessionBlocksUsername(viewerSession, session.username)),
      isFriend: Boolean(sessionFriendsUsername(viewerSession, session.username))
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

function getPublishedMediaInRoom(roomSlug, viewerSession) {
  return Array.from(onlineUsers.entries())
    .filter(([, session]) => session.roomSlug === roomSlug && session.isPublishing && canViewerAccessPublisher(viewerSession, session))
    .map(([socketId, session]) => ({
      socketId,
      username: session.username,
      displayName: session.displayName,
      cameraEnabled: Boolean(session.cameraEnabled),
      micEnabled: Boolean(session.micEnabled)
    }));
}

function updateUserList(roomSlug) {
  Array.from(onlineUsers.entries())
    .filter(([, session]) => session.roomSlug === roomSlug)
    .forEach(([socketId, session]) => {
      io.to(socketId).emit("user list", getUsersInRoom(roomSlug, session));
    });
}

function emitRoomList() {
  io.emit("room list", store.rooms.map(serializeRoom));
}

function emitMediaState(roomSlug) {
  Array.from(onlineUsers.entries())
    .filter(([, session]) => session.roomSlug === roomSlug)
    .forEach(([socketId, session]) => {
      io.to(socketId).emit("room media state", {
        roomSlug,
        publishers: getPublishedMediaInRoom(roomSlug, session)
      });
    });
}

function getRoomBySlug(roomSlug) {
  return store.rooms.find((room) => room.slug === roomSlug) || null;
}

function getRoomHistory(roomSlug) {
  return store.roomMessages
    .filter((message) => (
      message.roomSlug === roomSlug &&
      !(message.kind === "system" && /\b(joined|left) the room\b/i.test(message.message || ""))
    ))
    .slice(-MAX_ROOM_MESSAGES)
    .map((message) => buildMessagePayload(message, null));
}

function removeRoomMessages(roomSlug) {
  store.roomMessages = store.roomMessages.filter((message) => message.roomSlug !== roomSlug);
}

function canManageRoom(user, room) {
  return Boolean(user && room && !room.system && room.createdBy === user.username);
}

function canDeleteMessage(session, room, message) {
  if (!session || !room || !message) return false;
  if (session.accountType === "registered" && message.senderId && message.senderId === session.id) {
    return true;
  }

  return canManageRoom({ username: session.username }, room);
}

function buildLiveSystemMessage(roomSlug, text) {
  return buildMessagePayload({
    id: crypto.randomUUID(),
    kind: "system",
    roomSlug,
    message: text,
    username: "ChatDude",
    displayName: "ChatDude",
    accountType: "system",
    preferences: sanitizePreferences({}),
    senderId: "system",
    ...createTimestampPayload()
  }, null);
}

function emitLiveSystemMessage(roomSlug, text, targetSocketIds) {
  const payload = buildLiveSystemMessage(roomSlug, text);
  const recipients = Array.isArray(targetSocketIds) && targetSocketIds.length
    ? targetSocketIds
    : Array.from(onlineUsers.entries())
      .filter(([, session]) => session.roomSlug === roomSlug)
      .map(([socketId]) => socketId);

  recipients.forEach((socketId) => {
    io.to(socketId).emit("system message", payload);
  });
}

function notifyFriendsInRoom(roomSlug, enteringSession) {
  const recipients = Array.from(onlineUsers.entries())
    .filter(([socketId, session]) => (
      socketId !== enteringSession.socketId &&
      session.roomSlug === roomSlug &&
      session.accountType === "registered" &&
      sessionFriendsUsername(session, enteringSession.username) &&
      !sessionBlocksUsername(session, enteringSession.username) &&
      !sessionBlocksUsername(enteringSession, session.username)
    ))
    .map(([socketId]) => socketId);

  if (recipients.length) {
    emitLiveSystemMessage(roomSlug, `${enteringSession.displayName || enteringSession.username} entered the room`, recipients);
  }
}

function notifyRoomCameraStart(roomSlug, session) {
  const recipients = Array.from(onlineUsers.entries())
    .filter(([socketId, otherSession]) => (
      socketId !== session.socketId &&
      otherSession.roomSlug === roomSlug &&
      canViewerAccessPublisher(otherSession, session)
    ))
    .map(([socketId]) => socketId);

  if (recipients.length) {
    emitLiveSystemMessage(roomSlug, `${session.displayName || session.username} started broadcasting their camera`, recipients);
  }
}

async function createSystemMessage(roomSlug, text) {
  const message = {
    id: crypto.randomUUID(),
    kind: "system",
    roomSlug,
    message: text,
    username: "ChatDude",
    displayName: "ChatDude",
    accountType: "system",
    preferences: sanitizePreferences({}),
    senderId: "system",
    ...createTimestampPayload()
  };

  await saveMessage(message);
  io.to(roomSlug).emit("system message", buildMessagePayload(message, null));
  emitRoomList();
}

app.use(corsMiddleware);
app.use(express.json());
app.use(express.static(__dirname));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    persistenceMode: persistence ? persistence.mode : "booting",
    databaseConfigured: Boolean(process.env.DATABASE_URL)
  });
});

app.get("/api/bootstrap", (req, res) => {
  const token = getBearerToken(req);
  const payload = verifyToken(token);
  const user = payload ? findUserById(payload.userId) : null;

  res.json({
    rooms: store.rooms.map(serializeRoom),
    currentUser: user ? toPublicUser(user) : null
  });
});

app.post("/api/auth/register", async (req, res) => {
  const username = normalizeUsername(req.body.username || "");
  const displayName = normalizeUsername(req.body.displayName || username);
  const password = req.body.password || "";

  if (!consumeRateLimit(`auth-register:${req.ip}`, 8, 10 * 60 * 1000)) {
    res.status(429).json({ error: "Too many registration attempts. Please wait a few minutes." });
    return;
  }

  if (!isValidUsername(username)) {
    res.status(400).json({ error: "Username must be 3-20 characters using letters, numbers, or underscores." });
    return;
  }

  if (!isValidDisplayName(displayName)) {
    res.status(400).json({ error: "Display name must be 2-24 characters using letters, numbers, spaces, dashes, or underscores." });
    return;
  }

  if (!isValidPassword(password) || getPasswordStrength(password) < 3) {
    res.status(400).json({ error: "Password must be 8-72 characters and include a stronger mix of letters, numbers, or symbols." });
    return;
  }

  if (findUserByUsername(username)) {
    res.status(409).json({ error: "That username is already taken." });
    return;
  }

  const user = {
    id: crypto.randomUUID(),
    username,
    displayName: displayName.slice(0, 24),
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    preferences: sanitizePreferences({ onboardingCompleted: false }),
    blockedUsers: [],
    friends: []
  };

  store.users.push(user);
  await persistence.createUser(user);

  res.status(201).json({
    token: issueAuthToken(user),
    user: toPublicUser(user)
  });
});

app.post("/api/auth/login", (req, res) => {
  const username = normalizeUsername(req.body.username || "");
  const password = req.body.password || "";
  const user = findUserByUsername(username);

  if (!consumeRateLimit(`auth-login:${req.ip}`, 15, 10 * 60 * 1000)) {
    res.status(429).json({ error: "Too many login attempts. Please wait a few minutes." });
    return;
  }

  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }

  res.json({
    token: issueAuthToken(user),
    user: toPublicUser(user)
  });
});

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  const payload = verifyToken(token);
  const user = payload ? findUserById(payload.userId) : null;

  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  req.user = user;
  next();
}

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

app.patch("/api/me/profile", requireAuth, async (req, res) => {
  const displayName = normalizeUsername(req.body.displayName || req.user.displayName || "");
  const preferences = sanitizePreferences({
    ...(req.user.preferences || {}),
    statusMessage: req.body.statusMessage,
    onboardingCompleted: req.body.onboardingCompleted
      ?? req.user.preferences?.onboardingCompleted,
    lastSeenAt: req.user.preferences?.lastSeenAt || null
  });

  if (!isValidDisplayName(displayName)) {
    res.status(400).json({ error: "Display name must be 2-24 characters using letters, numbers, spaces, dashes, or underscores." });
    return;
  }

  req.user.displayName = displayName;
  req.user.preferences = preferences;
  await persistence.updateUser(req.user);

  for (const [socketId, session] of onlineUsers.entries()) {
    if (session.id === req.user.id) {
      const nextSession = {
        ...session,
        displayName,
        preferences
      };
      onlineUsers.set(socketId, nextSession);
      io.to(socketId).emit("preferences updated", preferences);
      io.to(socketId).emit("presence updated", serializeSession(nextSession));
    }
  }

  res.json({ user: toPublicUser(req.user) });
});

app.patch("/api/me/preferences", requireAuth, async (req, res) => {
  req.user.preferences = sanitizePreferences(req.body.preferences || {});
  await persistence.updateUser(req.user);

  for (const [socketId, session] of onlineUsers.entries()) {
    if (session.id === req.user.id) {
      onlineUsers.set(socketId, {
        ...session,
        preferences: req.user.preferences,
        blockedUsers: sanitizeBlockedUsers(req.user.blockedUsers || [])
      });
      io.to(socketId).emit("preferences updated", sanitizePreferences(req.user.preferences));
    }
  }

  res.json({
    user: toPublicUser(req.user)
  });
});

app.patch("/api/me/friends", requireAuth, async (req, res) => {
  const username = normalizeUsername(req.body.username || "");
  const action = req.body.action === "remove" ? "remove" : "add";

  if (!isValidUsername(username)) {
    res.status(400).json({ error: "Choose a valid username to friend." });
    return;
  }

  if (username.toLowerCase() === req.user.username.toLowerCase()) {
    res.status(400).json({ error: "You cannot friend yourself." });
    return;
  }

  const existingTarget = findUserByUsername(username) || Array.from(onlineUsers.values()).find((session) => session.username.toLowerCase() === username.toLowerCase());
  if (!existingTarget) {
    res.status(404).json({ error: "That user could not be found." });
    return;
  }

  const friends = new Set(sanitizeFriends(req.user.friends || []));
  if (action === "add") {
    friends.add(username);
  } else {
    friends.delete(username);
  }

  req.user.friends = Array.from(friends);
  await persistence.updateUser(req.user);

  for (const [socketId, session] of onlineUsers.entries()) {
    if (session.id === req.user.id) {
      onlineUsers.set(socketId, {
        ...session,
        friends: req.user.friends
      });
      io.to(socketId).emit("friends updated", sanitizeFriends(req.user.friends));
      if (session.roomSlug) {
        updateUserList(session.roomSlug);
      }
    }
  }

  res.json({
    user: toPublicUser(req.user)
  });
});

app.patch("/api/me/blocks", requireAuth, async (req, res) => {
  const username = normalizeUsername(req.body.username || "");
  const action = req.body.action === "remove" ? "remove" : "add";

  if (!isValidUsername(username)) {
    res.status(400).json({ error: "Choose a valid username to block." });
    return;
  }

  if (username.toLowerCase() === req.user.username.toLowerCase()) {
    res.status(400).json({ error: "You cannot block yourself." });
    return;
  }

  const existingTarget = findUserByUsername(username) || Array.from(onlineUsers.values()).find((session) => session.username.toLowerCase() === username.toLowerCase());
  if (!existingTarget) {
    res.status(404).json({ error: "That user could not be found." });
    return;
  }

  const blockedUsers = new Set(sanitizeBlockedUsers(req.user.blockedUsers || []));
  if (action === "add") {
    blockedUsers.add(username);
  } else {
    blockedUsers.delete(username);
  }

  req.user.blockedUsers = Array.from(blockedUsers);
  await persistence.updateUser(req.user);

  for (const [socketId, session] of onlineUsers.entries()) {
    if (session.id === req.user.id) {
      onlineUsers.set(socketId, {
        ...session,
        blockedUsers: req.user.blockedUsers
      });
    }
  }

  const affectedRooms = new Set(
    Array.from(onlineUsers.values())
      .filter((session) => session.username === req.user.username || session.username === username)
      .map((session) => session.roomSlug)
      .filter(Boolean)
  );

  affectedRooms.forEach((roomSlug) => {
    updateUserList(roomSlug);
    emitMediaState(roomSlug);
  });

  res.json({
    user: toPublicUser(req.user)
  });
});

app.post("/api/rooms", requireAuth, async (req, res) => {
  const name = normalizeUsername(req.body.name || "");
  const description = normalizeUsername(req.body.description || "");
  const slug = slugifyRoomName(name);

  if (!consumeRateLimit(`room-create:${req.user.id}`, 8, 10 * 60 * 1000)) {
    res.status(429).json({ error: "You are creating rooms too quickly. Please wait a bit." });
    return;
  }

  if (!name || name.length < 3) {
    res.status(400).json({ error: "Room name must be at least 3 characters." });
    return;
  }

  if (!slug) {
    res.status(400).json({ error: "Room name must contain letters or numbers." });
    return;
  }

  if (store.rooms.some((room) => room.slug === slug)) {
    res.status(409).json({ error: "A room with that name already exists." });
    return;
  }

  const room = {
    id: crypto.randomUUID(),
    slug,
    name: name.slice(0, 32),
    description: description.slice(0, 80) || "Custom room",
    createdAt: new Date().toISOString(),
    createdBy: req.user.username,
    system: false
  };

  store.rooms.push(room);
  await persistence.createRoom(room);
  emitRoomList();

  res.status(201).json({
    room: serializeRoom(room)
  });
});

app.delete("/api/rooms/:slug", requireAuth, async (req, res) => {
  const room = getRoomBySlug(req.params.slug);

  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  if (!canManageRoom(req.user, room)) {
    res.status(403).json({ error: "Only the room creator can delete this room." });
    return;
  }

  const fallbackRoom = getRoomBySlug("general") || store.rooms.find((entry) => entry.slug !== room.slug) || null;
  store.rooms = store.rooms.filter((entry) => entry.slug !== room.slug);
  removeRoomMessages(room.slug);
  await persistence.deleteRoom(room.slug);

  if (fallbackRoom) {
    io.to(room.slug).emit("room removed", {
      removedRoomSlug: room.slug,
      fallbackRoom: serializeRoom(fallbackRoom)
    });
  } else {
    io.to(room.slug).emit("room removed", {
      removedRoomSlug: room.slug,
      fallbackRoom: null
    });
  }

  emitRoomList();

  res.json({
    deletedRoomSlug: room.slug,
    fallbackRoomSlug: fallbackRoom ? fallbackRoom.slug : null
  });
});

io.use((socket, next) => {
  try {
    const auth = socket.handshake.auth || {};
    const payload = verifyToken(auth.token);
    const user = payload ? findUserById(payload.userId) : null;

    if (user) {
      socket.data.session = {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        accountType: "registered",
        preferences: sanitizePreferences(user.preferences || {}),
        blockedUsers: sanitizeBlockedUsers(user.blockedUsers || []),
        friends: sanitizeFriends(user.friends || []),
        roomSlug: null,
        presenceStatus: "online",
        lastActiveAt: Date.now(),
        isPublishing: false,
        cameraEnabled: false,
        micEnabled: false
      };
      next();
      return;
    }

    const guestName = normalizeUsername(auth.guestName || "");
    if (!isValidGuestName(guestName)) {
      next(new Error("Guest name must be 2-20 characters."));
      return;
    }

    socket.data.session = {
      id: `guest-${crypto.randomUUID()}`,
      username: guestName.slice(0, 20),
      displayName: guestName.slice(0, 20),
      accountType: "guest",
      preferences: sanitizePreferences({}),
      blockedUsers: [],
      friends: [],
      roomSlug: null,
      presenceStatus: "online",
      lastActiveAt: Date.now(),
      isPublishing: false,
      cameraEnabled: false,
      micEnabled: false
    };

    next();
  } catch (error) {
    next(new Error("Unable to establish session."));
  }
});

io.on("connection", (socket) => {
  const session = socket.data.session;
  onlineUsers.set(socket.id, session);

  socket.emit("session ready", {
    socketId: socket.id,
    user: serializeSession(session),
    rooms: store.rooms.map(serializeRoom)
  });

  socket.on("join room", ({ roomSlug }) => {
    const room = getRoomBySlug(roomSlug);
    if (!room) {
      socket.emit("error message", "That room does not exist.");
      return;
    }

    const currentSession = onlineUsers.get(socket.id);
    if (!currentSession) return;
    touchSession(currentSession);
    currentSession.socketId = socket.id;

    const previousRoom = currentSession.roomSlug;
    if (previousRoom === room.slug) {
      socket.emit("room history", {
        room: serializeRoom(room),
        messages: getRoomHistory(room.slug)
      });
      updateUserList(room.slug);
      emitMediaState(room.slug);
      return;
    }

    if (previousRoom) {
      currentSession.isPublishing = false;
      currentSession.cameraEnabled = false;
      currentSession.micEnabled = false;
      socket.leave(previousRoom);
      emitMediaState(previousRoom);
    }

    socket.join(room.slug);
    currentSession.roomSlug = room.slug;
    onlineUsers.set(socket.id, currentSession);

    socket.emit("room history", {
      room: serializeRoom(room),
      messages: getRoomHistory(room.slug)
    });

    updateUserList(room.slug);
    emitMediaState(room.slug);

    if (previousRoom && previousRoom !== room.slug) {
      updateUserList(previousRoom);
    }
    notifyFriendsInRoom(room.slug, currentSession);
  });

  socket.on("chat message", async ({ message }) => {
    const currentSession = onlineUsers.get(socket.id);
    const trimmed = String(message || "").trim();

    if (!currentSession || !currentSession.roomSlug || !trimmed) return;
    if (!consumeRateLimit(`chat:${currentSession.id}:${currentSession.roomSlug}`, 14, 12 * 1000)) {
      socket.emit("error message", "You are sending messages too quickly.");
      return;
    }
    touchSession(currentSession);

    const room = getRoomBySlug(currentSession.roomSlug);
    if (!room) return;

    const entry = {
      id: crypto.randomUUID(),
      kind: "chat",
      roomSlug: room.slug,
      message: trimmed.slice(0, 600),
      username: currentSession.username,
      displayName: currentSession.displayName,
      senderId: currentSession.id,
      accountType: currentSession.accountType,
      preferences: sanitizePreferences(currentSession.preferences || {}),
      socketId: socket.id,
      ...createTimestampPayload()
    };

    await saveMessage(entry);
    io.to(room.slug).emit("chat message", buildMessagePayload(entry, socket.id));
    currentSession.isTyping = false;
    onlineUsers.set(socket.id, currentSession);

    const usersNowTyping = Array.from(onlineUsers.values())
      .filter((otherSession) => otherSession.roomSlug === room.slug && otherSession.isTyping)
      .map((otherSession) => otherSession.username)
      .filter((name) => name !== currentSession.username);

    io.to(room.slug).emit("typing update", usersNowTyping);
    emitRoomList();
  });

  socket.on("typing", ({ isTyping }) => {
    const currentSession = onlineUsers.get(socket.id);
    if (!currentSession || !currentSession.roomSlug) return;
    touchSession(currentSession);

    currentSession.isTyping = Boolean(isTyping);
    onlineUsers.set(socket.id, currentSession);

    const usersNowTyping = Array.from(onlineUsers.values())
      .filter((otherSession) => otherSession.roomSlug === currentSession.roomSlug && otherSession.isTyping)
      .map((otherSession) => otherSession.username)
      .filter((name) => name !== currentSession.username);

    io.to(currentSession.roomSlug).emit("typing update", usersNowTyping);
  });

  socket.on("private message", async ({ toSocketId, message }) => {
    const currentSession = onlineUsers.get(socket.id);
    const recipientSession = onlineUsers.get(toSocketId);
    const trimmed = String(message || "").trim();

    if (!currentSession || !recipientSession || !trimmed) return;
    if (!consumeRateLimit(`pm:${currentSession.id}:${recipientSession.id}`, 10, 12 * 1000)) {
      socket.emit("error message", "You are sending private messages too quickly.");
      return;
    }
    touchSession(currentSession);

    if (sessionBlocksUsername(recipientSession, currentSession.username) || sessionBlocksUsername(currentSession, recipientSession.username)) {
      socket.emit("error message", "This user is not available for private messages.");
      return;
    }

    if (
      currentSession.accountType !== "registered" &&
      !hasPrivateConversationBetween(currentSession.username, recipientSession.username)
    ) {
      socket.emit("error message", "Guests can only reply to private messages they have already received.");
      return;
    }

    const entry = {
      id: crypto.randomUUID(),
      fromUserId: currentSession.id,
      toUserId: recipientSession.id,
      fromUsername: currentSession.username,
      toUsername: recipientSession.username,
      fromDisplayName: currentSession.displayName,
      toDisplayName: recipientSession.displayName,
      fromLabel: currentSession.username,
      preferences: sanitizePreferences(currentSession.preferences || {}),
      message: trimmed.slice(0, 600),
      fromSocketId: socket.id,
      toSocketId,
      ...createTimestampPayload()
    };

    await savePrivateMessage(entry);

    io.to(toSocketId).emit("private message", buildPrivateMessagePayload(entry, recipientSession.username));
    socket.emit("private message", buildPrivateMessagePayload({
      ...entry,
      fromLabel: `(to ${recipientSession.username})`
    }, currentSession.username));
  });

  socket.on("pm media request", ({ toSocketId, mode }) => {
    const currentSession = onlineUsers.get(socket.id);
    const targetSession = onlineUsers.get(toSocketId);
    if (!currentSession || !targetSession) return;
    if (!consumeRateLimit(`pm-call:${currentSession.id}:${targetSession.id}`, 4, 20 * 1000)) {
      socket.emit("error message", "Please wait a moment before sending another call request.");
      return;
    }
    if (!canInitiatePrivateCall(currentSession, targetSession)) {
      socket.emit("error message", "Guests cannot start private calls with registered users.");
      return;
    }
    if (sessionBlocksUsername(targetSession, currentSession.username) || sessionBlocksUsername(currentSession, targetSession.username)) {
      socket.emit("error message", "This user is not available for private calls.");
      return;
    }
    if (!["audio", "video"].includes(mode)) {
      socket.emit("error message", "That private call type is not supported.");
      return;
    }
    if (
      sanitizePreferences(currentSession.preferences || {}).allowPrivateCalls === false ||
      sanitizePreferences(targetSession.preferences || {}).allowPrivateCalls === false
    ) {
      socket.emit("error message", "Private calls are turned off for one of these users.");
      return;
    }
    touchSession(currentSession);

    io.to(toSocketId).emit("pm media request", {
      fromSocketId: socket.id,
      fromUsername: currentSession.username,
      fromDisplayName: currentSession.displayName,
      mode
    });
  });

  socket.on("pm media accept", ({ toSocketId, mode }) => {
    const currentSession = onlineUsers.get(socket.id);
    const targetSession = onlineUsers.get(toSocketId);
    if (!currentSession || !targetSession) return;
    if (sessionBlocksUsername(targetSession, currentSession.username) || sessionBlocksUsername(currentSession, targetSession.username)) {
      return;
    }
    if (
      sanitizePreferences(currentSession.preferences || {}).allowPrivateCalls === false ||
      sanitizePreferences(targetSession.preferences || {}).allowPrivateCalls === false
    ) {
      return;
    }
    touchSession(currentSession);

    io.to(toSocketId).emit("pm media accept", {
      fromSocketId: socket.id,
      mode: mode === "video" ? "video" : "audio"
    });
  });

  socket.on("pm media decline", ({ toSocketId }) => {
    const currentSession = onlineUsers.get(socket.id);
    const targetSession = onlineUsers.get(toSocketId);
    if (!currentSession || !targetSession) return;
    touchSession(currentSession);

    io.to(toSocketId).emit("pm media decline", {
      fromSocketId: socket.id,
      fromUsername: currentSession.username
    });
  });

  socket.on("pm media end", ({ toSocketId }) => {
    const currentSession = onlineUsers.get(socket.id);
    const targetSession = onlineUsers.get(toSocketId);
    if (!currentSession || !targetSession) return;
    touchSession(currentSession);

    io.to(toSocketId).emit("pm media end", {
      fromSocketId: socket.id
    });
  });

  socket.on("start publishing", () => {
    const currentSession = onlineUsers.get(socket.id);
    if (!currentSession || !currentSession.roomSlug) return;
    touchSession(currentSession);

    currentSession.isPublishing = true;
    currentSession.cameraEnabled = true;
    currentSession.micEnabled = true;
    currentSession.socketId = socket.id;
    onlineUsers.set(socket.id, currentSession);
    updateUserList(currentSession.roomSlug);
    emitMediaState(currentSession.roomSlug);
    notifyRoomCameraStart(currentSession.roomSlug, currentSession);
  });

  socket.on("stop publishing", () => {
    const currentSession = onlineUsers.get(socket.id);
    if (!currentSession || !currentSession.roomSlug) return;
    touchSession(currentSession);

    currentSession.isPublishing = false;
    currentSession.cameraEnabled = false;
    currentSession.micEnabled = false;
    onlineUsers.set(socket.id, currentSession);
    updateUserList(currentSession.roomSlug);
    emitMediaState(currentSession.roomSlug);
  });

  socket.on("update media status", ({ cameraEnabled, micEnabled }) => {
    const currentSession = onlineUsers.get(socket.id);
    if (!currentSession || !currentSession.roomSlug || !currentSession.isPublishing) return;
    touchSession(currentSession);

    currentSession.cameraEnabled = Boolean(cameraEnabled);
    currentSession.micEnabled = Boolean(micEnabled);
    onlineUsers.set(socket.id, currentSession);
    updateUserList(currentSession.roomSlug);
    emitMediaState(currentSession.roomSlug);
  });

  socket.on("request media view", ({ toSocketId }) => {
    const currentSession = onlineUsers.get(socket.id);
    const targetSession = onlineUsers.get(toSocketId);
    if (!currentSession || !targetSession) return;
    if (currentSession.roomSlug !== targetSession.roomSlug) return;
    if (!targetSession.isPublishing) return;
    if (!canViewerAccessPublisher(currentSession, targetSession)) return;
    touchSession(currentSession);

    io.to(toSocketId).emit("media view requested", {
      viewerSocketId: socket.id,
      viewer: {
        username: currentSession.username,
        displayName: currentSession.displayName
      }
    });
  });

  socket.on("webrtc offer", ({ toSocketId, description }) => {
    const currentSession = onlineUsers.get(socket.id);
    const targetSession = onlineUsers.get(toSocketId);
    if (!currentSession || !targetSession || !description) return;
    if (currentSession.roomSlug !== targetSession.roomSlug) return;
    touchSession(currentSession);

    io.to(toSocketId).emit("webrtc offer", {
      fromSocketId: socket.id,
      description,
      user: {
        username: currentSession.username,
        displayName: currentSession.displayName,
        cameraEnabled: Boolean(currentSession.cameraEnabled),
        micEnabled: Boolean(currentSession.micEnabled)
      }
    });
  });

  socket.on("webrtc answer", ({ toSocketId, description }) => {
    const currentSession = onlineUsers.get(socket.id);
    const targetSession = onlineUsers.get(toSocketId);
    if (!currentSession || !targetSession || !description) return;
    if (currentSession.roomSlug !== targetSession.roomSlug) return;
    touchSession(currentSession);

    io.to(toSocketId).emit("webrtc answer", {
      fromSocketId: socket.id,
      description
    });
  });

  socket.on("webrtc ice candidate", ({ toSocketId, candidate }) => {
    const currentSession = onlineUsers.get(socket.id);
    const targetSession = onlineUsers.get(toSocketId);
    if (!currentSession || !targetSession || !candidate) return;
    if (currentSession.roomSlug !== targetSession.roomSlug) return;
    touchSession(currentSession);

    io.to(toSocketId).emit("webrtc ice candidate", {
      fromSocketId: socket.id,
      candidate
    });
  });

  socket.on("pm webrtc offer", ({ toSocketId, description, mode }) => {
    const currentSession = onlineUsers.get(socket.id);
    const targetSession = onlineUsers.get(toSocketId);
    if (!currentSession || !targetSession || !description) return;
    if (sessionBlocksUsername(targetSession, currentSession.username) || sessionBlocksUsername(currentSession, targetSession.username)) return;
    touchSession(currentSession);

    io.to(toSocketId).emit("pm webrtc offer", {
      fromSocketId: socket.id,
      description,
      mode: mode === "video" ? "video" : "audio",
      user: {
        username: currentSession.username,
        displayName: currentSession.displayName
      }
    });
  });

  socket.on("pm webrtc answer", ({ toSocketId, description }) => {
    const currentSession = onlineUsers.get(socket.id);
    const targetSession = onlineUsers.get(toSocketId);
    if (!currentSession || !targetSession || !description) return;
    touchSession(currentSession);

    io.to(toSocketId).emit("pm webrtc answer", {
      fromSocketId: socket.id,
      description
    });
  });

  socket.on("pm webrtc ice candidate", ({ toSocketId, candidate }) => {
    const currentSession = onlineUsers.get(socket.id);
    const targetSession = onlineUsers.get(toSocketId);
    if (!currentSession || !targetSession || !candidate) return;
    touchSession(currentSession);

    io.to(toSocketId).emit("pm webrtc ice candidate", {
      fromSocketId: socket.id,
      candidate
    });
  });

  socket.on("set presence status", ({ status }) => {
    const currentSession = onlineUsers.get(socket.id);
    if (!currentSession) return;

    currentSession.presenceStatus = sanitizePresenceStatus(status);
    touchSession(currentSession);
    onlineUsers.set(socket.id, currentSession);

    if (currentSession.roomSlug) {
      updateUserList(currentSession.roomSlug);
    }

    socket.emit("presence updated", serializeSession(currentSession));
  });

  socket.on("activity ping", () => {
    const currentSession = onlineUsers.get(socket.id);
    if (!currentSession) return;

    const wasIdle = getEffectivePresenceStatus(currentSession) === "idle";
    touchSession(currentSession);
    onlineUsers.set(socket.id, currentSession);

    if (wasIdle && currentSession.roomSlug) {
      updateUserList(currentSession.roomSlug);
    }
  });

  socket.on("delete message", async ({ messageId }) => {
    const currentSession = onlineUsers.get(socket.id);
    if (!currentSession || !messageId) return;

    const message = store.roomMessages.find((entry) => entry.id === messageId);
    if (!message || message.kind === "system") return;

    const room = getRoomBySlug(message.roomSlug);
    if (!room || !canDeleteMessage(currentSession, room, message)) {
      socket.emit("error message", "You do not have permission to delete that message.");
      return;
    }

    store.roomMessages = store.roomMessages.filter((entry) => entry.id !== messageId);
    await persistence.deleteRoomMessage(messageId);
    io.to(message.roomSlug).emit("message deleted", {
      messageId,
      roomSlug: message.roomSlug
    });
    emitRoomList();
  });

  socket.on("disconnect", async () => {
    const currentSession = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);

    if (currentSession?.accountType === "registered") {
      const storedUser = findUserById(currentSession.id);
      if (storedUser) {
        storedUser.preferences = sanitizePreferences({
          ...(storedUser.preferences || {}),
          lastSeenAt: new Date().toISOString()
        });
        try {
          await persistence.updateUser(storedUser);
        } catch (error) {
          console.error("Failed to persist disconnect state.", error);
        }
      }
    }

    if (currentSession?.roomSlug) {
      updateUserList(currentSession.roomSlug);
      emitMediaState(currentSession.roomSlug);
    }

    emitRoomList();
  });
});

setInterval(() => {
  const activeRooms = new Set(
    Array.from(onlineUsers.values())
      .map((session) => session.roomSlug)
      .filter(Boolean)
  );

  activeRooms.forEach((roomSlug) => {
    updateUserList(roomSlug);
  });
}, 60 * 1000);

async function start() {
  persistence = await createPersistence(DEFAULT_ROOMS, {
    maxRoomMessages: MAX_ROOM_MESSAGES,
    maxPrivateMessages: MAX_PRIVATE_MESSAGES
  });
  store = persistence.store;

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Persistence mode: ${persistence.mode}`);
    if (persistence.mode === "file") {
      console.warn("DATABASE_URL is not configured. Accounts and history can still wipe on redeploys.");
    }
  });
}

start().catch((error) => {
  console.error("Failed to start ChatDude persistence layer.", error);
  process.exit(1);
});
