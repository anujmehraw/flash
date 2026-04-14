const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const codeMap = {};

io.on("connection", (socket) => {
  console.log("User connected");

  socket.on("register-code", ({ code, peerId }) => {
    codeMap[code] = peerId;
    console.log("Stored:", code, peerId);
  });

  socket.on("get-peer", (code, callback) => {
    const peerId = codeMap[code];
    callback(peerId || null);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});