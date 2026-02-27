import { useState, useEffect, useRef } from "react";

// ── Supabase config ────────────────────────────────────────────────────────
const SB_URL = "https://enruxqfwoojsflaqcijw.supabase.co";
const SB_KEY = "sb_publishable_yhZjoGtzqFFhIsYxyxbwaA_8LDLuSVI";
const SB_HEADERS = {
  "apikey": SB_KEY,
  "Authorization": `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=representation",
};

// Map DB row (snake_case) → app object (camelCase)
function rowToMail(r) {
  return {
    id: r.id,
    sender: r.sender,
    recipient: r.recipient,
    subject: r.subject,
    notes: r.notes,
    status: r.status,
    aiScanned: r.ai_scanned,
    file: r.file_info,
    fileDataUrl: r.file_data_url,
    history: r.history || [],
    comments: r.comments || [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Map app object → DB row
function mailToRow(m) {
  return {
    id: m.id,
    sender: m.sender,
    recipient: m.recipient,
    subject: m.subject,
    notes: m.notes,
    status: m.status,
    ai_scanned: m.aiScanned,
    file_info: m.file,
    file_data_url: m.fileDataUrl,
    history: m.history,
    comments: m.comments || [],
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SB_URL}/rest/v1${path}`, {
    ...options,
    headers: { ...SB_HEADERS, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Supabase error ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// Upload a file to Supabase Storage and return its public URL
async function uploadToStorage(dataUrl, fileName, mimeType) {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  // Sanitize filename and make path unique
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${Date.now()}-${safeName}`;

  const res = await fetch(`${SB_URL}/storage/v1/object/mail-files/${path}`, {
    method: "POST",
    headers: {
      "apikey": SB_KEY,
      "Authorization": `Bearer ${SB_KEY}`,
      "Content-Type": mimeType,
    },
    body: bytes,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Storage upload failed");
  }

  return `${SB_URL}/storage/v1/object/public/mail-files/${path}`;
}

const STATUS_FLOW = ["Received", "Processing", "Closed"];
const STATUS_COLORS = { "Received": "#4ade80", "Processing": "#facc15", "Closed": "#a78bfa" };
const STATUS_ICONS = { "Received": "⬛", "Processing": "⚙", "Closed": "✓" };

// Sequential tracking number — uses a persistent counter in Supabase
// The counter only ever increments, so deletions never affect future IDs
async function generateTrackingNumber() {
  try {
    // Try atomic RPC increment first
    const res = await fetch(`${SB_URL}/rest/v1/rpc/increment_counter`, {
      method: "POST",
      headers: {
        "apikey": SB_KEY,
        "Authorization": `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ counter_key: "tracking_id" }),
    });
    if (res.ok) {
      const num = await res.json();
      if (typeof num === "number") return `#${num}`;
    }
  } catch {}

  try {
    // Fallback: read + patch the counters table directly
    const res = await fetch(`${SB_URL}/rest/v1/counters?key=eq.tracking_id&select=value`, {
      headers: { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}` }
    });
    if (res.ok) {
      const rows = await res.json();
      if (rows?.length > 0) {
        const next = (rows[0].value ?? 243) + 1;
        await fetch(`${SB_URL}/rest/v1/counters?key=eq.tracking_id`, {
          method: "PATCH",
          headers: {
            "apikey": SB_KEY,
            "Authorization": `Bearer ${SB_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
          },
          body: JSON.stringify({ value: next }),
        });
        return `#${next}`;
      }
    }
  } catch {}

  // Final fallback: derive from existing mails if counters table doesn't exist yet
  try {
    const res = await fetch(`${SB_URL}/rest/v1/mails?select=id&order=created_at.desc&limit=100`, {
      headers: { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}` }
    });
    if (res.ok) {
      const rows = await res.json();
      let max = 243;
      rows.forEach(r => {
        const match = r.id?.match(/^#(\d+)$/);
        if (match) max = Math.max(max, parseInt(match[1]));
      });
      return `#${max + 1}`;
    }
  } catch {}

  // Absolute last resort
  return `#${244 + Math.floor(Math.random() * 900)}`;
}
function formatDate(iso) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function scanDocumentWithAI(base64Data, mimeType) {
  const isImage = mimeType.startsWith("image/");
  const isPDF = mimeType === "application/pdf";
  if (!isImage && !isPDF) return null;

  const contentBlock = isPDF
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } }
    : { type: "image", source: { type: "base64", media_type: mimeType, data: base64Data } };

  const prompt = `Analyze this mail/document and extract:
1. sender: The name or organization sending this (look for "From:", return addresses, letterhead, or signature)
2. recipient: The name or organization receiving this (look for "To:", "Dear", or the main addressee)
3. subject: A brief 5-10 word description of what this mail is about

Respond ONLY with valid JSON like:
{"sender": "...", "recipient": "...", "subject": "..."}

If you cannot determine a field with confidence, use an empty string "". Do not guess.`;

  // Call our secure server-side proxy instead of Anthropic directly
  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: [contentBlock, { type: "text", text: prompt }] }]
    })
  });

  const data = await response.json();
  const text = data.content?.map(b => b.text || "").join("") || "";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ── Document Viewer Modal ──────────────────────────────────────────────────
function DocViewer({ dataUrl, fileInfo, onClose }) {
  const isImage = fileInfo?.type?.startsWith("image/");
  const isPDF = fileInfo?.type === "application/pdf";
  const isRemoteUrl = dataUrl?.startsWith("http");
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!isPDF || !dataUrl) { setLoading(false); return; }

    async function renderPDF() {
      try {
        if (!window.pdfjsLib) {
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
          });
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        }

        // Use URL directly for remote files, bytes for data URLs
        let pdfSource;
        if (isRemoteUrl) {
          pdfSource = { url: dataUrl };
        } else {
          const base64 = dataUrl.split(",")[1];
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          pdfSource = { data: bytes };
        }

        const pdf = await window.pdfjsLib.getDocument(pdfSource).promise;
        const rendered = [];
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          await page.render({ canvasContext: ctx, viewport }).promise;
          rendered.push(canvas.toDataURL());
        }
        setPages(rendered);
        setLoading(false);
      } catch (err) {
        setError("Failed to render PDF. Try downloading instead.");
        setLoading(false);
      }
    }
    renderPDF();
  }, [dataUrl, isPDF]);

  // For non-remote data URLs, create a blob URL for image display & download
  const [blobUrl, setBlobUrl] = useState(null);
  useEffect(() => {
    if (!dataUrl || isRemoteUrl) { setBlobUrl(dataUrl); return; }
    try {
      const [header, base64] = dataUrl.split(",");
      const mime = header.match(/:(.*?);/)[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      return () => URL.revokeObjectURL(url);
    } catch { setBlobUrl(dataUrl); }
  }, [dataUrl]);

  const displayUrl = isRemoteUrl ? dataUrl : blobUrl;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.95)", display: "flex", flexDirection: "column", animation: "fadeIn 0.2s ease" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#0d0d0d", borderBottom: "1px solid #1a1a1a", padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 16, color: "#a78bfa" }}>📎</span>
          <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 12, color: "#aaa" }}>{fileInfo?.name}</span>
          <span style={{ fontSize: 10, color: "#444", letterSpacing: 1 }}>{fileInfo?.size}</span>
          {isPDF && pages.length > 0 && <span style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>{pages.length} page{pages.length !== 1 ? "s" : ""}</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {displayUrl && (
            <a href={displayUrl} download={!isRemoteUrl ? fileInfo?.name : undefined} target={isRemoteUrl ? "_blank" : undefined} rel="noreferrer"
              style={{ padding: "5px 14px", background: "transparent", color: "#888", border: "1px solid #2a2a2a", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Share Tech Mono', monospace", textDecoration: "none" }}>
              ↓ DOWNLOAD
            </a>
          )}
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#888", fontFamily: "'Share Tech Mono', monospace", fontSize: 10, padding: "5px 14px", letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>
            ✕ CLOSE
          </button>
        </div>
      </div>
      <div ref={containerRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", padding: 24, gap: 16 }}>
        {loading && <div style={{ color: "#555", fontFamily: "'Share Tech Mono', monospace", fontSize: 12, letterSpacing: 2, marginTop: 80 }}><span style={{ display: "inline-block", animation: "spin 1.5s linear infinite", marginRight: 10 }}>◈</span>RENDERING PDF...</div>}
        {error && (
          <div style={{ color: "#f87171", fontFamily: "'Share Tech Mono', monospace", fontSize: 12, letterSpacing: 1, marginTop: 80, textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>⚠</div>{error}
            {displayUrl && <div style={{ marginTop: 16 }}><a href={displayUrl} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", fontSize: 11, letterSpacing: 1 }}>↓ OPEN FILE</a></div>}
          </div>
        )}
        {isPDF && !loading && !error && pages.map((src, i) => (
          <div key={i} style={{ position: "relative", boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }}>
            {pages.length > 1 && <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.6)", color: "#888", fontFamily: "'Share Tech Mono', monospace", fontSize: 10, padding: "2px 8px" }}>{i + 1} / {pages.length}</div>}
            <img src={src} alt={`Page ${i + 1}`} style={{ display: "block", maxWidth: "min(900px, 100%)", border: "1px solid #2a2a2a" }} />
          </div>
        ))}
        {isImage && displayUrl && <img src={displayUrl} alt={fileInfo?.name} style={{ maxWidth: "min(900px, 100%)", objectFit: "contain", border: "1px solid #1a1a1a", boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }} />}
        {!isPDF && !isImage && displayUrl && (
          <div style={{ textAlign: "center", color: "#555", fontFamily: "'Share Tech Mono', monospace", marginTop: 80 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📎</div>
            <div style={{ fontSize: 12, letterSpacing: 2 }}>PREVIEW NOT AVAILABLE</div>
            <a href={displayUrl} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", fontSize: 11, marginTop: 16, display: "inline-block", letterSpacing: 1 }}>↓ OPEN FILE</a>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────
export default function MailTracker() {
  const [mails, setMails] = useState([]);
  const [view, setView] = useState("dashboard");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ sender: "", recipient: "", subject: "", notes: "" });
  const [fileInfo, setFileInfo] = useState(null);
  const [fileDataUrl, setFileDataUrl] = useState(null); // base64 data URL for current upload
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState("newest"); // "newest" | "oldest"
  const [colWidths, setColWidths] = useState([220, 150, 150, 150, 100, 110, 30]);
  const resizingCol = useRef(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const [editingId, setEditingId] = useState(false);
  const [editIdValue, setEditIdValue] = useState("");
  const [pendingId, setPendingId] = useState(null);
  const [toast, setToast] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [viewerData, setViewerData] = useState(null); // { dataUrl, fileInfo }
  const [commentText, setCommentText] = useState("");
  const [commentAuthor, setCommentAuthor] = useState("");
  const commentsEndRef = useRef(null);
  const fileRef = useRef();
  const dragCounter = useRef(0);

  // Pre-generate a tracking ID as soon as the upload form is opened
  useEffect(() => {
    if (view === "upload" && !pendingId) {
      generateTrackingNumber().then(id => setPendingId(id));
    }
    if (view !== "upload") setPendingId(null);
  }, [view]);
  useEffect(() => {
    async function load() {
      try {
        const rows = await sbFetch("/mails?select=*&order=created_at.desc");
        setMails(rows.map(rowToMail));
      } catch (e) {
        showToast("Failed to load from Supabase: " + e.message, "error");
      }
      setLoaded(true);
    }
    load();
  }, []);

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  async function processFile(file) {
    const info = { name: file.name, size: (file.size / 1024).toFixed(1) + " KB", type: file.type };
    setFileInfo(info);
    setFileDataUrl(null);
    setScanResult(null);

    const isImage = file.type.startsWith("image/");
    const isPDF = file.type === "application/pdf";

    // Always read the full data URL for viewing later
    const dataUrl = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.onerror = () => rej(new Error("Read failed"));
      reader.readAsDataURL(file);
    });
    setFileDataUrl(dataUrl);

    if (!isImage && !isPDF) {
      setScanResult("unsupported");
      showToast("File attached. This format isn't scannable — fill fields manually.", "warn");
      return;
    }

    setScanning(true);
    showToast("Scanning document with AI...", "info");

    try {
      const base64 = dataUrl.split(",")[1];
      const extracted = await scanDocumentWithAI(base64, file.type);

      if (extracted) {
        setForm(f => ({
          ...f,
          sender: extracted.sender || f.sender,
          recipient: extracted.recipient || f.recipient,
          subject: extracted.subject || f.subject,
        }));
        setScanResult("success");
        showToast("AI scan complete — fields autofilled! Review before submitting.");
      } else {
        setScanResult("failed");
        showToast("Scan returned no data. Please fill manually.", "error");
      }
    } catch {
      setScanResult("failed");
      showToast("Scan failed — please fill fields manually.", "error");
    } finally {
      setScanning(false);
    }
  }

  function handleFileChange(e) {
    const file = e.target?.files?.[0] || e;
    if (!file || !file.name) return;
    processFile(file);
  }

  function handleDragEnter(e) {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items?.length > 0) setDragging(true);
  }
  function handleDragLeave(e) {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  }
  function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); }
  function handleDrop(e) {
    e.preventDefault(); e.stopPropagation();
    setDragging(false); dragCounter.current = 0;
    if (scanning) return;
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  async function handleSubmit() {
    if (!form.sender || !form.recipient) {
      showToast("Sender and recipient are required.", "error");
      return;
    }
    const id = pendingId || await generateTrackingNumber();

    // Upload file to Supabase Storage if present
    let storedFileUrl = null;
    if (fileDataUrl && fileInfo) {
      try {
        showToast("Uploading file...", "info");
        storedFileUrl = await uploadToStorage(fileDataUrl, fileInfo.name, fileInfo.type);
      } catch (e) {
        showToast("File upload failed — mail will be saved without attachment.", "warn");
      }
    }

    const newMail = {
      id, ...form,
      file: fileInfo,
      fileDataUrl: storedFileUrl,
      aiScanned: scanResult === "success",
      status: "Received",
      history: [{ status: "Received", time: new Date().toISOString(), note: "Mail received and logged." }],
      comments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await sbFetch("/mails", {
        method: "POST",
        body: JSON.stringify(mailToRow(newMail)),
      });
      setMails(prev => [newMail, ...prev]);
      setForm({ sender: "", recipient: "", subject: "", notes: "" });
      setFileInfo(null);
      setFileDataUrl(null);
      setScanResult(null);
      setPendingId(null);
      if (fileRef.current) fileRef.current.value = "";
      showToast(`Mail logged! Tracking: ${id}`);
      setView("dashboard");
    } catch (e) {
      showToast("Failed to save: " + e.message, "error");
    }
  }

  function openViewer(mail) {
    if (!mail.file || !mail.fileDataUrl) return;
    setViewerData({ dataUrl: mail.fileDataUrl, fileInfo: mail.file });
  }

  async function advanceStatus(id, targetStatus) {
    const mail = mails.find(m => m.id === id);
    if (!mail) return;
    const updatedAt = new Date().toISOString();
    const newHistory = [...mail.history, { status: targetStatus, time: updatedAt, note: `Status changed to ${targetStatus}.` }];
    try {
      await sbFetch(`/mails?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: targetStatus, updated_at: updatedAt, history: newHistory }),
      });
      setMails(prev => prev.map(m => m.id !== id ? m : { ...m, status: targetStatus, updatedAt, history: newHistory }));
      setSelected(prev => prev?.id === id ? { ...prev, status: targetStatus, updatedAt, history: newHistory } : prev);
      showToast(`Status set to ${targetStatus}.`);
    } catch (e) {
      showToast("Failed to update status: " + e.message, "error");
    }
  }

  async function saveTrackingId(oldId, newId) {
    const trimmed = newId.trim();
    if (!trimmed || trimmed === oldId) { setEditingId(false); return; }
    // Check for duplicate
    if (mails.some(m => m.id === trimmed && m.id !== oldId)) {
      showToast("That tracking ID is already in use.", "error");
      return;
    }
    try {
      await sbFetch(`/mails?id=eq.${encodeURIComponent(oldId)}`, {
        method: "PATCH",
        body: JSON.stringify({ id: trimmed }),
      });
      setMails(prev => prev.map(m => m.id !== oldId ? m : { ...m, id: trimmed }));
      setSelected(prev => prev?.id === oldId ? { ...prev, id: trimmed } : prev);
      setEditingId(false);
      showToast("Tracking ID updated.");
    } catch (e) {
      showToast("Failed to update ID: " + e.message, "error");
    }
  }

  async function deleteMail(id) {
    try {
      await sbFetch(`/mails?id=eq.${id}`, { method: "DELETE" });
      setMails(prev => prev.filter(m => m.id !== id));
      if (selected?.id === id) { setSelected(null); setView("dashboard"); }
      showToast("Mail removed.", "error");
    } catch (e) {
      showToast("Failed to delete: " + e.message, "error");
    }
  }

  async function addComment(mailId) {
    const text = commentText.trim();
    if (!text) return;
    const mail = mails.find(m => m.id === mailId);
    if (!mail) return;
    const comment = {
      id: Date.now(),
      author: commentAuthor.trim() || "Staff",
      text,
      time: new Date().toISOString(),
    };
    const newComments = [...(mail.comments || []), comment];
    try {
      await sbFetch(`/mails?id=eq.${mailId}`, {
        method: "PATCH",
        body: JSON.stringify({ comments: newComments }),
      });
      setMails(prev => prev.map(m => m.id !== mailId ? m : { ...m, comments: newComments }));
      setSelected(prev => prev?.id === mailId ? { ...prev, comments: newComments } : prev);
      setCommentText("");
      setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      showToast("Failed to post comment: " + e.message, "error");
    }
  }

  async function deleteComment(mailId, commentId) {
    const mail = mails.find(m => m.id === mailId);
    if (!mail) return;
    const newComments = (mail.comments || []).filter(c => c.id !== commentId);
    try {
      await sbFetch(`/mails?id=eq.${mailId}`, {
        method: "PATCH",
        body: JSON.stringify({ comments: newComments }),
      });
      setMails(prev => prev.map(m => m.id !== mailId ? m : { ...m, comments: newComments }));
      setSelected(prev => prev?.id === mailId ? { ...prev, comments: newComments } : prev);
    } catch (e) {
      showToast("Failed to delete comment: " + e.message, "error");
    }
  }

  const filtered = mails
    .filter(m => {
      const matchFilter = filter === "All" || m.status === filter;
      const matchSearch = !search || m.id.includes(search.toUpperCase()) ||
        m.sender.toLowerCase().includes(search.toLowerCase()) ||
        m.recipient.toLowerCase().includes(search.toLowerCase()) ||
        (m.subject || "").toLowerCase().includes(search.toLowerCase());
      return matchFilter && matchSearch;
    })
    .sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return sortOrder === "newest" ? tb - ta : ta - tb;
    });
  const counts = STATUS_FLOW.reduce((acc, s) => { acc[s] = mails.filter(m => m.status === s).length; return acc; }, {});

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#e8e4dc", fontFamily: "'Courier New', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow+Condensed:wght@300;400;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #111; } ::-webkit-scrollbar-thumb { background: #333; }
        .btn { cursor: pointer; border: none; font-family: inherit; transition: all 0.15s; }
        .btn:hover { opacity: 0.85; transform: translateY(-1px); }
        .btn:active { transform: translateY(0); }
        .mail-row { transition: background 0.15s; cursor: pointer; border-left: 3px solid transparent; }
        .mail-row:hover { background: rgba(255,255,255,0.04) !important; border-left-color: #555 !important; }
        .col-resize-handle { position: absolute; right: 0; top: 0; bottom: 0; width: 6px; cursor: col-resize; z-index: 10; display: flex; align-items: center; justify-content: center; }
        .col-resize-handle::after { content: ''; display: block; width: 1px; height: 60%; background: #2a2a2a; transition: background 0.15s; }
        .col-resize-handle:hover::after { background: #555; }
        .col-header { position: relative; padding: 10px 16px 10px 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; user-select: none; }
        .tab { transition: all 0.2s; cursor: pointer; }
        .inp { background: #111; border: 1px solid #2a2a2a; color: #e8e4dc; font-family: 'Share Tech Mono', monospace; padding: 10px 12px; outline: none; transition: border-color 0.2s, background 0.3s; width: 100%; font-size: 12px; }
        .inp:focus { border-color: #555; }
        .inp.autofilled { border-color: #14532d !important; background: #0a1a0a !important; }
        .drop-zone { border: 2px dashed #2a2a2a; transition: all 0.2s; cursor: pointer; }
        .drop-zone:hover { border-color: #555; background: #0f0f0f !important; }
        .drop-zone.scanning { border-color: #60a5fa !important; animation: borderPulse 1.5s infinite; }
        .drop-zone.scanned-ok { border-color: #14532d !important; }
        .drop-zone.scanned-fail { border-color: #7f1d1d !important; }
        .drop-zone.dragging { border-color: #e8e4dc !important; border-style: solid !important; background: #141414 !important; box-shadow: 0 0 0 1px #e8e4dc22, inset 0 0 40px #e8e4dc08; transform: scale(1.005); }
        .view-doc-btn { background: #0d0d0d; border: 1px solid #2a2a2a; color: #a78bfa; font-family: 'Share Tech Mono', monospace; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; padding: 8px 16px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 8px; }
        .view-doc-btn:hover { background: #1a0a2a; border-color: #a78bfa44; color: #c4b5fd; transform: translateY(-1px); }
        @keyframes borderPulse { 0%,100% { border-color: #60a5fa; box-shadow: 0 0 12px #60a5fa22; } 50% { border-color: #1d4ed8; box-shadow: none; } }
        @keyframes scanLine { 0% { top: 0%; opacity:1; } 95% { opacity:1; } 100% { top:100%; opacity:0; } }
        @keyframes slideIn { from { opacity:0; transform: translateX(20px); } to { opacity:1; transform: translateX(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform: translateY(-6px); } to { opacity:1; transform: translateY(0); } }
        .toast { animation: slideIn 0.3s ease; }
        .fade-in { animation: fadeIn 0.35s ease; }
        .comment-bubble { background: #0d0d0d; border: 1px solid #1e1e1e; padding: 12px 14px; transition: border-color 0.15s; }
        .comment-bubble:hover { border-color: #2a2a2a; }
        .comment-bubble:hover .del-comment { opacity: 1 !important; }
        .del-comment { opacity: 0; transition: opacity 0.15s; background: transparent; border: none; color: #555; font-size: 11px; cursor: pointer; padding: 0; font-family: inherit; }
        .del-comment:hover { color: #f87171; }
        .comment-inp { background: #0d0d0d; border: 1px solid #1e1e1e; color: #e8e4dc; font-family: 'Share Tech Mono', monospace; padding: 10px 12px; outline: none; transition: border-color 0.2s; resize: none; width: 100%; font-size: 12px; }
        .comment-inp:focus { border-color: #444; }
        @keyframes commentIn { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .comment-new { animation: commentIn 0.25s ease; }
      `}</style>

      {/* Document Viewer Modal */}
      {viewerData && <DocViewer dataUrl={viewerData.dataUrl} fileInfo={viewerData.fileInfo} onClose={() => setViewerData(null)} />}

      {/* Header */}
      <header style={{ background: "#0d0d0d", borderBottom: "1px solid #1a1a1a", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 28, height: 28, border: "2px solid #e8e4dc", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✉</div>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>MailTrack</span>
          <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 10, color: "#555", borderLeft: "1px solid #2a2a2a", paddingLeft: 16 }}>AI-POWERED POSTAL SYSTEM</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[["dashboard", "◉ Dashboard"], ["upload", "+ Upload Mail"]].map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} className="btn" style={{
              padding: "6px 18px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase",
              background: view === v ? "#e8e4dc" : "transparent",
              color: view === v ? "#0a0a0a" : "#666",
              border: `1px solid ${view === v ? "#e8e4dc" : "#2a2a2a"}`,
            }}>{label}</button>
          ))}
        </div>
      </header>

      {/* Toast */}
      {toast && (
        <div className="toast" style={{
          position: "fixed", top: 70, right: 24, zIndex: 9998,
          background: toast.type === "error" ? "#2a0a0a" : toast.type === "info" ? "#0a1a2a" : toast.type === "warn" ? "#1a1200" : "#0a2a0a",
          border: `1px solid ${toast.type === "error" ? "#7f1d1d" : toast.type === "info" ? "#1e3a5f" : toast.type === "warn" ? "#713f12" : "#14532d"}`,
          color: toast.type === "error" ? "#fca5a5" : toast.type === "info" ? "#93c5fd" : toast.type === "warn" ? "#fcd34d" : "#86efac",
          padding: "10px 20px", fontSize: 12, letterSpacing: 1, fontFamily: "'Share Tech Mono', monospace", maxWidth: 400
        }}>
          {toast.type === "error" ? "✗" : toast.type === "info" ? "◈" : toast.type === "warn" ? "⚠" : "✓"} {toast.msg}
        </div>
      )}

      <div style={{ padding: "28px 32px" }}>
        {!loaded && (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#555", fontFamily: "'Share Tech Mono', monospace", fontSize: 12, letterSpacing: 3 }}>
            <div style={{ display: "inline-block", animation: "spin 1.5s linear infinite", marginRight: 12, color: "#60a5fa" }}>◈</div>
            CONNECTING TO SUPABASE...
          </div>
        )}
        {loaded && <>

        {/* ── DASHBOARD ── */}
        {view === "dashboard" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1, marginBottom: 28, background: "#1a1a1a" }}>
              {[{ label: "Total", val: mails.length, color: "#e8e4dc" }, ...STATUS_FLOW.map(s => ({ label: s, val: counts[s], color: STATUS_COLORS[s] }))].map(({ label, val, color }) => (
                <div key={label} style={{ background: "#0d0d0d", padding: "16px 20px" }}>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, fontWeight: 700, color }}>{val}</div>
                  <div style={{ fontSize: 10, color: "#444", letterSpacing: 2, textTransform: "uppercase", marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center" }}>
              <input className="inp" placeholder="SEARCH TRACKING ID, SENDER, RECIPIENT..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1 }} />
              <div style={{ display: "flex", gap: 1, background: "#1a1a1a" }}>
                {["All", ...STATUS_FLOW].map(f => (
                  <button key={f} onClick={() => setFilter(f)} className="tab btn" style={{
                    padding: "8px 14px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase",
                    background: filter === f ? "#1e1e1e" : "transparent",
                    color: filter === f ? (STATUS_COLORS[f] || "#e8e4dc") : "#444",
                    borderBottom: filter === f ? `2px solid ${STATUS_COLORS[f] || "#e8e4dc"}` : "2px solid transparent", border: "none",
                  }}>{f}</button>
                ))}
              </div>
              <button className="btn" onClick={() => setSortOrder(s => s === "newest" ? "oldest" : "newest")} style={{
                padding: "8px 14px", background: "transparent", color: "#888",
                border: "1px solid #2a2a2a", fontSize: 10, letterSpacing: 2,
                textTransform: "uppercase", fontFamily: "'Share Tech Mono', monospace",
                whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6
              }}>
                {sortOrder === "newest" ? "↓ NEWEST" : "↑ OLDEST"}
              </button>
              <button className="btn" onClick={() => {
                const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
                const dashboardUrl = window.location.origin;
                const subject = encodeURIComponent(`MailTrack Daily Summary — ${today}`);
                const body = encodeURIComponent(
`MailTrack Daily Summary
${today}
${"─".repeat(40)}

📬 Received:    ${counts["Received"]}
⚙  Processing:  ${counts["Processing"]}
✓  Closed:      ${counts["Closed"]}
${"─".repeat(40)}
Total Items:    ${mails.length}

View Dashboard:
${dashboardUrl}

---
Sent from MailTrack`
                );
                window.location.href = `mailto:?subject=${subject}&body=${body}`;
              }} style={{
                padding: "8px 16px", background: "transparent", color: "#888",
                border: "1px solid #2a2a2a", fontSize: 10, letterSpacing: 2,
                textTransform: "uppercase", fontFamily: "'Share Tech Mono', monospace",
                whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6
              }}>
                ✉ SEND SUMMARY
              </button>
            </div>

            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 0", color: "#333", fontSize: 13, letterSpacing: 2 }}>
                {mails.length === 0 ? "NO MAIL LOGGED — UPLOAD YOUR FIRST PIECE" : "NO RESULTS FOUND"}
              </div>
            ) : (() => {
              const cols = colWidths;
              const gridTemplate = cols.map(w => `${w}px`).join(" ");

              function startResize(e, idx) {
                e.preventDefault();
                resizingCol.current = idx;
                resizeStartX.current = e.clientX;
                resizeStartW.current = cols[idx];
                function onMove(ev) {
                  const delta = ev.clientX - resizeStartX.current;
                  const newW = Math.max(60, resizeStartW.current + delta);
                  setColWidths(prev => prev.map((w, i) => i === idx ? newW : w));
                }
                function onUp() {
                  resizingCol.current = null;
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                }
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }

              const headers = [
                { label: "Tracking ID", idx: 0 },
                { label: "From", idx: 1 },
                { label: "To", idx: 2 },
                { label: "Subject", idx: 3 },
                { label: "Status", idx: 4 },
                { label: null, idx: 5, sortable: true },
                { label: "", idx: 6 },
              ];

              return (
                <div style={{ border: "1px solid #1a1a1a", overflowX: "auto" }}>
                  {/* Header row */}
                  <div style={{ display: "grid", gridTemplateColumns: gridTemplate, background: "#0d0d0d", borderBottom: "1px solid #1a1a1a", fontSize: 10, color: "#444", letterSpacing: 2, textTransform: "uppercase", minWidth: "fit-content" }}>
                    {headers.map(({ label, idx, sortable }) => (
                      <div key={idx} className="col-header" style={{ paddingLeft: idx === 0 ? 16 : 0 }}>
                        {sortable ? (
                          <span onClick={() => setSortOrder(s => s === "newest" ? "oldest" : "newest")}
                            style={{ cursor: "pointer", color: "#666", display: "flex", alignItems: "center", gap: 4 }}>
                            Date Added {sortOrder === "newest" ? "↓" : "↑"}
                          </span>
                        ) : label}
                        {idx < 6 && (
                          <div className="col-resize-handle" onMouseDown={e => startResize(e, idx)} />
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Data rows */}
                  {filtered.map(mail => (
                    <div key={mail.id} className="mail-row"
                      style={{ display: "grid", gridTemplateColumns: gridTemplate, paddingTop: 13, paddingBottom: 13, borderBottom: "1px solid #111", background: "#0a0a0a", alignItems: "center", minWidth: "fit-content" }}
                      onClick={() => { setSelected(mail); setView("detail"); }}>
                      <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 12, color: "#aaa", paddingLeft: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mail.id}</span>
                      <span style={{ fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mail.sender}</span>
                      <span style={{ fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mail.recipient}</span>
                      <span style={{ fontSize: 12, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mail.subject || "—"}</span>
                      <span style={{ fontSize: 10, color: STATUS_COLORS[mail.status], background: `${STATUS_COLORS[mail.status]}15`, padding: "3px 8px", letterSpacing: 1, whiteSpace: "nowrap", display: "inline-block" }}>{mail.status.toUpperCase()}</span>
                      <span style={{ fontSize: 10, color: "#444", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatDate(mail.createdAt)}</span>
                      <span title={mail.aiScanned ? "AI Scanned" : ""} style={{ fontSize: 10, color: "#60a5fa", textAlign: "right", paddingRight: 12 }}>{mail.aiScanned ? "◈" : ""}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── UPLOAD ── */}
        {view === "upload" && (
          <div style={{ maxWidth: 680, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 32, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>Log New Mail</div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 9, color: "#555", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Tracking ID</div>
                {pendingId ? (
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: 3, color: "#e8e4dc" }}>{pendingId}</div>
                ) : (
                  <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 12, color: "#444", letterSpacing: 2, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ display: "inline-block", animation: "spin 1.5s linear infinite" }}>◈</span> GENERATING...
                  </div>
                )}
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, marginBottom: 28 }}>UPLOAD A PDF OR IMAGE — AI WILL AUTO-SCAN SENDER, RECIPIENT & DESCRIPTION</div>

            {/* Drop Zone */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, marginBottom: 8, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ color: "#555" }}>Attach Document</span>
                <span style={{ color: "#60a5fa", fontSize: 9 }}>◈ AI AUTO-SCAN</span>
              </div>
              <div
                className={`drop-zone ${scanning ? "scanning" : dragging ? "dragging" : scanResult === "success" ? "scanned-ok" : scanResult === "failed" ? "scanned-fail" : ""}`}
                style={{ padding: "36px 24px", textAlign: "center", background: "#0d0d0d", position: "relative", overflow: "hidden" }}
                onClick={() => !scanning && fileRef.current?.click()}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                {scanning && (
                  <div style={{ position: "absolute", left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent 0%, #60a5fa 40%, #93c5fd 50%, #60a5fa 60%, transparent 100%)", animation: "scanLine 1.4s linear infinite", pointerEvents: "none", top: 0 }} />
                )}

                {scanning ? (
                  <div className="fade-in">
                    <div style={{ fontSize: 28, marginBottom: 12, display: "inline-block", animation: "spin 2s linear infinite", color: "#60a5fa" }}>◈</div>
                    <div style={{ fontSize: 14, color: "#60a5fa", letterSpacing: 3, marginBottom: 6, fontFamily: "'Share Tech Mono', monospace" }}>SCANNING DOCUMENT</div>
                    <div style={{ fontSize: 10, color: "#3a6a9a", letterSpacing: 1 }}>EXTRACTING SENDER · RECIPIENT · CONTENT TYPE</div>
                    {fileInfo && <div style={{ fontSize: 11, color: "#444", marginTop: 10 }}>{fileInfo.name}</div>}
                  </div>
                ) : fileInfo ? (
                  <div className="fade-in">
                    <div style={{ fontSize: 22, marginBottom: 8, color: scanResult === "success" ? "#4ade80" : scanResult === "failed" ? "#f87171" : "#a78bfa" }}>
                      {scanResult === "success" ? "✓" : scanResult === "failed" ? "⚠" : "📎"}
                    </div>
                    <div style={{ fontSize: 14, color: "#ccc", marginBottom: 4 }}>{fileInfo.name}</div>
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 10 }}>{fileInfo.size}</div>

                    {/* Preview thumbnail for images */}
                    {fileDataUrl && fileInfo.type?.startsWith("image/") && (
                      <div style={{ marginBottom: 12 }}>
                        <img src={fileDataUrl} alt="preview" style={{ maxHeight: 80, maxWidth: 160, objectFit: "contain", border: "1px solid #2a2a2a", opacity: 0.8 }} />
                      </div>
                    )}

                    {scanResult === "success" && (
                      <div style={{ fontSize: 11, color: "#4ade80", background: "#061206", border: "1px solid #14532d", padding: "6px 16px", display: "inline-block", letterSpacing: 1, marginBottom: 8 }}>
                        ◈ AI SCAN COMPLETE — FIELDS AUTOFILLED BELOW
                      </div>
                    )}
                    {scanResult === "failed" && (
                      <div style={{ fontSize: 11, color: "#f87171", background: "#1a0606", border: "1px solid #7f1d1d", padding: "6px 16px", display: "inline-block", letterSpacing: 1, marginBottom: 8 }}>
                        SCAN FAILED — PLEASE FILL FIELDS MANUALLY
                      </div>
                    )}
                    {scanResult === "unsupported" && (
                      <div style={{ fontSize: 11, color: "#fcd34d", background: "#1a1000", border: "1px solid #713f12", padding: "6px 16px", display: "inline-block", letterSpacing: 1, marginBottom: 8 }}>
                        ⚠ FORMAT NOT SCANNABLE — USE PDF OR IMAGE
                      </div>
                    )}

                    {/* Preview button for PDFs/images */}
                    {fileDataUrl && (fileInfo.type === "application/pdf" || fileInfo.type?.startsWith("image/")) && (
                      <div style={{ marginTop: 4 }}>
                        <button
                          className="view-doc-btn"
                          style={{ display: "inline-flex", margin: "0 auto" }}
                          onClick={e => { e.stopPropagation(); setViewerData({ dataUrl: fileDataUrl, fileInfo }); }}
                        >
                          ⊞ PREVIEW DOCUMENT
                        </button>
                      </div>
                    )}

                    <div style={{ marginTop: 10, fontSize: 10, color: "#333", letterSpacing: 1 }}>CLICK TO REPLACE</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 36, marginBottom: 10, color: dragging ? "#e8e4dc" : "#2a2a2a", transition: "color 0.2s" }}>{dragging ? "↓" : "↑"}</div>
                    <div style={{ fontSize: 13, color: dragging ? "#e8e4dc" : "#444", letterSpacing: 2, marginBottom: 8, transition: "color 0.2s" }}>
                      {dragging ? "DROP TO SCAN" : "DRAG & DROP OR CLICK TO UPLOAD"}
                    </div>
                    <div style={{ fontSize: 10, color: dragging ? "#888" : "#2a2a2a", letterSpacing: 1, transition: "color 0.2s" }}>
                      PDF OR IMAGE → AI READS SENDER, RECIPIENT & DESCRIPTION AUTOMATICALLY
                    </div>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*,application/pdf,.doc,.docx,.txt" style={{ display: "none" }} onChange={handleFileChange} />
            </div>

            {/* Form Fields */}
            <div style={{ display: "grid", gap: 16 }}>
              {scanResult === "success" && (
                <div className="fade-in" style={{ padding: "10px 16px", background: "#060e06", border: "1px solid #14532d33", fontSize: 11, color: "#4ade8099", letterSpacing: 1 }}>
                  ◈ Green-highlighted fields were autofilled by AI — review and correct if needed.
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 6, textTransform: "uppercase", display: "flex", gap: 8, alignItems: "center" }}>
                    Sender *{scanResult === "success" && form.sender && <span style={{ color: "#4ade80", fontSize: 9, letterSpacing: 1 }}>◈ AI</span>}
                  </div>
                  <input className={`inp ${scanResult === "success" && form.sender ? "autofilled" : ""}`} placeholder="Name or address" value={form.sender} onChange={e => setForm(f => ({ ...f, sender: e.target.value }))} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 6, textTransform: "uppercase", display: "flex", gap: 8, alignItems: "center" }}>
                    Recipient *{scanResult === "success" && form.recipient && <span style={{ color: "#4ade80", fontSize: 9, letterSpacing: 1 }}>◈ AI</span>}
                  </div>
                  <input className={`inp ${scanResult === "success" && form.recipient ? "autofilled" : ""}`} placeholder="Name or address" value={form.recipient} onChange={e => setForm(f => ({ ...f, recipient: e.target.value }))} />
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 6, textTransform: "uppercase", display: "flex", gap: 8, alignItems: "center" }}>
                  Description{scanResult === "success" && form.subject && <span style={{ color: "#4ade80", fontSize: 9, letterSpacing: 1 }}>◈ AI</span>}
                </div>
                <input className={`inp ${scanResult === "success" && form.subject ? "autofilled" : ""}`} placeholder="Brief description" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
              </div>

              <div>
                <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 6, textTransform: "uppercase" }}>Notes</div>
                <textarea className="inp" style={{ resize: "vertical", minHeight: 80 }} placeholder="Internal notes or special instructions..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                <button className="btn" onClick={handleSubmit} disabled={scanning} style={{
                  flex: 1, padding: "14px", background: scanning ? "#1a1a1a" : "#e8e4dc", color: scanning ? "#444" : "#0a0a0a",
                  fontSize: 13, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase",
                  fontFamily: "'Barlow Condensed', sans-serif", cursor: scanning ? "not-allowed" : "pointer"
                }}>{scanning ? "◈ SCANNING..." : "⬛ GENERATE TRACKING & LOG MAIL"}</button>
                <button className="btn" onClick={() => { setView("dashboard"); setForm({ sender: "", recipient: "", subject: "", notes: "" }); setFileInfo(null); setFileDataUrl(null); setScanResult(null); setPendingId(null); }} style={{
                  padding: "14px 24px", background: "transparent", color: "#555", fontSize: 12, letterSpacing: 2, textTransform: "uppercase", border: "1px solid #2a2a2a"
                }}>CANCEL</button>
              </div>
            </div>
          </div>
        )}

        {/* ── DETAIL VIEW ── */}
        {view === "detail" && selected && (() => {
          const mail = mails.find(m => m.id === selected.id) || selected;
          const statusIdx = STATUS_FLOW.indexOf(mail.status);
          return (
            <div>
              <button className="btn" onClick={() => { setView("dashboard"); setEditingId(false); }} style={{ fontSize: 11, color: "#555", background: "transparent", border: "none", marginBottom: 24, letterSpacing: 2 }}>← BACK TO DASHBOARD</button>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                <div>
                  <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: "#555", marginBottom: 4, letterSpacing: 2 }}>TRACKING NUMBER</div>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 26, fontWeight: 700, letterSpacing: 3, marginBottom: 6, color: "#e8e4dc", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    {editingId ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          autoFocus
                          value={editIdValue}
                          onChange={e => setEditIdValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") saveTrackingId(mail.id, editIdValue);
                            if (e.key === "Escape") setEditingId(false);
                          }}
                          style={{
                            fontFamily: "'Barlow Condensed', sans-serif", fontSize: 24, fontWeight: 700,
                            letterSpacing: 3, background: "#111", border: "1px solid #555",
                            color: "#e8e4dc", padding: "2px 10px", outline: "none", width: 180,
                          }}
                        />
                        <button className="btn" onClick={() => saveTrackingId(mail.id, editIdValue)} style={{ fontSize: 10, padding: "5px 12px", background: "#e8e4dc", color: "#0a0a0a", letterSpacing: 2, fontFamily: "'Share Tech Mono', monospace" }}>SAVE</button>
                        <button className="btn" onClick={() => setEditingId(false)} style={{ fontSize: 10, padding: "5px 12px", background: "transparent", color: "#555", border: "1px solid #2a2a2a", letterSpacing: 2, fontFamily: "'Share Tech Mono', monospace" }}>CANCEL</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {mail.id}
                        <button className="btn" onClick={() => { setEditIdValue(mail.id); setEditingId(true); }} style={{ fontSize: 9, padding: "3px 10px", background: "transparent", color: "#555", border: "1px solid #2a2a2a", letterSpacing: 2, fontFamily: "'Share Tech Mono', monospace" }}>✎ EDIT</button>
                      </div>
                    )}
                    {mail.aiScanned && <span style={{ fontSize: 10, color: "#60a5fa", background: "#060e1a", border: "1px solid #1e3a5f", padding: "3px 10px", letterSpacing: 2, fontFamily: "'Share Tech Mono', monospace" }}>◈ AI SCANNED</span>}
                  </div>

                  <div style={{ marginBottom: 28, marginTop: 20 }}>
                    <div style={{ display: "flex", marginBottom: 12 }}>
                      {STATUS_FLOW.map((s, i) => <div key={s} style={{ flex: 1, height: 4, background: i <= statusIdx ? STATUS_COLORS[s] : "#1a1a1a", transition: "background 0.4s" }} />)}
                    </div>
                    <div style={{ display: "flex" }}>
                      {STATUS_FLOW.map((s, i) => (
                        <div key={s} style={{ textAlign: "center", fontSize: 9, color: i <= statusIdx ? STATUS_COLORS[s] : "#333", letterSpacing: 1, textTransform: "uppercase", flex: 1 }}>
                          <div style={{ marginBottom: 3, fontSize: 14 }}>{i <= statusIdx ? STATUS_ICONS[s] : "·"}</div>
                          {s}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "#1a1a1a", marginBottom: 20 }}>
                    {[["From", mail.sender], ["To", mail.recipient], ["Status", mail.status], ["Logged", formatDate(mail.createdAt)], ["Updated", formatDate(mail.updatedAt)]].map(([k, v]) => (
                      <div key={k} style={{ background: "#0d0d0d", padding: "14px 16px" }}>
                        <div style={{ fontSize: 9, color: "#444", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>{k}</div>
                        <div style={{ fontSize: 13, color: k === "Status" ? STATUS_COLORS[v] : "#ccc" }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  {mail.subject && (
                    <div style={{ padding: "14px 16px", background: "#0d0d0d", border: "1px solid #1a1a1a", marginBottom: 16 }}>
                      <div style={{ fontSize: 9, color: "#444", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Description</div>
                      <div style={{ fontSize: 13, color: "#aaa" }}>{mail.subject}</div>
                    </div>
                  )}
                  {mail.notes && (
                    <div style={{ padding: "14px 16px", background: "#0d0d0d", border: "1px solid #1a1a1a", marginBottom: 16 }}>
                      <div style={{ fontSize: 9, color: "#444", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Notes</div>
                      <div style={{ fontSize: 13, color: "#aaa" }}>{mail.notes}</div>
                    </div>
                  )}

                  {/* Attached File Panel */}
                  {mail.file && (
                    <div style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", marginBottom: 20, overflow: "hidden" }}>
                      <div style={{ padding: "12px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontSize: 9, color: "#444", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Attached File</div>
                          <div style={{ fontSize: 13, color: "#a78bfa", display: "flex", alignItems: "center", gap: 8 }}>
                            <span>📎</span>
                            <span>{mail.file.name}</span>
                            <span style={{ fontSize: 10, color: "#555" }}>{mail.file.size}</span>
                          </div>
                        </div>
                        {mail.fileDataUrl && (
                          <button className="view-doc-btn" onClick={() => openViewer(mail)}>
                            ⊞ VIEW DOCUMENT
                          </button>
                        )}
                      </div>
                      {!mail.fileDataUrl && (
                        <div style={{ padding: "8px 16px", fontSize: 10, color: "#444", letterSpacing: 1 }}>
                          File preview not available
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 10 }}>
                    {STATUS_FLOW.map((s, i) => {
                      const isCurrent = mail.status === s;
                      return (
                        <button
                          key={s}
                          className="btn"
                          onClick={() => !isCurrent && advanceStatus(mail.id, s)}
                          style={{
                            flex: 1, padding: "10px 6px", fontSize: 10, letterSpacing: 1,
                            textTransform: "uppercase", textAlign: "center",
                            background: isCurrent ? `${STATUS_COLORS[s]}22` : "transparent",
                            color: isCurrent ? STATUS_COLORS[s] : "#444",
                            border: `1px solid ${isCurrent ? STATUS_COLORS[s] + "66" : "#1e1e1e"}`,
                            cursor: isCurrent ? "default" : "pointer",
                            fontFamily: "'Share Tech Mono', monospace",
                          }}
                        >
                          {isCurrent && <div style={{ fontSize: 7, marginBottom: 3, letterSpacing: 2, color: STATUS_COLORS[s] }}>CURRENT</div>}
                          {s}
                        </button>
                      );
                    })}
                    <button className="btn" onClick={() => deleteMail(mail.id)} style={{ padding: "10px 14px", background: "#2a0a0a", color: "#f87171", border: "1px solid #7f1d1d44", fontSize: 11, letterSpacing: 2, flexShrink: 0 }}>✗</button>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {/* Tracking History */}
                  <div style={{ marginBottom: 32 }}>
                    <div style={{ fontSize: 10, color: "#555", letterSpacing: 3, textTransform: "uppercase", marginBottom: 16 }}>Tracking History</div>
                    {[...mail.history].reverse().map((h, i) => (
                      <div key={i} style={{ display: "flex", gap: 16, marginBottom: 20 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <div style={{ width: 10, height: 10, borderRadius: "50%", background: STATUS_COLORS[h.status], flexShrink: 0, marginTop: 2, boxShadow: `0 0 8px ${STATUS_COLORS[h.status]}` }} />
                          {i < mail.history.length - 1 && <div style={{ width: 1, flex: 1, background: "#1a1a1a", marginTop: 4 }} />}
                        </div>
                        <div style={{ paddingBottom: 16 }}>
                          <div style={{ fontSize: 12, color: STATUS_COLORS[h.status], fontWeight: 600, letterSpacing: 1 }}>{h.status.toUpperCase()}</div>
                          <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{formatDate(h.time)}</div>
                          <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{h.note}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ── COMMENTS ── */}
                  <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 24 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      <div style={{ fontSize: 10, color: "#555", letterSpacing: 3, textTransform: "uppercase" }}>Discussion</div>
                      {(mail.comments?.length > 0) && (
                        <div style={{ fontSize: 10, color: "#333", letterSpacing: 1 }}>{mail.comments.length} comment{mail.comments.length !== 1 ? "s" : ""}</div>
                      )}
                    </div>

                    {/* Comment list */}
                    <div style={{ marginBottom: 16, maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                      {(!mail.comments || mail.comments.length === 0) ? (
                        <div style={{ padding: "20px 0", textAlign: "center", color: "#2a2a2a", fontSize: 11, letterSpacing: 2 }}>
                          NO COMMENTS YET — START THE DISCUSSION
                        </div>
                      ) : (
                        mail.comments.map((c, i) => (
                          <div key={c.id} className={`comment-bubble ${i === mail.comments.length - 1 ? "comment-new" : ""}`}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <div style={{ width: 22, height: 22, background: "#1a1a1a", border: "1px solid #2a2a2a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#555", flexShrink: 0, fontFamily: "'Share Tech Mono', monospace" }}>
                                  {c.author.charAt(0).toUpperCase()}
                                </div>
                                <span style={{ fontSize: 11, color: "#aaa", letterSpacing: 1 }}>{c.author}</span>
                                <span style={{ fontSize: 10, color: "#333" }}>·</span>
                                <span style={{ fontSize: 10, color: "#444" }}>{formatDate(c.time)}</span>
                              </div>
                              <button className="del-comment" onClick={() => deleteComment(mail.id, c.id)} title="Delete comment">✕</button>
                            </div>
                            <div style={{ fontSize: 13, color: "#ccc", lineHeight: 1.6, paddingLeft: 32 }}>{c.text}</div>
                          </div>
                        ))
                      )}
                      <div ref={commentsEndRef} />
                    </div>

                    {/* Comment input */}
                    <div style={{ background: "#0a0a0a", border: "1px solid #1e1e1e", padding: 14 }}>
                      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                        <div style={{ flex: "0 0 140px" }}>
                          <input
                            className="comment-inp"
                            placeholder="Your name..."
                            value={commentAuthor}
                            onChange={e => setCommentAuthor(e.target.value)}
                            style={{ fontSize: 11 }}
                          />
                        </div>
                        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLORS[mail.status], flexShrink: 0 }} />
                          <span style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>RE: {mail.id}</span>
                        </div>
                      </div>
                      <textarea
                        className="comment-inp"
                        placeholder="Add a comment about this mail item..."
                        value={commentText}
                        onChange={e => setCommentText(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addComment(mail.id); }}
                        style={{ minHeight: 72, marginBottom: 10, lineHeight: 1.6 }}
                      />
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 9, color: "#333", letterSpacing: 1 }}>CTRL+ENTER TO POST</span>
                        <button
                          className="btn"
                          onClick={() => addComment(mail.id)}
                          disabled={!commentText.trim()}
                          style={{
                            padding: "7px 20px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase",
                            background: commentText.trim() ? "#e8e4dc" : "#1a1a1a",
                            color: commentText.trim() ? "#0a0a0a" : "#444",
                            fontFamily: "'Share Tech Mono', monospace",
                            cursor: commentText.trim() ? "pointer" : "not-allowed",
                          }}
                        >POST COMMENT</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
        </>}
      </div>
    </div>
  );
}
