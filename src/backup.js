// Password-protected backups. The whole backup (records plus every attached document) is encrypted
// on this device before it's saved, with a key made from the password. The same code runs on the
// desktop and the phone, so a backup made on one opens on the other.
//
// Format (a small JSON wrapper, so it's still recognisable as a Point Tracker file):
//   { "pointTrackerBackup": 2, "encrypted": true,
//     "kdf":    { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<base64, 16 bytes>" },
//     "cipher": { "name": "AES-GCM", "iv": "<base64, 12 bytes>" },
//     "data":   "<base64 ciphertext of the backup JSON>" }
// AES-256-GCM also detects a wrong password or a changed file: decryption fails instead of returning garbage.
// Backups without a password are the plain backup JSON, as before.

const ITERATIONS = 600000; // PBKDF2-SHA256, OWASP's current recommendation
export const MIN_PASSWORD = 8;

const toB64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function keyFrom(password, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export const supported = () => !!crypto?.subtle;

/** True for a password-protected backup file (parsed JSON). */
export const isEncrypted = (obj) => !!obj?.encrypted && obj?.cipher?.name === "AES-GCM" && typeof obj?.data === "string";

/** Encrypts the backup JSON text. Returns the wrapper file's text. */
export async function encrypt(json, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(password, salt, ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(json)));
  return JSON.stringify({
    pointTrackerBackup: 2, encrypted: true,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: toB64(salt) },
    cipher: { name: "AES-GCM", iv: toB64(iv) },
    data: toB64(ct),
  });
}

/** Decrypts a wrapper (parsed JSON). Returns the backup JSON text; throws "wrong-password" if it can't. */
export async function decrypt(wrapper, password) {
  const { kdf, cipher } = wrapper;
  if (kdf?.name !== "PBKDF2" || kdf?.hash !== "SHA-256") throw new Error("This backup was made by a newer version of Point Tracker.");
  // A sane range: a damaged or tampered file can't make the app hang deriving the key.
  if (!(kdf.iterations >= 100000 && kdf.iterations <= 10000000)) throw new Error("This backup file is damaged.");
  const key = await keyFrom(password, fromB64(kdf.salt), kdf.iterations);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(cipher.iv) }, key, fromB64(wrapper.data));
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error("wrong-password");
  }
}
