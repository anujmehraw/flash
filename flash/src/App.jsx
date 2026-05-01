import { useEffect, useState, useRef } from "react";
import Peer from "peerjs";
import { io } from "socket.io-client";
import { QRCodeCanvas } from "qrcode.react";
import { Html5QrcodeScanner } from "html5-qrcode";

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
  const [messages, setMessages] = useState([]); // 🔥 Chat history
  const [progress, setProgress] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [isScanning, setIsScanning] = useState(false); // 🔥 QR Scanner state
  const scannerRef = useRef(null);
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
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now(),
              text: data.message,
              sender: "them",
              timestamp: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            },
          ]);
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
    if (!peerReady || !text.trim() || !inputCode) return;

    setIsSending(true);
    socket.emit("get-peer", inputCode, (remotePeerId) => {
      const conn = peer.connect(remotePeerId);

      conn.on("open", () => {
        conn.send({
          type: "text",
          message: text,
        });

        setMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            text: text,
            sender: "me",
            timestamp: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          },
        ]);
        setText("");
        setIsSending(false);
      });

      conn.on("error", (err) => {
        console.error("Connection error:", err);
        setIsSending(false);
      });
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  };

  // 🔥 QR SCANNER EFFECT
  useEffect(() => {
    if (isScanning) {
      const scanner = new Html5QrcodeScanner("reader", {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        rememberLastUsedCamera: true,
      });

      scanner.render(
        (decodedText) => {
          // Success: extract code from URL or use raw text
          try {
            const url = new URL(decodedText);
            const code = url.searchParams.get("code");
            if (code) {
              setInputCode(code.toUpperCase());
            } else {
              setInputCode(decodedText.toUpperCase().substring(0, 4));
            }
          } catch (e) {
            setInputCode(decodedText.toUpperCase().substring(0, 4));
          }
          setIsScanning(false);
          scanner.clear();
        },
        (error) => {
          // Silent errors during scan
        }
      );

      return () => {
        scanner.clear().catch((error) => console.error("Failed to clear scanner", error));
      };
    }
  }, [isScanning]);

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 selection:bg-blue-500/30">
      {/* Background Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-emerald-600/10 blur-[120px] rounded-full" />
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 md:px-6">
        <header className="flex flex-col md:flex-row items-center justify-between gap-6 rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-500 shadow-lg shadow-blue-500/20">
              <span className="text-3xl">⚡</span>
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tight text-white bg-clip-text">
                Flash
              </h1>
              <p className="text-sm font-medium text-slate-400">
                P2P Instant Transfer
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-2 pr-4 border border-white/5">
            <div
              className={`h-3 w-3 rounded-full animate-pulse ${
                peerReady ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]" : "bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.5)]"
              }`}
            />
            <span className="text-sm font-bold uppercase tracking-wider text-slate-300">
              {peerReady ? "Network Active" : "Connecting..."}
            </span>
          </div>
        </header>

        <main className="grid gap-8 lg:grid-cols-12">
          {/* Left Column: Connection Info */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            <section className="group rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-xl backdrop-blur-md transition-all hover:border-white/20">
              <div className="flex items-center justify-between mb-6">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-400">
                  Your Access Key
                </p>
                <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                </div>
              </div>
              
              <div className="flex flex-col items-center gap-6">
                <div className="relative">
                  <div className="absolute -inset-4 bg-gradient-to-br from-blue-500/20 to-emerald-500/20 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                  <h2 className="relative text-5xl font-black tracking-[0.2em] text-white">
                    {myCode || "----"}
                  </h2>
                </div>

                <div className="relative rounded-3xl bg-white p-5 shadow-2xl transition-transform group-hover:scale-[1.02]">
                  <QRCodeCanvas 
                    value={`${appUrl}/?code=${myCode}`} 
                    size={160} 
                    level="H"
                    includeMargin={false}
                  />
                </div>
                
                <p className="text-center text-xs font-medium leading-relaxed text-slate-400 max-w-[200px]">
                  Share this code or scan the QR to establish a secure link.
                </p>
              </div>
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-xl backdrop-blur-md">
              <div className="mb-4 flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">
                  Remote Peer Key
                </label>
                <button
                  onClick={() => setIsScanning(true)}
                  className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-400 transition-all hover:bg-emerald-500 hover:text-white"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Scan
                </button>
              </div>
              <div className="relative">
                <input
                  placeholder="Paste receiver code..."
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-xl font-bold uppercase tracking-widest text-white outline-none ring-blue-500/50 transition focus:border-blue-500/50 focus:ring-4"
                />
              </div>

              <div className="mt-6 flex gap-2 rounded-2xl bg-white/5 p-1.5 border border-white/5">
                <button
                  onClick={() => setMode("file")}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-all ${
                    mode === "file"
                      ? "bg-blue-500 text-white shadow-lg shadow-blue-500/30"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  Files
                </button>
                <button
                  onClick={() => setMode("text")}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-all ${
                    mode === "text"
                      ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  Chat
                </button>
              </div>
            </section>
          </div>

          {/* Right Column: Interaction Area */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            <section className="flex flex-col h-[600px] rounded-[2rem] border border-white/10 bg-white/5 shadow-2xl backdrop-blur-md overflow-hidden">
              {/* Transfer Mode Content */}
              <div className="flex-1 flex flex-col">
                {mode === "file" ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                    <div className="mb-8 flex h-32 w-32 items-center justify-center rounded-[2.5rem] bg-blue-500/10 text-blue-400">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-2">Ready for Transfer</h3>
                    <p className="text-slate-400 mb-8 max-w-sm">Select any file to beam it directly to your connected peer.</p>
                    
                    <div className="w-full max-w-md space-y-4">
                      <label className="group relative block w-full cursor-pointer">
                        <input
                          type="file"
                          onChange={(e) => setFile(e.target.files[0])}
                          className="hidden"
                        />
                        <div className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-white/10 bg-white/5 px-6 py-10 transition-all group-hover:border-blue-500/50 group-hover:bg-blue-500/5">
                          <span className="text-sm font-bold text-slate-300">
                            {file ? file.name : "Choose a file"}
                          </span>
                          <span className="mt-1 text-xs text-slate-500">
                            {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Click to browse"}
                          </span>
                        </div>
                      </label>
                      
                      <button
                        onClick={sendFile}
                        disabled={!peerReady || !file || !inputCode}
                        className="w-full rounded-2xl bg-blue-600 px-8 py-4 text-lg font-black text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-500 hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        Beam File
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col h-full overflow-hidden">
                    {/* Chat Messages */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                      {messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-500 opacity-50">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                          <p className="font-medium">No messages yet. Say hello!</p>
                        </div>
                      ) : (
                        messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex flex-col ${msg.sender === "me" ? "items-end" : "items-start"}`}
                          >
                            <div
                              className={`max-w-[80%] rounded-2xl px-5 py-3 text-sm font-medium shadow-sm ${
                                msg.sender === "me"
                                  ? "bg-emerald-600 text-white rounded-tr-none"
                                  : "bg-white/10 text-slate-100 rounded-tl-none border border-white/5"
                              }`}
                            >
                              <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                              <span className={`mt-1 block text-[10px] opacity-60 ${msg.sender === "me" ? "text-right" : "text-left"}`}>
                                {msg.timestamp}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Chat Input */}
                    <div className="p-6 pt-2 bg-black/20 backdrop-blur-md">
                      <div className="relative flex items-end gap-3 rounded-[1.5rem] border border-white/10 bg-white/5 p-3 transition-all focus-within:border-emerald-500/50">
                        <textarea
                          placeholder="Type a message..."
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          onKeyDown={handleKeyDown}
                          className="flex-1 max-h-32 min-h-[48px] resize-none bg-transparent px-3 py-2 text-sm text-white outline-none custom-scrollbar"
                          rows={1}
                        />
                        <button
                          onClick={sendText}
                          disabled={!peerReady || !text.trim() || !inputCode || isSending}
                          className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {isSending ? (
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 rotate-90" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                            </svg>
                          )}
                        </button>
                      </div>
                      <p className="mt-3 text-center text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        Press Enter to send • Shift + Enter for new line
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>

        {/* Progress & Received Overlay */}
        {(progress > 0 || receivedFile) && (
          <div className="fixed bottom-8 right-8 z-50 flex flex-col gap-4 max-w-sm w-full">
            {progress > 0 && progress < 100 && (
              <section className="rounded-3xl border border-white/10 bg-[#0f172a]/90 p-6 shadow-2xl backdrop-blur-xl animate-in slide-in-from-right">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-widest text-blue-400">Transferring...</span>
                  <span className="text-sm font-bold text-white">{progress}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </section>
            )}

            {receivedFile && (
              <section className="rounded-3xl border border-white/10 bg-emerald-500/10 p-6 shadow-2xl backdrop-blur-xl border-emerald-500/20 animate-in slide-in-from-right">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold text-white">File Received</h3>
                    <p className="text-xs text-slate-400 truncate max-w-[200px] mb-3">{receivedFile.name}</p>
                    <a
                      href={URL.createObjectURL(receivedFile)}
                      download={receivedFile.name}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-white transition-all hover:bg-emerald-400 active:scale-95"
                    >
                      Download Now
                    </a>
                  </div>
                  <button onClick={() => setReceivedFile(null)} className="text-slate-500 hover:text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </section>
            )}
          </div>
        )}

        {/* QR Scanner Modal */}
        {isScanning && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
            <div className="relative w-full max-w-lg rounded-[2rem] border border-white/10 bg-[#0f172a] p-8 shadow-2xl">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-xl font-black text-white">Scan Peer QR</h3>
                <button
                  onClick={() => setIsScanning(false)}
                  className="h-10 w-10 rounded-full bg-white/5 flex items-center justify-center text-slate-400 transition hover:bg-white/10 hover:text-white"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div id="reader" className="overflow-hidden rounded-2xl bg-white/5 shadow-inner" />
              <p className="mt-6 text-center text-xs font-medium text-slate-500">
                Align the QR code within the frame to connect instantly.
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}