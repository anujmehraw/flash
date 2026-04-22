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
  const appUrl = window.location.origin;

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
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-8 md:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/40 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Flash⚡</h1>
              <p className="mt-2 text-sm text-slate-300">
                Transfer files and text instantly using secure peer-to-peer
                connections.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                peerReady
                  ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30"
                  : "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30"
              }`}
            >
              {peerReady ? "Connected" : "Connecting..."}
            </span>
          </div>
        </header>

        <main className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl shadow-slate-950/30">
            <p className="text-sm font-medium text-slate-300">Your Share Code</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-[0.2em] text-emerald-300">
              {myCode || "----"}
            </h2>
            <div className="mt-4 inline-block rounded-xl bg-white p-3">
              <QRCodeCanvas value={`${appUrl}/?code=${myCode}`} size={140} />
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Ask receiver to scan this QR or enter your code.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl shadow-slate-950/30">
            <label className="text-sm font-medium text-slate-300">
              Receiver Code
            </label>
            <input
              placeholder="Enter receiver code"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value.toUpperCase())}
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm uppercase tracking-widest text-slate-100 outline-none transition focus:border-blue-500"
            />

            <div className="mt-4 flex w-full rounded-lg bg-slate-800 p-1">
              <button
                onClick={() => setMode("file")}
                className={`w-1/2 rounded-md px-3 py-2 text-sm font-medium transition ${
                  mode === "file"
                    ? "bg-blue-500 text-white"
                    : "text-slate-300 hover:bg-slate-700"
                }`}
              >
                File Transfer
              </button>
              <button
                onClick={() => setMode("text")}
                className={`w-1/2 rounded-md px-3 py-2 text-sm font-medium transition ${
                  mode === "text"
                    ? "bg-emerald-500 text-white"
                    : "text-slate-300 hover:bg-slate-700"
                }`}
              >
                Text Message
              </button>
            </div>

            {mode === "file" && (
              <div className="mt-4 space-y-3">
                <input
                  type="file"
                  onChange={(e) => setFile(e.target.files[0])}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 file:mr-3 file:rounded-md file:border-0 file:bg-blue-500 file:px-3 file:py-1.5 file:text-white"
                />
                <button
                  onClick={sendFile}
                  disabled={!peerReady || !file || !inputCode}
                  className="w-full rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Send File
                </button>
              </div>
            )}

            {mode === "text" && (
              <div className="mt-4 space-y-3">
                <textarea
                  placeholder="Type your message..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="h-28 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-500"
                />
                <button
                  onClick={sendText}
                  disabled={!peerReady || !text || !inputCode}
                  className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Send Text
                </button>
              </div>
            )}
          </section>
        </main>

        {progress > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
              <span>Transfer Progress</span>
              <span>{progress}%</span>
            </div>
            <div className="h-3 w-full rounded-full bg-slate-700">
              <div
                className="h-3 rounded-full bg-emerald-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </section>
        )}

        {(receivedText || receivedFile) && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
              Received
            </h3>
            {receivedText && (
              <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3">
                <p className="text-xs font-medium text-amber-200">Text Message</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-amber-100">
                  {receivedText}
                </p>
              </div>
            )}
            {receivedFile && (
              <a
                href={URL.createObjectURL(receivedFile)}
                download={receivedFile.name}
                className="mt-3 inline-flex rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-amber-300"
              >
                Download {receivedFile.name}
              </a>
            )}
          </section>
        )}
      </div>
    </div>
  );
}