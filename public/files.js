/**
 * files.js — ZEOX File Management
 * Handles upload → Firestore persistence → share links.
 *
 * Usage (add to dashboard.html after firebase.js):
 *   import { initFileManager } from "./files.js";
 *   initFileManager();
 */

import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "./firebase.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const DAILY_QUOTA_BYTES = 500 * 1024; // 500 KB
const MAX_FILE_BYTES    = 500 * 1024;

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function formatDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getShareLink(fileId) {
  return `${location.origin}/raw/${fileId}`;
}

// ─── Firestore operations ────────────────────────────────────────────────────

/** Save a file to Firestore. Returns the document ID (share ID). */
async function saveFile({ name, content, encrypted = false, userId }) {
  const size     = new Blob([content]).size;
  const filesCol = collection(db, "files");
  const newDocRef = doc(filesCol);                    // auto-generated ID

  await setDoc(newDocRef, {
    name,
    content,
    size,
    encrypted,
    userId,
    uploadedAt: serverTimestamp(),
    expiresAt:  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  });

  return newDocRef.id;
}

/** Load all files for a given user. */
async function loadUserFiles(userId) {
  const q = query(
    collection(db, "files"),
    where("userId", "==", userId),
    orderBy("uploadedAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Delete a file by Firestore document ID. */
async function deleteFile(fileId) {
  await deleteDoc(doc(db, "files", fileId));
}

// ─── UI Rendering ────────────────────────────────────────────────────────────

function renderFileRow(file, onDelete) {
  const row = document.createElement("div");
  row.className = "file-row";
  row.dataset.id = file.id;
  row.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;gap:12px;" +
    "padding:14px 16px;border-radius:12px;border:1px solid var(--border);" +
    "background:var(--bg-card);margin-bottom:8px;transition:.2s;";

  const left = document.createElement("div");
  left.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:0;";

  const nameLine = document.createElement("div");
  nameLine.style.cssText =
    "font-weight:600;font-size:13px;color:var(--text-main);" +
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px;";
  nameLine.textContent = file.name;

  const metaLine = document.createElement("div");
  metaLine.style.cssText = "display:flex;gap:8px;align-items:center;";
  metaLine.innerHTML =
    `<span style="font-size:11px;color:var(--text-muted);">${formatSize(file.size)}</span>` +
    `<span style="font-size:11px;color:var(--text-muted);">·</span>` +
    `<span style="font-size:11px;color:var(--text-muted);">${formatDate(file.uploadedAt)}</span>` +
    (file.encrypted
      ? `<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:999px;background:rgba(22,163,74,.12);color:#166534;">Encrypted</span>`
      : "");

  left.appendChild(nameLine);
  left.appendChild(metaLine);

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:8px;flex-shrink:0;";

  const linkBtn = document.createElement("button");
  linkBtn.style.cssText =
    "padding:6px 12px;border-radius:8px;border:1px solid var(--border);" +
    "background:var(--bg-hover);color:var(--text-main);font-size:12px;" +
    "font-weight:600;cursor:pointer;transition:.15s;";
  linkBtn.textContent = "🔗 Copy Link";
  linkBtn.addEventListener("click", () => {
    const link = getShareLink(file.id);
    navigator.clipboard.writeText(link).then(() => {
      linkBtn.textContent = "✓ Copied!";
      setTimeout(() => linkBtn.textContent = "🔗 Copy Link", 2000);
    });
  });

  const viewBtn = document.createElement("a");
  viewBtn.href   = getShareLink(file.id);
  viewBtn.target = "_blank";
  viewBtn.style.cssText =
    "padding:6px 12px;border-radius:8px;border:1px solid transparent;" +
    "background:linear-gradient(135deg,#0ea5e9,#0369a1);color:#fff;font-size:12px;" +
    "font-weight:600;cursor:pointer;transition:.15s;text-decoration:none;";
  viewBtn.textContent = "View";

  const delBtn = document.createElement("button");
  delBtn.style.cssText =
    "padding:6px 10px;border-radius:8px;border:1px solid var(--border);" +
    "background:var(--bg-hover);color:#dc2626;font-size:12px;" +
    "font-weight:600;cursor:pointer;transition:.15s;";
  delBtn.textContent = "✕";
  delBtn.title = "Delete file";
  delBtn.addEventListener("click", async () => {
    if (!confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
    delBtn.disabled = true;
    try {
      await deleteFile(file.id);
      row.remove();
      onDelete(file);
    } catch (err) {
      alert("Failed to delete: " + err.message);
      delBtn.disabled = false;
    }
  });

  actions.append(linkBtn, viewBtn, delBtn);
  row.append(left, actions);
  return row;
}

// ─── Quota helpers ───────────────────────────────────────────────────────────

function getTodayKey() {
  return "zeox_quota_" + new Date().toISOString().slice(0, 10);
}

function getQuotaUsed() {
  return parseInt(localStorage.getItem(getTodayKey()) || "0", 10);
}

function addQuotaUsed(bytes) {
  const key = getTodayKey();
  const prev = getQuotaUsed();
  localStorage.setItem(key, prev + bytes);
  // Clean old keys
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith("zeox_quota_") && k !== key) localStorage.removeItem(k);
  }
}

function updateQuotaDisplay() {
  const used  = getQuotaUsed();
  const pct   = Math.min(100, (used / DAILY_QUOTA_BYTES) * 100);
  const label = document.getElementById("quota-used-label");
  const bar   = document.getElementById("quota-bar");
  if (label) label.textContent = formatSize(used) + " used of " + formatSize(DAILY_QUOTA_BYTES);
  if (bar)   { bar.style.width = pct + "%"; bar.style.background = pct > 80 ? "#dc2626" : "#0ea5e9"; }
}

// ─── Main init ───────────────────────────────────────────────────────────────

export function initFileManager() {
  const dropZone   = document.getElementById("file-drop-zone");
  const uploadBtn  = document.getElementById("file-upload-btn");
  const fileInput  = document.getElementById("file-input");
  const fileList   = document.getElementById("file-list");
  const emptyMsg   = document.getElementById("files-empty");
  const filesCount = document.getElementById("stat-files-encrypted");

  if (!dropZone && !fileList) return; // not on dashboard page

  let currentUser = null;
  let userFiles   = [];

  function refreshEmpty() {
    if (emptyMsg) emptyMsg.style.display = userFiles.length === 0 ? "" : "none";
    if (filesCount) filesCount.textContent = userFiles.length;
  }

  function onFileDeleted(file) {
    userFiles = userFiles.filter(f => f.id !== file.id);
    refreshEmpty();
    updateQuotaDisplay();
  }

  async function renderFiles() {
    if (!fileList) return;
    fileList.innerHTML = "";
    for (const f of userFiles) {
      fileList.appendChild(renderFileRow(f, onFileDeleted));
    }
    refreshEmpty();
  }

  async function processFile(file) {
    if (!currentUser) { alert("Please sign in first."); return; }
    if (file.size > MAX_FILE_BYTES) {
      alert(`File too large. Max size is ${formatSize(MAX_FILE_BYTES)}.`);
      return;
    }
    const quotaUsed = getQuotaUsed();
    if (quotaUsed + file.size > DAILY_QUOTA_BYTES) {
      alert("Daily quota exceeded. Resets every 24 hours.");
      return;
    }

    // Visual feedback
    if (dropZone) {
      dropZone.style.opacity = "0.6";
      dropZone.style.pointerEvents = "none";
    }

    try {
      const content = await file.text();
      const fileId  = await saveFile({
        name:      file.name,
        content,
        encrypted: false,
        userId:    currentUser.uid,
      });

      addQuotaUsed(file.size);
      updateQuotaDisplay();

      const newFile = {
        id:         fileId,
        name:       file.name,
        content,
        size:       file.size,
        encrypted:  false,
        userId:     currentUser.uid,
        uploadedAt: { toDate: () => new Date() },
      };
      userFiles.unshift(newFile);

      if (fileList) {
        const row = renderFileRow(newFile, onFileDeleted);
        fileList.prepend(row);
        // Highlight new row
        row.style.background = "rgba(14,165,233,0.07)";
        setTimeout(() => { row.style.background = ""; }, 1500);
      }

      refreshEmpty();

      // Automatically copy share link
      const link = getShareLink(fileId);
      navigator.clipboard.writeText(link).catch(() => {});
      showToast(`File uploaded! Link copied: ${file.name}`, "success");
    } catch (err) {
      console.error("Upload error:", err);
      showToast("Upload failed: " + err.message, "error");
    } finally {
      if (dropZone) {
        dropZone.style.opacity = "";
        dropZone.style.pointerEvents = "";
      }
    }
  }

  // ── Drag-and-drop ──
  if (dropZone) {
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.style.borderColor = "var(--sky)";
      dropZone.style.background  = "rgba(14,165,233,0.05)";
    });
    dropZone.addEventListener("dragleave", () => {
      dropZone.style.borderColor = "";
      dropZone.style.background  = "";
    });
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.style.borderColor = "";
      dropZone.style.background  = "";
      const files = e.dataTransfer?.files;
      if (files?.length) processFile(files[0]);
    });
    dropZone.addEventListener("click", () => fileInput?.click());
  }

  if (uploadBtn) uploadBtn.addEventListener("click", () => fileInput?.click());

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      if (fileInput.files?.length) {
        processFile(fileInput.files[0]);
        fileInput.value = "";
      }
    });
  }

  // ── Auth listener — load files on sign-in ──
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (!user) { userFiles = []; renderFiles(); return; }

    try {
      userFiles = await loadUserFiles(user.uid);
      await renderFiles();
    } catch (err) {
      console.error("Failed to load files:", err);
    }
    updateQuotaDisplay();
  });
}

// ─── Toast helper ────────────────────────────────────────────────────────────

function showToast(message, type = "info") {
  const existing = document.getElementById("zeox-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "zeox-toast";
  const colors = { success: "#166534,rgba(22,163,74,.12)", error: "#991b1b,rgba(220,38,38,.1)", info: "#0369a1,rgba(14,165,233,.1)" };
  const [color, bg] = (colors[type] || colors.info).split(",");
  toast.style.cssText =
    `position:fixed;bottom:28px;right:28px;z-index:9999;` +
    `padding:14px 20px;border-radius:12px;font-size:13px;font-weight:600;` +
    `color:${color};background:${bg};border:1px solid ${color}33;` +
    `box-shadow:0 8px 24px -4px rgba(0,0,0,.12);max-width:360px;word-break:break-word;` +
    `animation:slideInToast .25s ease;`;

  const style = document.createElement("style");
  style.textContent = `@keyframes slideInToast{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`;
  document.head.appendChild(style);

  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "0"; toast.style.transition = ".3s"; setTimeout(() => toast.remove(), 300); }, 4000);
}
