/**
 * Vercel Serverless Function: GET /api/raw/:id
 *
 * Fetches a file from the `publishedFiles` Firestore collection
 * and returns its AES-256-GCM decrypted content.
 *
 * ⚠️  Requires a Firestore Security Rule that allows public reads:
 *       match /publishedFiles/{id} { allow read: if true; }
 */

import { createDecipheriv, pbkdf2Sync } from "crypto";

// ── AES-256-GCM (must match public/crypto.js & src/crypto/encrypt.ts) ───────
const PASSPHRASE   = "zeox-aes-v1-secure-key-2024";
const PBKDF2_SALT  = Buffer.from("zeox-salt-v1");
const PBKDF2_ITER  = 100_000;
const KEY_LEN      = 32;
const IV_LEN       = 12;
const AUTH_TAG_LEN = 16;

let _key = null;
function getDerivedKey() {
  if (_key) return _key;
  _key = pbkdf2Sync(PASSPHRASE, PBKDF2_SALT, PBKDF2_ITER, KEY_LEN, "sha256");
  return _key;
}

function decryptFromBase64(b64) {
  const raw = Buffer.from(b64, "base64");
  const iv  = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(raw.length - AUTH_TAG_LEN);
  const ct  = raw.subarray(IV_LEN, raw.length - AUTH_TAG_LEN);
  const dec = createDecipheriv("aes-256-gcm", getDerivedKey(), iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]);
}

// ── Firestore REST helper ─────────────────────────────────────────────────────
const PROJECT_ID = "zeoxxyz";

function parseField(f) {
  if (!f) return null;
  if ("stringValue"  in f) return f.stringValue;
  if ("booleanValue" in f) return f.booleanValue;
  if ("integerValue" in f) return parseInt(f.integerValue, 10);
  if ("doubleValue"  in f) return parseFloat(f.doubleValue);
  if ("timestampValue" in f) return f.timestampValue;
  return null;
}

export default async function handler(req, res) {
  const { id } = req.query;

  if (!id || typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: "Invalid file ID." });
  }

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/publishedFiles/${id}`;
    const resp = await fetch(url);

    if (resp.status === 404) return res.status(404).json({ error: "File not found." });
    if (!resp.ok) throw new Error(`Firestore returned ${resp.status}`);

    const data = await resp.json();
    if (!data.fields) return res.status(404).json({ error: "File not found." });

    const f    = data.fields;
    const name = parseField(f.name) ?? "untitled";
    const encB64 = parseField(f.content) ?? "";
    const size = parseField(f.size) ?? 0;

    // Decrypt AES-256-GCM content
    let content = "";
    try {
      content = decryptFromBase64(encB64).toString("utf-8");
    } catch {
      content = encB64; // fallback: plain text (legacy records)
    }

    const accept = req.headers["accept"] || "";
    if (accept.includes("text/plain") || req.query.raw === "1") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(name)}"`);
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.status(200).send(content);
    }

    return res.status(200).json({ id, name, content, size });
  } catch (err) {
    console.error("[/api/raw] Error:", err);
    return res.status(500).json({ error: "Failed to fetch file: " + err.message });
  }
}
