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

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join room", ({ username, room }) => {
    socket.join(room);
    users[socket.id] = { username, room };

    socket.to(room).emit("system message", `${username} joined the room`);
  });

  socket.on("chat message", (msg) => {
    const user = users[socket.id];
    if (!user) return;

    io.to(user.room).emit("chat message", {
      username: user.username,
      message: msg
    });
  });

  socket.on("disconnect", () => {
    const user = users[socket.id];
    if (user) {
      socket.to(user.room).emit("system message", `${user.username} left the room`);
      delete users[socket.id];
    }

    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});