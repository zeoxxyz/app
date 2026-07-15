/**
 * ZEOX · AES-256-GCM encryption (Browser / Web Crypto API)
 *
 * Format stored in Firestore:
 *   base64( IV[12] || ciphertext+authTag )
 *
 * Compatible with src/crypto/encrypt.ts (Node.js) which uses
 * the same binary layout (Web Crypto appends authTag automatically).
 *
 * Usage (ES module):
 *   import { encryptToBase64, decryptFromBase64 } from "./crypto.js";
 */

// Must match the value in src/crypto/encrypt.ts
const PASSPHRASE  = "zeox-aes-v1-secure-key-2024";
const PBKDF2_SALT = new TextEncoder().encode("zeox-salt-v1");
const PBKDF2_ITER = 100_000;
const IV_LEN      = 12; // bytes

let _cryptoKey = null;

async function getCryptoKey() {
  if (_cryptoKey) return _cryptoKey;

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PASSPHRASE),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  _cryptoKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: PBKDF2_SALT,
      iterations: PBKDF2_ITER,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  return _cryptoKey;
}

/**
 * Encrypt raw bytes (ArrayBuffer or Uint8Array) with AES-256-GCM.
 * Returns base64 string: IV[12] || ciphertext+authTag
 */
export async function encryptBytes(data) {
  const key = await getCryptoKey();
  const iv  = crypto.getRandomValues(new Uint8Array(IV_LEN));

  // Web Crypto appends the 16-byte auth tag to the ciphertext automatically
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );

  const result = new Uint8Array(IV_LEN + ciphertextBuf.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertextBuf), IV_LEN);
  return result;
}

/**
 * Decrypt bytes previously encrypted with encryptBytes / encryptToBase64.
 * Returns a Uint8Array of the original plaintext.
 */
export async function decryptBytes(encryptedBytes) {
  const key        = await getCryptoKey();
  const iv         = encryptedBytes.slice(0, IV_LEN);
  const ciphertext = encryptedBytes.slice(IV_LEN); // includes auth tag at end

  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return new Uint8Array(plainBuf);
}

/** Helper: Uint8Array → base64 string */
export function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

/** Helper: base64 string → Uint8Array */
export function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encrypt raw bytes (ArrayBuffer / Uint8Array) → base64 string.
 * This is what dashboard.html calls when uploading a file.
 */
export async function encryptToBase64(data) {
  const encrypted = await encryptBytes(data);
  return bytesToBase64(encrypted);
}

/**
 * Decrypt a base64 string produced by encryptToBase64 / src/crypto/encrypt.ts.
 * Returns a Uint8Array of the original plaintext.
 */
export async function decryptFromBase64(b64) {
  const encBytes = base64ToBytes(b64);
  return await decryptBytes(encBytes);
}
