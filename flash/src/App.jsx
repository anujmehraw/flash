import { useEffect, useState } from "react";
import Peer from "peerjs";
import { io } from "socket.io-client";
import { QRCodeCanvas } from "qrcode.react";

const socket = io("https://flash-66bi.onrender.com", {
  transports: ["polling"], // 🔥 force polling instead of websocket
});

export default function App() {
  const [peer, setPeer] = useState(null);
  const [peerReady, setPeerReady] = useState(false);
  const [myCode, setMyCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [mode, setMode] = useState("file"); // 🔥 mode switch
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [receivedFile, setReceivedFile] = useState(null);
  const [receivedText, setReceivedText] = useState("");
  const [progress, setProgress] = useState(0);

  // 🔥 QR AUTO-FILL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeFromQR = params.get("code");

    if (codeFromQR) {
      setInputCode(codeFromQR.toUpperCase());
    }
  }, []);

  useEffect(() => {
    const newPeer = new Peer({
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
        ],
      },
    });

    newPeer.on("open", (id) => {
      setPeerReady(true);

      const code = Math.random().toString(36).substring(2, 6).toUpperCase();
      setMyCode(code);

      socket.emit("register-code", { code, peerId: id });
    });

    // 🔥 RECEIVER
    newPeer.on("connection", (conn) => {
      let chunks = [];
      let fileMeta = null;

      conn.on("data", (data) => {
        // TEXT
        if (typeof data === "object" && data.type === "text") {
          setReceivedText(data.message);
          return;
        }

        // FILE META
        if (typeof data === "object" && data.fileName) {
          fileMeta = data;
          return;
        }

        // FILE END
        if (data === "EOF") {
          const blob = new Blob(chunks, {
            type: fileMeta?.fileType,
          });

          blob.name = fileMeta?.fileName;
          setReceivedFile(blob);
          setProgress(100);
          chunks = [];
          return;
        }

        chunks.push(data);

        // progress
        setProgress((prev) => Math.min(prev + 2, 95));
      });
    });

    setPeer(newPeer);
  }, []);

  // 🔥 SEND FILE
  const sendFile = () => {
    if (!peerReady || !file) return;

    socket.emit("get-peer", inputCode, (remotePeerId) => {
      const conn = peer.connect(remotePeerId);

      conn.on("open", async () => {
        setProgress(0);

        conn.send({
          fileName: file.name,
          fileType: file.type,
        });

        const chunkSize = 16 * 1024;
        const buffer = await file.arrayBuffer();

        let offset = 0;

        while (offset < buffer.byteLength) {
          const chunk = buffer.slice(offset, offset + chunkSize);
          conn.send(chunk);
          offset += chunkSize;

          setProgress(Math.floor((offset / buffer.byteLength) * 100));
        }

        conn.send("EOF");
      });
    });
  };

  // 🔥 SEND TEXT
  const sendText = () => {
    if (!peerReady || !text) return;

    socket.emit("get-peer", inputCode, (remotePeerId) => {
      const conn = peer.connect(remotePeerId);

      conn.on("open", () => {
        conn.send({
          type: "text",
          message: text,
        });
      });
    });
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center gap-4 p-6">
      <h1 className="text-3xl font-bold">Flash⚡</h1>

      {/* CODE + QR */}
      <div className="bg-gray-800 p-4 rounded text-center">
        <p>Your Code:</p>
        <h2 className="text-green-400 text-xl">{myCode}</h2>

        <QRCodeCanvas
          value={`http://${window.location.hostname}:5173/?code=${myCode}`}
          size={120}
        />
      </div>

      {/* ENTER CODE */}
      <input
        placeholder="Enter receiver code"
        value={inputCode}
        onChange={(e) => setInputCode(e.target.value.toUpperCase())}
        className="bg-white text-black p-2 rounded w-64"
      />

      {/* 🔥 MODE SWITCH */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode("file")}
          className={`px-3 py-1 rounded ${
            mode === "file" ? "bg-blue-500" : "bg-gray-600"
          }`}
        >
          File
        </button>

        <button
          onClick={() => setMode("text")}
          className={`px-3 py-1 rounded ${
            mode === "text" ? "bg-green-500" : "bg-gray-600"
          }`}
        >
          Text
        </button>
      </div>

      {/* FILE MODE */}
      {mode === "file" && (
        <>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files[0])}
            className="bg-white text-black p-2 rounded"
          />
          <button onClick={sendFile} className="bg-blue-500 px-4 py-2 rounded">
            Send File
          </button>
        </>
      )}

      {/* TEXT MODE */}
      {mode === "text" && (
        <>
          <textarea
            placeholder="Enter text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="bg-white text-black p-2 rounded w-64"
          />
          <button onClick={sendText} className="bg-green-500 px-4 py-2 rounded">
            Send Text
          </button>
        </>
      )}

      {/* PROGRESS */}
      {progress > 0 && (
        <div className="w-64 bg-gray-700 rounded">
          <div
            className="bg-green-500 h-3 rounded"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      )}

      {/* RECEIVED TEXT */}
      {receivedText && (
        <div className="bg-gray-800 p-3 rounded w-64">
          <p>Received Text:</p>
          <p className="text-yellow-400">{receivedText}</p>
        </div>
      )}

      {/* RECEIVED FILE */}
      {receivedFile && (
        <a
          href={URL.createObjectURL(receivedFile)}
          download={receivedFile.name}
          className="text-yellow-400 underline"
        >
          Download {receivedFile.name}
        </a>
      )}
    </div>
  );
}