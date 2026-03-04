import { useState, useEffect, useRef } from "react";

// ── Supabase config ────────────────────────────────────────────────────────
const SB_URL = "https://enruxqfwoojsflaqcijw.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVucnV4cWZ3b29qc2ZsYXFjaWp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMTQyNjUsImV4cCI6MjA4Nzc5MDI2NX0.VpDatxRR395arTYT2hOJVDuU7Ps76GMFPRuLUwNKcNU";
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
    priority: r.priority || "Medium",
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
    priority: m.priority || "Medium",
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

async function sbFetch(path, options = {}, token = null) {
  const authHeader = token
    ? { "Authorization": `Bearer ${token}` }
    : { "Authorization": `Bearer ${SB_KEY}` };
  const res = await fetch(`${SB_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      "apikey": SB_KEY,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...authHeader,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Supabase error ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// ── Auth helpers ──────────────────────────────────────────────────────────
async function authSignIn(email, password) {
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "apikey": SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Login failed");
  return data; // { access_token, user, ... }
}

async function authSignOut(token) {
  await fetch(`${SB_URL}/auth/v1/logout`, {
    method: "POST",
    headers: { "apikey": SB_KEY, "Authorization": `Bearer ${token}` },
  });
}

async function authGetUser(token) {
  const res = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { "apikey": SB_KEY, "Authorization": `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

// ── Login Screen ──────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e) {
    e?.preventDefault();
    if (!email || !password) { setError("Please enter your email and password."); return; }
    setLoading(true); setError("");
    try {
      const session = await authSignIn(email, password);
      localStorage.setItem("mailtrack-session", JSON.stringify(session));
      onLogin(session);
    } catch (err) {
      setError(err.message || "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FDFBF7", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;1,400&family=DM+Sans:wght@300;400&family=JetBrains+Mono:wght@300;400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .login-inp { width: 100%; background: white; border: 1px solid #E8E3DB; border-bottom: 2px solid #1B3A2D; color: #1B3A2D; font-family: 'DM Sans', sans-serif; font-weight: 300; padding: 10px 12px; font-size: 14px; outline: none; transition: border-color 0.2s; }
        .login-inp:focus { border-bottom-color: #3A6B54; }
        .login-inp::placeholder { color: #8B9590; }
      `}</style>

      {/* Gold accent line top */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 3, background: "#B8965A" }} />

      <div style={{ width: "100%", maxWidth: 400, padding: "0 32px" }}>

        {/* Logo / firm identity */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ width: 2, height: 40, background: "#B8965A", margin: "0 auto 24px" }} />
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 5, textTransform: "uppercase", color: "#1B3A2D", marginBottom: 8 }}>
            Green Bay Ventures
          </div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic", fontSize: 22, fontWeight: 400, color: "#8B9590" }}>
            Mail Management
          </div>
        </div>

        {/* Card */}
        <div style={{ background: "white", border: "1px solid #E8E3DB", borderTop: "2px solid #1B3A2D", padding: "36px 32px" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 4, textTransform: "uppercase", color: "#B8965A", marginBottom: 28 }}>
            Sign In
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#8B9590", marginBottom: 7 }}>Email Address</div>
            <input
              className="login-inp" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              placeholder="you@greenbayventures.com"
            />
          </div>

          <div style={{ marginBottom: 28 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#8B9590", marginBottom: 7 }}>Password</div>
            <input
              className="login-inp" type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div style={{ background: "#FDF5F5", border: "1px solid #C2A0A0", borderLeft: "3px solid #8B4A4A", color: "#8B4A4A", padding: "10px 14px", fontSize: 13, fontWeight: 300, marginBottom: 20 }}>
              {error}
            </div>
          )}

          <button onClick={handleLogin} disabled={loading} style={{
            width: "100%", padding: "14px",
            background: loading ? "#C2D9CE" : "#1B3A2D",
            color: loading ? "#8B9590" : "#FDFBF7",
            border: "none", cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 3, textTransform: "uppercase",
            transition: "background 0.2s",
          }}>
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </div>

        <div style={{ textAlign: "center", marginTop: 24, fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 13, color: "#8B9590" }}>
          Contact your administrator to request access.
        </div>
      </div>
    </div>
  );
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
const STATUS_COLORS = { "Received": "#3A6B54", "Processing": "#B8965A", "Closed": "#8B9590" };
const STATUS_ICONS = { "Received": "⬛", "Processing": "⚙", "Closed": "✓" };
const PRIORITY_COLORS = { "Low": "#3A6B54", "Medium": "#B8965A", "High": "#8B4A4A" };
const PRIORITY_ICONS = { "Low": "↓", "Medium": "→", "High": "↑" };

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
4. priority: One of "Low", "Medium", or "High" based on urgency cues:
   - High: legal notices, court documents, government correspondence, certified mail, invoices past due, deadlines, urgent/immediate language, collection notices, contracts requiring signature
   - Low: newsletters, marketing materials, catalogs, general announcements, routine acknowledgments
   - Medium: everything else

Respond ONLY with valid JSON like:
{"sender": "...", "recipient": "...", "subject": "...", "priority": "Medium"}

If you cannot determine a field with confidence, use an empty string "" for text fields or "Medium" for priority. Do not guess.`;

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
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(27,58,45,0.85)", display: "flex", flexDirection: "column", animation: "fadeIn 0.2s ease" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      {/* Toolbar */}
      <div style={{ background: "white", borderBottom: "2px solid #1B3A2D", padding: "0 28px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 2, height: 24, background: "#B8965A" }} />
          <div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: 14, color: "#1B3A2D" }}>{fileInfo?.name}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#8B9590", letterSpacing: 1 }}>{fileInfo?.size}{isPDF && pages.length > 0 ? ` · ${pages.length} page${pages.length !== 1 ? "s" : ""}` : ""}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {displayUrl && (
            <a href={displayUrl} download={!isRemoteUrl ? fileInfo?.name : undefined} target={isRemoteUrl ? "_blank" : undefined} rel="noreferrer"
              style={{ padding: "6px 16px", background: "transparent", color: "#566963", border: "1px solid #E8E3DB", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
              ↓ Download
            </a>
          )}
          <button onClick={onClose} style={{ background: "#1B3A2D", border: "none", color: "#FDFBF7", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, padding: "6px 16px", letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>
            ✕ Close
          </button>
        </div>
      </div>
      {/* Content */}
      <div ref={containerRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", padding: 32, gap: 16, background: "#F5F1EA" }}>
        {loading && <div style={{ color: "#8B9590", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 3, marginTop: 80, textTransform: "uppercase" }}>Rendering…</div>}
        {error && (
          <div style={{ color: "#8B4A4A", fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 14, marginTop: 80, textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>⚠</div>{error}
            {displayUrl && <div style={{ marginTop: 16 }}><a href={displayUrl} target="_blank" rel="noreferrer" style={{ color: "#3A6B54", fontSize: 13 }}>Open file ↗</a></div>}
          </div>
        )}
        {isPDF && !loading && !error && pages.map((src, i) => (
          <div key={i} style={{ position: "relative", boxShadow: "0 4px 24px rgba(27,58,45,0.15)" }}>
            {pages.length > 1 && <div style={{ position: "absolute", top: 10, right: 10, background: "#1B3A2D", color: "#FDFBF7", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 1, padding: "3px 10px" }}>{i + 1} / {pages.length}</div>}
            <img src={src} alt={`Page ${i + 1}`} style={{ display: "block", maxWidth: "min(900px, 100%)", border: "1px solid #D4CFC6" }} />
          </div>
        ))}
        {isImage && displayUrl && <img src={displayUrl} alt={fileInfo?.name} style={{ maxWidth: "min(900px, 100%)", objectFit: "contain", border: "1px solid #D4CFC6", boxShadow: "0 4px 24px rgba(27,58,45,0.12)" }} />}
        {!isPDF && !isImage && displayUrl && (
          <div style={{ textAlign: "center", color: "#8B9590", fontFamily: "'DM Sans', sans-serif", fontWeight: 300, marginTop: 80 }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>📎</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", marginBottom: 20 }}>Preview not available</div>
            <a href={displayUrl} target="_blank" rel="noreferrer" style={{ color: "#3A6B54", fontSize: 13, fontWeight: 300 }}>Open file ↗</a>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────
export default function MailTracker() {
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [mails, setMails] = useState([]);
  const [view, setView] = useState("dashboard");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ sender: "", recipient: "", subject: "", notes: "", priority: "Medium" });
  const [fileInfo, setFileInfo] = useState(null);
  const [fileDataUrl, setFileDataUrl] = useState(null); // base64 data URL for current upload
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [filter, setFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = localStorage.getItem("mailtrack-col-widths");
      return saved ? JSON.parse(saved) : [170, 170, 180, 100, 90, 120, 30];
    } catch { return [170, 170, 180, 100, 90, 120, 30]; }
  });
  const resizingCol = useRef(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const [toast, setToast] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [viewerData, setViewerData] = useState(null); // { dataUrl, fileInfo }
  const [commentText, setCommentText] = useState("");
  const [commentAuthor, setCommentAuthor] = useState("");
  const commentsEndRef = useRef(null);
  const fileRef = useRef();
  const dragCounter = useRef(0);

  // Persist column widths to localStorage
  useEffect(() => {
    try { localStorage.setItem("mailtrack-col-widths", JSON.stringify(colWidths)); } catch {}
  }, [colWidths]);

  // Check for existing session on mount
  useEffect(() => {
    async function checkSession() {
      try {
        const raw = localStorage.getItem("mailtrack-session");
        if (raw) {
          const saved = JSON.parse(raw);
          const user = await authGetUser(saved.access_token);
          if (user) { setSession(saved); setAuthChecked(true); return; }
        }
      } catch {}
      localStorage.removeItem("mailtrack-session");
      setAuthChecked(true);
    }
    checkSession();
  }, []);

  const userName = session?.user?.user_metadata?.name || session?.user?.email?.split("@")[0] || "Staff";
  const userEmail = session?.user?.email || "";

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
          priority: ["Low","Medium","High"].includes(extracted.priority) ? extracted.priority : f.priority,
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
    const id = crypto.randomUUID();

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
      priority: form.priority || "Medium",
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
      setForm({ sender: "", recipient: "", subject: "", notes: "", priority: "Medium" });
      setFileInfo(null);
      setFileDataUrl(null);
      setScanResult(null);
      if (fileRef.current) fileRef.current.value = "";
      showToast(`Mail logged! Tracking: ${id}`);
      setView("dashboard");
    } catch (e) {
      showToast("Failed to save: " + e.message, "error");
    }
  }

  async function signOut() {
    try { await authSignOut(session?.access_token); } catch {}
    localStorage.removeItem("mailtrack-session");
    setSession(null);
    setMails([]);
    setLoaded(false);
  }

  function openViewer(mail) {
    if (!mail.file || !mail.fileDataUrl) return;
    setViewerData({ dataUrl: mail.fileDataUrl, fileInfo: mail.file });
  }

  async function advanceStatus(id, targetStatus) {
    const mail = mails.find(m => m.id === id);
    if (!mail) return;
    const updatedAt = new Date().toISOString();
    const newHistory = [...mail.history, {
      status: targetStatus,
      time: updatedAt,
      note: `Status changed to ${targetStatus}.`,
      by: userName,
    }];
    try {
      await sbFetch(`/mails?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: targetStatus, updated_at: updatedAt, history: newHistory }),
      }, session?.access_token);
      setMails(prev => prev.map(m => m.id !== id ? m : { ...m, status: targetStatus, updatedAt, history: newHistory }));
      setSelected(prev => prev?.id === id ? { ...prev, status: targetStatus, updatedAt, history: newHistory } : prev);
      showToast(`Status set to ${targetStatus}.`);
    } catch (e) {
      showToast("Failed to update status: " + e.message, "error");
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
      author: userName,
      email: userEmail,
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
      const matchStatus = filter === "All" || m.status === filter;
      const matchPriority = priorityFilter === "All" || (m.priority || "Medium") === priorityFilter;
      const matchSearch = !search ||
        m.sender.toLowerCase().includes(search.toLowerCase()) ||
        m.recipient.toLowerCase().includes(search.toLowerCase()) ||
        (m.subject || "").toLowerCase().includes(search.toLowerCase());
      return matchStatus && matchPriority && matchSearch;
    })
    .sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return sortOrder === "newest" ? tb - ta : ta - tb;
    });
  const counts = STATUS_FLOW.reduce((acc, s) => { acc[s] = mails.filter(m => m.status === s).length; return acc; }, {});

  // Load mails once session is established
  useEffect(() => {
    if (!session) return;
    setLoaded(false);
    async function load() {
      try {
        const rows = await sbFetch("/mails?select=*&order=created_at.desc", {}, session.access_token);
        setMails(rows.map(rowToMail));
      } catch (e) {
        showToast("Failed to load from Supabase: " + e.message, "error");
      }
      setLoaded(true);
    }
    load();
  }, [session]);

  if (!authChecked) return (
    <div style={{ minHeight: "100vh", background: "#FDFBF7", display: "flex", alignItems: "center", justifyContent: "center", color: "#8B9590", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 4, textTransform: "uppercase" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400&display=swap'); @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <span style={{ display: "inline-block", animation: "spin 1.5s linear infinite", marginRight: 12, color: "#3A6B54" }}>◈</span> Loading...
    </div>
  );

  if (!session) return <LoginScreen onLogin={s => setSession(s)} />;

  return (
    <div style={{ minHeight: "100vh", background: "#FDFBF7", color: "#1B3A2D", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&family=JetBrains+Mono:wght@300;400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #F5F1EA; } ::-webkit-scrollbar-thumb { background: #C2D9CE; }
        .btn { cursor: pointer; border: none; font-family: inherit; transition: all 0.15s; }
        .btn:hover { opacity: 0.85; }
        .btn:active { transform: translateY(0); }
        .mail-row { transition: background 0.15s; cursor: pointer; border-left: 3px solid transparent; }
        .mail-row:hover { background: #F5F1EA !important; border-left-color: #B8965A !important; }
        .col-resize-handle { position: absolute; right: 0; top: 0; bottom: 0; width: 6px; cursor: col-resize; z-index: 10; display: flex; align-items: center; justify-content: center; }
        .col-resize-handle::after { content: ''; display: block; width: 1px; height: 60%; background: #D4CFC6; transition: background 0.15s; }
        .col-resize-handle:hover::after { background: #8B9590; }
        .col-header { position: relative; padding: 10px 16px 10px 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; user-select: none; }
        .tab { transition: all 0.2s; cursor: pointer; }
        .inp { background: white; border: 1px solid #E8E3DB; border-bottom: 2px solid #1B3A2D; color: #1B3A2D; font-family: 'DM Sans', sans-serif; font-weight: 300; padding: 10px 12px; outline: none; transition: border-color 0.2s; width: 100%; font-size: 14px; }
        .inp:focus { border-color: #3A6B54; }
        .inp.autofilled { border-bottom-color: #3A6B54 !important; background: #EDF3F0 !important; }
        textarea.inp { border: 1px solid #E8E3DB; border-bottom: 2px solid #1B3A2D; }
        .drop-zone { border: 2px dashed #D4CFC6; transition: all 0.2s; cursor: pointer; }
        .drop-zone:hover { border-color: #8BB5A0; background: #F5F1EA !important; }
        .drop-zone.scanning { border-color: #3A6B54 !important; animation: borderPulse 1.5s infinite; }
        .drop-zone.scanned-ok { border-color: #3A6B54 !important; }
        .drop-zone.scanned-fail { border-color: #8B4A4A !important; }
        .drop-zone.dragging { border-color: #1B3A2D !important; border-style: solid !important; background: #EDF3F0 !important; }
        .view-doc-btn { background: white; border: 1px solid #E8E3DB; color: #3A6B54; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; padding: 8px 16px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 8px; }
        .view-doc-btn:hover { background: #EDF3F0; border-color: #8BB5A0; }
        @keyframes borderPulse { 0%,100% { border-color: #3A6B54; } 50% { border-color: #8BB5A0; } }
        @keyframes scanLine { 0% { top: 0%; opacity:1; } 95% { opacity:1; } 100% { top:100%; opacity:0; } }
        @keyframes slideIn { from { opacity:0; transform: translateX(20px); } to { opacity:1; transform: translateX(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform: translateY(-6px); } to { opacity:1; transform: translateY(0); } }
        .toast { animation: slideIn 0.3s ease; }
        .fade-in { animation: fadeIn 0.35s ease; }
        .comment-bubble { background: white; border: 1px solid #E8E3DB; padding: 14px 16px; transition: border-color 0.15s; }
        .comment-bubble:hover { border-color: #C2D9CE; }
        .comment-bubble:hover .del-comment { opacity: 1 !important; }
        .del-comment { opacity: 0; transition: opacity 0.15s; background: transparent; border: none; color: #8B9590; font-size: 11px; cursor: pointer; padding: 0; font-family: inherit; }
        .del-comment:hover { color: #8B4A4A; }
        .comment-inp { background: white; border: 1px solid #E8E3DB; color: #1B3A2D; font-family: 'DM Sans', sans-serif; font-weight: 300; padding: 10px 12px; outline: none; transition: border-color 0.2s; resize: none; width: 100%; font-size: 14px; }
        .comment-inp:focus { border-color: #8BB5A0; }
        @keyframes commentIn { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .comment-new { animation: commentIn 0.25s ease; }
      `}</style>

      {/* Document Viewer Modal */}
      {viewerData && <DocViewer dataUrl={viewerData.dataUrl} fileInfo={viewerData.fileInfo} onClose={() => setViewerData(null)} />}

      {/* Header */}
      <header style={{ background: "white", borderBottom: "2px solid #1B3A2D", padding: "0 40px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 2, height: 32, background: "#B8965A" }} />
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 5, textTransform: "uppercase", color: "#1B3A2D" }}>Green Bay Ventures</div>
            <div style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic", fontSize: 13, color: "#8B9590", fontWeight: 400, marginTop: 1 }}>Mail Management</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {[["dashboard", "Dashboard"], ["upload", "Log Mail"]].map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} className="btn" style={{
              padding: "7px 20px", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 3, textTransform: "uppercase",
              background: view === v ? "#1B3A2D" : "transparent",
              color: view === v ? "#FDFBF7" : "#8B9590",
              border: `1px solid ${view === v ? "#1B3A2D" : "#E8E3DB"}`,
            }}>{label}</button>
          ))}
          <div style={{ borderLeft: "1px solid #E8E3DB", paddingLeft: 16, marginLeft: 8, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#1B3A2D" }}>{userName}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#8B9590", letterSpacing: 1 }}>{userEmail}</div>
            </div>
            <button className="btn" onClick={signOut} style={{
              padding: "6px 14px", background: "transparent", color: "#8B9590",
              border: "1px solid #E8E3DB", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
            }}>Sign Out</button>
          </div>
        </div>
      </header>

      {/* Toast */}
      {toast && (
        <div className="toast" style={{
          position: "fixed", top: 76, right: 24, zIndex: 9998,
          background: toast.type === "error" ? "white" : toast.type === "warn" ? "white" : "white",
          border: `1px solid ${toast.type === "error" ? "#8B4A4A" : toast.type === "warn" ? "#B8965A" : "#3A6B54"}`,
          borderLeft: `4px solid ${toast.type === "error" ? "#8B4A4A" : toast.type === "warn" ? "#B8965A" : "#3A6B54"}`,
          color: toast.type === "error" ? "#8B4A4A" : toast.type === "warn" ? "#B8965A" : "#3A6B54",
          padding: "12px 20px", fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 13, maxWidth: 400
        }}>
          {toast.msg}
        </div>
      )}

      <div style={{ padding: "36px 40px" }}>
        {!loaded && (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#8B9590", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: 3 }}>
            <div style={{ display: "inline-block", animation: "spin 1.5s linear infinite", marginRight: 12, color: "#3A6B54" }}>◈</div>
            Loading...
          </div>
        )}
        {loaded && <>

        {/* ── DASHBOARD ── */}
        {view === "dashboard" && (
          <div>
            {/* Page title */}
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 4, textTransform: "uppercase", color: "#B8965A", marginBottom: 8 }}>Overview</div>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 400, color: "#1B3A2D", marginBottom: 0 }}>Mail Dashboard</div>
              <div style={{ width: "100%", height: 2, background: "#1B3A2D", marginTop: 12 }} />
            </div>

            {/* Stats row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 32 }}>
              {[{ label: "Total", val: mails.length, color: "#1B3A2D" }, ...STATUS_FLOW.map(s => ({ label: s, val: counts[s], color: STATUS_COLORS[s] }))].map(({ label, val, color }) => (
                <div key={label} style={{ background: "white", border: "1px solid #E8E3DB", padding: "20px 24px" }}>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, fontWeight: 400, color }}>{val}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#8B9590", letterSpacing: 3, textTransform: "uppercase", marginTop: 4 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Filter/Search bar */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "center" }}>
                <input className="inp" placeholder="Search sender, recipient, subject…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, fontSize: 13 }} />
                <button className="btn" onClick={() => setSortOrder(s => s === "newest" ? "oldest" : "newest")} style={{
                  padding: "9px 16px", background: "white", color: "#566963", border: "1px solid #E8E3DB",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", whiteSpace: "nowrap"
                }}>{sortOrder === "newest" ? "↓ Newest" : "↑ Oldest"}</button>
                <button className="btn" onClick={() => {
                  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
                  const dashboardUrl = window.location.origin;
                  const subject = encodeURIComponent(`Mail Summary — ${today}`);
                  const body = encodeURIComponent(
`Green Bay Ventures — Mail Summary
${today}

Received:   ${counts["Received"]}
Processing: ${counts["Processing"]}
Closed:     ${counts["Closed"]}
Total:      ${mails.length}

Dashboard: ${dashboardUrl}`
                  );
                  window.location.href = `mailto:?subject=${subject}&body=${body}`;
                }} style={{
                  padding: "9px 16px", background: "white", color: "#566963", border: "1px solid #E8E3DB",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", whiteSpace: "nowrap"
                }}>✉ Summary</button>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {/* Status filter */}
                <div style={{ display: "flex", gap: 0, border: "1px solid #E8E3DB", background: "white", flex: 1 }}>
                  {["All", ...STATUS_FLOW].map((f, fi) => (
                    <button key={f} onClick={() => setFilter(f)} className="tab btn" style={{
                      flex: 1, padding: "7px 10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
                      background: filter === f ? "#1B3A2D" : "transparent",
                      color: filter === f ? "#FDFBF7" : "#8B9590",
                      borderRight: fi < STATUS_FLOW.length ? "1px solid #E8E3DB" : "none",
                      border: "none", borderRight: fi < STATUS_FLOW.length ? "1px solid #E8E3DB" : "none",
                      background: filter === f ? "#1B3A2D" : "transparent",
                    }}>{f}</button>
                  ))}
                </div>
                <div style={{ color: "#E8E3DB" }}>|</div>
                {/* Priority filter */}
                <div style={{ display: "flex", gap: 0, border: "1px solid #E8E3DB", background: "white" }}>
                  {["All", "Low", "Medium", "High"].map((p, pi) => (
                    <button key={p} onClick={() => setPriorityFilter(p)} className="tab btn" style={{
                      padding: "7px 14px", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
                      background: priorityFilter === p ? PRIORITY_COLORS[p] || "#1B3A2D" : "transparent",
                      color: priorityFilter === p ? "white" : "#8B9590",
                      border: "none", borderRight: pi < 3 ? "1px solid #E8E3DB" : "none",
                    }}>{p === "All" ? "All" : `${PRIORITY_ICONS[p]} ${p}`}</button>
                  ))}
                </div>
                {(filter !== "All" || priorityFilter !== "All" || search) && (
                  <button className="btn" onClick={() => { setFilter("All"); setPriorityFilter("All"); setSearch(""); }} style={{
                    padding: "7px 14px", background: "transparent", color: "#8B9590",
                    border: "1px solid #E8E3DB", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", whiteSpace: "nowrap"
                  }}>✕ Clear</button>
                )}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 0", color: "#8B9590", fontFamily: "'Playfair Display', serif", fontStyle: "italic", fontSize: 16 }}>
                {mails.length === 0 ? "No mail logged yet — log your first piece." : "No results match the current filters."}
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
                { label: "From", idx: 0 },
                { label: "To", idx: 1 },
                { label: "Subject", idx: 2 },
                { label: "Status", idx: 3 },
                { label: "Priority", idx: 4 },
                { label: null, idx: 5, sortable: true },
                { label: "", idx: 6 },
              ];

              return (
                <div style={{ border: "none", overflowX: "auto" }}>
                  {/* Header row */}
                  <div style={{ display: "grid", gridTemplateColumns: gridTemplate, borderBottom: "2px solid #1B3A2D", fontSize: 9, color: "#8B9590", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", minWidth: "fit-content" }}>
                    {headers.map(({ label, idx, sortable }) => (
                      <div key={idx} className="col-header" style={{ paddingLeft: idx === 0 ? 16 : 0, paddingTop: 10, paddingBottom: 10 }}>
                        {sortable ? (
                          <span onClick={() => setSortOrder(s => s === "newest" ? "oldest" : "newest")}
                            style={{ cursor: "pointer", color: "#8B9590", display: "flex", alignItems: "center", gap: 4 }}>
                            Date Added {sortOrder === "newest" ? "↓" : "↑"}
                          </span>
                        ) : label}
                        {idx < 6 && <div className="col-resize-handle" onMouseDown={e => startResize(e, idx)} />}
                      </div>
                    ))}
                  </div>
                  {/* Data rows */}
                  {filtered.map((mail, ri) => (
                    <div key={mail.id} className="mail-row"
                      style={{ display: "grid", gridTemplateColumns: gridTemplate, paddingTop: 13, paddingBottom: 13, borderBottom: "1px solid #E8E3DB", background: ri % 2 === 0 ? "#FDFBF7" : "#F9F6F1", alignItems: "center", minWidth: "fit-content" }}
                      onClick={() => { setSelected(mail); setView("detail"); }}>
                      <span style={{ fontSize: 13, fontWeight: 300, color: "#1B3A2D", paddingLeft: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mail.sender}</span>
                      <span style={{ fontSize: 13, fontWeight: 300, color: "#566963", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mail.recipient}</span>
                      <span style={{ fontSize: 13, fontWeight: 300, color: "#566963", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mail.subject || "—"}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 1, color: STATUS_COLORS[mail.status], background: STATUS_BG[mail.status], border: `1px solid ${STATUS_COLORS[mail.status]}40`, whiteSpace: "nowrap", display: "inline-block", textTransform: "uppercase", padding: "3px 10px", borderRadius: 2 }}>{mail.status}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 1, color: PRIORITY_COLORS[mail.priority || "Medium"], whiteSpace: "nowrap", display: "inline-block", textTransform: "uppercase" }}>{PRIORITY_ICONS[mail.priority || "Medium"]} {mail.priority || "Medium"}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8B9590", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatDate(mail.createdAt)}</span>
                      <span title={mail.aiScanned ? "AI Scanned" : ""} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#B8965A", textAlign: "right", paddingRight: 12 }}>{mail.aiScanned ? "◈" : ""}</span>
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
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 4, textTransform: "uppercase", color: "#B8965A", marginBottom: 8 }}>New Entry</div>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 400, color: "#1B3A2D" }}>Log Mail Item</div>
              <div style={{ width: "100%", height: 2, background: "#1B3A2D", marginTop: 12, marginBottom: 6 }} />
              <div style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic", fontSize: 14, color: "#8B9590", fontWeight: 400 }}>Upload a document — AI will extract sender, recipient, and priority automatically.</div>
            </div>

            {/* Drop Zone */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: "#8B9590", marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
                Attach Document
                <span style={{ color: "#B8965A" }}>◈ AI Scan</span>
              </div>
              <div
                className={`drop-zone ${scanning ? "scanning" : dragging ? "dragging" : scanResult === "success" ? "scanned-ok" : scanResult === "failed" ? "scanned-fail" : ""}`}
                style={{ padding: "48px 32px", textAlign: "center", background: "white", position: "relative", overflow: "hidden" }}
                onClick={() => !scanning && fileRef.current?.click()}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                {scanning && (
                  <div style={{ position: "absolute", left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent 0%, #3A6B54 40%, #8BB5A0 50%, #3A6B54 60%, transparent 100%)", animation: "scanLine 1.4s linear infinite", pointerEvents: "none", top: 0 }} />
                )}

                {scanning ? (
                  <div className="fade-in">
                    <div style={{ fontSize: 24, marginBottom: 12, display: "inline-block", animation: "spin 2s linear infinite", color: "#3A6B54" }}>◈</div>
                    <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: "#1B3A2D", marginBottom: 6 }}>Scanning Document</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8B9590", letterSpacing: 1 }}>Extracting sender · recipient · content type</div>
                    {fileInfo && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8B9590", marginTop: 10 }}>{fileInfo.name}</div>}
                  </div>
                ) : fileInfo ? (
                  <div className="fade-in">
                    <div style={{ fontSize: 22, marginBottom: 8, color: scanResult === "success" ? "#3A6B54" : scanResult === "failed" ? "#8B4A4A" : "#B8965A" }}>
                      {scanResult === "success" ? "✓" : scanResult === "failed" ? "⚠" : "📎"}
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 300, color: "#1B3A2D", marginBottom: 4 }}>{fileInfo.name}</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8B9590", marginBottom: 12 }}>{fileInfo.size}</div>
                    {fileDataUrl && fileInfo.type?.startsWith("image/") && (
                      <div style={{ marginBottom: 12 }}>
                        <img src={fileDataUrl} alt="preview" style={{ maxHeight: 80, maxWidth: 160, objectFit: "contain", border: "1px solid #E8E3DB", opacity: 0.9 }} />
                      </div>
                    )}
                    {scanResult === "success" && (
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 1, color: "#3A6B54", background: "#EDF3F0", border: "1px solid #C2D9CE", padding: "6px 16px", display: "inline-block", marginBottom: 8 }}>
                        ◈ AI scan complete — fields autofilled below
                      </div>
                    )}
                    {scanResult === "failed" && (
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 1, color: "#8B4A4A", background: "white", border: "1px solid #8B4A4A", padding: "6px 16px", display: "inline-block", marginBottom: 8 }}>
                        Scan failed — please fill fields manually
                      </div>
                    )}
                    {fileDataUrl && (fileInfo.type === "application/pdf" || fileInfo.type?.startsWith("image/")) && (
                      <div style={{ marginTop: 8 }}>
                        <button className="view-doc-btn" style={{ display: "inline-flex", margin: "0 auto" }} onClick={e => { e.stopPropagation(); setViewerData({ dataUrl: fileDataUrl, fileInfo }); }}>
                          ⊞ Preview Document
                        </button>
                      </div>
                    )}
                    <div style={{ marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#C2D9CE", letterSpacing: 1, textTransform: "uppercase" }}>Click to replace</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 28, marginBottom: 12, color: dragging ? "#1B3A2D" : "#C2D9CE" }}>↑</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 14, color: dragging ? "#1B3A2D" : "#8B9590", marginBottom: 8 }}>
                      {dragging ? "Drop to scan" : "Drag & drop or click to upload"}
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#C2D9CE", letterSpacing: 1, textTransform: "uppercase" }}>
                      PDF or image — AI reads sender, recipient & description automatically
                    </div>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*,application/pdf,.doc,.docx,.txt" style={{ display: "none" }} onChange={handleFileChange} />
            </div>

            {/* Form Fields */}
            <div style={{ display: "grid", gap: 20 }}>
              {scanResult === "success" && (
                <div className="fade-in" style={{ padding: "10px 16px", background: "#EDF3F0", border: "1px solid #C2D9CE", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 1, color: "#3A6B54" }}>
                  ◈ Highlighted fields were autofilled by AI — review before submitting.
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#8B9590", marginBottom: 6, display: "flex", gap: 8, alignItems: "center" }}>
                    From *{scanResult === "success" && form.sender && <span style={{ color: "#B8965A", fontSize: 9 }}>◈ AI</span>}
                  </div>
                  <input className={`inp ${scanResult === "success" && form.sender ? "autofilled" : ""}`} placeholder="Name or organisation" value={form.sender} onChange={e => setForm(f => ({ ...f, sender: e.target.value }))} />
                </div>
                <div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#8B9590", marginBottom: 6, display: "flex", gap: 8, alignItems: "center" }}>
                    To *{scanResult === "success" && form.recipient && <span style={{ color: "#B8965A", fontSize: 9 }}>◈ AI</span>}
                  </div>
                  <input className={`inp ${scanResult === "success" && form.recipient ? "autofilled" : ""}`} placeholder="Name or organisation" value={form.recipient} onChange={e => setForm(f => ({ ...f, recipient: e.target.value }))} />
                </div>
              </div>

              <div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#8B9590", marginBottom: 6, display: "flex", gap: 8, alignItems: "center" }}>
                  Description{scanResult === "success" && form.subject && <span style={{ color: "#B8965A", fontSize: 9 }}>◈ AI</span>}
                </div>
                <input className={`inp ${scanResult === "success" && form.subject ? "autofilled" : ""}`} placeholder="Brief description of contents" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
              </div>

              <div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#8B9590", marginBottom: 6 }}>Notes</div>
                <textarea className="inp" style={{ resize: "vertical", minHeight: 80 }} placeholder="Internal notes or special instructions…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>

              <div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#8B9590", marginBottom: 10, display: "flex", gap: 8, alignItems: "center" }}>
                  Priority{scanResult === "success" && <span style={{ color: "#B8965A", fontSize: 9 }}>◈ AI</span>}
                </div>
                <div style={{ display: "flex", gap: 0, border: "1px solid #E8E3DB" }}>
                  {["Low", "Medium", "High"].map((p, pi) => (
                    <button key={p} onClick={() => setForm(f => ({ ...f, priority: p }))} className="btn" style={{
                      flex: 1, padding: "10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
                      background: form.priority === p ? PRIORITY_COLORS[p] : "white",
                      color: form.priority === p ? "white" : "#8B9590",
                      borderRight: pi < 2 ? "1px solid #E8E3DB" : "none",
                      border: "none", borderRight: pi < 2 ? "1px solid #E8E3DB" : "none",
                      background: form.priority === p ? PRIORITY_COLORS[p] : "white",
                      transition: "all 0.15s",
                    }}>
                      {PRIORITY_ICONS[p]} {p}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                <button className="btn" onClick={handleSubmit} disabled={scanning} style={{
                  flex: 1, padding: "14px", background: scanning ? "#D9D2C5" : "#1B3A2D", color: scanning ? "#8B9590" : "#FDFBF7",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 3, textTransform: "uppercase", cursor: scanning ? "not-allowed" : "pointer",
                  transition: "background 0.2s",
                }}>{scanning ? "Scanning…" : "Log Mail Item"}</button>
                <button className="btn" onClick={() => { setView("dashboard"); setForm({ sender: "", recipient: "", subject: "", notes: "", priority: "Medium" }); setFileInfo(null); setFileDataUrl(null); setScanResult(null); }} style={{
                  padding: "14px 28px", background: "transparent", color: "#8B9590", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", border: "1px solid #E8E3DB",
                }}>Cancel</button>
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
              <button className="btn" onClick={() => setView("dashboard")} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: "#8B9590", background: "transparent", border: "none", marginBottom: 28, display: "flex", alignItems: "center", gap: 8 }}>← Back to Dashboard</button>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
                <div>
                  {/* Section header */}
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 4, textTransform: "uppercase", color: "#B8965A", marginBottom: 6 }}>Mail Detail</div>
                    <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 400, color: "#1B3A2D", marginBottom: 0 }}>{mail.subject || "Mail Item"}</div>
                    <div style={{ width: "100%", height: 2, background: "#1B3A2D", marginTop: 10 }} />
                  </div>

                  {/* Status progress */}
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ display: "flex", marginBottom: 8 }}>
                      {STATUS_FLOW.map((s, i) => <div key={s} style={{ flex: 1, height: 3, background: i <= statusIdx ? STATUS_COLORS[s] : "#E8E3DB", transition: "background 0.4s" }} />)}
                    </div>
                    <div style={{ display: "flex" }}>
                      {STATUS_FLOW.map((s, i) => (
                        <div key={s} style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: i <= statusIdx ? STATUS_COLORS[s] : "#C2D9CE", letterSpacing: 1, textTransform: "uppercase", flex: 1 }}>
                          {s}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Metadata grid */}
                  <div style={{ marginBottom: 20 }}>
                    {[["From", mail.sender], ["To", mail.recipient], ["Status", mail.status], ["Logged", formatDate(mail.createdAt)], ["Updated", formatDate(mail.updatedAt)]].map(([k, v], ki) => (
                      <div key={k} style={{ display: "grid", gridTemplateColumns: "120px 1fr", borderBottom: "1px solid #E8E3DB", padding: "10px 0", background: ki % 2 === 0 ? "#FDFBF7" : "#F9F6F1", paddingLeft: 12, paddingRight: 12 }}>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#8B9590" }}>{k}</div>
                        <div style={{ fontSize: 13, fontWeight: 300, color: k === "Status" ? STATUS_COLORS[v] : "#566963" }}>{v}</div>
                      </div>
                    ))}
                    {/* Priority row */}
                    <div style={{ borderBottom: "1px solid #E8E3DB", padding: "10px 12px", background: "#FDFBF7" }}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#8B9590", marginBottom: 8 }}>Priority</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {["Low", "Medium", "High"].map(p => (
                          <button key={p} className="btn" onClick={async () => {
                            try {
                              await sbFetch(`/mails?id=eq.${encodeURIComponent(mail.id)}`, { method: "PATCH", body: JSON.stringify({ priority: p }) }, session?.access_token);
                              setMails(prev => prev.map(m => m.id !== mail.id ? m : { ...m, priority: p }));
                              setSelected(prev => prev?.id === mail.id ? { ...prev, priority: p } : prev);
                              showToast(`Priority set to ${p}.`);
                            } catch (e) { showToast("Failed to update priority.", "error"); }
                          }} style={{
                            padding: "4px 14px", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
                            background: (mail.priority || "Medium") === p ? PRIORITY_COLORS[p] : "white",
                            color: (mail.priority || "Medium") === p ? "white" : "#8B9590",
                            border: `1px solid ${(mail.priority || "Medium") === p ? PRIORITY_COLORS[p] : "#E8E3DB"}`,
                            cursor: "pointer", transition: "all 0.15s",
                          }}>{PRIORITY_ICONS[p]} {p}</button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {mail.subject && (
                    <div style={{ padding: "14px 16px", background: "white", border: "1px solid #E8E3DB", marginBottom: 12 }}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#8B9590", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>Description</div>
                      <div style={{ fontSize: 13, fontWeight: 300, color: "#566963" }}>{mail.subject}</div>
                    </div>
                  )}
                  {mail.notes && (
                    <div style={{ padding: "14px 16px", background: "white", border: "1px solid #E8E3DB", marginBottom: 12 }}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#8B9590", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>Notes</div>
                      <div style={{ fontSize: 13, fontWeight: 300, color: "#566963" }}>{mail.notes}</div>
                    </div>
                  )}

                  {/* Attached File */}
                  {mail.file && (
                    <div style={{ background: "white", border: "1px solid #E8E3DB", marginBottom: 20 }}>
                      <div style={{ padding: "12px 16px", borderBottom: "1px solid #E8E3DB", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#8B9590", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Attached File</div>
                          <div style={{ fontSize: 13, fontWeight: 300, color: "#3A6B54", display: "flex", alignItems: "center", gap: 8 }}>
                            <span>📎</span><span>{mail.file.name}</span>
                            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8B9590" }}>{mail.file.size}</span>
                          </div>
                        </div>
                        {mail.fileDataUrl && <button className="view-doc-btn" onClick={() => openViewer(mail)}>⊞ View Document</button>}
                      </div>
                    </div>
                  )}

                  {/* Status actions */}
                  <div style={{ display: "flex", gap: 8 }}>
                    {STATUS_FLOW.map(s => {
                      const isCurrent = mail.status === s;
                      return (
                        <button key={s} className="btn" onClick={() => !isCurrent && advanceStatus(mail.id, s)} style={{
                          flex: 1, padding: "10px 6px", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", textAlign: "center",
                          background: isCurrent ? STATUS_COLORS[s] : "white",
                          color: isCurrent ? "white" : "#8B9590",
                          border: `1px solid ${isCurrent ? STATUS_COLORS[s] : "#E8E3DB"}`,
                          cursor: isCurrent ? "default" : "pointer", transition: "all 0.15s",
                        }}>
                          {isCurrent && <div style={{ fontSize: 7, marginBottom: 3, letterSpacing: 2 }}>Current</div>}
                          {s}
                        </button>
                      );
                    })}
                    <button className="btn" onClick={() => deleteMail(mail.id)} style={{ padding: "10px 14px", background: "white", color: "#8B4A4A", border: "1px solid #8B4A4A", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 1, flexShrink: 0 }}>Remove</button>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {/* Tracking History */}
                  <div style={{ marginBottom: 32 }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 4, textTransform: "uppercase", color: "#B8965A", marginBottom: 4 }}>Activity</div>
                    <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 400, color: "#1B3A2D", marginBottom: 16 }}>History</div>
                    <div style={{ width: "100%", height: 1, background: "#E8E3DB", marginBottom: 20 }} />
                    {[...mail.history].reverse().map((h, i) => (
                      <div key={i} style={{ display: "flex", gap: 16, marginBottom: 20 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS[h.status], flexShrink: 0, marginTop: 4 }} />
                          {i < mail.history.length - 1 && <div style={{ width: 1, flex: 1, background: "#E8E3DB", marginTop: 4 }} />}
                        </div>
                        <div style={{ paddingBottom: 16 }}>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: STATUS_COLORS[h.status], letterSpacing: 1, textTransform: "uppercase" }}>{h.status}</div>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8B9590", marginTop: 2 }}>{formatDate(h.time)}{h.by ? ` · ${h.by}` : ""}</div>
                          <div style={{ fontSize: 13, fontWeight: 300, color: "#566963", marginTop: 4 }}>{h.note}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Comments */}
                  <div style={{ borderTop: "2px solid #1B3A2D", paddingTop: 24 }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 4, textTransform: "uppercase", color: "#B8965A", marginBottom: 4 }}>Discussion</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                      <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 400, color: "#1B3A2D" }}>Comments</div>
                      {(mail.comments?.length > 0) && (
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#8B9590", letterSpacing: 1 }}>{mail.comments.length} comment{mail.comments.length !== 1 ? "s" : ""}</div>
                      )}
                    </div>

                    <div style={{ marginBottom: 16, maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                      {(!mail.comments || mail.comments.length === 0) ? (
                        <div style={{ padding: "20px 0", textAlign: "center", fontFamily: "'Playfair Display', serif", fontStyle: "italic", color: "#C2D9CE", fontSize: 14 }}>
                          No comments yet
                        </div>
                      ) : (
                        mail.comments.map((c, i) => (
                          <div key={c.id} className={`comment-bubble ${i === mail.comments.length - 1 ? "comment-new" : ""}`}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <div style={{ width: 24, height: 24, background: "#1B3A2D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#C2D9CE", flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>
                                  {c.author.charAt(0).toUpperCase()}
                                </div>
                                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#1B3A2D", letterSpacing: 1 }}>{c.author}</span>
                                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#8B9590" }}>{formatDate(c.time)}</span>
                              </div>
                              <button className="del-comment" onClick={() => deleteComment(mail.id, c.id)} title="Delete comment">✕</button>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 300, color: "#566963", lineHeight: 1.7, paddingLeft: 34 }}>{c.text}</div>
                          </div>
                        ))
                      )}
                      <div ref={commentsEndRef} />
                    </div>

                    {/* Comment input */}
                    <div style={{ background: "#F9F6F1", border: "1px solid #E8E3DB", padding: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <div style={{ width: 24, height: 24, background: "#1B3A2D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#C2D9CE", flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>
                          {userName.charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#1B3A2D" }}>{userName}</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#C2D9CE", letterSpacing: 1, marginLeft: "auto", textTransform: "uppercase" }}>Posting as signed-in user</span>
                      </div>
                      <textarea
                        className="comment-inp"
                        placeholder="Add a comment…"
                        value={commentText}
                        onChange={e => setCommentText(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addComment(mail.id); }}
                        style={{ minHeight: 72, marginBottom: 10, lineHeight: 1.7 }}
                      />
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#C2D9CE", letterSpacing: 1, textTransform: "uppercase" }}>Ctrl+Enter to post</span>
                        <button className="btn" onClick={() => addComment(mail.id)} disabled={!commentText.trim()} style={{
                          padding: "8px 20px", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
                          background: commentText.trim() ? "#1B3A2D" : "#D9D2C5",
                          color: commentText.trim() ? "#FDFBF7" : "#8B9590",
                          cursor: commentText.trim() ? "pointer" : "not-allowed", transition: "all 0.15s", border: "none",
                        }}>Post Comment</button>
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
