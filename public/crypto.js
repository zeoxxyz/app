/**
 * ZEOX · AES-256-GCM encryption  (Browser / Web Crypto API)
 *
 * Stored format in Firestore:
 *   base64( IV[12] || ciphertext+authTag )
 *
 * Compatible with src/crypto/encrypt.ts (Node.js).
 * Web Crypto automatically appends the 16-byte auth tag to the ciphertext.
 *
 * Usage (ES module):
 *   import { encryptToBase64, decryptFromBase64 } from "./crypto.js";
 */

const PASSPHRASE  = "zeox-aes-v1-secure-key-2024"; // must match src/crypto/encrypt.ts
const PBKDF2_SALT = new TextEncoder().encode("zeox-salt-v1");
const PBKDF2_ITER = 100_000;
const IV_LEN      = 12; // bytes (96-bit recommended for GCM)

let _key = null;

async function getCryptoKey() {
  if (_key) return _key;
  const mat = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(PASSPHRASE),
    "PBKDF2", false, ["deriveKey"]
  );
  _key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: PBKDF2_SALT, iterations: PBKDF2_ITER, hash: "SHA-256" },
    mat,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  return _key;
}

/** Uint8Array → base64 */
export function bytesToBase64(bytes) {
  let s = "";
  bytes.forEach(b => s += String.fromCharCode(b));
  return btoa(s);
}

/** base64 → Uint8Array */
export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Encrypt raw bytes (ArrayBuffer / Uint8Array) with AES-256-GCM.
 * Returns base64 string: IV[12] || ciphertext+authTag
 */
export async function encryptToBase64(data) {
  const key = await getCryptoKey();
  const iv  = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct  = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const out = new Uint8Array(IV_LEN + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), IV_LEN);
  return bytesToBase64(out);
}

/**
 * Decrypt a base64 string produced by encryptToBase64.
 * Returns Uint8Array of original plaintext.
 */
export async function decryptFromBase64(b64) {
  const key   = await getCryptoKey();
  const bytes = base64ToBytes(b64);
  const iv    = bytes.slice(0, IV_LEN);
  const ct    = bytes.slice(IV_LEN); // includes auth tag at end
  const pt    = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new Uint8Array(pt);
}
