// Storage for the web / Home Screen version (no Tauri): data and attachment files live in the
// browser's IndexedDB on this device only. Nothing is sent anywhere.

const DB_NAME = "point-tracker";
const KV = "kv";
const FILES = "files";

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(KV);
      req.result.createObjectStore(FILES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const getData = (key) => run(KV, "readonly", (s) => s.get(key));
export const setData = (key, json) => run(KV, "readwrite", (s) => s.put(json, key));
export const getFile = (name) => run(FILES, "readonly", (s) => s.get(name));
export const putFile = (name, blob) => run(FILES, "readwrite", (s) => s.put(blob, name));
export const deleteFile = (name) => run(FILES, "readwrite", (s) => s.delete(name));

/** Ask the browser not to clear this data under storage pressure (best effort). */
export async function requestPersistence() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
