"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Youtube, HardDrive, Download, CheckCircle2, AlertCircle, Loader2, LogOut, FileVideo, Search, Pencil, XCircle, ChevronDown, Clock, History, BarChart3 } from "lucide-react";

export default function Home() {
  const { data: session, status } = useSession();
  const [mode, setMode] = useState<"download" | "compress" | "history">("download");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0); // 0: input, 1: processing, 3: success
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [fileId, setFileId] = useState("");
  const [transferred, setTransferred] = useState(0);
  const [total, setTotal] = useState(0);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Compressor State
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [newName, setNewName] = useState("");
  const [quality, setQuality] = useState(28); // Standard CRF
  const [resolution, setResolution] = useState("original");
  const [originalSize, setOriginalSize] = useState(0);
  const [compressedSize, setCompressedSize] = useState(0);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // History State
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const fetchDriveFiles = async () => {
    try {
      const res = await fetch(`/api/drive/files?q=${encodeURIComponent(searchQuery)}`);
      if (res.status === 401) {
        setError("Your session has expired or requires new permissions. Please Sign Out and Sign In again.");
        setDriveFiles([]);
        return;
      }
      const data = await res.json();
      setDriveFiles(data.files || []);
    } catch (e) {
      console.error("Failed to fetch files", e);
      setError("Failed to connect to Google Drive.");
    }
  };

  const fetchHistory = async () => {
    setIsHistoryLoading(true);
    try {
      const res = await fetch("/api/transfers");
      const data = await res.json();
      setHistoryData(data.history || []);
    } catch (e) {
      console.error("Failed to fetch history", e);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const deleteHistoryItem = async (id: string) => {
    try {
      const res = await fetch("/api/transfers", {
        method: "DELETE",
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setHistoryData(prev => prev.filter(item => item.id !== id));
      }
    } catch (e) {
      console.error("Failed to delete item", e);
    }
  };

  useEffect(() => {
    if (session && mode === "compress") {
      fetchDriveFiles();
    }
    if (session && mode === "history") {
      fetchHistory();
    }
  }, [mode, session]);

  useEffect(() => {
    if (session && mode === "compress" && searchQuery.length > 2) {
      const delayDebounceFn = setTimeout(() => {
        fetchDriveFiles();
      }, 500);
      return () => clearTimeout(delayDebounceFn);
    }
  }, [searchQuery]);

  const handleCancel = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setLoading(false);
      setStep(0);
      setError("Process cancelled by user.");
    }
  };

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "download") {
      if (!url) return;
      if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
        setError("Please enter a valid YouTube URL");
        return;
      }
      startStreamProcess("/api/download", { url });
    } else if (mode === "compress") {
      if (!selectedFile) return;
      startStreamProcess("/api/compress", {
        fileId: selectedFile.id,
        newName,
        quality,
        resolution
      });
    }
  };

  const startStreamProcess = async (endpoint: string, body: any) => {
    const controller = new AbortController();
    setAbortController(controller);

    setLoading(true);
    setStep(1);
    setError("");
    setProgress(0);
    setTransferred(0);
    setTotal(0);
    setStatusMessage("Connecting...");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json();
        const errorMessage = data.error || "Something went wrong";
        if (errorMessage.toLowerCase().includes("insufficient authentication scopes") ||
          errorMessage.toLowerCase().includes("permission denied")) {
          throw new Error("🚨 Drive Access Missing! Please 'Sign Out', then 'Sign In' and Check the Google Drive permission box.");
        }
        throw new Error(errorMessage);
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n");
          buffer = parts.pop() || "";

          for (const line of parts) {
            if (!line.trim()) continue;
            let data;
            try { data = JSON.parse(line); } catch (e) { continue; }

            if (data.status === "error") throw new Error(data.message);

            setStatusMessage(data.message || "");
            if (data.progress !== undefined) setProgress(data.progress);
            if (data.transferred !== undefined) setTransferred(data.transferred);
            if (data.total !== undefined) setTotal(data.total);

            if (data.status === "success") {
              setFileId(data.fileId);
              if (data.originalSize) setOriginalSize(data.originalSize);
              if (data.compressedSize) setCompressedSize(data.compressedSize);
              setStep(3);
              // Refresh history if it's open (though we are in step 3 now)
              fetchHistory();
            }
          }
        }

        if (done) break;
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return;
      }
      setError(err.message);
      setStep(0);
    } finally {
      setLoading(false);
      setAbortController(null);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0a]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  const totalProcessed = historyData.length;
  const totalSaved = historyData.reduce((acc, item) => {
    if (item.type === 'compress' && item.original_size && item.final_size) {
      return acc + (item.original_size - item.final_size);
    }
    return acc;
  }, 0);
  const totalDownloaded = historyData.filter(i => i.type === 'download').length;
  const totalCompressed = historyData.filter(i => i.type === 'compress').length;

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white selection:bg-blue-500/30">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/10 blur-[120px] rounded-full" />
      </div>

      <nav className="max-w-7xl mx-auto px-6 py-8 flex items-center justify-between relative z-10">
        <div className="flex items-center gap-2 group cursor-pointer" onClick={() => { setStep(0); setMode("download"); }}>
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform">
            <Youtube className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">TubeDrive</span>
        </div>

        <div className="hidden md:flex items-center bg-white/5 p-1 rounded-2xl border border-white/10">
          <button
            onClick={() => { setMode("download"); setStep(0); setDriveFiles([]); setSelectedFile(null); }}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${mode === "download" ? "bg-blue-600 text-white shadow-lg" : "text-zinc-400 hover:text-white"}`}
          >
            Download
          </button>
          <button
            onClick={() => { setMode("compress"); setStep(0); }}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${mode === "compress" ? "bg-blue-600 text-white shadow-lg" : "text-zinc-400 hover:text-white"}`}
          >
            Compress
          </button>
          <button
            onClick={() => { setMode("history"); setStep(0); }}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${mode === "history" ? "bg-blue-600 text-white shadow-lg" : "text-zinc-400 hover:text-white"}`}
          >
            History
          </button>
        </div>

        {session ? (
          <button onClick={() => signOut()} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-colors text-sm font-medium border border-white/10">
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        ) : (
          <button onClick={() => signIn("google", { callbackUrl: "/" }, { scope: "openid email profile https://www.googleapis.com/auth/drive" })} className="px-6 py-2.5 bg-white text-black font-bold rounded-xl hover:bg-zinc-200 transition-colors shadow-lg shadow-white/5">
            Get Started
          </button>
        )}
      </nav>

      <div className="max-w-4xl mx-auto px-6 pt-12 pb-16 text-center relative z-10">
        <motion.h1
          key={mode}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-5xl md:text-7xl font-bold mb-6 tracking-tight"
        >
          {mode === "download" ? <><span className="text-[#FF0000]">YouTube</span> to Drive</> : mode === "compress" ? "Super Compressor" : "Transfer History"}
          <span className="block text-blue-500">
            {mode === "download" ? "Instantly." : mode === "compress" ? "Optimized." : "Tracked."}
          </span>
        </motion.h1>

        {session && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-1 bg-gradient-to-b from-white/10 to-transparent rounded-[2.5rem] mt-12">
            <div className="p-10 bg-[#121212] rounded-[2.4rem] backdrop-blur-xl">
              <AnimatePresence mode="wait">
                {mode === "history" ? (
                  <motion.div key="history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-4 bg-white/5 rounded-2xl border border-white/10 flex flex-col items-center">
                        <BarChart3 className="w-4 h-4 text-blue-500 mb-1" />
                        <span className="text-xl font-black">{totalProcessed}</span>
                        <span className="text-[8px] text-zinc-500 uppercase tracking-widest font-black text-center">Total Tasks</span>
                      </div>
                      <div className="p-4 bg-white/5 rounded-2xl border border-white/10 flex flex-col items-center">
                        <Download className="w-4 h-4 text-zinc-500 mb-1" />
                        <span className="text-xl font-black">{totalDownloaded}</span>
                        <span className="text-[8px] text-zinc-500 uppercase tracking-widest font-black text-center">Downloads</span>
                      </div>
                      <div className="p-4 bg-white/5 rounded-2xl border border-white/10 flex flex-col items-center">
                        <Loader2 className="w-4 h-4 text-green-500 mb-1" />
                        <span className="text-xl font-black">{totalCompressed}</span>
                        <span className="text-[8px] text-zinc-500 uppercase tracking-widest font-black text-center">Compressions</span>
                      </div>
                      <div className="p-4 bg-blue-500/10 rounded-2xl border border-blue-500/20 flex flex-col items-center shadow-lg shadow-blue-500/5">
                        <CheckCircle2 className="w-4 h-4 text-blue-500 mb-1" />
                        <span className="text-xl font-black text-blue-500">{formatBytes(totalSaved)}</span>
                        <span className="text-[8px] text-zinc-500 uppercase tracking-widest font-black text-center">Space Saved</span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between items-center px-2">
                        <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Recent Activity</h3>
                        <button
                          onClick={fetchHistory}
                          className="p-2 hover:bg-white/10 rounded-full transition-all text-zinc-500 hover:text-white"
                          title="Refresh"
                        >
                          <Loader2 className={`w-4 h-4 ${isHistoryLoading ? 'animate-spin' : ''}`} />
                        </button>
                      </div>

                      {isHistoryLoading && historyData.length === 0 ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>
                      ) : historyData.length === 0 ? (
                        <div className="py-12 text-center bg-white/5 border border-white/10 rounded-3xl text-zinc-500">
                          No transfers yet. Start by downloading a video!
                        </div>
                      ) : (
                        historyData.map((item) => (
                          <div key={item.id} className="p-4 bg-white/5 hover:bg-white/[0.08] border border-white/10 rounded-2xl flex items-center gap-4 transition-all text-left group hover:scale-[1.01] active:scale-[0.99]">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-lg ${item.type === 'download' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : 'bg-green-500/10 text-green-500 border border-green-500/20'}`}>
                              {item.type === 'download' ? <Download className="w-5 h-5" /> : <HardDrive className="w-5 h-5" />}
                            </div>
                            <div className="flex-1 overflow-hidden">
                              <h4 className="text-sm font-bold truncate group-hover:text-white transition-colors text-zinc-200">{item.title}</h4>
                              <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-bold">
                                <span className="flex items-center gap-1 uppercase"><Clock className="w-3 h-3" /> {new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                {item.type === 'compress' && (
                                  <span className="text-green-500/80 bg-green-500/10 px-1.5 py-0.5 rounded">Saved {formatBytes(item.original_size - item.final_size)}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <a
                                href={`https://drive.google.com/file/d/${item.drive_file_id}/view`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2.5 bg-white/5 hover:bg-blue-600/20 text-zinc-400 hover:text-blue-400 rounded-xl transition-all border border-transparent hover:border-blue-500/20"
                                title="View in Drive"
                              >
                                <ArrowUpRight className="w-4 h-4" />
                              </a>
                              <button
                                onClick={() => deleteHistoryItem(item.id)}
                                className="p-2.5 bg-white/5 hover:bg-red-600/20 text-zinc-400 hover:text-red-400 rounded-xl transition-all border border-transparent hover:border-red-500/20"
                                title="Remove from History"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                ) : step === 0 && (
                  <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                    {mode === "download" ? (
                      <form onSubmit={handleAction} className="space-y-4">
                        <div className="relative">
                          <input
                            type="url"
                            placeholder="Paste YouTube URL here..."
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            required
                            className="w-full px-6 py-4 bg-black/40 border border-white/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-white placeholder:text-zinc-600"
                          />
                        </div>
                        <button disabled={loading} className="w-full flex items-center justify-center gap-2 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl transition-all hover:shadow-lg hover:shadow-blue-500/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed">
                          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                          Move to Drive
                        </button>
                      </form>
                    ) : mode === "compress" && (
                      <div className="space-y-6 text-left">
                        {/* Dropdown Selection */}
                        <div className="relative">
                          <div
                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                            className="w-full px-6 py-4 bg-black/40 border border-white/10 rounded-2xl flex items-center justify-between cursor-pointer group hover:border-white/20 transition-all"
                          >
                            <div className="flex items-center gap-3">
                              <FileVideo className="w-5 h-5 text-blue-500" />
                              <span className={selectedFile ? "text-white" : "text-zinc-500"}>
                                {selectedFile ? selectedFile.name : "Select a video from your Drive..."}
                              </span>
                            </div>
                            <ChevronDown className={`w-5 h-5 text-zinc-500 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`} />
                          </div>

                          <AnimatePresence>
                            {isDropdownOpen && (
                              <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="absolute top-full left-0 right-0 mt-2 bg-[#1a1a1a] border border-white/10 rounded-2xl overflow-hidden z-50 shadow-2xl backdrop-blur-2xl"
                              >
                                <div className="p-3 border-b border-white/5">
                                  <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                    <input
                                      type="text"
                                      placeholder="Search videos..."
                                      value={searchQuery}
                                      onChange={(e) => setSearchQuery(e.target.value)}
                                      className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/5 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                  </div>
                                </div>
                                <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                  {driveFiles.map((file) => (
                                    <div
                                      key={file.id}
                                      onClick={() => {
                                        setSelectedFile(file);
                                        setNewName(file.name.replace(/\.[^/.]+$/, ""));
                                        setIsDropdownOpen(false);
                                      }}
                                      className="p-4 hover:bg-white/5 flex items-center gap-4 cursor-pointer transition-colors"
                                    >
                                      <FileVideo className="w-5 h-5 text-zinc-500" />
                                      <div className="flex-1 overflow-hidden">
                                        <p className="text-sm font-medium truncate">{file.name}</p>
                                        <p className="text-[10px] text-zinc-500">{formatBytes(parseInt(file.size || "0"))}</p>
                                      </div>
                                    </div>
                                  ))}
                                  {driveFiles.length === 0 && <p className="p-8 text-center text-sm text-zinc-500">No videos found.</p>}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        {selectedFile && (
                          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 pt-4 border-t border-white/5">
                            <div className="flex items-center gap-3 text-sm text-zinc-400 px-2">
                              <Pencil className="w-4 h-4" />
                              <span>Rename output (optional):</span>
                            </div>
                            <input
                              type="text"
                              placeholder="New filename..."
                              value={newName}
                              onChange={(e) => setNewName(e.target.value)}
                              className="w-full px-6 py-4 bg-white/5 border border-white/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-white"
                            />

                            {/* Advanced Options */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-3">
                                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Target Resolution</label>
                                <div className="flex flex-wrap gap-2">
                                  {["original", "720", "480", "360"].map((res) => (
                                    <button
                                      key={res}
                                      onClick={() => setResolution(res)}
                                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${resolution === res ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20" : "bg-white/5 text-zinc-400 hover:bg-white/10"
                                        }`}
                                    >
                                      {res === "original" ? "Auto" : res + "p"}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-3">
                                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex justify-between items-center">
                                  <span>Compression Quality</span>
                                  <span className="text-blue-500 font-bold">{quality === 18 ? "Extreme" : quality === 23 ? "High" : quality === 28 ? "Standard" : "Low"}</span>
                                </label>
                                <input
                                  type="range"
                                  min="18"
                                  max="35"
                                  step="5"
                                  value={quality}
                                  onChange={(e) => setQuality(parseInt(e.target.value))}
                                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                />
                                <div className="flex justify-between text-[10px] text-zinc-600 font-bold px-1">
                                  <span>MAX</span>
                                  <span>MIN</span>
                                </div>
                              </div>
                            </div>
                            <button onClick={handleAction} disabled={loading} className="w-full flex items-center justify-center gap-2 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl transition-all hover:shadow-lg hover:shadow-blue-500/20">
                              <Loader2 className={`w-5 h-5 animate-spin ${loading ? "block" : "hidden"}`} />
                              Compress & Save to Drive
                            </button>
                          </motion.div>
                        )}
                      </div>
                    )}
                    {error && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-sm flex flex-col items-center gap-3">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          {error}
                        </div>
                        {error.includes("permissions") && (
                          <button onClick={() => signOut()} className="px-6 py-2 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-colors shadow-lg">
                            Sign Out Now
                          </button>
                        )}
                      </motion.div>
                    )}
                  </motion.div>
                )}

                {step === 1 && (
                  <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-12 flex flex-col items-center gap-6">
                    <div className="relative">
                      <div className="w-24 h-24 border-4 border-white/5 rounded-full" />
                      <motion.div
                        className="absolute inset-0 border-4 border-blue-500 rounded-full"
                        style={{ clipPath: progress > 0 ? `inset(0 0 0 0)` : undefined, rotate: (progress / 100) * 360, transition: "rotate 0.5s ease-out" }}
                        animate={{ rotate: (progress / 100) * 360 }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-bold text-blue-500">{progress}%</span>
                      </div>
                    </div>
                    <div className="text-center w-full max-sm">
                      <h3 className="text-xl font-semibold mb-2">{statusMessage}</h3>
                      <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden mb-2">
                        <motion.div className="h-full bg-blue-500" initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.5 }} />
                      </div>
                      {total > 0 && <div className="flex justify-between items-center text-[10px] font-mono text-zinc-500 mb-4 px-1"><span>{formatBytes(transferred)}</span><span>{formatBytes(total)}</span></div>}
                      <p className="text-zinc-500 text-sm mb-8">{mode === "download" ? "Transferring data directly between servers..." : "Processing video on high-speed server..."}</p>

                      <button
                        onClick={handleCancel}
                        className="flex items-center gap-2 mx-auto px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-xl transition-all hover:scale-105 active:scale-95 text-sm font-bold"
                      >
                        <XCircle className="w-4 h-4" />
                        Cancel Process
                      </button>
                    </div>
                  </motion.div>
                )}

                {step === 3 && (
                  <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="py-12 flex flex-col items-center gap-6">
                    <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center">
                      <CheckCircle2 className="w-10 h-10 text-green-500" />
                    </div>
                    <div className="text-center">
                      <h3 className="text-xl font-semibold mb-2">Success!</h3>
                      <p className="text-zinc-400">Your video is ready and saved to Google Drive.</p>
                      {compressedSize > 0 && (
                        <div className="mt-4 inline-flex items-center gap-4 px-4 py-2 bg-green-500/10 rounded-full border border-green-500/20 text-xs text-green-400">
                          <span>{formatBytes(originalSize)}</span>
                          <span className="opacity-40">→</span>
                          <span className="font-bold">{formatBytes(compressedSize)}</span>
                          <span className="bg-green-500 text-black px-1.5 py-0.5 rounded font-black">-{Math.round((1 - compressedSize / originalSize) * 100)}%</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-4 w-full justify-center px-6">
                      <a href={`https://drive.google.com/file/d/${fileId}/view`} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 px-8 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl transition-all text-sm font-bold shadow-lg shadow-blue-500/20">
                        <HardDrive className="w-4 h-4" />
                        Open in Drive
                      </a>
                      <button onClick={() => { setStep(0); setSelectedFile(null); setNewName(""); }} className="flex-1 px-8 py-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors text-sm font-medium border border-white/10">
                        {mode === "download" ? "Download Another" : "Compress Another"}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-8 pb-32 relative z-10">
        {[
          { icon: <Loader2 className="w-6 h-6" />, title: "Super Compressor", desc: "Reduce video size by up to 90% without losing quality." },
          { icon: <HardDrive className="w-6 h-6" />, title: "Drive Native", desc: "Select files directly from your Drive and save them back." },
          { icon: <CheckCircle2 className="w-6 h-6" />, title: "High Speed", desc: "Processed on our high-performance server clusters." }
        ].map((feature, i) => (
          <div key={i} className="p-8 bg-white/5 border border-white/10 rounded-3xl hover:bg-white/[0.07] transition-colors group">
            <div className={`w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-500 mb-6 group-hover:scale-110 transition-transform ${i === 0 && loading ? "animate-spin" : ""}`}>
              {feature.icon}
            </div>
            <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
            <p className="text-zinc-400 leading-relaxed">{feature.desc}</p>
          </div>
        ))}
      </div>
    </main>
  );
}

// Fixed missing icon
function ArrowUpRight(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </svg>
  )
}
