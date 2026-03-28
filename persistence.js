const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

function ensureFileStore(defaultRooms) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(STORE_FILE)) {
    const initialStore = {
      users: [],
      rooms: defaultRooms,
      roomMessages: [],
      privateMessages: []
    };

    fs.writeFileSync(STORE_FILE, JSON.stringify(initialStore, null, 2));
  }
}

function loadFileStore(defaultRooms) {
  ensureFileStore(defaultRooms);
  const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));

  if (!Array.isArray(parsed.users)) parsed.users = [];
  if (!Array.isArray(parsed.rooms)) parsed.rooms = [];
  if (!Array.isArray(parsed.roomMessages)) parsed.roomMessages = [];
  if (!Array.isArray(parsed.privateMessages)) parsed.privateMessages = [];

  defaultRooms.forEach((room) => {
    if (!parsed.rooms.some((existing) => existing.slug === room.slug)) {
      parsed.rooms.push(room);
    }
  });

  fs.writeFileSync(STORE_FILE, JSON.stringify(parsed, null, 2));
  return parsed;
}

function saveFileStore(store) {
  ensureFileStore(store.rooms || []);
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function fromJson(value, fallback) {
  if (value == null) {
    return fallback;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function normalizeStore(defaultRooms, store) {
  const normalized = {
    users: Array.isArray(store.users) ? store.users : [],
    rooms: Array.isArray(store.rooms) ? store.rooms : [],
    roomMessages: Array.isArray(store.roomMessages) ? store.roomMessages : [],
    privateMessages: Array.isArray(store.privateMessages) ? store.privateMessages : []
  };

  defaultRooms.forEach((room) => {
    if (!normalized.rooms.some((existing) => existing.slug === room.slug)) {
      normalized.rooms.push(room);
    }
  });

  normalized.rooms.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  normalized.roomMessages.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  normalized.privateMessages.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  return normalized;
}

async function createPersistence(defaultRooms, options = {}) {
  const databaseUrl = process.env.DATABASE_URL || "";
  const maxRoomMessages = options.maxRoomMessages || 120;
  const maxPrivateMessages = options.maxPrivateMessages || 60;

  if (!databaseUrl) {
    const store = loadFileStore(defaultRooms);

    return {
      mode: "file",
      store,
      async updateUser(_user) {
        saveFileStore(store);
      },
      async createUser(_user) {
        saveFileStore(store);
      },
      async createRoom(_room) {
        saveFileStore(store);
      },
      async deleteRoom(_roomSlug) {
        saveFileStore(store);
      },
      async saveRoomMessage(_message) {
        saveFileStore(store);
      },
      async deleteRoomMessage(_messageId) {
        saveFileStore(store);
      },
      async savePrivateMessage(_message) {
        saveFileStore(store);
      }
    };
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.PGSSL_DISABLE === "true" ? false : { rejectUnauthorized: false }
  });

  async function query(text, params) {
    return pool.query(text, params);
  }

  async function ensureSchema() {
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
        blocked_users JSONB NOT NULL DEFAULT '[]'::jsonb,
        friends JSONB NOT NULL DEFAULT '[]'::jsonb
      );
    `);

    await query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS friends JSONB NOT NULL DEFAULT '[]'::jsonb;
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        created_by TEXT NOT NULL,
        system BOOLEAN NOT NULL DEFAULT FALSE
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS room_messages (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        room_slug TEXT NOT NULL,
        message TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        sender_id TEXT,
        account_type TEXT NOT NULL,
        socket_id TEXT,
        time TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS room_messages_room_slug_timestamp_idx
      ON room_messages (room_slug, timestamp ASC);
    `);

    await query(`
      ALTER TABLE room_messages
      ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS private_messages (
        id TEXT PRIMARY KEY,
        from_user_id TEXT NOT NULL,
        to_user_id TEXT NOT NULL,
        from_username TEXT NOT NULL,
        to_username TEXT NOT NULL,
        from_display_name TEXT NOT NULL,
        to_display_name TEXT NOT NULL,
        from_label TEXT NOT NULL,
        message TEXT NOT NULL,
        from_socket_id TEXT,
        to_socket_id TEXT,
        time TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS private_messages_timestamp_idx
      ON private_messages (timestamp ASC);
    `);

    await query(`
      ALTER TABLE private_messages
      ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
    `);
  }

  async function seedDefaultRooms() {
    for (const room of defaultRooms) {
      await query(
        `
          INSERT INTO rooms (id, slug, name, description, created_at, created_by, system)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (slug) DO NOTHING
        `,
        [room.id, room.slug, room.name, room.description, room.createdAt, room.createdBy, room.system]
      );
    }
  }

  async function maybeImportFileStore() {
    if (!fs.existsSync(STORE_FILE)) {
      return;
    }

    const counts = await Promise.all([
      query("SELECT COUNT(*)::int AS count FROM users"),
      query("SELECT COUNT(*)::int AS count FROM room_messages"),
      query("SELECT COUNT(*)::int AS count FROM private_messages")
    ]);

    const hasData = counts.some((result) => result.rows[0].count > 0);
    if (hasData) {
      return;
    }

    const fileStore = loadFileStore(defaultRooms);

    for (const user of fileStore.users) {
      await query(
        `
          INSERT INTO users (id, username, display_name, password_hash, created_at, preferences, blocked_users, friends)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          user.id,
          user.username,
          user.displayName,
          user.passwordHash,
          user.createdAt,
          toJson(user.preferences || {}),
          toJson(user.blockedUsers || []),
          toJson(user.friends || [])
        ]
      );
    }

    for (const room of fileStore.rooms) {
      await query(
        `
          INSERT INTO rooms (id, slug, name, description, created_at, created_by, system)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (slug) DO NOTHING
        `,
        [room.id, room.slug, room.name, room.description, room.createdAt, room.createdBy, room.system]
      );
    }

    for (const message of fileStore.roomMessages) {
      await query(
        `
          INSERT INTO room_messages (id, kind, room_slug, message, username, display_name, sender_id, account_type, socket_id, time, timestamp, preferences)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          message.id,
          message.kind,
          message.roomSlug,
          message.message,
          message.username,
          message.displayName || message.username,
          message.senderId || null,
          message.accountType || "guest",
          message.socketId || null,
          message.time,
          message.timestamp,
          toJson(message.preferences || {})
        ]
      );
    }

    for (const message of fileStore.privateMessages) {
      await query(
        `
          INSERT INTO private_messages (id, from_user_id, to_user_id, from_username, to_username, from_display_name, to_display_name, from_label, message, from_socket_id, to_socket_id, time, timestamp, preferences)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          message.id,
          message.fromUserId,
          message.toUserId,
          message.fromUsername,
          message.toUsername,
          message.fromDisplayName || message.fromUsername,
          message.toDisplayName || message.toUsername,
          message.fromLabel,
          message.message,
          message.fromSocketId || null,
          message.toSocketId || null,
          message.time,
          message.timestamp,
          toJson(message.preferences || {})
        ]
      );
    }
  }

  async function loadDatabaseStore() {
    const [usersResult, roomsResult, roomMessagesResult, privateMessagesResult] = await Promise.all([
      query("SELECT * FROM users ORDER BY created_at ASC"),
      query("SELECT * FROM rooms ORDER BY created_at ASC"),
      query("SELECT * FROM room_messages ORDER BY timestamp ASC"),
      query("SELECT * FROM private_messages ORDER BY timestamp ASC")
    ]);

    return normalizeStore(defaultRooms, {
      users: usersResult.rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        passwordHash: row.password_hash,
        createdAt: new Date(row.created_at).toISOString(),
        preferences: fromJson(row.preferences, {}),
        blockedUsers: fromJson(row.blocked_users, []),
        friends: fromJson(row.friends, [])
      })),
      rooms: roomsResult.rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        createdAt: new Date(row.created_at).toISOString(),
        createdBy: row.created_by,
        system: Boolean(row.system)
      })),
      roomMessages: roomMessagesResult.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        roomSlug: row.room_slug,
        message: row.message,
        username: row.username,
        displayName: row.display_name,
        senderId: row.sender_id,
        accountType: row.account_type,
        preferences: fromJson(row.preferences, {}),
        socketId: row.socket_id,
        time: row.time,
        timestamp: new Date(row.timestamp).toISOString()
      })),
      privateMessages: privateMessagesResult.rows.map((row) => ({
        id: row.id,
        fromUserId: row.from_user_id,
        toUserId: row.to_user_id,
        fromUsername: row.from_username,
        toUsername: row.to_username,
        fromDisplayName: row.from_display_name,
        toDisplayName: row.to_display_name,
        fromLabel: row.from_label,
        preferences: fromJson(row.preferences, {}),
        message: row.message,
        fromSocketId: row.from_socket_id,
        toSocketId: row.to_socket_id,
        time: row.time,
        timestamp: new Date(row.timestamp).toISOString()
      }))
    });
  }

  async function trimRoomMessages(roomSlug, store) {
    const roomMessages = store.roomMessages.filter((entry) => entry.roomSlug === roomSlug);
    if (roomMessages.length <= maxRoomMessages) {
      return;
    }

    const removable = roomMessages.slice(0, roomMessages.length - maxRoomMessages).map((entry) => entry.id);
    store.roomMessages = store.roomMessages.filter((entry) => !removable.includes(entry.id));
    await query("DELETE FROM room_messages WHERE id = ANY($1::text[])", [removable]);
  }

  async function trimPrivateMessages(store) {
    if (store.privateMessages.length <= maxPrivateMessages) {
      return;
    }

    const removable = store.privateMessages.slice(0, store.privateMessages.length - maxPrivateMessages).map((entry) => entry.id);
    store.privateMessages = store.privateMessages.filter((entry) => !removable.includes(entry.id));
    await query("DELETE FROM private_messages WHERE id = ANY($1::text[])", [removable]);
  }

  await ensureSchema();
  await seedDefaultRooms();
  await maybeImportFileStore();
  const store = await loadDatabaseStore();

  return {
    mode: "postgres",
    store,
    async updateUser(user) {
      await query(
        `
          INSERT INTO users (id, username, display_name, password_hash, created_at, preferences, blocked_users, friends)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
          ON CONFLICT (id) DO UPDATE SET
            username = EXCLUDED.username,
            display_name = EXCLUDED.display_name,
            password_hash = EXCLUDED.password_hash,
            created_at = EXCLUDED.created_at,
            preferences = EXCLUDED.preferences,
            blocked_users = EXCLUDED.blocked_users,
            friends = EXCLUDED.friends
        `,
        [user.id, user.username, user.displayName, user.passwordHash, user.createdAt, toJson(user.preferences || {}), toJson(user.blockedUsers || []), toJson(user.friends || [])]
      );
    },
    async createUser(user) {
      await this.updateUser(user);
    },
    async createRoom(room) {
      await query(
        `
          INSERT INTO rooms (id, slug, name, description, created_at, created_by, system)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [room.id, room.slug, room.name, room.description, room.createdAt, room.createdBy, room.system]
      );
    },
    async deleteRoom(roomSlug) {
      await query("DELETE FROM room_messages WHERE room_slug = $1", [roomSlug]);
      await query("DELETE FROM rooms WHERE slug = $1", [roomSlug]);
    },
    async saveRoomMessage(message) {
      await query(
        `
          INSERT INTO room_messages (id, kind, room_slug, message, username, display_name, sender_id, account_type, socket_id, time, timestamp, preferences)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        `,
        [
          message.id,
          message.kind,
          message.roomSlug,
          message.message,
          message.username,
          message.displayName || message.username,
          message.senderId || null,
          message.accountType || "guest",
          message.socketId || null,
          message.time,
          message.timestamp,
          toJson(message.preferences || {})
        ]
      );
      await trimRoomMessages(message.roomSlug, store);
    },
    async deleteRoomMessage(messageId) {
      await query("DELETE FROM room_messages WHERE id = $1", [messageId]);
    },
    async savePrivateMessage(message) {
      await query(
        `
          INSERT INTO private_messages (id, from_user_id, to_user_id, from_username, to_username, from_display_name, to_display_name, from_label, message, from_socket_id, to_socket_id, time, timestamp, preferences)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
        `,
        [
          message.id,
          message.fromUserId,
          message.toUserId,
          message.fromUsername,
          message.toUsername,
          message.fromDisplayName || message.fromUsername,
          message.toDisplayName || message.toUsername,
          message.fromLabel,
          message.message,
          message.fromSocketId || null,
          message.toSocketId || null,
          message.time,
          message.timestamp,
          toJson(message.preferences || {})
        ]
      );
      await trimPrivateMessages(store);
    }
  };
}

module.exports = {
  createPersistence
};
