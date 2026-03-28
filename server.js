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

  socket.on("set username", (username) => {
    users[socket.id] = username;

    io.emit("system message", `${username} joined the chat`);
  });

  socket.on("chat message", (msg) => {
    const username = users[socket.id] || "Anonymous";
    io.emit("chat message", {
      username,
      message: msg
    });
  });

  socket.on("disconnect", () => {
    const username = users[socket.id];
    if (username) {
      io.emit("system message", `${username} left the chat`);
      delete users[socket.id];
    }

    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});