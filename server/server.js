const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

// 🔥 IMPORTANT: allow your frontend
const allowedOrigins = [
  "http://localhost:5173",
  "https://flash-sigma-eight.vercel.app"
];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST"],
  credentials: true
}));

app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

const server = http.createServer(app);

// 🔥 Socket.io with CORS fix
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

// store code → peerId
const codeMap = {};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("register-code", ({ code, peerId }) => {
    codeMap[code] = peerId;
    console.log("Stored:", code, peerId);
  });

  socket.on("get-peer", (code, callback) => {
    const peerId = codeMap[code];
    console.log("Requested:", code, "→", peerId);
    callback(peerId || null);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// 🔥 IMPORTANT FOR RENDER
const PORT = process.env.PORT || 5000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});