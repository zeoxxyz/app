/**
 * Vercel Serverless Function: GET /api/raw/:id
 * Returns the (decrypted) content of a file stored in Firestore.
 *
 * Requires that the Firestore Security Rules allow public reads on
 * the `publishedFiles` collection, e.g.:
 *   match /publishedFiles/{id} { allow read: if true; }
 */

import { createDecipheriv, pbkdf2Sync } from "crypto";

// ── AES-256-GCM key derivation (must match public/crypto.js) ──────────────
const PASSPHRASE   = "zeox-aes-v1-secure-key-2024";
const PBKDF2_SALT  = Buffer.from("zeox-salt-v1");
const PBKDF2_ITER  = 100_000;
const KEY_LEN      = 32;
const IV_LEN       = 12;
const AUTH_TAG_LEN = 16;

let _cachedKey = null;
function getDerivedKey() {
  if (_cachedKey) return _cachedKey;
  _cachedKey = pbkdf2Sync(PASSPHRASE, PBKDF2_SALT, PBKDF2_ITER, KEY_LEN, "sha256");
  return _cachedKey;
}

/**
 * Decrypt a base64 string produced by public/crypto.js (AES-256-GCM).
 * Format: base64( IV[12] || ciphertext || authTag[16] )
 */
function decryptFromBase64(b64) {
  const raw      = Buffer.from(b64, "base64");
  const iv       = raw.subarray(0, IV_LEN);
  const tag      = raw.subarray(raw.length - AUTH_TAG_LEN);
  const cipher   = raw.subarray(IV_LEN, raw.length - AUTH_TAG_LEN);
  const dec      = createDecipheriv("aes-256-gcm", getDerivedKey(), iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(cipher), dec.final()]);
}

// ── Firestore REST helper ─────────────────────────────────────────────────
const PROJECT_ID = "zeoxxyz";

function parseFirestoreField(field) {
  if (!field) return null;
  if ("stringValue"  in field) return field.stringValue;
  if ("booleanValue" in field) return field.booleanValue;
  if ("integerValue" in field) return parseInt(field.integerValue);
  if ("doubleValue"  in field) return parseFloat(field.doubleValue);
  if ("timestampValue" in field) return field.timestampValue;
  return null;
}

export default async function handler(req, res) {
  const { id } = req.query;

  if (!id || typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: "Invalid file ID." });
  }

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/publishedFiles/${id}`;
    const response = await fetch(url);

    if (response.status === 404) {
      return res.status(404).json({ error: "File not found." });
    }
    if (!response.ok) {
      throw new Error(`Firestore returned ${response.status}`);
    }

    const data = await response.json();
    if (!data.fields) {
      return res.status(404).json({ error: "File not found." });
    }

    const f         = data.fields;
    const name      = parseFirestoreField(f.name) ?? "untitled";
    const encB64    = parseFirestoreField(f.content) ?? "";
    const size      = parseFirestoreField(f.size) ?? 0;
    const uid       = parseFirestoreField(f.uid) ?? "";

    // Decrypt content (AES-256-GCM)
    let content = "";
    try {
      const plainBuf = decryptFromBase64(encB64);
      content = plainBuf.toString("utf-8");
    } catch (decErr) {
      // Fallback: if decryption fails the stored content may be plain text
      content = encB64;
    }

    const accept = req.headers["accept"] || "";
    if (accept.includes("text/plain") || req.query.raw === "1") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(name)}"`);
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.status(200).send(content);
    }

    return res.status(200).json({ id, name, content, size, uid });
  } catch (err) {
    console.error("[/api/raw] Error:", err);
    return res.status(500).json({ error: "Failed to fetch file: " + err.message });
  }
}
