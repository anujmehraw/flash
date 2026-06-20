import { useEffect, useState, useRef } from "react";
import Peer from "peerjs";
import { io } from "socket.io-client";
import { QRCodeCanvas } from "qrcode.react";
import { Html5QrcodeScanner } from "html5-qrcode";

const socket = io("https://flash-66bi.onrender.com", {
  transports: ["polling"], // 🔥 force polling instead of websocket
});

const log = (...args) => console.log("[Flash]", ...args);
const logWarn = (...args) => console.warn("[Flash]", ...args);
const logError = (...args) => console.error("[Flash]", ...args);

socket.on("connect", () => log("Socket connected", socket.id));
socket.on("disconnect", (reason) => logWarn("Socket disconnected", reason));
socket.on("connect_error", (err) => logError("Socket connection error", err.message));

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
  const [connectionStatus, setConnectionStatus] = useState("idle"); // idle | connecting | connected | failed
  const [notifications, setNotifications] = useState([]);
  const scannerRef = useRef(null);
  const activeConnRef = useRef(null);
  const notificationTimeoutsRef = useRef(new Map());
  const appUrl = import.meta.env.VITE_PUBLIC_URL || window.location.origin;

  const dismissNotification = (id) => {
    setNotifications((prev) => {
      const notification = prev.find((n) => n.id === id);
      if (notification?.previewUrl) {
        URL.revokeObjectURL(notification.previewUrl);
      }
      return prev.filter((n) => n.id !== id);
    });

    const timeout = notificationTimeoutsRef.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      notificationTimeoutsRef.current.delete(id);
    }
  };

  const showNotification = ({ type, title, message, previewUrl, onAction }) => {
    const id = Date.now() + Math.random();
    log("Notification", { type, title, message });
    setNotifications((prev) => [...prev, { id, type, title, message, previewUrl, onAction }]);

    const timeout = setTimeout(() => dismissNotification(id), 6000);
    notificationTimeoutsRef.current.set(id, timeout);
  };

  const attachIncomingHandlers = (conn, remoteCode = null) => {
    activeConnRef.current = conn;
    setConnectionStatus("connected");

    log("Peer connected", {
      remotePeerId: conn.peer,
      remoteCode: remoteCode || "(incoming)",
      direction: remoteCode ? "outgoing" : "incoming",
    });

    showNotification({
      type: "connected",
      title: "Device Connected",
      message: remoteCode
        ? `Linked with peer ${remoteCode}`
        : "A device connected to you",
    });

    conn.on("close", () => {
      log("Peer disconnected", { remotePeerId: conn.peer });
      setConnectionStatus("idle");
      activeConnRef.current = null;
    });

    let chunks = [];
    let fileMeta = null;
    let chunkCount = 0;

    conn.on("data", (data) => {
      if (typeof data === "object" && data.type === "text") {
        log("Message received", { text: data.message });

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

        showNotification({
          type: "message",
          title: "New Message",
          message: data.message,
          onAction: () => setMode("text"),
        });
        return;
      }

      if (typeof data === "object" && data.fileName) {
        fileMeta = data;
        chunkCount = 0;
        log("File transfer started", {
          fileName: data.fileName,
          fileType: data.fileType,
        });
        return;
      }

      if (data === "EOF") {
        const blob = new Blob(chunks, {
          type: fileMeta?.fileType,
        });

        blob.name = fileMeta?.fileName;
        log("File transfer complete", {
          fileName: fileMeta?.fileName,
          fileType: fileMeta?.fileType,
          size: blob.size,
          chunks: chunkCount,
        });

        setReceivedFile(blob);
        setProgress(100);
        chunks = [];

        const isImage = fileMeta?.fileType?.startsWith("image/");
        showNotification({
          type: "file",
          title: isImage ? "Image Received" : "File Received",
          message: fileMeta?.fileName || "Unknown file",
          previewUrl: isImage ? URL.createObjectURL(blob) : null,
          onAction: () => setMode("file"),
        });
        return;
      }

      chunks.push(data);
      chunkCount += 1;
      if (chunkCount === 1 || chunkCount % 50 === 0) {
        log("Receiving file chunks...", { chunks: chunkCount });
      }
      setProgress((prev) => Math.min(prev + 2, 95));
    });
  };


  // 🔥 QR AUTO-FILL
  useEffect(() => {
    log("App ready", { appUrl });

    const params = new URLSearchParams(window.location.search);
    const codeFromQR = params.get("code");

    if (codeFromQR) {
      log("QR code auto-fill from URL", { code: codeFromQR.toUpperCase() });
      setInputCode(codeFromQR.toUpperCase());
    }
  }, []);

  useEffect(() => {
    if (!myCode) return;
    log("Your access key ready", {
      myCode,
      qrUrl: `${appUrl}/?code=${myCode}`,
    });
  }, [myCode, appUrl]);

  useEffect(() => {
    return () => {
      notificationTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      notificationTimeoutsRef.current.clear();
    };
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

      log("PeerJS ready", { peerId: id, code });
      socket.emit("register-code", { code, peerId: id });
      log("Code registered with server", { code, peerId: id });
    });

    newPeer.on("error", (err) => logError("PeerJS error", err));

    // 🔥 RECEIVER
    newPeer.on("connection", (conn) => {
      log("Incoming connection request", { from: conn.peer });
      attachIncomingHandlers(conn, null);
    });

    setPeer(newPeer);
  }, []);

  const connectToPeer = () => {
    if (!peerReady || !inputCode.trim()) return;

    if (activeConnRef.current?.open) {
      logWarn("Already connected — skipping connect");
      return;
    }

    log("Connecting to peer...", { remoteCode: inputCode.trim() });
    setConnectionStatus("connecting");

    socket.emit("get-peer", inputCode, (remotePeerId) => {
      if (!remotePeerId) {
        logWarn("Peer not found", { remoteCode: inputCode.trim() });
        setConnectionStatus("failed");
        alert("Peer not found! Make sure the receiver code is correct.");
        return;
      }

      log("Peer found on server", { remoteCode: inputCode.trim(), remotePeerId });
      const conn = peer.connect(remotePeerId);

      conn.on("open", () => {
        log("Outgoing connection open", { remoteCode: inputCode.trim(), remotePeerId });
        attachIncomingHandlers(conn, inputCode.trim());
      });

      conn.on("error", (err) => {
        logError("Connection error", err);
        setConnectionStatus("failed");
        activeConnRef.current = null;
      });
    });
  };

  const withConnection = (callback, onError) => {
    if (activeConnRef.current?.open) {
      log("Reusing active connection");
      callback(activeConnRef.current);
      return;
    }

    log("Opening connection for send...", { remoteCode: inputCode.trim() });

    socket.emit("get-peer", inputCode, (remotePeerId) => {
      if (!remotePeerId) {
        logWarn("Peer not found for send", { remoteCode: inputCode.trim() });
        onError?.();
        alert("Peer not found! Make sure the receiver code is correct.");
        return;
      }

      const conn = peer.connect(remotePeerId);

      conn.on("open", () => {
        log("Connection open for send", { remotePeerId });
        attachIncomingHandlers(conn, inputCode.trim());
        callback(conn);
      });

      conn.on("error", (err) => {
        logError("Send connection error", err);
        setConnectionStatus("failed");
        activeConnRef.current = null;
        onError?.();
      });
    });
  };

  // 🔥 SEND FILE
  const sendFile = () => {
    if (!peerReady || !file || !inputCode) return;

    withConnection(async (conn) => {
      setProgress(0);
      log("Sending file...", {
        fileName: file.name,
        fileType: file.type,
        size: file.size,
      });

      conn.send({
        fileName: file.name,
        fileType: file.type,
      });

      const chunkSize = 16 * 1024;
      const buffer = await file.arrayBuffer();

      let offset = 0;
      let sentChunks = 0;

      while (offset < buffer.byteLength) {
        const chunk = buffer.slice(offset, offset + chunkSize);
        conn.send(chunk);
        offset += chunkSize;
        sentChunks += 1;

        setProgress(Math.floor((offset / buffer.byteLength) * 100));
      }

      conn.send("EOF");
      log("File sent", {
        fileName: file.name,
        size: file.size,
        chunks: sentChunks,
      });
    });
  };

  // 🔥 SEND TEXT
  const sendText = () => {
    if (!peerReady || !text.trim() || !inputCode) return;

    setIsSending(true);

    withConnection(
      (conn) => {
        log("Sending message...", { text: text.trim() });

        conn.send({
          type: "text",
          message: text,
        });

        log("Message sent", { text: text.trim() });

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
      },
      () => setIsSending(false)
    );
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
      log("QR scanner started");

      const scanner = new Html5QrcodeScanner("reader", {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        rememberLastUsedCamera: true,
      });

      scanner.render(
        (decodedText) => {
          log("QR scanned", { decodedText });

          try {
            const url = new URL(decodedText);
            const code = url.searchParams.get("code");
            if (code) {
              log("QR code extracted from URL", { code: code.toUpperCase() });
              setInputCode(code.toUpperCase());
            } else {
              log("QR raw text used as code", { code: decodedText.toUpperCase().substring(0, 4) });
              setInputCode(decodedText.toUpperCase().substring(0, 4));
            }
          } catch (e) {
            log("QR parsed as plain code", { code: decodedText.toUpperCase().substring(0, 4) });
            setInputCode(decodedText.toUpperCase().substring(0, 4));
          }
          setIsScanning(false);
          scanner.clear();
        },
        () => {
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

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-5 px-3 py-4 sm:gap-8 sm:px-4 sm:py-8 md:px-6">
        <header className="flex flex-col items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-xl sm:flex-row sm:gap-6 sm:rounded-[2rem] sm:p-8">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 shadow-lg shadow-blue-500/20 sm:h-14 sm:w-14 sm:rounded-2xl">
              <span className="text-2xl sm:text-3xl">⚡</span>
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-white sm:text-4xl">
                Flash
              </h1>
              <p className="text-xs font-medium text-slate-400 sm:text-sm">
                P2P Instant Transfer
              </p>
            </div>
          </div>

          <div className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/5 bg-white/5 p-2 pr-4 sm:w-auto sm:rounded-2xl">
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

        <main className="grid gap-5 sm:gap-8 lg:grid-cols-12">
          {/* Left Column: Connection Info */}
          <div className="flex flex-col gap-5 sm:gap-6 lg:col-span-4">
            <section className="group rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur-md transition-all hover:border-white/20 sm:rounded-[2rem] sm:p-8">
              <div className="mb-5 flex items-center justify-between sm:mb-6">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-400">
                  Your Access Key
                </p>
                <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                </div>
              </div>
              
              <div className="flex flex-col items-center gap-5 sm:gap-6">
                <div className="relative">
                  <div className="absolute -inset-4 rounded-full bg-gradient-to-br from-blue-500/20 to-emerald-500/20 opacity-0 blur-2xl transition-opacity group-hover:opacity-100" />
                  <h2 className="relative text-4xl font-black tracking-[0.2em] text-white sm:text-5xl">
                    {myCode || "----"}
                  </h2>
                </div>

                <div className="relative scale-90 rounded-3xl bg-white p-4 shadow-2xl transition-transform group-hover:scale-[1.02] sm:scale-100 sm:p-5">
                  <QRCodeCanvas 
                    value={`${appUrl}/?code=${myCode}`} 
                    size={140} 
                    level="H"
                    includeMargin={false}
                  />
                </div>
                
                <p className="text-center text-xs font-medium leading-relaxed text-slate-400 max-w-[200px]">
                  Share this code or scan the QR to establish a secure link.
                </p>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur-md sm:rounded-[2rem] sm:p-8">
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
              <div className="flex overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-inner transition focus-within:border-blue-500/50 focus-within:ring-4 focus-within:ring-blue-500/30">
                <input
                  placeholder="Paste receiver code..."
                  value={inputCode}
                  onChange={(e) => {
                    setInputCode(e.target.value.toUpperCase());
                    if (connectionStatus === "connected") {
                      setConnectionStatus("idle");
                      activeConnRef.current = null;
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      connectToPeer();
                    }
                  }}
                  className="min-w-0 flex-1 bg-transparent px-4 py-3.5 text-base font-bold uppercase tracking-widest text-white outline-none placeholder:font-medium placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-500 sm:px-5 sm:py-4 sm:text-lg"
                />
                <button
                  type="button"
                  onClick={connectToPeer}
                  disabled={!peerReady || !inputCode.trim() || connectionStatus === "connecting"}
                  className="flex shrink-0 items-center justify-center gap-1.5 self-stretch border-l border-white/10 bg-emerald-600 px-3.5 text-sm font-black uppercase tracking-wider text-white transition-all hover:bg-emerald-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-600 sm:gap-2 sm:px-5"
                >
                  {connectionStatus === "connecting" ? (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <>
                      <span className="hidden sm:inline">Enter</span>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                </button>
              </div>

              {connectionStatus === "connected" && (
                <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2.5 border border-emerald-500/20">
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                  <span className="text-sm font-bold text-emerald-400">Connected</span>
                </div>
              )}

              {connectionStatus === "failed" && (
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5">
                  <span className="text-xs font-bold text-red-400 sm:text-sm">Connection failed — check the code and try again</span>
                </div>
              )}

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
          <div className="flex flex-col gap-5 sm:gap-6 lg:col-span-8">
            <section className="flex h-[min(520px,calc(100dvh-22rem))] min-h-[360px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur-md sm:h-[600px] sm:rounded-[2rem]">
              {/* Transfer Mode Content */}
              <div className="flex-1 flex flex-col">
                {mode === "file" ? (
                  <div className="flex flex-1 flex-col items-center justify-center p-5 text-center sm:p-12">
                    <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-blue-500/10 text-blue-400 sm:mb-8 sm:h-32 sm:w-32 sm:rounded-[2.5rem]">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 sm:h-16 sm:w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <h3 className="mb-2 text-xl font-bold text-white sm:text-2xl">Ready for Transfer</h3>
                    <p className="mb-6 max-w-sm text-sm text-slate-400 sm:mb-8 sm:text-base">Select any file to beam it directly to your connected peer.</p>
                    
                    <div className="w-full max-w-md space-y-4">
                      <label className="group relative block w-full cursor-pointer">
                        <input
                          type="file"
                          onChange={(e) => setFile(e.target.files[0])}
                          className="hidden"
                        />
                        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/10 bg-white/5 px-4 py-8 transition-all group-hover:border-blue-500/50 group-hover:bg-blue-500/5 sm:rounded-3xl sm:px-6 sm:py-10">
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
                        className="w-full rounded-xl bg-blue-600 px-6 py-3.5 text-base font-black text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 sm:rounded-2xl sm:px-8 sm:py-4 sm:text-lg sm:hover:scale-[1.02]"
                      >
                        Beam File
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col h-full overflow-hidden">
                    {/* Chat Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar sm:p-6">
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
                              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm font-medium shadow-sm sm:max-w-[80%] sm:px-5 sm:py-3 ${
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
                    <div className="bg-black/20 p-3 backdrop-blur-md sm:p-6 sm:pt-2">
                      <div className="relative flex items-end gap-2 rounded-2xl border border-white/10 bg-white/5 p-2.5 transition-all focus-within:border-emerald-500/50 sm:gap-3 sm:rounded-[1.5rem] sm:p-3">
                        <textarea
                          placeholder="Type a message..."
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          onKeyDown={handleKeyDown}
                          className="flex-1 max-h-28 min-h-[44px] resize-none bg-transparent px-2 py-2 text-base text-white outline-none custom-scrollbar sm:max-h-32 sm:min-h-[48px] sm:px-3 sm:text-sm"
                          rows={1}
                        />
                        <button
                          onClick={sendText}
                          disabled={!peerReady || !text.trim() || !inputCode || isSending}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:h-11 sm:w-11 sm:rounded-xl"
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
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>

        {/* Toast Notifications */}
        <div className="pointer-events-none fixed inset-x-3 top-3 z-[200] flex flex-col gap-3 sm:inset-x-auto sm:right-6 sm:top-6 sm:w-full sm:max-w-sm">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              role="alert"
              className={`pointer-events-auto animate-in slide-in-from-top rounded-2xl border p-4 shadow-2xl backdrop-blur-xl ${
                notification.type === "message"
                  ? "border-emerald-500/30 bg-emerald-500/15"
                  : notification.type === "connected"
                    ? "border-violet-500/30 bg-violet-500/15"
                    : "border-blue-500/30 bg-blue-500/15"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${
                    notification.type === "message"
                      ? "bg-emerald-500"
                      : notification.type === "connected"
                        ? "bg-violet-500"
                        : "bg-blue-500"
                  }`}
                >
                  {notification.type === "message" ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  ) : notification.type === "connected" ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase tracking-widest text-slate-300">
                    {notification.title}
                  </p>
                  <p className="mt-1 truncate text-sm font-medium text-white">
                    {notification.message}
                  </p>

                  {notification.previewUrl && (
                    <img
                      src={notification.previewUrl}
                      alt="Received preview"
                      className="mt-3 h-24 w-full rounded-xl border border-white/10 object-cover"
                    />
                  )}

                  {notification.onAction && (
                    <button
                      type="button"
                      onClick={() => {
                        notification.onAction();
                        dismissNotification(notification.id);
                      }}
                      className="mt-3 text-xs font-bold text-blue-300 transition hover:text-white"
                    >
                      View now →
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => dismissNotification(notification.id)}
                  className="shrink-0 text-slate-400 transition hover:text-white"
                  aria-label="Dismiss notification"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Progress & Received Overlay */}
        {(progress > 0 || receivedFile) && (
          <div className="fixed inset-x-3 bottom-3 z-50 flex flex-col gap-3 sm:inset-x-auto sm:bottom-8 sm:right-8 sm:w-full sm:max-w-sm">
            {progress > 0 && progress < 100 && (
              <section className="rounded-2xl border border-white/10 bg-[#0f172a]/90 p-4 shadow-2xl backdrop-blur-xl animate-in slide-in-from-right sm:rounded-3xl sm:p-6">
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
              <section className="rounded-2xl border border-emerald-500/20 border-white/10 bg-emerald-500/10 p-4 shadow-2xl backdrop-blur-xl animate-in slide-in-from-right sm:rounded-3xl sm:p-6">
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
          <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/90 p-3 backdrop-blur-md sm:items-center sm:p-4">
            <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#0f172a] p-5 shadow-2xl sm:rounded-[2rem] sm:p-8">
              <div className="mb-4 flex items-center justify-between sm:mb-6">
                <h3 className="text-lg font-black text-white sm:text-xl">Scan Peer QR</h3>
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