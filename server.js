const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const AUTH_SECRET = process.env.AUTH_SECRET || "chatdude-dev-secret-change-me";
const MAX_ROOM_MESSAGES = 120;
const MAX_PRIVATE_MESSAGES = 60;
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

function ensureDataStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(STORE_FILE)) {
    const initialStore = {
      users: [],
      rooms: DEFAULT_ROOMS,
      roomMessages: [],
      privateMessages: []
    };

    fs.writeFileSync(STORE_FILE, JSON.stringify(initialStore, null, 2));
  }
}

function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function loadStore() {
  ensureDataStore();

  const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));

  if (!Array.isArray(parsed.users)) parsed.users = [];
  if (!Array.isArray(parsed.rooms)) parsed.rooms = [];
  if (!Array.isArray(parsed.roomMessages)) parsed.roomMessages = [];
  if (!Array.isArray(parsed.privateMessages)) parsed.privateMessages = [];

  DEFAULT_ROOMS.forEach((room) => {
    if (!parsed.rooms.some((existing) => existing.slug === room.slug)) {
      parsed.rooms.push(room);
    }
  });

  saveStore(parsed);
  return parsed;
}

let store = loadStore();

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
  const fonts = ["Space Grotesk", "DM Sans", "Manrope", "IBM Plex Sans"];
  const backgrounds = ["aurora", "midnight", "sunrise"];

  return {
    accentColor: /^#[0-9a-fA-F]{6}$/.test(preferences.accentColor || "")
      ? preferences.accentColor
      : "#38bdf8",
    bubbleColor: /^#[0-9a-fA-F]{6}$/.test(preferences.bubbleColor || "")
      ? preferences.bubbleColor
      : "#1d4ed8",
    fontFamily: fonts.includes(preferences.fontFamily)
      ? preferences.fontFamily
      : "Space Grotesk",
    backgroundStyle: backgrounds.includes(preferences.backgroundStyle)
      ? preferences.backgroundStyle
      : "aurora"
  };
}

function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    accountType: "registered",
    preferences: sanitizePreferences(user.preferences || {})
  };
}

function serializeSession(session) {
  return {
    id: session.id,
    username: session.username,
    displayName: session.displayName,
    accountType: session.accountType,
    isGuest: session.accountType === "guest",
    canCustomize: session.accountType === "registered",
    canCreateRooms: session.accountType === "registered",
    canPrivateMessage: session.accountType === "registered",
    preferences: sanitizePreferences(session.preferences || {})
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
    socketId: socketIdOverride || message.socketId || null,
    time: message.time,
    timestamp: message.timestamp
  };
}

function buildPrivateMessagePayload(message, socketIdOverride) {
  return {
    id: message.id,
    from: message.fromLabel,
    fromUsername: message.fromUsername,
    fromSocketId: socketIdOverride || message.fromSocketId || null,
    message: message.message,
    time: message.time,
    timestamp: message.timestamp
  };
}

function saveMessage(message) {
  store.roomMessages.push(message);
  const roomMessages = store.roomMessages.filter((entry) => entry.roomSlug === message.roomSlug);

  if (roomMessages.length > MAX_ROOM_MESSAGES) {
    const removableCount = roomMessages.length - MAX_ROOM_MESSAGES;
    const removableIds = new Set(roomMessages.slice(0, removableCount).map((entry) => entry.id));
    store.roomMessages = store.roomMessages.filter((entry) => !removableIds.has(entry.id));
  }

  saveStore(store);
}

function savePrivateMessage(message) {
  store.privateMessages.push(message);
  if (store.privateMessages.length > MAX_PRIVATE_MESSAGES) {
    store.privateMessages = store.privateMessages.slice(-MAX_PRIVATE_MESSAGES);
  }
  saveStore(store);
}

function getUsersInRoom(roomSlug) {
  return Array.from(onlineUsers.entries())
    .filter(([, session]) => session.roomSlug === roomSlug)
    .map(([socketId, session]) => ({
      socketId,
      userId: session.id,
      username: session.username,
      displayName: session.displayName,
      accountType: session.accountType,
      isGuest: session.accountType === "guest",
      isPublishing: Boolean(session.isPublishing),
      cameraEnabled: Boolean(session.cameraEnabled)
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

function getPublishedMediaInRoom(roomSlug) {
  return Array.from(onlineUsers.entries())
    .filter(([, session]) => session.roomSlug === roomSlug && session.isPublishing)
    .map(([socketId, session]) => ({
      socketId,
      username: session.username,
      displayName: session.displayName,
      cameraEnabled: Boolean(session.cameraEnabled),
      micEnabled: Boolean(session.micEnabled)
    }));
}

function updateUserList(roomSlug) {
  io.to(roomSlug).emit("user list", getUsersInRoom(roomSlug));
}

function emitRoomList() {
  io.emit("room list", store.rooms.map(serializeRoom));
}

function emitMediaState(roomSlug) {
  io.to(roomSlug).emit("room media state", {
    roomSlug,
    publishers: getPublishedMediaInRoom(roomSlug)
  });
}

function getRoomBySlug(roomSlug) {
  return store.rooms.find((room) => room.slug === roomSlug) || null;
}

function getRoomHistory(roomSlug) {
  return store.roomMessages
    .filter((message) => message.roomSlug === roomSlug)
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

function createSystemMessage(roomSlug, text) {
  const message = {
    id: crypto.randomUUID(),
    kind: "system",
    roomSlug,
    message: text,
    username: "ChatDude",
    displayName: "ChatDude",
    accountType: "system",
    senderId: "system",
    ...createTimestampPayload()
  };

  saveMessage(message);
  io.to(roomSlug).emit("system message", buildMessagePayload(message, null));
  emitRoomList();
}

app.use(corsMiddleware);
app.use(express.json());
app.use(express.static(__dirname));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
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

app.post("/api/auth/register", (req, res) => {
  const username = normalizeUsername(req.body.username || "");
  const displayName = normalizeUsername(req.body.displayName || username);
  const password = req.body.password || "";

  if (!isValidUsername(username)) {
    res.status(400).json({ error: "Username must be 3-20 characters using letters, numbers, or underscores." });
    return;
  }

  if (!isValidPassword(password)) {
    res.status(400).json({ error: "Password must be between 8 and 72 characters." });
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
    preferences: sanitizePreferences({})
  };

  store.users.push(user);
  saveStore(store);

  res.status(201).json({
    token: issueAuthToken(user),
    user: toPublicUser(user)
  });
});

app.post("/api/auth/login", (req, res) => {
  const username = normalizeUsername(req.body.username || "");
  const password = req.body.password || "";
  const user = findUserByUsername(username);

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

app.patch("/api/me/preferences", requireAuth, (req, res) => {
  req.user.preferences = sanitizePreferences(req.body.preferences || {});
  saveStore(store);

  for (const [socketId, session] of onlineUsers.entries()) {
    if (session.id === req.user.id) {
      onlineUsers.set(socketId, {
        ...session,
        preferences: req.user.preferences
      });
      io.to(socketId).emit("preferences updated", sanitizePreferences(req.user.preferences));
    }
  }

  res.json({
    user: toPublicUser(req.user)
  });
});

app.post("/api/rooms", requireAuth, (req, res) => {
  const name = normalizeUsername(req.body.name || "");
  const description = normalizeUsername(req.body.description || "");
  const slug = slugifyRoomName(name);

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
  saveStore(store);
  emitRoomList();

  res.status(201).json({
    room: serializeRoom(room)
  });
});

app.delete("/api/rooms/:slug", requireAuth, (req, res) => {
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
  saveStore(store);

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
        roomSlug: null,
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
      roomSlug: null,
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
      createSystemMessage(previousRoom, `${currentSession.username} left the room`);
    }

    createSystemMessage(room.slug, `${currentSession.username} joined the room`);
  });

  socket.on("chat message", ({ message }) => {
    const currentSession = onlineUsers.get(socket.id);
    const trimmed = String(message || "").trim();

    if (!currentSession || !currentSession.roomSlug || !trimmed) return;

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
      socketId: socket.id,
      ...createTimestampPayload()
    };

    saveMessage(entry);
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

    currentSession.isTyping = Boolean(isTyping);
    onlineUsers.set(socket.id, currentSession);

    const usersNowTyping = Array.from(onlineUsers.values())
      .filter((otherSession) => otherSession.roomSlug === currentSession.roomSlug && otherSession.isTyping)
      .map((otherSession) => otherSession.username)
      .filter((name) => name !== currentSession.username);

    io.to(currentSession.roomSlug).emit("typing update", usersNowTyping);
  });

  socket.on("private message", ({ toSocketId, message }) => {
    const currentSession = onlineUsers.get(socket.id);
    const recipientSession = onlineUsers.get(toSocketId);
    const trimmed = String(message || "").trim();

    if (!currentSession || !recipientSession || !trimmed) return;

    if (currentSession.accountType !== "registered") {
      socket.emit("error message", "Guests can join rooms, but private messages are for registered users.");
      return;
    }

    const entry = {
      id: crypto.randomUUID(),
      fromUserId: currentSession.id,
      toUserId: recipientSession.id,
      fromUsername: currentSession.username,
      toUsername: recipientSession.username,
      fromLabel: currentSession.username,
      message: trimmed.slice(0, 600),
      fromSocketId: socket.id,
      ...createTimestampPayload()
    };

    savePrivateMessage(entry);

    io.to(toSocketId).emit("private message", buildPrivateMessagePayload(entry, socket.id));
    socket.emit("private message", buildPrivateMessagePayload({
      ...entry,
      fromLabel: `(to ${recipientSession.username})`
    }, toSocketId));
  });

  socket.on("start publishing", () => {
    const currentSession = onlineUsers.get(socket.id);
    if (!currentSession || !currentSession.roomSlug) return;

    if (currentSession.accountType !== "registered") {
      socket.emit("error message", "Camera publishing is available for registered users.");
      return;
    }

    currentSession.isPublishing = true;
    currentSession.cameraEnabled = true;
    currentSession.micEnabled = true;
    onlineUsers.set(socket.id, currentSession);
    updateUserList(currentSession.roomSlug);
    emitMediaState(currentSession.roomSlug);
  });

  socket.on("stop publishing", () => {
    const currentSession = onlineUsers.get(socket.id);
    if (!currentSession || !currentSession.roomSlug) return;

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

    io.to(toSocketId).emit("webrtc ice candidate", {
      fromSocketId: socket.id,
      candidate
    });
  });

  socket.on("delete message", ({ messageId }) => {
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
    saveStore(store);
    io.to(message.roomSlug).emit("message deleted", {
      messageId,
      roomSlug: message.roomSlug
    });
    emitRoomList();
  });

  socket.on("disconnect", () => {
    const currentSession = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);

    if (currentSession?.roomSlug) {
      createSystemMessage(currentSession.roomSlug, `${currentSession.username} left the room`);
      updateUserList(currentSession.roomSlug);
      emitMediaState(currentSession.roomSlug);
    }

    emitRoomList();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
