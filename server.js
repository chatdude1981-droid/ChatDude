const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(__dirname));

const users = {};

function getUsersInRoom(room) {
  return Object.entries(users)
    .filter(([_, user]) => user.room === room)
    .map(([socketId, user]) => ({
      socketId,
      username: user.username
    }));
}

function updateUserList(room) {
  io.to(room).emit("user list", getUsersInRoom(room));
}

function timestamp() {
  return new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join room", ({ username, room }) => {
    socket.join(room);
    users[socket.id] = { username, room };

    socket.emit("joined room", {
      socketId: socket.id,
      room,
      username
    });

    socket.to(room).emit("system message", {
      message: `${username} joined the room`,
      time: timestamp()
    });

    updateUserList(room);
  });

  socket.on("chat message", (msg) => {
    const user = users[socket.id];
    if (!user || !msg || !msg.trim()) return;

    io.to(user.room).emit("chat message", {
      username: user.username,
      socketId: socket.id,
      message: msg.trim(),
      time: timestamp()
    });
  });

  socket.on("private message", ({ toSocketId, message }) => {
    const fromUser = users[socket.id];
    const toUser = users[toSocketId];

    if (!fromUser || !toUser || !message || !message.trim()) return;

    io.to(toSocketId).emit("private message", {
      from: fromUser.username,
      fromSocketId: socket.id,
      message: message.trim(),
      time: timestamp()
    });

    socket.emit("private message", {
      from: `(to ${toUser.username})`,
      fromSocketId: toSocketId,
      message: message.trim(),
      time: timestamp()
    });
  });

  socket.on("disconnect", () => {
    const user = users[socket.id];

    if (user) {
      socket.to(user.room).emit("system message", {
        message: `${user.username} left the room`,
        time: timestamp()
      });

      delete users[socket.id];
      updateUserList(user.room);
    }

    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});