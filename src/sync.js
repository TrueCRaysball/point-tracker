// Nearby Sync: keeps paired devices (computer ↔ phone) in step without accounts or cloud storage.
//
// How it works:
// - Pairing shares a secret key through a QR code (or typed code). It never leaves the paired devices.
// - Devices find each other through PeerJS's free public "introduction" server, then talk directly
//   (WebRTC, already encrypted). Everything is also encrypted with the pairing key, so neither the
//   introduction server nor any relay can read or change it.
// - Both sides send their records, merge (newest change wins, deletions are remembered), then swap any
//   attached documents the other side is missing.
//
// app.js supplies storage through init(host); this file holds no app data of its own.

const PROTOCOL = 1;
const CHUNK = 48 * 1024; // bytes of a document per message
const CONNECT_TIMEOUT = 12000;
const IDLE_TIMEOUT = 30000; // give up on a sync that goes quiet this long

let host = null; // { configKey, deviceName, payload, apply, files, hasFile, readFile, writeFile, onStatus, onPaired }
let cfg = null; // { key, deviceId, devices: [{ id, name, lastSync }], lastSync }
let peer = null;
let aesKey = null;
let groupId = "";
const sessions = new Map(); // other deviceId → session
let state = { busy: false, message: "", error: "" };

export const supported = () => typeof RTCPeerConnection === "function" && !!crypto?.subtle;
export const paired = () => !!cfg?.key;
export const config = () => cfg;
export const status = () => ({ ...state, online: !!peer && !peer.disconnected && !peer.destroyed });

// ---------- Merge (pure) ----------

const COLLECTIONS = ["entries", "reprimands", "leaves"];
const later = (a, b) => ((a ?? "") > (b ?? "") ? a : b);
/** The newer of two versions of a record; ties are settled the same way on both devices. */
function newer(a, b) {
  const ma = a.mod ?? "", mb = b.mod ?? "";
  if (ma !== mb) return ma > mb ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

/** Combines two copies of the data. Gives the same result whichever side does it. */
export function merge(local, remote) {
  const deleted = { ...(local.deleted ?? {}) };
  for (const [id, t] of Object.entries(remote.deleted ?? {})) deleted[id] = later(deleted[id], t);
  const out = { deleted };
  for (const c of COLLECTIONS) {
    const byId = new Map((local[c] ?? []).map((x) => [x.id, x]));
    for (const r of remote[c] ?? []) byId.set(r.id, byId.has(r.id) ? newer(byId.get(r.id), r) : r);
    // A deletion wins unless the record was changed again after it.
    out[c] = [...byId.values()].filter((x) => !(deleted[x.id] && deleted[x.id] >= (x.mod ?? "")));
  }
  const ls = local.settingsMod ?? "", rs = remote.settingsMod ?? "";
  const useRemote = rs > ls || (rs === ls && JSON.stringify(remote.settings ?? {}) > JSON.stringify(local.settings ?? {}));
  out.settings = useRemote && remote.settings ? remote.settings : local.settings;
  out.settingsMod = later(ls, rs) || undefined;
  out.confirmations = {};
  for (const k of new Set([...Object.keys(local.confirmations ?? {}), ...Object.keys(remote.confirmations ?? {})])) {
    out.confirmations[k] = [...new Set([...(local.confirmations?.[k] ?? []), ...(remote.confirmations?.[k] ?? [])])];
  }
  return out;
}

// ---------- Keys and codes ----------

const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I to mix up
function toB32(bytes) {
  let bits = 0, val = 0, out = "";
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function fromB32(text) {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/0/g, "O").replace(/1/g, "I");
  let bits = 0, val = 0;
  const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) return null;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}
const random = (n) => crypto.getRandomValues(new Uint8Array(n));
const KEY_BYTES = 15, ID_BYTES = 5; // 20 bytes → a 32-character code

/** The code another device needs to join: this group's key plus this device's ID. */
export function pairingCode() {
  const key = fromB32(cfg.key), id = fromB32(cfg.deviceId);
  return toB32(new Uint8Array([...key, ...id])).match(/.{1,4}/g).join("-");
}
const QR_PREFIX = "PTSYNC1:";
export const pairingQrText = () => QR_PREFIX + pairingCode().replace(/-/g, "");

/** Reads a scanned or typed code. Returns { key, deviceId } or null. */
export function parseCode(text) {
  const raw = String(text ?? "").trim().replace(/^PTSYNC1:/i, "");
  const bytes = fromB32(raw);
  if (!bytes || bytes.length !== KEY_BYTES + ID_BYTES) return null;
  return { key: toB32(bytes.slice(0, KEY_BYTES)), deviceId: toB32(bytes.slice(KEY_BYTES)) };
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
async function deriveKeys() {
  const hex = [...(await sha256(`pt-group:${cfg.key}`))].map((b) => b.toString(16).padStart(2, "0")).join("");
  groupId = hex.slice(0, 20);
  aesKey = await crypto.subtle.importKey("raw", await sha256(`pt-enc:${cfg.key}`), "AES-GCM", false, ["encrypt", "decrypt"]);
}
const peerIdFor = (deviceId) => `ptsync-${groupId}-${deviceId.toLowerCase()}`;
const deviceIdFromPeer = (peerId) => peerId.split("-").pop().toUpperCase();

async function seal(msg) {
  const iv = random(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, new TextEncoder().encode(JSON.stringify(msg))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out.buffer;
}
async function open(buf) {
  const bytes = new Uint8Array(buf);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, aesKey, bytes.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}

const toB64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ---------- Setup ----------

function saveConfig() {
  try { if (cfg) localStorage.setItem(host.configKey, JSON.stringify(cfg)); else localStorage.removeItem(host.configKey); } catch {}
}
function setStatus(patch) {
  state = { ...state, ...patch };
  host?.onStatus?.(status());
}

/** Loads this device's sync settings and, if paired, goes online and syncs. */
export async function init(h) {
  host = h;
  if (!supported()) return;
  try { cfg = JSON.parse(localStorage.getItem(host.configKey) || "null"); } catch { cfg = null; }
  if (!cfg?.key) return;
  await goOnline();
  syncNow({ quiet: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !paired()) return;
    if (!peer || peer.destroyed) goOnline().then(() => syncNow({ quiet: true }));
    else if (peer.disconnected) { peer.reconnect(); setTimeout(() => syncNow({ quiet: true }), 1500); }
    else syncNow({ quiet: true });
  });
}

async function loadPeerJs() {
  if (window.peerjs?.Peer) return window.peerjs.Peer;
  await new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), { src: "vendor/sync/peerjs.min.js" });
    s.onload = resolve;
    s.onerror = () => reject(new Error("Sync couldn't load."));
    document.head.append(s);
  });
  return window.peerjs.Peer;
}

/** Registers this device with the introduction server so the other device can reach it. */
async function goOnline() {
  await deriveKeys();
  const Peer = await loadPeerJs();
  peer?.destroy();
  const p = new Peer(peerIdFor(cfg.deviceId), { debug: 0 });
  peer = p;
  await new Promise((resolve) => {
    const done = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(done, CONNECT_TIMEOUT);
    p.on("open", () => { setStatus({ error: "" }); done(); });
    p.on("error", (err) => {
      if (err.type === "unavailable-id") setStatus({ error: "Sync is already running in another window." });
      else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) setStatus({ error: "Can't reach the internet right now." });
      done();
    });
  });
  p.on("connection", (conn) => accept(conn));
  p.on("disconnected", () => setTimeout(() => { if (peer === p && !p.destroyed && p.disconnected) p.reconnect(); }, 5000));
}

/** Starts a new sync group on this device (or reuses the current one) for pairing another device. */
export async function startPairing() {
  if (!cfg?.key) {
    cfg = { key: toB32(random(KEY_BYTES)), deviceId: toB32(random(ID_BYTES)), devices: [], lastSync: null };
    saveConfig();
  }
  if (!peer || peer.destroyed || peer.disconnected) await goOnline();
  return { code: pairingCode(), qr: pairingQrText() };
}

/** Joins the group in a scanned/typed code and syncs with the device that showed it. */
export async function join(text) {
  const parsed = parseCode(text);
  if (!parsed) throw new Error("That code isn't right. Check it and try again.");
  const same = cfg?.key === parsed.key;
  const deviceId = same ? cfg.deviceId : toB32(random(ID_BYTES));
  if (deviceId === parsed.deviceId) throw new Error("That's this device's own code. Enter it on the other device.");
  const devices = same ? cfg.devices : [];
  if (!devices.some((d) => d.id === parsed.deviceId)) devices.push({ id: parsed.deviceId, name: "Other device", lastSync: null });
  cfg = { key: parsed.key, deviceId, devices, lastSync: same ? cfg.lastSync : null };
  saveConfig();
  await goOnline();
  return syncWith(parsed.deviceId, { pairing: true });
}

/** Stops syncing on this device and forgets the pairing. */
export function unpair() {
  for (const s of sessions.values()) s.conn.close();
  sessions.clear();
  peer?.destroy();
  peer = null;
  cfg = null;
  saveConfig();
  setStatus({ busy: false, message: "", error: "" });
}

export function forgetDevice(id) {
  if (!cfg) return;
  cfg.devices = cfg.devices.filter((d) => d.id !== id);
  saveConfig();
  setStatus({});
}

// ---------- Syncing ----------

let lastAuto = 0;
/** Syncs with every paired device that's open right now. */
export async function syncNow({ quiet = false } = {}) {
  if (!paired() || !cfg.devices.length) return { synced: 0 };
  if (quiet && Date.now() - lastAuto < 4000) return { synced: 0 };
  lastAuto = Date.now();
  if (!peer || peer.destroyed) await goOnline();
  if (peer.disconnected) {
    peer.reconnect();
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!quiet) setStatus({ busy: true, message: "Looking for your other devices…", error: "" });
  const results = await Promise.all(cfg.devices.map((d) => syncWith(d.id).catch((err) => ({ error: err.message, id: d.id }))));
  const ok = results.filter((r) => !r.error);
  if (!quiet) {
    const one = cfg.devices.length === 1;
    setStatus({
      busy: false,
      message: "",
      error: ok.length ? "" : peer?.open ? `Couldn't reach ${one ? "your other device" : "your other devices"}. Make sure Point Tracker is open on ${one ? "it" : "them"}, then try again.`
        : "Can't reach the internet right now.",
    });
  }
  return { synced: ok.length, results };
}

/** Changes were just saved here: sync them over shortly (if the other device is open). */
let pushTimer = null;
export function changed() {
  if (!paired()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow({ quiet: true }), 4000);
}

function syncWith(deviceId, { pairing = false } = {}) {
  if (sessions.has(deviceId)) return sessions.get(deviceId).done;
  if (!peer?.open) return Promise.reject(new Error("Can't reach the internet right now."));
  return new Promise((resolve, reject) => {
    const target = peerIdFor(deviceId);
    const conn = peer.connect(target, { reliable: true, serialization: "raw" });
    const onPeerError = (err) => {
      if (err.type === "peer-unavailable" && String(err.message).includes(target)) fail("not-open");
    };
    const timer = setTimeout(() => fail("timeout"), CONNECT_TIMEOUT);
    const fail = (why) => {
      clearTimeout(timer);
      peer.off("error", onPeerError);
      conn.close();
      reject(new Error(pairing
        ? "Couldn't reach the other device. Keep the pairing code showing on it and try again."
        : why === "not-open" ? "The other device isn't open right now." : "The other device didn't answer."));
    };
    peer.on("error", onPeerError);
    conn.on("open", () => {
      clearTimeout(timer);
      peer.off("error", onPeerError);
      run(conn, deviceId, true).then(resolve, reject);
    });
    conn.on("error", () => fail("error"));
  });
}

function accept(conn) {
  const from = deviceIdFromPeer(conn.peer);
  const existing = sessions.get(from);
  // Both sides started at once: keep the connection started by the device with the smaller ID.
  if (existing && (existing.outgoing ? cfg.deviceId < from : true)) { conn.close(); return; }
  const session = new Promise((resolve, reject) => conn.on("open", () => run(conn, from, false).then(resolve, reject)));
  session.catch(() => {});
  if (existing) { existing.replacement = session; existing.conn.close(); }
}

/** One sync session over an open connection. Both sides run the same steps. */
function run(conn, deviceId, outgoing) {
  let resolveDone, rejectDone;
  const done = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });
  const s = { conn, outgoing, done, finished: false };
  sessions.set(deviceId, s);

  let name = cfg.devices.find((d) => d.id === deviceId)?.name ?? "Other device";
  let applied = false, wanted = null, servedPeer = false, gotDone = false, sentDone = false;
  let changes = 0, filesIn = 0;
  const incoming = new Map(); // file name → chunks
  let idle;
  const touch = () => { clearTimeout(idle); idle = setTimeout(() => finish(new Error("The sync stopped partway. Try again.")), IDLE_TIMEOUT); };

  const send = async (msg) => {
    conn.send(await seal(msg));
    touch();
    // Don't flood the connection with documents faster than it can send them.
    const dc = conn.dataChannel;
    while (dc && dc.bufferedAmount > 1024 * 1024 && dc.readyState === "open") await new Promise((r) => setTimeout(r, 20));
  };
  const finish = (err) => {
    if (s.finished) return;
    s.finished = true;
    clearTimeout(idle);
    if (sessions.get(deviceId) === s) sessions.delete(deviceId);
    setTimeout(() => conn.close(), 300);
    // Replaced by the other device's connection: report that session's result instead.
    if (s.replacement) { s.replacement.then(resolveDone, rejectDone); return; }
    if (err) { rejectDone(err); return; }
    const when = new Date().toISOString();
    const known = cfg.devices.find((d) => d.id === deviceId);
    if (known) Object.assign(known, { name, lastSync: when });
    else cfg.devices.push({ id: deviceId, name, lastSync: when });
    cfg.lastSync = when;
    saveConfig();
    const result = { id: deviceId, name, changes, files: filesIn };
    setStatus({ error: "" });
    host.onSynced?.(result);
    resolveDone(result);
  };
  const maybeDone = async () => {
    if (!sentDone && applied && wanted && wanted.size === 0) { sentDone = true; await send({ t: "done" }); }
    if (sentDone && gotDone && servedPeer) finish();
  };

  // Handle messages one at a time, in the order they arrive.
  let queue = Promise.resolve();
  conn.on("data", (buf) => { queue = queue.then(() => handle(buf)); });
  const handle = async (buf) => {
    if (s.finished) return;
    let msg;
    try { msg = await open(buf); } catch { finish(new Error("A device with the wrong pairing tried to connect.")); return; }
    touch();
    try {
      switch (msg.t) {
        case "hello":
          if (msg.v !== PROTOCOL) { finish(new Error("Update Point Tracker on both devices, then sync again.")); return; }
          name = String(msg.name || name).slice(0, 40);
          // Learn about the group's other devices so this one can reach them too.
          for (const d of msg.devices ?? []) {
            if (d.id !== cfg.deviceId && d.id !== deviceId && !cfg.devices.some((x) => x.id === d.id)) cfg.devices.push({ id: d.id, name: d.name, lastSync: null });
          }
          saveConfig();
          host.onPaired?.({ id: deviceId, name });
          break;
        case "data": {
          changes = await host.apply(msg.data);
          applied = true;
          const missing = [];
          for (const f of await host.files()) if (!(await host.hasFile(f))) missing.push(f);
          wanted = new Set(missing);
          await send({ t: "want", files: missing });
          break;
        }
        case "want":
          for (const f of msg.files ?? []) {
            let bytes = null;
            try { bytes = await host.readFile(f); } catch {}
            if (!bytes) { await send({ t: "nofile", name: f }); continue; }
            const n = Math.max(1, Math.ceil(bytes.length / CHUNK));
            for (let i = 0; i < n; i++) await send({ t: "chunk", name: f, i, n, b64: toB64(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)) });
          }
          servedPeer = true;
          break;
        case "chunk": {
          if (!wanted?.has(msg.name)) break;
          const parts = incoming.get(msg.name) ?? [];
          parts[msg.i] = fromB64(msg.b64);
          incoming.set(msg.name, parts);
          if (parts.filter(Boolean).length === msg.n) {
            const total = parts.reduce((a, p) => a + p.length, 0), bytes = new Uint8Array(total);
            let o = 0;
            for (const p of parts) { bytes.set(p, o); o += p.length; }
            await host.writeFile(msg.name, bytes);
            incoming.delete(msg.name);
            wanted.delete(msg.name);
            filesIn++;
          }
          break;
        }
        case "nofile": wanted?.delete(msg.name); break;
        case "done": gotDone = true; break;
      }
      await maybeDone();
    } catch (err) {
      finish(new Error(`Sync failed: ${err.message ?? err}`));
    }
  };
  conn.on("close", () => finish(s.finished ? null : new Error("The connection closed before the sync finished.")));

  touch();
  (async () => {
    await send({ t: "hello", v: PROTOCOL, name: host.deviceName, devices: cfg.devices.map(({ id, name }) => ({ id, name })) });
    await send({ t: "data", data: host.payload() });
  })().catch((err) => finish(err));
  return done;
}
