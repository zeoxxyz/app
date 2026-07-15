/**
 * ZEOX · AES-256-GCM encryption  (Node.js / Vercel serverless)
 *
 * Stored format in Firestore:
 *   base64( IV[12] || ciphertext || authTag[16] )
 *
 * Compatible with public/crypto.js (Web Crypto API) which produces
 * the same binary layout (Web Crypto appends authTag automatically).
 */

import { pbkdf2Sync, createCipheriv, createDecipheriv, randomBytes } from "crypto";

const PASSPHRASE    = "zeox-aes-v1-secure-key-2024"; // must match public/crypto.js
const PBKDF2_SALT   = Buffer.from("zeox-salt-v1");
const PBKDF2_ITER   = 100_000;
const KEY_LEN       = 32;  // 256-bit
const IV_LEN        = 12;  // 96-bit
const AUTH_TAG_LEN  = 16;  // 128-bit

let _key: Buffer | null = null;

function getDerivedKey(): Buffer {
  if (_key) return _key;
  _key = pbkdf2Sync(PASSPHRASE, PBKDF2_SALT, PBKDF2_ITER, KEY_LEN, "sha256");
  return _key;
}

/** Encrypt a Buffer with AES-256-GCM → base64: IV || ciphertext || authTag */
export function encryptToBase64(data: Buffer | Uint8Array): string {
  const key    = getDerivedKey();
  const iv     = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc    = Buffer.concat([cipher.update(data as Buffer), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString("base64");
}

/** Decrypt a base64 string produced by encryptToBase64 or public/crypto.js */
export function decryptFromBase64(b64: string): Buffer {
  const raw  = Buffer.from(b64, "base64");
  const iv   = raw.subarray(0, IV_LEN);
  const tag  = raw.subarray(raw.length - AUTH_TAG_LEN);
  const ct   = raw.subarray(IV_LEN, raw.length - AUTH_TAG_LEN);
  const dec  = createDecipheriv("aes-256-gcm", getDerivedKey(), iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]);
}
