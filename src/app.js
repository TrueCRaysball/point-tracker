import * as E from "./engine.js";
import * as WS from "./webstore.js";
import * as V from "./viewer.js";
import * as S from "./sync.js";
import * as W from "./whatsnew.js";
import * as T from "./tour.js";

const { Day } = E;
const STORE = { data: "pt-demo-data", appearance: "pt-appearance", layout: "pt-layout" };
const tauri = window.__TAURI__;

// ---------- State ----------

let data;
// Set by load(): demo build (sample data), and where the data file lives.
// Web/Home Screen version: add ?demo to the address for the sample-data demo.
const env = { demo: !tauri && new URLSearchParams(location.search).has("demo"), path: "", migrated: false };
const webKey = () => (env.demo ? "data-demo" : "data");
const IS_MAC = /Mac/i.test(navigator.userAgent);
const CASTLIFE_URL = "http://castlife.disney.com";
const ui = {
  page: "overview", // overview | calendar | settings
  expanded: null, // "entries" or "reprimands": that table shown large in a pop-up
  calMonth: null, // first day (Day number) of the month shown on the Calendar page
  calSelected: null, // selected day on the Calendar page
  asOverride: null,
  tab: "entries",
  filter: "all",
  windowFilter: 0,
  newestFirst: true,
  fullscreen: false,
};
let overlay = null; // { kind, ... } for the open popover/menu/dialog

const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

/** Desktop: data file via Rust. Web/Home Screen: IndexedDB on this device. Demo: starts from sample data. */
async function load() {
  let raw = null;
  if (tauri) {
    const res = await tauri.core.invoke("load_data");
    Object.assign(env, { demo: res.demo, path: res.path, migrated: res.migrated });
    raw = res.data;
  } else {
    try { raw = await WS.getData(webKey()); } catch {}
    WS.requestPersistence();
  }
  if (raw) data = JSON.parse(raw);
  else if (env.demo) data = await loadSample();
  else data = { entries: [], reprimands: [] };
  data.settings ??= E.defaultSettings();
  data.settings = { ...E.defaultSettings(), ...data.settings };
  data.entries ??= [];
  data.reprimands ??= [];
  data.confirmations ??= {};
  data.confirmations.dropOffs ??= [];
  data.confirmations.expirations ??= [];
  data.confirmations.leaveDismissed ??= [];
  data.leaves ??= [];
  data.deleted ??= {};
  normalizeLeaves();
  takeSnapshot();
}
/** Sample data for the demo, unpacking any bundled documents into attachment storage. */
async function loadSample() {
  const sample = await (await fetch("sample-data.json")).json();
  for (const [file, b64] of Object.entries(sample.attachmentFiles ?? {})) {
    try {
      if (tauri) await tauri.core.invoke("restore_attachment", { file, dataBase64: b64 });
      else {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        await WS.putFile(file, new Blob([bytes], { type: MIME[extOf(file)] ?? "" }));
      }
    } catch {}
    thumbCache.delete(file);
  }
  delete sample.attachmentFiles;
  return sample;
}

function persist({ fromSync = false } = {}) {
  const changedHere = trackChanges();
  data.updatedAt = stamp();
  const json = JSON.stringify(data, null, 2);
  if (tauri) tauri.core.invoke("save_data", { json }).catch((err) => alert(`Couldn't save: ${err}`));
  else WS.setData(webKey(), json).catch((err) => alert(`Couldn't save: ${err}`));
  if (changedHere && !fromSync) S.changed();
}

// ---------- Change tracking (for Nearby Sync) ----------
// Every record gets a "mod" time when it changes, and deleted records are remembered in data.deleted,
// so two devices can be merged without one wiping out the other.

const SYNCED = ["entries", "reprimands", "leaves"];
let snapshot = null; // record id → JSON as last saved
let settingsSnapshot = "";
const recordKey = ({ mod, ...rest }) => JSON.stringify(rest);
function takeSnapshot() {
  snapshot = new Map();
  for (const c of SYNCED) for (const x of data[c]) snapshot.set(x.id, recordKey(x));
  settingsSnapshot = JSON.stringify(data.settings);
}
/** Stamps records changed since the last save and remembers deletions. True if anything changed. */
function trackChanges() {
  if (!snapshot) { takeSnapshot(); return false; }
  const now = stamp(), seen = new Set();
  let changed = false;
  data.deleted ??= {};
  for (const c of SYNCED) {
    for (const x of data[c]) {
      seen.add(x.id);
      if (snapshot.get(x.id) !== recordKey(x)) { x.mod = now; changed = true; }
    }
  }
  for (const id of snapshot.keys()) if (!seen.has(id)) { data.deleted[id] = now; changed = true; }
  if (settingsSnapshot !== JSON.stringify(data.settings)) { data.settingsMod = now; changed = true; }
  takeSnapshot();
  return changed;
}
function save() {
  persist();
  render();
}

// ---------- Attachments ----------

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "heif", "svg", "avif", "tif", "tiff"];
const MIME = V.MIME;
const thumbCache = new Map();
const extOf = (name) => (name.split(".").pop() || "").toLowerCase();

/** Thumbnails/links for a list of attachments. Images load after render (see hydrateThumbs). */
function attachmentList(list, { removable = false } = {}) {
  if (!list?.length) return "";
  return `<div class="attachments">${list.map((a) => `
    <div class="att" title="${esc(a.name)}">
      <button class="att-open" data-action="open-attachment" data-file="${esc(a.file)}">
        ${a.kind === "image" ? `<img data-thumb="${esc(a.file)}" alt="">`
          : a.kind === "pdf" ? `<span class="att-pdf">${icon("file-text")}<span>PDF</span></span>`
          : `<span class="att-pdf att-file">${icon(V.fileIcon(a.name)[0])}<span>${esc((a.name.split(".").pop() || "FILE").toUpperCase().slice(0, 5))}</span></span>`}
        <span class="att-name">${esc(a.name)}</span>
      </button>
      ${removable ? `<button class="att-remove" data-action="remove-attachment" data-file="${esc(a.file)}" title="Remove">${icon("x")}</button>` : ""}
    </div>`).join("")}</div>`;
}

/** Image source for a stored attachment (cached). */
async function thumbSrc(file) {
  if (thumbCache.has(file)) return thumbCache.get(file);
  let src = "";
  try {
    if (tauri) {
      const ext = file.split(".").pop().toLowerCase();
      src = `data:${MIME[ext] ?? "image/png"};base64,${await tauri.core.invoke("read_attachment", { file })}`;
    } else {
      const blob = await WS.getFile(file);
      if (blob) src = URL.createObjectURL(blob);
    }
  } catch {}
  thumbCache.set(file, src);
  return src;
}

async function hydrateThumbs(root = document) {
  for (const img of root.querySelectorAll("img[data-thumb]")) {
    // Formats this device can't draw (HEIC/TIFF outside Apple's WebKit) fall back to an icon.
    img.onerror = () => img.replaceWith(Object.assign(document.createElement("span"), {
      className: "att-pdf att-file", innerHTML: `${icon("image")}<span>${esc(extOf(img.dataset.thumb).toUpperCase())}</span>` }));
    img.src = await thumbSrc(img.dataset.thumb);
  }
  lucide.createIcons();
}

function deleteFiles(files) {
  for (const file of files) {
    if (tauri) tauri.core.invoke("delete_attachment", { file }).catch(() => {});
    else WS.deleteFile(file).catch(() => {});
    thumbCache.delete(file);
  }
}

const findAttachment = (file) => [...data.entries, ...data.reprimands, ...(data.leaves ?? [])].flatMap((x) => x.attachments ?? []).find((a) => a.file === file);

/** Opens an attachment in the app's own viewer (PDFs, images, Word, spreadsheets, text, audio/video). */
function openAttachment(file) {
  const name = findAttachment(file)?.name ?? file;
  return V.openViewer({
    name,
    load: async () => {
      if (tauri) return new Blob([await tauri.core.invoke("read_attachment_bytes", { file })], { type: MIME[extOf(file)] ?? "" });
      const blob = await WS.getFile(file);
      if (!blob) throw new Error("That file couldn't be found.");
      return blob;
    },
    // Desktop: hand the file to another app (to print it, for example). Web: share or save a copy.
    openExternal: tauri ? () => tauri.core.invoke("open_attachment", { file }).catch((err) => alert(`Couldn't open it: ${err}`)) : null,
    share: !tauri && navigator.canShare ? () => shareAttachment(file) : null,
    download: tauri ? null : async () => {
      const url = URL.createObjectURL(await WS.getFile(file));
      Object.assign(document.createElement("a"), { href: url, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
    swipe: (el, close) => enableSwipeClose(el, close, () => true, (e) => !!e.target.closest(".viewer-head")),
  });
}

async function shareAttachment(file) {
  const blob = await WS.getFile(file);
  const f = new File([blob], findAttachment(file)?.name ?? file, { type: blob.type });
  if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f] }).catch(() => {});
}

/** The item being edited (entry or reprimand) and whether it takes PDFs. */
const editing = () => overlay?.kind === "entry" ? { item: overlay.entry, pdf: false, rerender: renderEntryEditor }
  : overlay?.kind === "rep" ? { item: overlay.rep, pdf: true, rerender: renderReprimandEditor } : null;

function addAttachments(list) {
  const ed = editing();
  if (!ed || !list.length) return;
  ed.item.attachments = [...(ed.item.attachments ?? []), ...list];
  overlay.added.push(...list.map((a) => a.file));
  ed.rerender();
}

const webName = (ext) => `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}.${ext}`;

/** Stores browser File/Blob objects (web version). allowAny: any file type (leave documentation). */
async function storeWebFiles(files, allowPdf, allowAny = false) {
  const added = [];
  for (const f of files) {
    const ext = (f.type === "application/pdf" ? "pdf" : extOf(f.name || "") || (f.type.split("/")[1] ?? "bin")).replace(/[^a-z0-9]/g, "").slice(0, 10) || "bin";
    const kind = ext === "pdf" ? "pdf" : f.type.startsWith("image/") || IMAGE_EXTS.includes(ext) ? "image" : allowAny ? "file" : null;
    if (!kind || (kind === "pdf" && !allowPdf)) { alert(`${f.name || "That file"} can't be attached here.`); continue; }
    const file = webName(ext === "jpeg" ? "jpg" : ext);
    await WS.putFile(file, f);
    added.push({ file, name: f.name || `Image ${nowLocal().replace("T", " ")}.${ext}`, kind });
  }
  return added;
}

async function pickAttachments() {
  const ed = editing();
  if (!ed) return;
  if (tauri) {
    const exts = ed.pdf ? [...IMAGE_EXTS, "pdf"] : IMAGE_EXTS;
    const picked = await tauri.dialog.open({ multiple: true, ...(ed.any ? {} : { filters: [{ name: ed.pdf ? "Images and PDFs" : "Images", extensions: exts }] }) });
    return importPaths([picked].flat().filter(Boolean));
  }
  // Web: the system picker (Photos, camera or Files on a phone).
  const input = Object.assign(document.createElement("input"), { type: "file", multiple: true, ...(ed.any ? {} : { accept: ed.pdf ? "image/*,application/pdf" : "image/*" }) });
  input.onchange = async () => addAttachments(await storeWebFiles([...input.files], ed.pdf, ed.any));
  input.click();
}

async function importPaths(paths) {
  const ed = editing();
  if (!ed) return;
  const added = [];
  for (const path of paths) {
    try { added.push(await tauri.core.invoke("import_attachment", { path, allowPdf: ed.pdf, allowAny: !!ed.any })); }
    catch (err) { alert(err); }
  }
  addAttachments(added);
}

/** "7:00 AM", "7am", "7 pm", "15:30", "0700", "7" → "HH:MM" (24-hour); "" → ""; unreadable → null. */
function parseTime(text) {
  const s = String(text ?? "").trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
  if (!s) return "";
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0), mer = m[3]?.[0];
  if (min > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === "a" && h === 12) h = 0;
    if (mer === "p" && h !== 12) h += 12;
  } else if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const fmtTime = (hhmm) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};
const fmtDateTime = (local) => {
  if (!local) return "";
  if (local.length === 10) return Day.short(Day.parse(local)); // date only
  const d = new Date(local);
  if (isNaN(d)) return local;
  return `${Day.short(Day.parse(local.slice(0, 10)))} at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};
const nowLocal = () => {
  const d = new Date(), pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** About window: app icon, name, version, build number and copyright. */
async function showAbout() {
  const web = tauri ? null : await fetch("version.json").then((r) => r.json()).catch(() => ({}));
  const info = tauri ? await tauri.core.invoke("app_info")
    : { name: env.demo ? "Point Tracker Demo" : "Point Tracker", version: web.version ?? "dev", build: web.build ?? "dev",
        copyright: "Copyright © 2026 CRaysball Softworks. All rights reserved." };
  showDialog(`
    <div class="about">
      <img src="vendor/${env.demo ? "app-icon-demo" : "app-icon"}.png" alt="" draggable="false">
      <h2>${esc(info.name)}</h2>
      <div>${W.STAGE ? "" : "Version "}${esc(W.versionName(info.version))} (Build ${esc(info.build)})</div>
      <div class="muted">${esc(info.copyright)}</div>
      <div class="muted small">Not affiliated with or endorsed by The Walt Disney Company (TWDC).</div>
      <div class="about-actions"><button class="btn-subtle" data-action="whats-new">${icon("sparkles")} What's New</button>
        ${tauri ? `<button class="btn-subtle" data-action="check-updates">${icon("download")} Check for Updates</button>` : ""}
        <button class="btn-primary" data-action="close">OK</button></div>
    </div>`);
}

// ---------- What's New ----------

/** The version of the code that's running (on the web, not the newest one on the server). */
const appVersion = async () => {
  if (tauri) return (await tauri.core.invoke("app_info")).version;
  const own = await import("./app-version.js").then((m) => m.default.version).catch(() => null);
  return own ?? (await fetch("version.json", { cache: "no-store" }).then((r) => r.json())).version;
};
/** Web: true while a newer version than the running one is on the server (it's downloading, or ready to load). */
async function updatePending(version) {
  if (tauri) return false;
  if (document.getElementById("update-notice")) return true;
  const latest = await fetch("version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  return !!latest?.version && latest.version !== version;
}
const whatsNewKey = () => `pt-whatsnew-${env.demo ? "demo" : "main"}`;

// ---------- Welcome and tour (first launch) ----------

const introKey = () => `pt-intro-${env.demo ? "demo" : "main"}`;

/** Very first launch (nothing recorded yet): offer the tour, syncing from another device, or skipping. */
async function maybeShowIntro() {
  if (pref(introKey(), null)) return false;
  setPref(introKey(), "shown");
  const fresh = env.demo || !(data.entries.length || data.reprimands.length || data.leaves.length);
  if (!fresh || pref(whatsNewKey(), null)) return false; // someone who's used the app before
  const version = await appVersion().catch(() => null);
  if (version) setPref(whatsNewKey(), version); // new users don't need "what's new"
  showWelcome();
  return true;
}

function showWelcome() {
  overlay = { kind: "welcome" };
  const here = tauri || !isMobile() ? "computer" : "phone";
  showDialog(`
    <div class="whatsnew welcome">
      <div class="wn-hero">
        <div class="wn-art"></div>
        <img src="vendor/${env.demo ? "app-icon-demo" : "app-icon"}.png" alt="" draggable="false">
        <div><div class="wn-kicker">${icon("hand")} Welcome</div><h2>${env.demo ? "Point Tracker Demo" : "Point Tracker"}</h2>
          <div class="wn-sub">${env.demo ? "This demo is filled with sample data, so explore freely." : "Track your attendance points, reprimands and medical leave in one place."}</div></div>
      </div>
      <div class="wn-body">
        <button class="wl-option c-blue" data-action="intro-tour"><span class="wn-icon">${icon("map")}</span>
          <div><b>Take the Tour</b><p>A one-minute look at how everything works.</p></div>${icon("chevron-right")}</button>
        <button class="wl-option c-teal" data-action="intro-sync"><span class="wn-icon">${icon("refresh-cw")}</span>
          <div><b>Sync Data</b><p>Already use Point Tracker on another device? Bring your data to this ${here}.</p></div>${icon("chevron-right")}</button>
      </div>
    </div>
    <div class="dialog-actions wl-actions"><button class="link-btn" data-action="intro-skip">Skip Introduction</button></div>`, true);
}

/** Tour stops for the desktop layout and the phone layout. */
function tourSteps() {
  const q = (sel) => () => document.querySelector(sel);
  const panel = (title) => () => [...document.querySelectorAll(".panel")].find((p) => p.querySelector(".panel-title")?.textContent.includes(title));
  const intro = { target: null, title: "A quick look around", text: "Here's what each part of Point Tracker does. Use the arrow keys or the buttons to move through the tour." };
  const done = { target: null, title: "You're all set", text: `Start by logging your call-ins with ${isMobile() ? "the <b>+</b> button" : "<b>Add Entry</b>"}. You can take this tour again any time from <b>Settings → Help</b>.` };
  if (isMobile()) {
    const tab = (page) => q(`.m-tabbar [data-page="${page}"]`);
    return [
      intro,
      { target: q("#m-cards"), title: "Your points windows", text: "Each card is a rolling window (like 30 or 90 days). The ring shows your points against the limit that earns a reprimand. Swipe to see the others." },
      { target: q(".m-plus"), title: "Log a call-in", text: "Tap <b>+</b> to add a call-in, a shift you picked up or worked, or a reprimand. Points are worked out for you." },
      { target: tab("callins"), title: "Call-ins", text: "Every call-in you've logged, with its points and which sick occurrence it belongs to." },
      { target: tab("reprimands"), title: "Reprimands", text: "Reprimands you've signed, when each one expires, and how close you are to termination." },
      { target: tab("calendar"), title: "Calendar", text: "A month view of your call-ins, reprimands and medical leave." },
      { target: q(".m-date"), title: "Look ahead or back", text: "Pick any date to see where you'll stand then. Handy for checking when points drop off." },
      { target: q('.m-iconbtn[data-page="settings"]'), title: "Settings", text: "Adjust thresholds and point values, back up your data, and turn on <b>Nearby Sync</b> to keep your phone and computer in step." },
      done,
    ];
  }
  const nav = (page) => q(`.nav [data-page="${page}"]`);
  return [
    intro,
    { target: q(".panel.workpoints"), title: "Work Points Progress", text: "Each card is a rolling window (like 30 or 90 days). The ring shows your points against the limit that earns a reprimand, and when your oldest point drops off." },
    { target: panel("Attendance Reprimands"), title: "Attendance Reprimands", text: "How many reprimands are in effect, and how many more before termination." },
    { target: panel("Reprimands Expire"), title: "Reprimands Expire", text: "When your current reprimands expire, with a countdown." },
    { target: q(".panel.log"), title: "Call-ins and reprimands", text: "Everything you've logged. Click a row for details, or double-click to edit it." },
    { target: q('[data-action="add-entry"]'), title: "Add Entry", text: "Log a call-in, a shift you picked up or worked, or another change. Points are worked out for you." },
    { target: q(".datenav"), title: "Look ahead or back", text: "Change the date to see where you'll stand on any day. Handy for checking when points drop off." },
    { target: nav("calendar"), title: "Calendar", text: "A month view of your call-ins, reprimands and medical leave." },
    { target: nav("leaves"), title: "Medical Leaves", text: "Keep each leave's details, timeline, notes, upcoming dates and documents together." },
    { target: nav("settings"), title: "Settings", text: "Adjust thresholds and point values, back up your data, and turn on <b>Nearby Sync</b> to keep your phone and computer in step." },
    done,
  ];
}

function startAppTour() {
  closeOverlay();
  if (isMobile()) ui.mpage = "overview"; else ui.page = "overview";
  ui.expanded = null;
  render();
  T.startTour(tourSteps());
}

/**
 * First launch of a new version: show what changed. Skipped on a brand-new install with nothing in it.
 * Only shown once the running version is the one the notes are for (not while an update is still
 * downloading), and only counts as read once it's closed, so an update in between doesn't swallow it.
 */
async function maybeShowWhatsNew() {
  const version = await appVersion().catch(() => null);
  if (!version) return;
  const seen = pref(whatsNewKey(), null);
  if (seen === version) return;
  const usedBefore = seen || env.demo || data.entries.length || data.reprimands.length || data.leaves.length;
  if (!usedBefore) { setPref(whatsNewKey(), version); return; }
  const notes = W.notesSince(seen, version);
  if (!notes.some((n) => n.version === version || n.version === "next")) return; // nothing written for this version
  if (overlay || (await updatePending(version))) return; // try again after the update
  showWhatsNew(notes, version, { markSeen: true });
}

async function showWhatsNew(notes, version, { markSeen = false } = {}) {
  version ??= await appVersion().catch(() => "");
  notes ??= W.recentNotes(version); // opened by hand: the last few versions
  overlay = { kind: "whatsnew", markSeen: markSeen ? version : null };
  const label = (v) => (v === "next" ? version : v);
  const many = notes.length > 1;
  showDialog(`
    <div class="whatsnew">
      <div class="wn-hero">
        <div class="wn-art"></div>
        <img src="vendor/${env.demo ? "app-icon-demo" : "app-icon"}.png" alt="" draggable="false">
        <div><div class="wn-kicker">${icon("sparkles")} What's New</div><h2>Point Tracker ${esc(W.versionName(version))}</h2>
          <div class="wn-sub">Here's what's new since you last opened the app.</div></div>
      </div>
      <div class="wn-body">
        ${notes.map((n) => `
          ${many ? `<h3 class="wn-ver">Version ${esc(W.versionName(label(n.version)))}</h3>` : ""}
          <div class="wn-cards">${(n.features ?? []).map((f) => `
            <div class="wn-card c-${f.color ?? "blue"}"><span class="wn-icon">${icon(f.icon)}</span>
              <div><b>${esc(f.title)}</b><p>${esc(f.text)}</p></div></div>`).join("")}</div>
          ${n.also?.length ? `<div class="wn-also"><div class="wn-also-head">Also in this update</div><ul>${n.also.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}`).join("")}
      </div>
    </div>
    <div class="dialog-actions"><span class="spacer"></span><button class="btn-primary" data-action="close">Continue</button></div>`, true);
}

/** File → Save / ⌘S / Ctrl+S: save now and confirm in the footer. */
let savedFlashTimer = null;
function manualSave() {
  persist();
  const el = document.getElementById("last-saved");
  if (el) el.textContent = lastSavedText();
  const flash = document.getElementById("saved-flash");
  if (flash) {
    flash.classList.add("show");
    clearTimeout(savedFlashTimer);
    savedFlashTimer = setTimeout(() => flash.classList.remove("show"), 1600);
  }
}

// Timed auto-save on top of the save that happens on every add, edit and delete.
// Only the footer timestamp is refreshed, so open pop-ups and scroll positions aren't disturbed.
const AUTOSAVE_MIN_SECONDS = 15;
let autosaveTimer = null;
function startAutosave() {
  clearInterval(autosaveTimer);
  const secs = Math.max(AUTOSAVE_MIN_SECONDS, Number(data.settings.autosaveSeconds) || 60);
  autosaveTimer = setInterval(() => {
    persist();
    const el = document.getElementById("last-saved");
    if (el) el.textContent = lastSavedText();
  }, secs * 1000);
}
/** ISO timestamp without milliseconds (matches the Mac app's data format). */
const stamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const blobToBase64 = (blob) => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.readAsDataURL(blob);
});
const referencedFiles = (d) => [...d.entries, ...d.reprimands, ...(d.leaves ?? [])].flatMap((x) => x.attachments ?? []).map((a) => a.file);

async function exportBackup() {
  if (!tauri) {
    const attachmentFiles = {};
    for (const f of referencedFiles(data)) { const b = await WS.getFile(f); if (b) attachmentFiles[f] = await blobToBase64(b); }
    const name = `PointTracker-backup-${Day.iso(Day.today())}.json`;
    const file = new File([JSON.stringify({ ...data, attachmentFiles }, null, 2)], name, { type: "application/json" });
    if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file], title: name }).catch(() => {});
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: name });
    return a.click();
  }
  const path = await tauri.dialog.save({ defaultPath: `PointTracker-backup-${Day.iso(Day.today())}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
  if (path) await tauri.core.invoke("export_backup", { path, json: JSON.stringify(data) });
}
async function importBackupWeb() {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: ".json,application/json" });
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    let imported;
    try { imported = JSON.parse(await f.text()); } catch { return alert("That file isn't a Point Tracker backup."); }
    if (!confirm(`Replace all data?\n\nThis replaces your current ${data.entries.length} entries and ${data.reprimands.length} reprimands with ${imported.entries?.length ?? 0} entries and ${imported.reprimands?.length ?? 0} reprimands from the backup.`)) return;
    for (const [name, b64] of Object.entries(imported.attachmentFiles ?? {})) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await WS.putFile(name, new Blob([bytes], { type: name.endsWith(".pdf") ? "application/pdf" : MIME[extOf(name)] ?? "image/png" }));
    }
    delete imported.attachmentFiles;
    data = imported;
    data.settings = { ...E.defaultSettings(), ...(data.settings ?? {}) };
    data.entries ??= []; data.reprimands ??= [];
    data.confirmations ??= { dropOffs: [], expirations: [] };
    data.confirmations.leaveDismissed ??= [];
    data.leaves ??= [];
    normalizeLeaves();
    save();
    startAutosave();
  };
  input.click();
}

async function importBackup() {
  if (!tauri) return importBackupWeb();
  const path = await tauri.dialog.open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
  if (!path) return;
  const imported = JSON.parse(await tauri.core.invoke("import_backup", { path }));
  const ok = await tauri.dialog.ask(
    `This replaces your current ${data.entries.length} entries and ${data.reprimands.length} reprimands with ${imported.entries?.length ?? 0} entries and ${imported.reprimands?.length ?? 0} reprimands from the backup.`,
    { title: "Replace all data?", kind: "warning", okLabel: "Replace", cancelLabel: "Cancel" });
  if (!ok) return;
  data = imported;
  data.settings = { ...E.defaultSettings(), ...(data.settings ?? {}) };
  data.entries ??= []; data.reprimands ??= [];
  save();
  startAutosave();
}
// ---------- Nearby Sync ----------

const syncPayload = () => ({
  entries: data.entries, reprimands: data.reprimands, leaves: data.leaves, deleted: data.deleted ?? {},
  settings: data.settings, settingsMod: data.settingsMod, confirmations: data.confirmations,
});
const safeFileName = (f) => typeof f === "string" && f.length > 0 && f.length < 200 && !/[\\/]|\.\./.test(f);
const DEVICE_NAME = tauri ? (IS_MAC ? "Mac" : /Windows/i.test(navigator.userAgent) ? "Windows PC" : "Linux PC")
  : /iPhone/i.test(navigator.userAgent) ? "iPhone" : /iPad/i.test(navigator.userAgent) ? "iPad"
  : /Android/i.test(navigator.userAgent) ? "Android phone" : "Browser";

/** Merges another device's data into this one. Returns how many records changed here. */
async function applySync(remote) {
  const before = new Map(SYNCED.flatMap((c) => data[c].map((x) => [x.id, JSON.stringify(x)])));
  const beforeSettings = JSON.stringify(data.settings);
  Object.assign(data, S.merge(syncPayload(), remote));
  data.settings = { ...E.defaultSettings(), ...data.settings };
  for (const k of ["dropOffs", "expirations", "leaveDismissed"]) data.confirmations[k] ??= [];
  normalizeLeaves();
  let changes = JSON.stringify(data.settings) === beforeSettings ? 0 : 1;
  const after = new Set();
  for (const c of SYNCED) for (const x of data[c]) { after.add(x.id); if (before.get(x.id) !== JSON.stringify(x)) changes++; }
  for (const id of before.keys()) if (!after.has(id)) changes++;
  takeSnapshot(); // merged records aren't local edits
  if (changes) { persist({ fromSync: true }); render(); startAutosave(); }
  return changes;
}

function initSync() {
  S.init({
    configKey: `pt-sync-${env.demo ? "demo" : "main"}`,
    deviceName: DEVICE_NAME,
    payload: syncPayload,
    apply: applySync,
    files: async () => [...new Set(referencedFiles(data))].filter(safeFileName),
    hasFile: async (f) => safeFileName(f) && (tauri ? tauri.core.invoke("attachment_exists", { file: f }) : !!(await WS.getFile(f))),
    readFile: async (f) => {
      if (!safeFileName(f)) return null;
      if (tauri) return new Uint8Array(await tauri.core.invoke("read_attachment_bytes", { file: f }));
      const b = await WS.getFile(f);
      return b ? new Uint8Array(await b.arrayBuffer()) : null;
    },
    writeFile: async (f, bytes) => {
      if (!safeFileName(f)) return;
      const blob = new Blob([bytes], { type: MIME[extOf(f)] ?? "" });
      if (tauri) await tauri.core.invoke("restore_attachment", { file: f, dataBase64: await blobToBase64(blob) });
      else await WS.putFile(f, blob);
      thumbCache.delete(f);
    },
    onStatus: refreshSyncGroup,
    onPaired: ({ name }) => {
      const el = document.getElementById("sync-pair-status");
      if (el) el.innerHTML = `${icon("loader-circle")} Connected to ${esc(name)}. Syncing…`, lucide.createIcons();
    },
    onSynced: (r) => {
      refreshSyncGroup();
      const el = document.getElementById("sync-pair-status");
      if (el) { el.innerHTML = `${icon("circle-check")} Paired with ${esc(r.name)} and synced.`; el.className = "sync-ok"; lucide.createIcons(); }
      if (r.changes || r.files || syncToastWanted) syncToast(r);
    },
  }).catch(() => {});
}

let syncToastWanted = false;
function syncToast(r) {
  syncToastWanted = false;
  const parts = [];
  if (r.changes) parts.push(`${r.changes} update${r.changes === 1 ? "" : "s"}`);
  if (r.files) parts.push(`${r.files} document${r.files === 1 ? "" : "s"}`);
  toast("refresh-cw", parts.length ? `Synced with ${esc(r.name)} · ${parts.join(", ")}` : `Up to date with ${esc(r.name)}`);
}

/** A short message at the bottom of the screen that goes away on its own. html is already escaped. */
function toast(iconName, html) {
  document.getElementById("sync-toast")?.remove();
  const n = Object.assign(document.createElement("div"), { id: "sync-toast", className: "sync-toast" });
  n.innerHTML = `${icon(iconName)}<span>${html}</span>`;
  document.body.append(n);
  lucide.createIcons();
  setTimeout(() => n.classList.add("hide"), 3200);
  setTimeout(() => n.remove(), 3700);
}

function ago(iso) {
  if (!iso) return "Not synced yet";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "Synced just now";
  if (mins < 60) return `Synced ${mins} min ago`;
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return Day.iso(Day.today()) === d.toLocaleDateString("en-CA") ? `Synced today at ${time}` : `Synced ${d.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time}`;
}
const otherKind = () => (tauri || !isMobile() ? "phone" : "computer");

function syncGroup() {
  const head = `<h3>Nearby Sync</h3>`;
  if (!S.supported()) return `<div class="group" id="sync-group">${head}<div class="note">Nearby Sync isn't available on this system. Use Export and Import Backup to move your data instead.</div></div>`;
  const c = S.config(), st = S.status();
  if (!c?.devices?.length) {
    return `<div class="group" id="sync-group">${head}
      <div class="note sync-intro">Keep this ${tauri || !isMobile() ? "computer" : "phone"} and your ${otherKind()} in sync. They connect to each other directly, with no account and no cloud storage. Both need Point Tracker open to sync.</div>
      <div class="field"><span class="sync-btns"><button class="btn-primary" data-action="sync-pair">${icon("qr-code")} Show Pairing Code…</button>
        <button class="btn-subtle" data-action="sync-join">${icon(isMobile() ? "scan-line" : "keyboard")} ${isMobile() ? "Scan" : "Enter"} Pairing Code…</button></span></div>
    </div>`;
  }
  const line = st.busy ? `<span class="muted">${icon("loader-circle")} ${esc(st.message || "Syncing…")}</span>`
    : st.error ? `<span class="sync-err">${icon("circle-alert")} ${esc(st.error)}</span>`
    : `<span class="muted">Syncs automatically whenever both devices are open.</span>`;
  return `<div class="group" id="sync-group">${head}
    ${c.devices.map((d) => `<div class="field sync-device"><span>${icon(/iPhone|Android|iPad/.test(d.name) ? "smartphone" : "monitor")} <b>${esc(d.name)}</b></span><span class="muted">${ago(d.lastSync)}</span></div>`).join("")}
    <div class="sync-line" id="sync-line">${line}</div>
    <div class="field"><span class="sync-btns"><button class="btn-primary" data-action="sync-now" ${st.busy ? "disabled" : ""}>${icon("refresh-cw")} Sync Now</button>
      <button class="btn-subtle" data-action="sync-pair">Pair Another Device…</button>
      <button class="btn-subtle btn-danger" data-action="sync-off">Turn Off…</button></span></div>
  </div>`;
}
/** Redraws just the sync section (keeps focus and scroll elsewhere on the page). */
function refreshSyncGroup() {
  const el = document.getElementById("sync-group");
  if (!el) return;
  el.outerHTML = syncGroup();
  lucide.createIcons();
}

let qrLib = null;
async function qrSvg(text) {
  qrLib ??= new Promise((resolve, reject) => {
    const sc = Object.assign(document.createElement("script"), { src: "vendor/sync/qrcode.js" });
    sc.onload = () => resolve(window.qrcode);
    sc.onerror = reject;
    document.head.append(sc);
  });
  const q = (await qrLib)(0, "M");
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
}

async function showPairDialog() {
  overlay = { kind: "sync-pair" };
  showDialog(`<div class="form"><h2>Pair a Device</h2><div class="muted">${icon("loader-circle")} Getting ready…</div></div>`);
  let pairing;
  try { pairing = await S.startPairing(); } catch (err) {
    if (overlay?.kind !== "sync-pair") return;
    return showDialog(`<div class="form"><h2>Pair a Device</h2><div class="sync-err">${esc(err.message ?? err)}</div></div>
      <div class="dialog-actions"><span class="spacer"></span><button class="btn-primary" data-action="close">OK</button></div>`);
  }
  if (overlay?.kind !== "sync-pair") return;
  const other = otherKind();
  showDialog(`<div class="form sync-pair">
      <h2>Pair a Device</h2>
      <div>On your ${other}, open Point Tracker, go to <b>Settings → Nearby Sync</b> and tap <b>${other === "phone" ? "Scan Pairing Code" : "Enter Pairing Code"}</b>.
        ${other === "phone" ? "Point it at this code." : "Type in the code below."}</div>
      <div class="sync-qr">${await qrSvg(pairing.qr)}</div>
      <div class="sync-code" title="Pairing code">${esc(pairing.code)}</div>
      <div class="muted" id="sync-pair-status">${icon("loader-circle")} Waiting for your ${other}…</div>
      <div class="note" style="padding:0">Only share this code with your own devices. Anyone with it can sync your data.</div>
    </div>
    <div class="dialog-actions"><span class="spacer"></span><button class="btn-primary" data-action="close">Done</button></div>`);
}

let scanner = null; // { stream, raf }
function stopScanner() {
  if (!scanner) return;
  cancelAnimationFrame(scanner.raf);
  scanner.stream?.getTracks().forEach((tr) => tr.stop());
  scanner = null;
}
async function startScanner() {
  const video = document.getElementById("sync-video");
  if (!video) return;
  try {
    if (!window.jsQR) await new Promise((resolve, reject) => {
      const sc = Object.assign(document.createElement("script"), { src: "vendor/sync/jsQR.js" });
      sc.onload = resolve; sc.onerror = reject; document.head.append(sc);
    });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    if (overlay?.kind !== "sync-join") { stream.getTracks().forEach((tr) => tr.stop()); return; }
    scanner = { stream, raf: 0 };
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    const tick = () => {
      if (!scanner) return;
      if (video.videoWidth) {
        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const found = window.jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
        if (found?.data && S.parseCode(found.data)) { stopScanner(); joinWithCode(found.data); return; }
      }
      scanner.raf = requestAnimationFrame(tick);
    };
    tick();
  } catch {
    const cam = document.querySelector(".sync-cam");
    if (cam) cam.innerHTML = `<div class="muted">${icon("camera-off")} The camera isn't available. Type the code instead.</div>`, lucide.createIcons();
  }
}

function showJoinDialog() {
  overlay = { kind: "sync-join" };
  const cam = isMobile() && !!navigator.mediaDevices?.getUserMedia;
  const other = otherKind();
  showDialog(`<div class="form">
      <h2>${cam ? "Scan" : "Enter"} Pairing Code</h2>
      <div>On your ${other}, open Point Tracker, go to <b>Settings → Nearby Sync</b> and choose <b>Show Pairing Code</b>.
        ${cam ? "Point the camera at the code, or type it in below." : "Type in the code shown under the QR code."}</div>
      ${cam ? `<div class="sync-cam"><video id="sync-video" playsinline muted></video></div>` : ""}
      <input id="sync-code" class="sync-code-input" type="text" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false">
      <div id="sync-join-status" class="muted"></div>
      <button class="link-btn" data-action="sync-pair">Or show a pairing code on this ${tauri || !isMobile() ? "computer" : "phone"} instead</button>
    </div>
    <div class="dialog-actions"><span class="spacer"></span>
      <button class="btn-subtle" data-action="close">Cancel</button>
      <button class="btn-primary" data-action="sync-join-go">Pair</button>
    </div>`);
  document.getElementById("sync-code").addEventListener("keydown", (e) => { if (e.key === "Enter") joinWithCode(e.target.value); });
  if (cam) startScanner();
}

async function joinWithCode(text) {
  const status = document.getElementById("sync-join-status");
  if (!S.parseCode(text)) {
    if (status) { status.className = "sync-err"; status.textContent = "That code isn't right. Check it and try again."; }
    return;
  }
  if (S.paired() && S.config().devices.length && S.parseCode(text).key !== S.config().key
    && !(await ask("This device is already paired with another device. Pair with the new one instead?", { title: "Switch Pairing?", okLabel: "Switch" }))) return;
  if (status) { status.className = "muted"; status.innerHTML = `${icon("loader-circle")} Connecting…`; lucide.createIcons(); }
  document.querySelector('[data-action="sync-join-go"]')?.setAttribute("disabled", "");
  try {
    syncToastWanted = true;
    const r = await S.join(text);
    if (overlay?.kind !== "sync-join") return;
    stopScanner();
    showDialog(`<div class="form"><h2>Paired</h2>
        <div class="sync-ok">${icon("circle-check")} Paired with ${esc(r.name)} and synced${r.changes ? ` (${r.changes} update${r.changes === 1 ? "" : "s"})` : ""}.</div>
        <div class="muted">From now on, changes sync automatically whenever both devices have Point Tracker open.</div></div>
      <div class="dialog-actions"><span class="spacer"></span><button class="btn-primary" data-action="close">Done</button></div>`);
    refreshSyncGroup();
  } catch (err) {
    syncToastWanted = false;
    document.querySelector('[data-action="sync-join-go"]')?.removeAttribute("disabled");
    const st = document.getElementById("sync-join-status");
    if (st) { st.className = "sync-err"; st.textContent = err.message ?? String(err); }
    if (overlay?.kind === "sync-join" && !scanner && document.getElementById("sync-video")) startScanner();
  }
}

/** Yes/no question: the system dialog on desktop (the web view's own confirm() isn't reliable there), confirm() on the web. */
async function ask(message, { title = "Point Tracker", okLabel = "OK", danger = false } = {}) {
  if (tauri?.dialog?.ask) return tauri.dialog.ask(message, { title, kind: danger ? "warning" : "info", okLabel, cancelLabel: "Cancel" });
  return confirm(`${title}\n\n${message}`);
}

const asOf = () => ui.asOverride ?? Day.today();
const uuid = () => crypto.randomUUID().toUpperCase();

// ---------- Helpers ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (name) => `<i data-lucide="${name}"></i>`;
const TYPE_ICON = {
  callSick: "cross", callPersonal: "user", worked: "briefcase", ado: "sun",
  pickedUp: "circle-plus", dropped: "circle-minus", other: "circle-ellipsis",
};
const pts = (n) => `${E.fmtPts(n)} ${n === 1 ? "pt" : "pts"}`;

const EC = [
  { id: "date", title: "Date", w: 100 },
  { id: "type", title: "Type", w: 150 },
  { id: "points", title: "Points", w: 50, center: true },
  { id: "occ", title: "Occurrence", w: 85, center: true, help: "Which occurrence this is in the longest window (365 days) up to its first call-in" },
  { id: "details", title: "Details", w: 115 },
  { id: "window", title: "Window Count", w: 300, help: "Which point this is in each window as of the viewed date. Dim = no longer counting." },
];
const RC = [
  { id: "number", title: "Number", w: 64, center: true, help: "Its place among the reprimands currently in effect" },
  { id: "signed", title: "Signed", w: 100 },
  { id: "threshold", title: "Threshold", w: 140 },
  { id: "points", title: "Points used", w: 90 },
  { id: "status", title: "Status", w: 205 },
];
const tableWidth = (cols) => cols.reduce((a, c) => a + c.w + 12, 0) + 44;
const SIDE_BY_SIDE_WIDTH = tableWidth(EC) + 18 + 14 + tableWidth(RC) + 18;

const FILTERS = {
  all: ["Call-ins", (e) => !E.HIDDEN_TYPES.has(e.type)],
  points: ["Points only", (e, p) => p > 0],
  sick: ["Call In Sick", (e) => e.type === "callSick"],
  personal: ["Call In Personal", (e) => e.type === "callPersonal"],
  breakers: ["Worked, ADO & shift changes", (e) => E.HIDDEN_TYPES.has(e.type)],
  other: ["Other", (e) => e.type === "other"],
};

function sideBySide() {
  const mode = pref(STORE.layout, "adaptive");
  if (mode === "tabs") return false;
  if (mode === "sideBySide") return true;
  return document.getElementById("app").clientWidth - 40 >= SIDE_BY_SIDE_WIDTH;
}

function thresholdText(r, s) {
  const rule = s.rules.find((x) => x.days === r.ruleDays);
  if (rule) return `${E.fmtPts(rule.threshold)} pts in ${rule.days} days`;
  return r.ruleDays === 0 ? "Other / unspecified" : `${r.ruleDays}-day window`;
}

function detailsText(e, ev) {
  const x = ev.evals.get(e.id);
  if (!x) return "";
  const parts = [];
  if (x.stringPosition) {
    parts.push(`Call-in ${x.stringPosition} of ${ev.settings.maxSickString}`);
    if (x.medicalLeave) parts.push("MEDICAL LEAVE");
  } else if (x.basePoints === 0 && e.pointsOverride == null && e.type !== "other") {
    parts.push("Breaks sick occurrence");
  }
  if (e.pointsOverride != null && e.pointsOverride !== x.basePoints) parts.push(`Override (rules: ${E.fmtPts(x.basePoints)})`);
  const rid = ev.neutralizedBy.get(e.id);
  const rep = rid && data.reprimands.find((r) => r.id === rid);
  if (rep) parts.push(`Used in reprimand ${Day.short(Day.parse(rep.signedDate))}`);
  if (Day.parse(e.date) > ev.asOf) parts.push("After viewed date");
  return parts.length ? parts.join(" · ") : "—";
}

// ---------- Main render ----------

function render() {
  const ev = E.evaluate(data, asOf());
  document.body.classList.toggle("mobile", isMobile());
  if (isMobile()) return renderMobile(ev);
  const body = ui.page === "calendar" ? calendarPage(ev) : ui.page === "settings" ? settingsPage()
    : ui.page === "leaves" ? leavesPage(ev) : overviewPage(ev);
  document.getElementById("app").innerHTML = `${hero()}<main class="page page-${ui.page}">${body}</main>${footer()}${ui.expanded ? expandedTable(ev) : ""}`;
  lucide.createIcons();
  updateRepExpand();
  hydrateThumbs(document.getElementById("app"));
  setupLeaveCarousel();
}

/** Keeps the Previous Leaves dots in step with scrolling. */
function setupLeaveCarousel() {
  const track = document.getElementById("lc-track");
  if (!track) return;
  // Arrows only when there's more than fits.
  track.parentElement.classList.toggle("fits", track.scrollWidth <= track.clientWidth + 4);
  track.addEventListener("scroll", () => {
    const cards = [...track.children];
    const i = cards.findIndex((c) => c.offsetLeft + c.offsetWidth / 2 >= track.scrollLeft);
    document.querySelectorAll(".lc-dots span").forEach((s, j) => s.classList.toggle("on", j === Math.max(0, i)));
  }, { passive: true });
}

function overviewPage(ev) {
  const side = sideBySide();
  const entriesHead = `<span class="panel-title"><span class="pi blue">${icon("phone")}</span> Call-ins</span><span class="spacer"></span>${addEntryBtn()}${filterBtn()}${moreBtn()}${expandBtn()}`;
  const repsHead = `<span class="panel-title"><span class="pi">${icon("gavel")}</span> Reprimands</span><span class="spacer"></span>${recordBtn()}${repExpandBtn()}`;
  return `
    <div class="top">
      ${workPoints(ev)}
      <div class="right-col">${reprimandCount(ev)}${reprimandExpire(ev)}</div>
    </div>
    ${banners(ev)}
    ${side ? `
      <div class="logs">
        <div class="panel log" style="flex:1"><div class="log-head">${entriesHead}</div>${entriesTable(ev)}</div>
        <div class="panel log" style="width:${tableWidth(RC) + 18}px;flex:none"><div class="log-head">${repsHead}</div>${reprimandsTable(ev)}</div>
      </div>` : `
      <div class="logs">
        <div class="panel log" style="flex:1">
          <div class="log-head">
            <div class="tabs">
              <button class="${ui.tab === "entries" ? "on" : ""}" data-action="tab" data-tab="entries">Call-ins</button>
              <button class="${ui.tab === "reprimands" ? "on" : ""}" data-action="tab" data-tab="reprimands">Reprimands</button>
            </div>
            <span class="spacer"></span>
            ${ui.tab === "entries" ? addEntryBtn() + filterBtn() + moreBtn() + expandBtn() : recordBtn() + repExpandBtn()}
          </div>
          ${ui.tab === "entries" ? entriesTable(ev) : reprimandsTable(ev)}
        </div>
      </div>`}`;
}

/** The Call-ins or Reprimands table, large, in a pop-up over the app. */
function expandedTable(ev) {
  const entries = ui.expanded === "entries";
  return `
  <div class="expanded-scrim" data-action="collapse"></div>
  <div class="panel expanded log">
    <div class="log-head">
      ${entries
        ? `<span class="panel-title"><span class="pi blue">${icon("phone")}</span> Call-ins</span><span class="spacer"></span>${addEntryBtn()}${filterBtn()}${moreBtn()}`
        : `<span class="panel-title"><span class="pi">${icon("gavel")}</span> Reprimands</span><span class="spacer"></span>${recordBtn()}`}
      <button class="btn-subtle square" data-action="collapse" title="Close (Esc)">${icon("minimize-2")}</button>
    </div>
    ${entries ? entriesTable(ev) : reprimandsTable(ev, true)}
  </div>`;
}

function hero() {
  const over = ui.asOverride !== null;
  const nav = [["overview", "house", "Overview"], ["calendar", "calendar-days", "Calendar"], ["leaves", "heart-pulse", "Medical Leaves"], ["settings", "settings", "Settings"]];
  return `
  <div class="hero" data-tauri-drag-region>
    <div class="hero-art" data-tauri-drag-region></div>
    <div class="header ${IS_MAC && !ui.fullscreen ? "mac-lights" : ""}" data-tauri-drag-region>
      <img class="logo" src="vendor/logo.png" alt="" draggable="false">
      <div data-tauri-drag-region>
        <div class="title">Point Tracker</div>
        <div class="subtitle">Attendance Points and Reprimands</div>
      </div>
      ${betaBadge()}
      ${env.demo ? `<span class="badge">DEMO · Sample data</span>` : ""}
      <span class="spacer" data-tauri-drag-region></span>
      ${over ? `<button class="btn-subtle glass" style="color:var(--amber)" data-action="today">Back to Today</button>` : ""}
      <div class="datenav ${over ? "override" : ""}">
        <button class="arrow" data-action="day" data-delta="-1" title="Previous day">${icon("chevron-left")}</button>
        <button class="date" data-action="calendar">${Day.long(asOf())} ${icon("calendar")}</button>
        <button class="arrow" data-action="day" data-delta="1" title="Next day">${icon("chevron-right")}</button>
      </div>
      ${ui.fullscreen ? `<button class="btn-subtle glass" data-action="exit-fullscreen">${icon("minimize-2")} Exit Full Screen</button>` : ""}
    </div>
    <nav class="nav">
      ${nav.map(([id, ic, label]) => `<button class="${ui.page === id ? "on" : ""}" data-action="page" data-page="${id}">${icon(ic)} ${label}</button>`).join("")}
    </nav>
  </div>`;
}

function lastSavedText() {
  const t = data.updatedAt ? new Date(data.updatedAt) : null;
  return t && !isNaN(t)
    ? `${Day.short(Day.parse(`${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}`))} at ${t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "—";
}

const disclaimerHTML = () => `<span>This tool is for informational purposes only. <a href="${CASTLIFE_URL}" data-external>CastLife</a> will have your official record.</span>
  <small>Not affiliated with or endorsed by The Walt Disney Company (TWDC).</small>`;

function footer() {
  return `
  <footer class="footer">
    <span>${icon("info")}
      <span class="disclaimers">${disclaimerHTML()}</span></span>
    <span class="spacer"></span>
    <span id="saved-flash" class="saved-flash">${icon("check")} Saved</span>
    <button class="linkbtn" data-action="reload" title="Reload from disk">${icon("refresh-cw")}</button>
    <span>Last saved: <span id="last-saved">${lastSavedText()}</span></span>
  </footer>`;
}

function ring(fraction) {
  const r = 50.5, c = 2 * Math.PI * r, f = Math.max(0.001, Math.min(1, fraction));
  return `<svg viewBox="0 0 112 112">
    <circle cx="56" cy="56" r="${r}" fill="none" stroke="rgba(var(--ink),0.12)" stroke-width="11"/>
    <circle cx="56" cy="56" r="${r}" fill="none" stroke="var(--c)" stroke-width="11" stroke-linecap="round"
      stroke-dasharray="${c * f} ${c}"/></svg>`;
}

function workPoints(ev) {
  const longest = ev.windows.at(-1);
  return `
  <div class="panel workpoints">
    <div class="panel-title"><span class="pi blue">${icon("chart-column")}</span> Work Points Progress
      ${longest ? `<span class="muted" style="font-size:14px;font-weight:400">Since ${Day.short(longest.since)}</span>` : ""}</div>
    <div class="cards">${ev.windows.map((w) => windowCard(w, ev.asOf)).join("")}</div>
  </div>`;
}

function windowCard(w, asOfDay) {
  const sev = E.severity(w.rule, w.eligible);
  const frac = w.rule.threshold > 0 ? w.eligible / w.rule.threshold : 0;
  return `
  <div class="wcard c-${sev}">
    <div class="center"><h3>${w.rule.days} Days</h3><div class="muted">Since ${Day.short(w.since)}</div></div>
    <div class="ring">${ring(frac)}
      <div class="label"><div><span class="big">${E.fmtPts(w.eligible)}</span><span class="of"> / ${E.fmtPts(w.rule.threshold)}</span></div><div class="muted" style="font-size:11px">points</div></div>
    </div>
    ${w.earned ? `<b class="red">Reprimand earned</b>` : `<div>${pts(w.remaining)} until reprimand</div>`}
    ${w.neutralized > 0 ? `<div class="muted" style="font-size:12px">+${E.fmtPts(w.neutralized)} used in reprimands</div>` : ""}
    <div class="rows">
      ${w.oldest ? `
        <div class="irow ir-oldest">${icon("calendar")}<div><div class="cap">Oldest point</div><div class="val">${Day.short(Day.parse(w.oldest.date))}</div></div></div>
        <div class="irow ir-type" style="align-items:center">${icon(TYPE_ICON[w.oldest.type])}<div class="val">${esc(E.displayType(w.oldest))}</div></div>
        <div class="irow ir-drop">${icon("clock")}<div><div class="cap">Drops off</div><div class="val">${Day.short(w.dropsOff)}</div><div class="muted" style="font-size:13px">(${E.relative(w.dropsOff, asOfDay)})</div></div></div>
      ` : `<div class="irow" style="align-items:center">${icon("circle-check")}<div class="val">No active points</div></div>`}
      ${w.recentlyDropped
        .filter((d) => !data.confirmations.dropOffs.includes(E.dropOffKey(d.entry.id, w.rule.id)))
        .map((d) => `<div class="warn-small">${icon("circle-alert")}<span>${Day.short(Day.parse(d.entry.date))} point dropped off ${E.relative(d.droppedOn, asOfDay)}. Double-check CastLife.
          <button class="confirm-btn" data-action="confirm-drop" data-key="${E.dropOffKey(d.entry.id, w.rule.id)}" title="Dismiss once you've confirmed it in CastLife">${icon("check")} Confirm</button></span></div>`).join("")}
    </div>
  </div>`;
}

function reprimandCount(ev) {
  const limit = ev.settings.terminationAt, count = ev.activeCount, danger = count >= limit - 1;
  const msg = count >= limit
    ? [`Termination threshold reached.`, `${count} reprimands are in effect.`]
    : [`Termination at ${limit} reprimands.`, count === limit - 1 ? "The next reprimand ends employment." : `${limit - 1 - count} more before the final warning.`];
  return `
  <div class="panel" style="padding:12px">
    <div class="panel-title" style="margin-bottom:12px"><span class="pi ${danger ? "red" : "blue"}">${icon("triangle-alert")}</span> Attendance Reprimands</div>
    <div class="rep-inner ${danger ? "c-red" : "c-blue"}">
      <div style="display:flex;align-items:center">
        <div><div class="num" style="font-size:44px;line-height:1"><span class="${danger ? "red" : ""}">${count}</span><span style="font-size:36px"> / ${limit}</span></div>
          <div style="font-weight:600;margin-top:4px">Attendance Reprimands</div></div>
        <span class="spacer"></span>
        <div class="dots">${Array.from({ length: limit }, (_, i) => `<div class="dot ${i < count ? "on" : ""}"></div>`).join("")}</div>
      </div>
      <div class="rep-warn">${icon(danger ? "triangle-alert" : "info")}
        <div><b class="${danger ? "red" : ""}">${msg[0]}</b><div class="${danger ? "red" : "muted"}" style="opacity:.85">${msg[1]}</div></div></div>
    </div>
  </div>`;
}

function reprimandExpire(ev) {
  const g = ev.activeGroup;
  let body = `<div class="muted" style="font-size:22px;font-weight:700">No reprimands in effect</div>`;
  if (g) {
    const left = g.expires - ev.asOf, total = Math.max(1, g.expires - g.latestSigned);
    const dayN = Math.min(total, ev.asOf - g.latestSigned + 1);
    body = `
      <div><span class="num" style="font-size:38px">${left}</span> <span class="num" style="font-size:30px">days</span> <span class="muted" style="font-size:22px">left</span></div>
      <div>${Day.short(g.expires)}: ${g.reprimands.length > 1 ? "all current reprimands expire together." : "current reprimand expires."}</div>
      <div class="bar"><div style="width:${(dayN / total) * 100}%"></div></div>
      <div style="display:flex" class="muted"><span>Day ${dayN} of ${total}</span><span class="spacer"></span><span>${Math.round((left / total) * 100)}% remaining</span></div>`;
  }
  return `
  <div class="panel" style="flex:1;display:flex;flex-direction:column;gap:12px">
    <div class="panel-title"><span class="pi blue">${icon("hourglass")}</span> Reprimands Expire<span class="spacer"></span>
      ${g ? `<button class="btn-subtle small" data-action="expire-details">${icon("file-text")} View Details</button>` : ""}</div>
    ${body}
  </div>`;
}

// ---------- Medical leave ----------

const LEAVE_TYPES = ["Personal Medical Leave", "FMLA", "Workers' Comp", "Short-Term Disability", "Other"];
const LEAVE_STATUSES = ["Pending", "Approved", "Active", "Denied", "Closed"];
const DOC_TYPES = ["Doctor's Note", "HR Form", "Test Result", "Care Plan", "Appointment", "Return to Work", "Other"];
/** Category → [label, icon, color]. Sets each leave card's look. */
const LEAVE_CATEGORIES = {
  back: ["Back / Spine", "person-standing", "blue"],
  flu: ["Flu / Virus", "thermometer", "teal"],
  respiratory: ["Respiratory", "wind", "purple"],
  joint: ["Bone / Joint", "bone", "amber"],
  gi: ["Stomach / GI", "pill", "green"],
  injury: ["Injury", "bandage", "orange"],
  other: ["Other", "heart-pulse", "red"],
};
const DTOOLSHR_URL = "https://disney.service-now.com/DToolsHR";

/** Call-ins that went past the occurrence limit (one per occurrence), up to the viewed date. */
function leaveTriggers(ev) {
  const max = ev.settings.maxSickString;
  return ev.entries.filter((e) => {
    const x = ev.evals.get(e.id);
    return x?.medicalLeave && x.stringPosition === max + 1 && Day.parse(e.date) <= ev.asOf;
  });
}
/** The leave a date falls in (its start through the day before the first shift back), if any. */
const leaveCovering = (iso) => {
  const d = Day.parse(iso);
  return data.leaves.find((l) => Day.parse(l.startDate) <= d && (!l.returnDate || d < Day.parse(l.returnDate)));
};
const onLeaveNow = (l, asOfDay) => Day.parse(l.startDate) <= asOfDay && (!l.returnDate || Day.parse(l.returnDate) > asOfDay);
const currentLeave = (asOfDay) => data.leaves.filter((l) => onLeaveNow(l, asOfDay))
  .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0] ?? null;
/** Last day of a leave: the day before the first shift back (null while ongoing). */
const leaveEnd = (l) => (l.returnDate ? Day.parse(l.returnDate) - 1 : null);
const leaveDaysCount = (l, asOfDay) => Math.max(0, Math.min(leaveEnd(l) ?? asOfDay, asOfDay) - Day.parse(l.startDate) + 1);
const touchLeave = (l) => { l.updatedAt = stamp(); };
/** How long an unconfirmed trigger keeps asking (days). */
const LEAVE_CONFIRM_DAYS = 60;

/** First call-in of the sick occurrence that the given call-in belongs to. */
function occurrenceStart(entryId) {
  const evals = E.run(data.entries, data.settings).evals;
  let first = null;
  for (const e of E.sortEntries(data.entries)) {
    if (e.type !== "callSick") continue;
    if (evals.get(e.id)?.stringPosition === 1) first = e.date;
    if (e.id === entryId) return first;
  }
  return null;
}

/** Fills in fields for leaves saved by earlier versions (and any missing defaults). */
function normalizeLeaves() {
  for (const l of data.leaves) {
    if (!l.triggerDate) {
      // Earlier versions stored the triggering call-in's date as the start.
      l.triggerDate = l.startDate;
      const first = l.triggerEntryId ? occurrenceStart(l.triggerEntryId) : null;
      if (first) l.startDate = first;
    }
    l.leaveType ??= LEAVE_TYPES[0];
    l.status ??= "Approved";
    l.category ??= "other";
    l.diagnosis ??= "";
    l.provider ??= "";
    l.caseNumber ??= "";
    l.expectedReturn ??= "";
    l.note ??= "";
    l.reminders ??= [];
    l.attachments ??= [];
    for (const a of l.attachments) {
      a.docType ??= "Other";
      a.uploadedAt ??= (l.confirmedAt ?? stamp()).slice(0, 10);
    }
  }
}

function leaveBanners(ev) {
  const out = [];
  for (const t of leaveTriggers(ev)) {
    if (leaveCovering(t.date) || data.leaves.some((l) => l.triggerEntryId === t.id)
      || data.confirmations.leaveDismissed.includes(t.id) || ev.asOf - Day.parse(t.date) > LEAVE_CONFIRM_DAYS) continue;
    out.push(`<div class="banner c-red">${icon("hospital")}<span><b>Medical leave triggered:</b> call-in ${ev.settings.maxSickString + 1} of a sick occurrence on ${Day.long(Day.parse(t.date))}. Confirm once it's official.</span>
      <span class="spacer"></span><span class="banner-actions">
      <button class="btn-subtle" data-action="leave-dismiss" data-id="${t.id}" title="It didn't become a medical leave">Dismiss</button>
      <button class="btn-primary small" data-action="leave-confirm" data-id="${t.id}">${icon("check")} Confirm Medical Leave</button></span></div>`);
  }
  for (const l of data.leaves.filter((l) => onLeaveNow(l, ev.asOf))) {
    const day = leaveDaysCount(l, ev.asOf), docs = l.attachments?.length ?? 0;
    out.push(`<div class="banner c-amber">${icon("hospital")}<span><b>On medical leave</b> since ${Day.long(Day.parse(l.startDate))} · day ${day}${docs ? ` · ${docs} document${docs === 1 ? "" : "s"}` : ""}</span>
      <span class="spacer"></span><span class="banner-actions">
      <button class="btn-subtle" data-action="leave-edit" data-id="${l.id}">${icon("heart-pulse")} View Leave</button>
      <button class="btn-primary small" data-action="leave-return" data-id="${l.id}">${icon("briefcase")} Return to Work</button></span></div>`);
  }
  return out;
}

// ----- Medical Leaves page -----

function leavesPage(ev) {
  const cur = currentLeave(ev.asOf);
  const view = ui.leaveView;
  const back = isMobile() ? `<button class="m-back" data-action="m-page" data-page="overview">${icon("chevron-left")} Overview</button>` : "";
  if (view && view !== "history") {
    const l = data.leaves.find((x) => x.id === view);
    if (l) return back + leaveDetail(l, ev, l === cur);
  }
  if (cur && view !== "history") return back + leaveDetail(cur, ev, true);
  return back + leavesOverview(ev, cur);
}

function leavesOverview(ev, cur) {
  const q = (ui.leaveSearch ?? "").trim().toLowerCase();
  let past = data.leaves.filter((l) => l !== cur);
  if (q) past = past.filter((l) => [l.diagnosis, l.leaveType, l.provider, l.caseNumber, l.note, l.status, LEAVE_CATEGORIES[l.category]?.[0]]
    .some((v) => String(v ?? "").toLowerCase().includes(q)));
  past.sort((a, b) => ((a.startDate < b.startDate) === (ui.leaveSort === "old") ? -1 : 1));
  return `
  <div class="panel leaves-overview">
    <div class="ld-head">
      <span class="ld-heart">${icon("heart-pulse")}</span>
      <div class="ld-head-text"><h2 class="page-title">Medical Leaves</h2>
        <div class="muted">Track your medical leaves. This is your personal copy. You must still file all requests, documentation, and communications through DToolsHR.</div></div>
      <span class="spacer"></span>
      ${cur ? `<button class="btn-subtle" data-action="leave-edit" data-id="${cur.id}">${icon("arrow-left")} Back to Current Leave</button>` : ""}
      <button class="btn-primary" data-action="leave-new">${icon("plus")} Report a New Medical Leave</button>
    </div>
    ${cur ? "" : `
    <div class="leave-empty">${icon("folder-plus")}
      <div><b class="head">You do not have an active medical leave.</b>
        <div class="muted">Use the button above to report a new medical leave and start tracking it here.</div></div></div>`}
    <div class="ld-section-head">
      <span class="pi blue">${icon("history")}</span>
      <div><div class="panel-title">Previous Medical Leaves</div><div class="muted">Click a leave below to view full details, documentation, and notes.</div></div>
      <span class="spacer"></span>
      <label class="leave-search">${icon("search")}<input type="search" data-leave-search placeholder="Search past leaves…" value="${esc(ui.leaveSearch ?? "")}"></label>
      <select data-leave-sort><option value="new" ${ui.leaveSort !== "old" ? "selected" : ""}>Newest First</option><option value="old" ${ui.leaveSort === "old" ? "selected" : ""}>Oldest First</option></select>
    </div>
    ${past.length ? `
    <div class="leave-carousel">
      <button class="lc-arrow prev" data-action="lc-scroll" data-dir="-1" aria-label="Previous">${icon("chevron-left")}</button>
      <div class="lc-track" id="lc-track">${past.map((l) => leaveCard(l, ev)).join("")}</div>
      <button class="lc-arrow next" data-action="lc-scroll" data-dir="1" aria-label="Next">${icon("chevron-right")}</button>
    </div>
    <div class="m-dots lc-dots">${past.map((_, i) => `<span class="${i === 0 ? "on" : ""}"></span>`).join("")}</div>`
    : `<div class="m-empty">${q ? "No past leaves match your search." : "No previous medical leaves yet."}</div>`}
  </div>`;
}

function leaveCard(l, ev) {
  const [, ic, color] = LEAVE_CATEGORIES[l.category] ?? LEAVE_CATEGORIES.other;
  const end = leaveEnd(l);
  return `
  <button class="leave-card c-${color}" data-action="leave-edit" data-id="${l.id}">
    <span class="lc-bg">${icon(ic)}</span>
    <span class="lc-icon">${icon(ic)}</span>
    <b class="lc-title">${esc(l.diagnosis || l.leaveType)}</b>
    <span class="lc-dates">${Day.short(Day.parse(l.startDate))} –<br>${end !== null ? Day.short(end) : "Ongoing"}</span>
    <span class="lc-status st-${esc(l.status)}">${esc(l.status)}</span>
    <span class="lc-days">${leaveDaysCount(l, ev.asOf)} days</span>
  </button>`;
}

function leaveDetail(l, ev, isCurrent) {
  const S = Day.parse(l.startDate), T = Day.parse(l.triggerDate || l.startDate);
  const R = l.returnDate ? Day.parse(l.returnDate) : null, X = l.expectedReturn ? Day.parse(l.expectedReturn) : null;
  const days = leaveDaysCount(l, ev.asOf);
  const chip = isCurrent ? ["Active", "st-Active"] : [l.status, `st-${l.status}`];
  const tile = (ic, color, label, value, sub, num = false) => `
    <div class="ld-tile"><div class="ld-tile-in"><span class="ld-tile-icon c-${color}">${icon(ic)}</span>
      <div class="ld-tile-text"><div class="cap">${label}</div><div class="ld-tile-value ${num ? "num" : ""}">${value}</div><div class="muted small">${sub}</div></div></div></div>`;
  // Protected days stop at the end of the leave.
  const protEnd = Math.min(ev.asOf, leaveEnd(l) ?? ev.asOf);
  const protDays = Math.max(0, protEnd - T + 1);
  const protectedTile = T > ev.asOf
    ? tile("hourglass", "amber", "Days Until Trigger", T - ev.asOf, `Until ${Day.short(T)}`, true)
    : tile("shield-check", "amber", "Points Protected", `${protDays} day${protDays === 1 ? "" : "s"}`, R ? `${Day.short(T)} – ${Day.short(leaveEnd(l))}` : `Since ${Day.short(T)}`, true);
  const returnTile = R
    ? tile("calendar-check", "teal", "Returned", Day.short(R), `${R - S} total days`)
    : X ? tile("calendar-check", "teal", "Expected Return", Day.short(X), `${X - S} total days (est.)`)
    : tile("calendar-check", "teal", "Expected Return", "Not set", "Add it in Edit Details");

  // Timeline: start → trigger → return (or expected return).
  const E2 = R ?? X ?? Math.max(ev.asOf, T) + 7;
  const span = Math.max(1, E2 - S);
  const pos = (d) => Math.max(0, Math.min(100, ((d - S) / span) * 100));
  const now = Math.min(ev.asOf, E2);
  const timeline = `
    <div class="panel ld-timeline">
      <div class="tl-track">
        <div class="tl-dash"></div>
        <div class="tl-fill blue" style="left:0;width:${pos(Math.min(now, T))}%"></div>
        ${now > T ? `<div class="tl-fill amber" style="left:${pos(T)}%;width:${pos(now) - pos(T)}%"></div>` : ""}
        <span class="tl-dot blue" style="left:0"></span>
        <span class="tl-dot amber" style="left:${pos(T)}%"></span>
        <span class="tl-dot end ${R ? "done" : ""}" style="left:100%"></span>
        ${ev.asOf > S && ev.asOf < E2 ? `<span class="tl-now" style="left:${pos(ev.asOf)}%" title="${Day.short(ev.asOf)}"></span>` : ""}
      </div>
      <div class="tl-labels">
        <div style="left:0"><b>${Day.short(S)}</b><span>Start of Leave</span></div>
        <div style="left:${pos(T)}%" class="mid amber"><b>${Day.short(T)}</b><span>Points Protected<br>(Day ${T - S + 1})</span></div>
        <div style="left:100%" class="end"><b>${R || X ? Day.short(E2) : "—"}</b><span>${R ? "Returned" : "Expected Return"}${R || X ? `<br>(Day ${E2 - S + 1})` : ""}</span></div>
      </div>
    </div>`;

  const detailRow = (ic, label, value) => `<div class="ld-row">${icon(ic)}<span class="muted">${label}</span><span>${value}</span></div>`;
  const kindIcon = (a) => V.fileIcon(a.name);
  const docs = (l.attachments ?? []).map((a) => {
    const [ic, color] = kindIcon(a);
    return `<div class="doc-row">
      <button class="doc-name" data-action="open-attachment" data-file="${esc(a.file)}"><span class="c-${color}">${icon(ic)}</span><span>${esc(a.name)}</span></button>
      <span class="muted">${esc(a.docType ?? "Other")}</span>
      <span class="muted">${a.uploadedAt ? Day.short(Day.parse(a.uploadedAt)) : "—"}</span>
      <button class="btn-subtle square" data-action="doc-menu" data-leave="${l.id}" data-file="${esc(a.file)}" aria-label="Document actions">${icon("ellipsis")}</button>
    </div>`;
  }).join("");

  const upcoming = [
    ...(T >= ev.asOf ? [{ ic: "hourglass", color: "amber", label: "Points Protected (Trigger Date)", date: T }] : []),
    ...(!R && X && X >= ev.asOf ? [{ ic: "calendar-check", color: "teal", label: "Expected Return to Work", date: X }] : []),
    ...(l.reminders ?? []).filter((r) => Day.parse(r.date) >= ev.asOf)
      .map((r) => ({ ic: "bell", color: "blue", label: r.label, date: Day.parse(r.date), id: r.id })),
  ].sort((a, b) => a.date - b.date);
  const until = (d) => (d === ev.asOf ? "Today" : `In ${d - ev.asOf} day${d - ev.asOf === 1 ? "" : "s"}`);

  return `
  <div class="leave-grid">
    <div class="leave-main">
      <div class="panel ld-head">
        <span class="ld-heart">${icon("heart-pulse")}</span>
        <div class="ld-head-text">
          <div class="ld-title-row"><h2 class="page-title">${isCurrent ? "Current Medical Leave" : "Medical Leave"}</h2><span class="ld-chip ${chip[1]}">${esc(chip[0])}</span></div>
          <div class="muted">${esc(l.leaveType)}${l.diagnosis ? ` • ${esc(l.diagnosis)}` : ""}</div>
        </div>
        <span class="spacer"></span>
        ${isCurrent ? `<button class="btn-primary small" data-action="leave-return" data-id="${l.id}">${icon("briefcase")} Return to Work</button>` : ""}
        <button class="btn-subtle" data-action="leave-history">${icon("history")} ${isCurrent ? "View Previous Leaves" : "All Leaves"}</button>
      </div>
      <div class="ld-stats">
        ${tile("calendar", "blue", "Start Date", Day.short(S), "First day of leave")}
        ${tile("shield", "amber", "Trigger Date", Day.short(T), "First day points are protected")}
        ${tile("clock", "blue", "Days on Leave", days, R ? "Total" : `As of ${Day.short(ev.asOf)}`, true)}
        ${protectedTile}
        ${returnTile}
      </div>
      ${timeline}
      <div class="ld-bottom">
        <div class="panel ld-panel">
          <div class="ld-panel-head"><span class="pi blue">${icon("file-text")}</span><span class="panel-title">Leave Details</span><span class="spacer"></span>
            <button class="btn-subtle small" data-action="leave-details" data-id="${l.id}">${icon("pencil")} Edit Details</button></div>
          ${detailRow("hospital", "Leave Type", esc(l.leaveType))}
          ${detailRow("stethoscope", "Reason / Diagnosis", esc(l.diagnosis) || "—")}
          ${detailRow("heart-pulse", "Category", esc(LEAVE_CATEGORIES[l.category]?.[0] ?? "Other"))}
          ${detailRow("hospital", "Care Provider", esc(l.provider) || "—")}
          ${detailRow("hash", "Claim / Case Number", esc(l.caseNumber) || "—")}
          ${detailRow("calendar-check", R ? "Returned" : "Expected Return", R ? `${Day.short(R)}${l.returnShiftStart ? ` at ${fmtTime(l.returnShiftStart)}` : ""}` : X ? Day.short(X) : "—")}
          ${detailRow("circle-check", "Status", `<span class="status-dot st-${esc(l.status)}"></span>${esc(l.status)}`)}
          ${detailRow("clock", "Last Updated", l.updatedAt ? fmtDateTime(isoLocal(l.updatedAt)) : "—")}
        </div>
        <div class="panel ld-panel">
          <div class="ld-panel-head"><span class="pi blue">${icon("notepad-text")}</span><span class="panel-title">Notes</span><span class="spacer"></span>
            <button class="btn-subtle small" data-action="leave-notes" data-id="${l.id}">${icon("pencil")} Edit Notes</button></div>
          <div class="ld-notes ${l.note ? "" : "muted"}">${l.note ? esc(l.note) : "No notes yet."}</div>
        </div>
      </div>
    </div>
    <div class="leave-side">
      <div class="panel ld-panel">
        <div class="ld-panel-head"><span class="pi blue">${icon("file-text")}</span><span class="panel-title">Documents</span><span class="spacer"></span>
          <button class="btn-primary small" data-action="doc-upload" data-id="${l.id}">${icon("plus")} Upload Document</button></div>
        ${docs ? `<div class="doc-row doc-head muted"><span>File Name</span><span>Type</span><span>Uploaded</span><span>Actions</span></div>${docs}`
          : `<div class="m-empty small">No documents yet. Upload doctor's notes, HR forms, test results — any file type.</div>`}
      </div>
      <div class="panel ld-panel">
        <div class="ld-panel-head"><span class="pi blue">${icon("calendar-clock")}</span><span class="panel-title">Upcoming Dates</span><span class="spacer"></span>
          <button class="btn-primary small" data-action="reminder-add" data-id="${l.id}">${icon("plus")} Add Reminder</button></div>
        ${upcoming.length ? upcoming.map((u) => `<div class="up-row"><span class="c-${u.color}">${icon(u.ic)}</span><span>${esc(u.label)}</span>
            <span>${Day.short(u.date)}</span><span class="muted">${until(u.date)}</span>
            ${u.id ? `<button class="btn-subtle square" data-action="reminder-edit" data-leave="${l.id}" data-id="${u.id}" aria-label="Edit reminder">${icon("ellipsis")}</button>` : `<span></span>`}</div>`).join("")
          : `<div class="m-empty small">Nothing coming up. Add reminders for appointments and deadlines.</div>`}
      </div>
      <div class="panel ld-important">
        <div class="ld-panel-head"><span class="amber-text">${icon("circle-alert")}</span><b class="head amber-text">Important Reminder</b><span class="spacer"></span>
          <a class="btn-amber" href="${DTOOLSHR_URL}" data-external>${icon("external-link")} Open DToolsHR</a></div>
        <div>This tool does not file, submit, or communicate with DToolsHR. You must submit all medical leave requests, documentation, and updates through DToolsHR. This is only a personal tracking tool to help you manage your leave information.</div>
      </div>
    </div>
  </div>`;
}

/** Local "YYYY-MM-DDTHH:MM" for an ISO timestamp (for display). */
function isoLocal(iso) {
  const d = new Date(iso), pad = (n) => String(n).padStart(2, "0");
  return isNaN(d) ? "" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function goToLeave(id) {
  ui.leaveView = id;
  if (isMobile()) ui.mpage = "leaves"; else ui.page = "leaves";
  closeOverlay();
  render();
  document.getElementById("m-page")?.scrollTo(0, 0);
}

// ----- Leave editors -----

function newLeaveDraft() {
  const d = Day.iso(asOf());
  return { id: uuid(), startDate: d, triggerDate: d, expectedReturn: "", leaveType: LEAVE_TYPES[0], status: "Pending", category: "other",
    diagnosis: "", provider: "", caseNumber: "", note: "", reminders: [], attachments: [], confirmedAt: stamp() };
}

function openLeaveDetails(leave, isNew = false) {
  overlay = { kind: "leaveDetails", draft: structuredClone(leave), isNew };
  const l = overlay.draft;
  const opts = (list, cur) => list.map((v) => `<option ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
  showDialog(`
    <div class="form">
      <h2>${isNew ? "Report a New Medical Leave" : "Edit Leave Details"}</h2>
      <div class="group">
        <div class="field"><span>Leave Type</span><select data-ld="leaveType">${opts(LEAVE_TYPES, l.leaveType)}</select></div>
        <div class="field"><span>Status</span><select data-ld="status">${opts(LEAVE_STATUSES, l.status)}</select></div>
        <div class="field"><span>Category</span><select data-ld="category">${Object.entries(LEAVE_CATEGORIES).map(([k, [label]]) => `<option value="${k}" ${k === l.category ? "selected" : ""}>${label}</option>`).join("")}</select></div>
        <div class="field"><span>Reason / Diagnosis</span><input data-ld="diagnosis" value="${esc(l.diagnosis)}" placeholder="e.g. Back injury (sciatica)"></div>
        <div class="field"><span>Care Provider</span><input data-ld="provider" value="${esc(l.provider)}" placeholder="e.g. Orlando Health – Dr. Michaels"></div>
        <div class="field"><span>Claim / Case Number</span><input data-ld="caseNumber" value="${esc(l.caseNumber)}"></div>
      </div>
      <div class="group"><h3>Dates</h3>
        <div class="field"><span>Start Date<br><small class="muted">First call-in of the leave</small></span><input type="date" data-ld="startDate" value="${esc(l.startDate)}"></div>
        <div class="field"><span>Trigger Date<br><small class="muted">First day points are protected</small></span><input type="date" data-ld="triggerDate" value="${esc(l.triggerDate)}"></div>
        <div class="field"><span>Expected Return</span><input type="date" data-ld="expectedReturn" value="${esc(l.expectedReturn ?? "")}"></div>
        <div class="field"><span>First Shift Back<br><small class="muted">Leave empty while on leave</small></span><span>
          <input type="date" data-ld="returnDate" value="${esc(l.returnDate ?? "")}">
          <input type="text" class="time-text" data-ld-time="returnShiftStart" value="${esc(fmtTime(l.returnShiftStart))}" placeholder="7:00 AM"></span></div>
      </div>
    </div>
    <div class="dialog-actions">
      ${isNew ? "" : `<button class="btn-subtle btn-danger" data-action="leave-delete" data-id="${l.id}">Delete Leave…</button>`}
      <span class="spacer"></span>
      <button class="btn-subtle" data-action="close">Cancel</button>
      <button class="btn-primary" data-action="ld-save">${isNew ? "Add Leave" : "Save"}</button>
    </div>`, true);
}

function openLeaveNotes(leave) {
  overlay = { kind: "leaveNotes", leaveId: leave.id };
  showDialog(`
    <div class="form"><h2>Notes</h2>
      <textarea id="leave-notes" rows="10" placeholder="Appointments, conversations with HR, how you're feeling…">${esc(leave.note ?? "")}</textarea></div>
    <div class="dialog-actions"><span class="spacer"></span>
      <button class="btn-subtle" data-action="close">Cancel</button>
      <button class="btn-primary" data-action="notes-save" data-id="${leave.id}">Save</button></div>`, true);
}

function openReminder(leave, rem = null) {
  overlay = { kind: "reminder", leaveId: leave.id, remId: rem?.id ?? null };
  showDialog(`
    <div class="form"><h2>${rem ? "Edit Reminder" : "Add Reminder"}</h2>
      <div class="group">
        <div class="field"><span>What</span><input id="rem-label" value="${esc(rem?.label ?? "")}" placeholder="e.g. Follow-up Appointment"></div>
        <div class="field"><span>Date</span><input type="date" id="rem-date" value="${esc(rem?.date ?? Day.iso(asOf()))}"></div>
      </div></div>
    <div class="dialog-actions">
      ${rem ? `<button class="btn-subtle btn-danger" data-action="reminder-delete">Delete</button>` : ""}
      <span class="spacer"></span>
      <button class="btn-subtle" data-action="close">Cancel</button>
      <button class="btn-primary" data-action="reminder-save">Save</button></div>`);
}

/** Adds documents straight to a leave (any file type). */
async function uploadLeaveDocs(leave) {
  const today = Day.iso(Day.today());
  const finish = (list) => {
    if (!list.length) return;
    leave.attachments.push(...list.map((a) => ({ ...a, docType: "Other", uploadedAt: today })));
    touchLeave(leave);
    save();
  };
  if (tauri) {
    const picked = [await tauri.dialog.open({ multiple: true })].flat().filter(Boolean);
    const added = [];
    for (const path of picked) {
      try { added.push(await tauri.core.invoke("import_attachment", { path, allowPdf: true, allowAny: true })); }
      catch (err) { alert(err); }
    }
    return finish(added);
  }
  const input = Object.assign(document.createElement("input"), { type: "file", multiple: true });
  input.onchange = async () => finish(await storeWebFiles([...input.files], true, true));
  input.click();
}

/** Rename a leave document (in-app, since prompt() isn't available in every desktop web view). */
function showRenameDoc(leave, doc) {
  overlay = { kind: "rename-doc" };
  showDialog(`<div class="form"><h2>Rename Document</h2>
      <input type="text" id="doc-name" value="${esc(doc.name)}" autocomplete="off"></div>
    <div class="dialog-actions"><span class="spacer"></span>
      <button class="btn-subtle" data-action="close">Cancel</button>
      <button class="btn-primary" data-action="doc-rename-save" data-leave="${leave.id}" data-file="${esc(doc.file)}">Rename</button></div>`);
  const input = document.getElementById("doc-name");
  input.focus();
  input.setSelectionRange(0, doc.name.lastIndexOf(".") > 0 ? doc.name.lastIndexOf(".") : doc.name.length);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") document.querySelector('[data-action="doc-rename-save"]').click(); });
}

function showReturnToWork(leave) {
  overlay = { kind: "return", leaveId: leave.id };
  showDialog(`
    <div class="form">
      <h2>Return to Work</h2>
      <div>On medical leave since ${Day.long(Day.parse(leave.startDate))}. When is your first shift back?</div>
      <div class="group">
        <div class="field"><span>First shift back</span><input type="date" id="return-date" value="${Day.iso(asOf())}"></div>
        <div class="field"><span>Shift starts (optional)</span><input type="text" class="time-text" id="return-time" placeholder="7:00 AM"></div>
      </div>
      <div class="note" style="padding:0">This ends the leave and logs a "Worked / Returned" day, which closes the sick occurrence.</div>
    </div>
    <div class="dialog-actions"><span class="spacer"></span>
      <button class="btn-subtle" data-action="close">Cancel</button>
      <button class="btn-primary" data-action="leave-return-save" data-id="${leave.id}">${icon("briefcase")} Return to Work</button>
    </div>`);
}

function banners(ev) {
  const s = ev.settings, out = leaveBanners(ev);
  for (const g of ev.recentlyExpired.filter((g) => !data.confirmations.expirations.includes(E.expiryKey(g)))) {
    const n = g.reprimands.length;
    out.push(`<div class="banner c-amber">${icon("gavel")}<span>${n === 1 ? "Your reprimand" : `Your ${n} reprimands`} expired ${E.relative(g.expires, ev.asOf)} (${Day.long(g.expires)}). Double-check with leadership before relying on this.</span><span class="spacer"></span><button class="btn-subtle" data-action="confirm-expiry" data-key="${E.expiryKey(g)}">${icon("check")} Confirmed with leadership</button></div>`);
  }
  for (const w of ev.windows.filter((w) => w.earned)) {
    out.push(`<div class="banner c-red">${icon("triangle-alert")}<span>Reprimand earned: ${E.fmtPts(w.eligible)} of ${E.fmtPts(w.rule.threshold)} pts in ${w.rule.days} days. Record it here once you've signed it.</span><span class="spacer"></span><button class="btn-subtle" data-action="record" data-rule="${w.rule.days}" data-prefill="1">Record Reprimand…</button></div>`);
  }
  if (ev.stringOpenThrough !== null) {
    const n = ev.string.count, through = Day.short(ev.stringOpenThrough);
    if (n > s.maxSickString) { /* covered by the medical leave banners */ }
    else if (n === s.maxSickString) out.push(`<div class="banner c-amber">${icon("hospital")}<span>Sick occurrence: ${n} of ${s.maxSickString}. Another sick call through ${through} would be call-in ${n + 1} and trigger medical leave.</span></div>`);
    else out.push(`<div class="banner c-blue"><span class="bub">i</span><span>Sick occurrence open: ${n} of ${s.maxSickString}. A sick call through ${through} continues it with no new point.</span></div>`);
  }
  return out.length ? `<div class="banners">${out.join("")}</div>` : "";
}

const addEntryBtn = () => `<button class="btn-primary" data-action="add-entry">${icon("plus")} Add Entry</button>`;
const recordBtn = () => `<button class="btn-primary" data-action="record" data-rule="0">${icon("plus")} Record Reprimand</button>`;
function filterBtn() {
  const parts = [...(ui.windowFilter ? [`${ui.windowFilter} days`] : []), ...(ui.filter !== "all" ? [FILTERS[ui.filter][0]] : [])];
  return `<button class="btn-subtle ${parts.length ? "active" : ""}" data-action="filter-menu">${icon("list-filter")} ${parts.length ? esc(parts.join(" · ")) : "Filter"}</button>`;
}

const expandBtn = () => `<button class="btn-subtle square" data-action="expand" data-table="entries" title="Expand the call-ins table">${icon("maximize-2")}</button>`;
// Shown only when fewer than three reprimand rows fit (see updateRepExpand).
const repExpandBtn = () => `<button class="btn-subtle square rep-expand" hidden data-action="expand" data-table="reprimands" title="Expand the reprimands table">${icon("maximize-2")}</button>`;

/** Show the Reprimands expand button only if fewer than three rows are visible and some are cut off. */
function updateRepExpand() {
  const btn = document.querySelector(".rep-expand");
  if (!btn) return;
  const body = document.querySelector(".rep-table .tbody");
  const row = body?.querySelector(".trow");
  if (!body || !row) { btn.hidden = true; return; }
  const rowH = row.offsetHeight + parseFloat(getComputedStyle(row).marginBottom || 0);
  const visible = Math.floor((body.clientHeight + 4) / rowH);
  const total = body.querySelectorAll(".trow").length;
  btn.hidden = !(visible < Math.min(3, total));
}
const moreBtn = () => `<button class="btn-subtle square" data-action="more-menu" title="More">${icon("ellipsis")}</button>`;

const headCells = (cols, labels = {}) =>
  cols.map((c) => `<div style="width:${c.w}px;flex:none" ${c.help ? `title="${esc(c.help)}"` : ""}>${labels[c.id] ?? c.title}</div>`).join("");

/** Entries after the Filter menu's time window and type choices, in the chosen order. */
function filteredEntries(ev) {
  const s = data.settings, a = asOf();
  const rule = s.rules.find((r) => r.days === ui.windowFilter);
  const since = rule ? E.windowStart(rule, a, s) : null;
  let rows = ev.entries.filter((e) => FILTERS[ui.filter][1](e, ev.evals.get(e.id)?.points ?? 0));
  if (since !== null) rows = rows.filter((e) => { const d = Day.parse(e.date); return d >= since && d <= a; });
  if (ui.newestFirst) rows.reverse();
  const empty = data.entries.length === 0 ? `No entries yet. ${isMobile() ? "Tap + to add a call out." : "Click Add Entry to add a call-in."}`
    : ui.filter === "all" && !ui.windowFilter ? "No call-ins yet." : "No entries match these filters.";
  return { rows, empty };
}

function entriesTable(ev) {
  const { rows, empty } = filteredEntries(ev);
  return `
    <div style="min-width:${tableWidth(EC)}px;display:flex;flex-direction:column;flex:1;min-height:0">
      <div class="thead">${headCells(EC, { date: `<button data-action="sort">Date ${icon(ui.newestFirst ? "chevron-down" : "chevron-up")}</button>` })}</div>
      ${rows.length ? `<div class="tbody">${rows.map((e) => entryRow(e, ev)).join("")}</div>` : `<div class="empty">${empty}</div>`}
    </div>`;
}

function entryRow(e, ev) {
  const x = ev.evals.get(e.id), p = x?.points ?? 0, used = ev.neutralizedBy.has(e.id);
  const d = Day.parse(e.date), details = detailsText(e, ev);
  const chips = p > 0 && !used && d <= ev.asOf
    ? E.sortedRules(ev.settings).map((r) => chip(r, ev.positions.get(e.id)?.[r.id])).join("") : "";
  const w = Object.fromEntries(EC.map((c) => [c.id, c.w]));
  return `
  <div class="trow ${d > ev.asOf ? "future" : ""}" data-row="entry" data-id="${e.id}">
    <div class="cell" style="width:${w.date}px">${Day.short(d)}</div>
    <div class="cell typecell" style="width:${w.type}px">${icon(TYPE_ICON[e.type])}<span class="cell">${esc(E.displayType(e))}</span>${e.note ? `<span class="muted" title="Has a note">${icon("notepad-text")}</span>` : ""}</div>
    <div class="cell center tnum ${used ? "muted" : ""}" style="width:${w.points}px;${used ? "text-decoration:line-through" : ""}">${p === 0 ? "–" : E.fmtPts(p)}</div>
    <div class="cell center tnum ${x?.stringNumber ? "" : "muted"}" style="width:${w.occ}px">${x?.stringNumber ?? "—"}</div>
    <div class="cell ${x?.medicalLeave ? "red" : "muted"}" style="width:${w.details}px" title="${esc(details)}">${esc(details)}</div>
    <div class="cell chips" style="width:${w.window}px">${chips}</div>
  </div>`;
}

function chip(rule, position) {
  const sev = position == null ? "gray" : E.severity(rule, position);
  const title = position == null ? `No longer counts in the ${rule.days}-day window` : `Point ${E.fmtPts(position)} of ${E.fmtPts(rule.threshold)} in the ${rule.days}-day window`;
  return `<span class="chip c-${sev} ${position == null ? "off" : ""}" title="${title}"><b>${rule.days}d</b>${position == null ? "off" : `${E.fmtPts(position)}/${E.fmtPts(rule.threshold)}`}</span>`;
}

function reprimandsTable(ev, expanded = false) {
  const rows = [...data.reprimands].sort((a, b) => (a.signedDate < b.signedDate ? 1 : -1));
  const numbers = new Map((ev.activeGroup?.reprimands ?? []).map((r, i) => [r.id, i + 1]));
  const w = Object.fromEntries(RC.map((c) => [c.id, c.w]));
  const body = rows.map((r) => {
    const n = numbers.get(r.id), total = (r.pointEntryIDs ?? []).reduce((a, id) => a + (ev.evals.get(id)?.points ?? 0), 0);
    const signed = Day.parse(r.signedDate);
    const status = signed > ev.asOf ? `<span class="muted">After viewed date</span>`
      : n ? `<span class="red">In effect until ${Day.short(ev.activeGroup.expires)}</span>` : `<span class="muted">Expired</span>`;
    return `
    <div class="trow" data-row="rep" data-id="${r.id}">
      <div class="cell center tnum ${n ? "red" : "muted"}" style="width:${w.number}px;font-weight:${n ? 600 : 400}">${n ?? "—"}</div>
      <div class="cell typecell" style="width:${w.signed}px">${Day.short(signed)}${r.note ? `<span class="muted" title="Has a note">${icon("notepad-text")}</span>` : ""}</div>
      <div class="cell" style="width:${w.threshold}px">${thresholdText(r, ev.settings)}</div>
      <div class="cell" style="width:${w.points}px">${r.pointEntryIDs?.length ? `${E.fmtPts(total)} pts (${r.pointEntryIDs.length})` : "—"}</div>
      <div class="cell" style="width:${w.status}px">${status}</div>
    </div>`;
  }).join("");
  return `
    <div class="${expanded ? "" : "rep-table"}" style="min-width:${tableWidth(RC)}px;display:flex;flex-direction:column;flex:1;min-height:0">
      <div class="thead">${headCells(RC)}</div>
      ${rows.length ? `<div class="tbody">${body}</div>` : `<div class="empty">No reprimands recorded.</div>`}
    </div>`;
}


// ----- Calendar page -----

const MS_DAY = 86400000;
const dayParts = (n) => { const d = new Date(n * MS_DAY); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() }; };
const monthStart = (n) => { const p = dayParts(n); return Date.UTC(p.y, p.m, 1) / MS_DAY; };
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const CALL_TYPES = new Set(["callSick", "callPersonal", "other"]);

/** Call-ins and signed reprimands grouped by day. */
function calendarItems(ev) {
  const byDay = new Map();
  for (const e of ev.entries) {
    if (!CALL_TYPES.has(e.type)) continue;
    const d = Day.parse(e.date);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push({ kind: "entry", e });
  }
  for (const r of data.reprimands) {
    const d = Day.parse(r.signedDate);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push({ kind: "rep", r });
  }
  return byDay;
}

/**
 * Days covered by medical leave, like an all-day event: from the start date through the day before
 * the first shift back (ongoing leaves run through today, or the viewed date if later).
 */
function leaveDays(asOfDay) {
  const map = new Map();
  for (const l of data.leaves ?? []) {
    const s = Day.parse(l.startDate);
    const e = l.returnDate ? Day.parse(l.returnDate) - 1 : Math.max(Day.today(), asOfDay);
    for (let d = s; d <= e && d - s < 800; d++) {
      if (!map.has(d)) map.set(d, []);
      map.get(d).push({ leave: l, start: d === s, end: d === e, day: d - s + 1, ongoing: !l.returnDate });
    }
  }
  return map;
}

/** Color class for a calendar item. */
function calClass(it, ev) {
  if (it.kind === "rep") return "c-red";
  const e = it.e, x = ev.evals.get(e.id), p = x?.points ?? 0;
  return x?.medicalLeave ? "c-red" : e.type === "callPersonal" ? "c-orange" : e.type === "callSick" ? (p > 0 ? "c-blue" : "c-gray") : "c-yellow";
}

function calPill(it, ev) {
  if (it.kind === "rep") return `<button class="cal-pill c-red" data-row="rep" data-id="${it.r.id}">${icon("gavel")}<span>Reprimand signed</span></button>`;
  const e = it.e, x = ev.evals.get(e.id), p = x?.points ?? 0, used = ev.neutralizedBy.has(e.id);
  const label = e.type === "callSick" ? "Sick" : e.type === "callPersonal" ? "Personal" : E.displayType(e);
  const tail = p > 0 ? `${E.fmtPts(p)} pt` : x?.stringPosition ? `${x.stringPosition}/${ev.settings.maxSickString}` : "";
  return `<button class="cal-pill ${calClass(it, ev)} ${used ? "used" : ""}" data-row="entry" data-id="${e.id}" title="${esc(detailsText(e, ev))}">
    ${icon(TYPE_ICON[e.type])}<span>${esc(label)}</span>${tail ? `<b>${tail}</b>` : ""}${e.note ? icon("notepad-text") : ""}</button>`;
}

/** Full-window month calendar showing the days you called out. */
function calendarPage(ev) {
  const first = ui.calMonth ?? monthStart(asOf());
  const fp = dayParts(first);
  const start = first - fp.dow; // the Sunday on or before the 1st
  const today = Day.today();
  const byDay = calendarItems(ev);
  const leaves = leaveDays(ev.asOf);

  let monthCalls = 0, monthPoints = 0;
  for (const [d, items] of byDay) {
    if (dayParts(d).m !== fp.m || dayParts(d).y !== fp.y) continue;
    for (const it of items) if (it.kind === "entry") { monthCalls++; monthPoints += ev.evals.get(it.e.id)?.points ?? 0; }
  }

  const pill = (it) => calPill(it, ev);

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = start + i, p = dayParts(d), items = byDay.get(d) ?? [];
    const cls = [items.some((it) => it.kind === "entry") ? "has" : "", p.m !== fp.m ? "out" : "", d === today ? "today" : "", d === ev.asOf && d !== today ? "viewed" : "", p.dow === 0 || p.dow === 6 ? "weekend" : ""].join(" ");
    const bars = (leaves.get(d) ?? []).map((x) => `<button class="cal-leave ${x.start ? "start" : ""} ${x.end ? "end" : ""} ${p.dow === 0 ? "wk-start" : ""} ${p.dow === 6 ? "wk-end" : ""}"
        data-action="leave-edit" data-id="${x.leave.id}" title="Medical leave · day ${x.day}${x.ongoing ? " (ongoing)" : ""}">
        ${x.start || p.dow === 0 ? `${icon("hospital")}<span>Medical leave${x.ongoing && x.start ? " (ongoing)" : ""}</span>` : ""}</button>`).join("");
    return `<div class="cal-cell ${cls}" data-calday="${d}" title="Double-click to add an entry">
      <div class="cal-num">${p.d === 1 ? `${MONTH_NAMES[p.m].slice(0, 3)} ` : ""}${p.d}</div>
      ${bars}
      <div class="cal-items">${items.map(pill).join("")}</div>
    </div>`;
  }).join("");

  return `
  <div class="panel calendar">
    <div class="cal-head">
      <span class="panel-title"><span class="pi blue">${icon("calendar-days")}</span> ${MONTH_NAMES[fp.m]} ${fp.y}</span>
      <span class="muted">${monthCalls} call-in${monthCalls === 1 ? "" : "s"} · ${pts(monthPoints)}</span>
      <span class="spacer"></span>
      <div class="datenav">
        <button class="arrow" data-action="cal-nav" data-delta="-1" title="Previous month">${icon("chevron-left")}</button>
        <button class="date" data-action="cal-today">Today</button>
        <button class="arrow" data-action="cal-nav" data-delta="1" title="Next month">${icon("chevron-right")}</button>
      </div>
      ${addEntryBtn()}
    </div>
    <div class="cal-legend muted">
      <span class="cal-pill c-blue">${icon("cross")}<span>Sick, new point</span></span>
      <span class="cal-pill c-gray">${icon("cross")}<span>Sick, continues occurrence</span></span>
      <span class="cal-pill c-orange">${icon("user")}<span>Personal</span></span>
      <span class="cal-pill c-red">${icon("gavel")}<span>Reprimand signed</span></span>
      <span class="cal-pill c-amber">${icon("hospital")}<span>Medical leave</span></span>
      <span class="spacer"></span><span>Click an item for details · double-click a day to add an entry</span>
    </div>
    <div class="cal-dow">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div>${d}</div>`).join("")}</div>
    <div class="cal-grid">${cells}</div>
  </div>`;
}

// ---------- Phone layout ----------
// Narrow screens (phones): swipeable window cards, separate pages, and a bottom tab bar with a "+" button.

const MOBILE_MAX = 700;
function isMobile() { return innerWidth < MOBILE_MAX; }
const START_CARD = "pt-start-card"; // "30" (default) or "urgent"

/** Which window card the Overview opens on: the 30-day card, or the one closest to a reprimand. */
function defaultCardIndex(ev) {
  if (pref(START_CARD, "30") === "urgent") {
    let best = 0, bestF = -1;
    ev.windows.forEach((w, i) => {
      const f = w.rule.threshold ? w.eligible / w.rule.threshold : 0;
      if (f > bestF) { bestF = f; best = i; }
    });
    return best;
  }
  return Math.max(0, ev.windows.findIndex((w) => w.rule.days === 30));
}

function renderMobile(ev) {
  const page = ui.mpage ?? "overview";
  const body = page === "callins" ? mCallins(ev) : page === "reprimands" ? mReprimands(ev)
    : page === "calendar" ? mCalendar(ev) : page === "settings" ? mSettings() : page === "leaves" ? leavesPage(ev) : mOverview(ev);
  const app = document.getElementById("app");
  const scroll = document.getElementById("m-page")?.scrollTop ?? 0;
  app.innerHTML = `${mHeader()}<main class="m-page m-${page}" id="m-page">${body}</main>${mTabbar()}`;
  if (page === ui.lastMPage) document.getElementById("m-page").scrollTop = scroll;
  ui.lastMPage = page;
  lucide.createIcons();
  hydrateThumbs(app);
  if (page === "overview") setupCarousel();
  if (page === "settings") showVersionInSettings();
  if (page === "leaves") setupLeaveCarousel();
}

function mHeader() {
  const over = ui.asOverride !== null;
  const d = dayParts(asOf());
  return `
  <header class="m-header">
    <div class="hero-art"></div>
    <div class="m-head-row">
      <img class="logo" src="vendor/logo.png" alt="" draggable="false">
      <div class="m-title-wrap"><div class="title">Point Tracker</div>${betaBadge()}${env.demo ? `<span class="badge">DEMO</span>` : ""}</div>
      <span class="spacer"></span>
      <button class="m-date ${over ? "override" : ""}" data-action="calendar">${icon("calendar")} ${MONTH_NAMES[d.m].slice(0, 3)} ${d.d}</button>
      <button class="m-iconbtn ${ui.mpage === "settings" ? "on" : ""}" data-action="m-page" data-page="settings" aria-label="Settings">${icon("settings")}</button>
    </div>
  </header>`;
}

function mTabbar() {
  const tabs = [["overview", "house", "Overview"], ["callins", "phone", "Call-ins"], null, ["reprimands", "gavel", "Reprimands"], ["calendar", "calendar-days", "Calendar"]];
  const cur = ui.mpage ?? "overview";
  return `<nav class="m-tabbar">${tabs.map((t) => t
    ? `<button class="${cur === t[0] ? "on" : ""}" data-action="m-page" data-page="${t[0]}">${icon(t[1])}<span>${t[2]}</span></button>`
    : `<button class="m-plus" data-action="m-add" aria-label="Add">${icon("plus")}</button>`).join("")}</nav>`;
}

function mOverview(ev) {
  const idx = ui.cardIndex ??= defaultCardIndex(ev);
  return `
    <div class="m-strip">${ev.windows.map((w, i) => `<button class="m-chip c-${E.severity(w.rule, w.eligible)} ${i === idx ? "on" : ""}" data-action="m-card" data-index="${i}">
      <b>${w.rule.days}d</b> ${E.fmtPts(w.eligible)}/${E.fmtPts(w.rule.threshold)}</button>`).join("")}</div>
    <div class="m-cards" id="m-cards">${ev.windows.map((w) => windowCard(w, ev.asOf)).join("")}</div>
    <div class="m-dots">${ev.windows.map((_, i) => `<span class="${i === idx ? "on" : ""}"></span>`).join("")}</div>
    ${banners(ev)}
    ${reprimandCount(ev)}
    ${reprimandExpire(ev)}
    ${mLeaveCard(ev)}
    <div class="m-disclaimer">${disclaimerHTML()}</div>`;
}

/** Overview card that opens the Medical Leaves page. */
function mLeaveCard(ev) {
  const cur = currentLeave(ev.asOf);
  const past = data.leaves.filter((l) => l !== cur).length;
  return `
    <button class="panel m-leave-card ${cur ? "active" : ""}" data-action="leave-page">
      <span class="ld-heart small">${icon("heart-pulse")}</span>
      <span class="m-leave-text"><b class="head">Medical Leaves</b>
        <span class="muted">${cur ? `On leave since ${Day.short(Day.parse(cur.startDate))} · day ${leaveDaysCount(cur, ev.asOf)}`
          : `No active leave${past ? ` · ${past} previous` : ""}`}</span></span>
      ${icon("chevron-right")}
    </button>`;
}

/** Puts the chosen card in view and keeps the dots and chips in step with swiping. */
function setupCarousel() {
  const strip = document.getElementById("m-cards");
  if (!strip) return;
  const cards = [...strip.children];
  const center = (i) => cards[i].offsetLeft - (strip.clientWidth - cards[i].offsetWidth) / 2;
  strip.scrollLeft = center(ui.cardIndex ?? 0);
  let raf = 0;
  strip.addEventListener("scroll", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const mid = strip.scrollLeft + strip.clientWidth / 2;
      let best = 0;
      cards.forEach((c, i) => { if (Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid) < Math.abs(cards[best].offsetLeft + cards[best].offsetWidth / 2 - mid)) best = i; });
      if (best === ui.cardIndex) return;
      ui.cardIndex = best;
      document.querySelectorAll(".m-dots span").forEach((s, i) => s.classList.toggle("on", i === best));
      document.querySelectorAll(".m-chip").forEach((s, i) => s.classList.toggle("on", i === best));
    });
  }, { passive: true });
  strip.dataset.center = "1";
  strip.scrollToCard = (i) => strip.scrollTo({ left: center(i), behavior: "smooth" });
}

function mCallins(ev) {
  const { rows, empty } = filteredEntries(ev);
  return `
    <div class="m-section-head"><h2 class="page-title">Call-ins</h2><span class="spacer"></span>${filterBtn()}${moreBtn()}</div>
    ${rows.length ? `<div class="m-list">${rows.map((e) => mEntryCard(e, ev)).join("")}</div>` : `<div class="m-empty">${empty}</div>`}`;
}

function mEntryCard(e, ev) {
  const x = ev.evals.get(e.id), p = x?.points ?? 0, used = ev.neutralizedBy.has(e.id), d = Day.parse(e.date);
  const details = detailsText(e, ev);
  const chips = p > 0 && !used && d <= ev.asOf
    ? E.sortedRules(ev.settings).map((r) => chip(r, ev.positions.get(e.id)?.[r.id])).join("") : "";
  return `
    <button class="m-row ${d > ev.asOf ? "future" : ""}" data-row="entry" data-id="${e.id}">
      <div class="m-row-top"><span class="m-type">${icon(TYPE_ICON[e.type])} ${esc(E.displayType(e))}</span><span class="spacer"></span>
        <span class="m-pts ${used ? "used" : ""} ${p > 0 ? "" : "zero"}">${p > 0 ? pts(p) : "No point"}</span></div>
      <div class="m-row-sub">${Day.long(d)}${x?.stringNumber ? ` · Occurrence ${x.stringNumber}` : ""}</div>
      ${details !== "—" ? `<div class="m-row-sub ${x?.medicalLeave ? "red" : ""}">${esc(details)}</div>` : ""}
      ${chips ? `<div class="chips">${chips}</div>` : ""}
    </button>`;
}

function mReprimands(ev) {
  const rows = [...data.reprimands].sort((a, b) => (a.signedDate < b.signedDate ? 1 : -1));
  const numbers = new Map((ev.activeGroup?.reprimands ?? []).map((r, i) => [r.id, i + 1]));
  const body = rows.map((r) => {
    const n = numbers.get(r.id), signed = Day.parse(r.signedDate);
    const total = (r.pointEntryIDs ?? []).reduce((a, id) => a + (ev.evals.get(id)?.points ?? 0), 0);
    const status = signed > ev.asOf ? `<span class="muted">After viewed date</span>`
      : n ? `<span class="red">In effect until ${Day.short(ev.activeGroup.expires)}</span>` : `<span class="muted">Expired</span>`;
    return `
      <button class="m-row" data-row="rep" data-id="${r.id}">
        <div class="m-row-top"><span class="m-num ${n ? "on" : ""}">${n ?? "–"}</span>
          <span class="m-type">Signed ${Day.long(signed)}</span></div>
        <div class="m-row-sub">${thresholdText(r, ev.settings)}${r.pointEntryIDs?.length ? ` · ${E.fmtPts(total)} pts used` : ""}</div>
        <div class="m-row-sub">${status}</div>
      </button>`;
  }).join("");
  return `
    <div class="m-section-head"><h2 class="page-title">Reprimands</h2></div>
    ${rows.length ? `<div class="m-list">${body}</div>` : `<div class="m-empty">No reprimands recorded. Tap + to record one.</div>`}`;
}

function mCalendar(ev) {
  const first = ui.calMonth ?? monthStart(asOf());
  const fp = dayParts(first), start = first - fp.dow, today = Day.today();
  const byDay = calendarItems(ev);
  const leaves = leaveDays(ev.asOf);
  const inMonth = (d) => dayParts(d).m === fp.m && dayParts(d).y === fp.y;
  const sel = ui.calSelected !== null && inMonth(ui.calSelected) ? ui.calSelected : inMonth(today) ? today : first;
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = start + i, p = dayParts(d), items = byDay.get(d) ?? [];
    const cls = [p.m !== fp.m ? "out" : "", d === today ? "today" : "", d === sel ? "sel" : ""].join(" ");
    const lv = leaves.get(d)?.[0];
    return `<button class="m-cal-cell ${cls}" data-action="m-cal-day" data-day="${d}">
      <span>${p.d}</span><span class="m-cal-dots">${items.slice(0, 3).map((it) => `<i class="${calClass(it, ev)}"></i>`).join("")}</span>
      ${lv ? `<span class="m-cal-leave ${lv.start || p.dow === 0 ? "start" : ""} ${lv.end || p.dow === 6 ? "end" : ""}"></span>` : ""}</button>`;
  }).join("");
  const items = byDay.get(sel) ?? [];
  const selLeaves = (leaves.get(sel) ?? []).map((x) => `<button class="cal-pill c-amber" data-action="leave-edit" data-id="${x.leave.id}">
    ${icon("hospital")}<span>Medical leave · day ${x.day}${x.ongoing ? " (ongoing)" : ""}</span></button>`).join("");
  return `
    <div class="m-section-head">
      <button class="m-iconbtn" data-action="cal-nav" data-delta="-1" aria-label="Previous month">${icon("chevron-left")}</button>
      <h2 class="page-title" style="flex:1;text-align:center">${MONTH_NAMES[fp.m]} ${fp.y}</h2>
      <button class="m-iconbtn" data-action="cal-nav" data-delta="1" aria-label="Next month">${icon("chevron-right")}</button>
    </div>
    <div class="m-cal">
      <div class="m-cal-dow">${["S", "M", "T", "W", "T", "F", "S"].map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="m-cal-grid">${cells}</div>
    </div>
    <div class="m-section-head small"><b class="head">${Day.long(sel)}</b><span class="spacer"></span>
      <button class="btn-subtle small" data-action="cal-today">Today</button></div>
    ${items.length || selLeaves ? `<div class="m-cal-items">${selLeaves}${items.map((it) => calPill(it, ev)).join("")}</div>` : `<div class="m-empty small">Nothing on this day.</div>`}`;
}

/** "BETA" next to the app name in the header while the app is in a release stage (see whatsnew.js). */
const betaBadge = () => W.STAGE
  ? `<span class="badge badge-stage" title="Point Tracker is in ${esc(W.STAGE.toLowerCase())}: it's still being polished, so things may change.">${esc(W.STAGE.toUpperCase())}</span>`
  : "";

/** Fills in the version on the phone's About row. */
async function showVersionInSettings() {
  const v = tauri ? await tauri.core.invoke("app_info").catch(() => null)
    : await fetch("version.json").then((r) => r.json()).catch(() => null);
  const el = document.getElementById("m-version");
  if (el && v?.version) el.textContent = W.STAGE && W.versionName(v.version) !== v.version ? W.versionName(v.version) : `v${v.version}`;
}

function mSettings() {
  const start = pref(START_CARD, "30");
  return `${settingsPage(`
    <div class="group m-phone-group"><h3>On this phone</h3>
      <div class="field"><span>Overview opens on</span><div class="seg">
        <button class="${start === "30" ? "on" : ""}" data-action="pref" data-key="${START_CARD}" data-value="30">30 days</button>
        <button class="${start === "urgent" ? "on" : ""}" data-action="pref" data-key="${START_CARD}" data-value="urgent">Most urgent</button></div></div>
      <div class="field"><span>Last saved</span><span id="last-saved">${lastSavedText()}</span></div>
    </div>`)}
    <button class="sheet-item m-about-row" data-action="about">${icon("info")}<span>About Point Tracker</span>
      <span class="m-version muted" id="m-version"></span>${icon("chevron-right")}</button>
    <div class="m-disclaimer">${disclaimerHTML()}</div>`;
}

/** The "+" button: what to add. */
function showAddSheet(step = "main") {
  const item = (label, ic, attrs) => `<button class="sheet-item" ${attrs}>${icon(ic)}<span>${label}</span>${icon("chevron-right")}</button>`;
  const html = step === "callout"
    ? `<div class="sheet-title">New Call Out</div>
       ${item("Call In Sick", "cross", `data-action="m-new" data-type="callSick"`)}
       ${item("Call In Personal", "user", `data-action="m-new" data-type="callPersonal"`)}`
    : step === "other"
    ? `<div class="sheet-title">New Other Entry</div>
       ${item("ADO", "sun", `data-action="m-new" data-type="ado"`)}
       ${item("Worked / Returned to Work", "briefcase", `data-action="m-new" data-type="worked"`)}
       ${item("Picked Up Shift", "circle-plus", `data-action="m-new" data-type="pickedUp"`)}
       ${item("Dropped Shift", "circle-minus", `data-action="m-new" data-type="dropped"`)}
       ${item("Other (custom points, e.g. tardy)", "circle-ellipsis", `data-action="m-new" data-type="other"`)}`
    : `<div class="sheet-title">Add</div>
       ${item("New Call Out", "phone", `data-action="m-add-step" data-step="callout"`)}
       ${item("New Reprimand", "gavel", `data-action="record" data-rule="0"`)}
       ${item("New Other Entry", "calendar-plus", `data-action="m-add-step" data-step="other"`)}`;
  showSheet(html);
}

function showSheet(html) {
  const el = document.getElementById("overlay");
  el.innerHTML = `<div class="scrim dim" data-action="close"></div><div class="sheet"><div class="sheet-grip"></div>${html}</div>`;
  lucide.createIcons();
  hydrateThumbs(el);
  enableSwipeClose(el.querySelector(".sheet"), closeOverlay);
}

/** True if the open editor has changes that haven't been saved. */
const editorDirty = () => {
  const ed = editing();
  return !!ed && (JSON.stringify(ed.item) !== overlay.original || overlay.added.length > 0);
};

/**
 * Phone: drag a sheet down to close it. Only starts when the sheet is scrolled to the top,
 * so scrolling inside it still works. canClose() can veto (e.g. unsaved changes).
 */
function enableSwipeClose(panel, close, canClose = () => true, canStart = () => panel.scrollTop <= 0) {
  if (!panel) return;
  let startY = null, startT = 0, dy = 0, dragging = false;
  panel.addEventListener("touchstart", (e) => {
    startY = e.touches.length === 1 && canStart(e) ? e.touches[0].clientY : null;
    startT = Date.now(); dy = 0; dragging = false;
  }, { passive: true });
  panel.addEventListener("touchmove", (e) => {
    if (startY === null) return;
    dy = e.touches[0].clientY - startY;
    if (!dragging) {
      if (dy < -4) { startY = null; return; } // scrolling up: leave it alone
      if (dy > 8) { dragging = true; panel.style.transition = "none"; }
    }
    if (dragging) {
      e.preventDefault();
      panel.style.transform = `translateY(${Math.max(0, dy)}px)`;
    }
  }, { passive: false });
  const end = () => {
    if (!dragging) { startY = null; return; }
    dragging = false; startY = null;
    const fast = dy / Math.max(1, Date.now() - startT) > 0.6;
    panel.style.transition = "transform 0.2s ease-out";
    if ((dy > 110 || (fast && dy > 40)) && canClose()) {
      panel.style.transform = "translateY(105%)";
      setTimeout(close, 180);
    } else {
      panel.style.transform = "";
    }
  };
  panel.addEventListener("touchend", end);
  panel.addEventListener("touchcancel", end);
}

// ---------- Overlays ----------

function closeOverlay() {
  stopScanner();
  if (overlay?.kind === "whatsnew" && overlay.markSeen) setPref(whatsNewKey(), overlay.markSeen);
  // Files attached during an edit that was cancelled aren't referenced anywhere; remove them.
  if (overlay?.added?.length) deleteFiles(overlay.added);
  overlay = null;
  document.getElementById("overlay").innerHTML = "";
}

function showPopover(html, anchor, { side = "right", width = 340, menu = false } = {}) {
  if (isMobile()) return showSheet(`<div class="${menu ? "menu sheet-menu" : "sheet-body"}">${html}</div>`);
  const r = anchor.getBoundingClientRect();
  const el = document.getElementById("overlay");
  el.innerHTML = `<div class="scrim" data-action="close"></div><div class="popover ${menu ? "menu" : ""}" style="width:${width}px">${html}</div>`;
  const pop = el.querySelector(".popover");
  const h = pop.offsetHeight;
  let left, top;
  if (side === "below") { left = Math.min(r.right - width, innerWidth - width - 8); top = r.bottom + 6; }
  else if (side === "point") { left = Math.min(anchor.x, innerWidth - width - 8); top = Math.min(anchor.y, innerHeight - h - 8); }
  else {
    left = r.left + r.width / 2 + 10;
    if (left + width > innerWidth - 8) left = r.left + r.width / 2 - width - 10;
    top = Math.min(Math.max(8, r.top - h / 2 + r.height / 2), innerHeight - h - 8);
  }
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${top}px`;
  lucide.createIcons();
  hydrateThumbs(el).then(() => {
    // Images change the pop-up's height; keep it on screen.
    const h2 = pop.offsetHeight;
    if (pop.offsetTop + h2 > innerHeight - 8) pop.style.top = `${Math.max(8, innerHeight - h2 - 8)}px`;
  });
}

function showDialog(html, wide = false) {
  const el = document.getElementById("overlay");
  const prevScroll = el.querySelector(".dialog")?.scrollTop ?? 0;
  el.innerHTML = `<div class="scrim dim"><div class="dialog ${wide ? "wide" : ""}">${isMobile() ? `<div class="sheet-grip"></div>` : ""}${html}</div></div>`;
  lucide.createIcons();
  hydrateThumbs(el);
  if (isMobile()) {
    const panel = el.querySelector(".dialog");
    if (overlay?.added) panel.scrollTop = prevScroll; // editor re-render: keep position
    enableSwipeClose(panel, closeOverlay, () => !editorDirty() || confirm("Discard your changes?"));
  }
}

const line = (label, value, cls = "") => `<div class="line"><span>${label}</span><span class="${cls}">${value}</span></div>`;
const noteBlock = (note) => `<div style="margin-top:12px"><div class="muted">Note</div><div style="user-select:text;white-space:pre-wrap" class="${note ? "" : "muted"}">${note ? esc(note) : "No note"}</div></div>`;
const popActions = (kind, id) => `<div class="actions"><button class="btn-subtle btn-danger" data-action="delete" data-kind="${kind}" data-id="${id}">Delete…</button><button class="btn-primary" data-action="edit" data-kind="${kind}" data-id="${id}">Edit…</button></div>`;

function entryInfo(e) {
  const ev = E.evaluate(data, asOf());
  const x = ev.evals.get(e.id), p = x?.points ?? 0, used = ev.neutralizedBy.has(e.id);
  const longest = E.sortedRules(ev.settings).at(-1)?.days ?? 365;
  let html = `<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px"><span style="font-size:20px">${icon(TYPE_ICON[e.type])}</span>
    <div><b class="head">${esc(E.displayType(e))}</b><div class="muted">${Day.long(Day.parse(e.date))}</div></div></div>`;
  html += line("Points", e.pointsOverride != null && e.pointsOverride !== x?.basePoints ? `${E.fmtPts(p)} (override; rules say ${E.fmtPts(x?.basePoints ?? 0)})` : E.fmtPts(p));
  if (x?.stringNumber) html += line("Occurrence", `${x.stringNumber} in ${longest} days`);
  if (x?.stringPosition) html += line("Call-in", `${x.stringPosition} of ${ev.settings.maxSickString} in this occurrence`, x.medicalLeave ? "red" : "");
  if (x?.medicalLeave) {
    const l = leaveFor(e.id);
    html += l
      ? line("Medical leave", `${Day.short(Day.parse(l.startDate))} – ${l.returnDate ? Day.short(Day.parse(l.returnDate)) : "ongoing"}${l.attachments?.length ? ` · ${l.attachments.length} document${l.attachments.length === 1 ? "" : "s"}` : ""}<br>
          <button class="btn-subtle small" style="margin-top:6px" data-action="leave-edit" data-id="${l.id}">${icon("hospital")} Leave Details…</button>`)
      : line("", "Medical leave triggered", "red");
  }
  if (used) html += line("Reprimand", detailsText(e, ev).split(" · ").find((t) => t.startsWith("Used in reprimand")) ?? "Used in a reprimand");
  if (e.shiftStart || e.shiftEnd) html += line("Shift", [fmtTime(e.shiftStart), fmtTime(e.shiftEnd)].filter(Boolean).join(" – "));
  if (e.submittedAt) html += line("Submitted", `${fmtDateTime(e.submittedAt)} <span class="muted">(CastLife)</span>`);
  if (p > 0 && !used && Day.parse(e.date) <= ev.asOf)
    html += `<div class="line"><span>Windows</span><span style="display:flex;flex-direction:column;gap:4px;align-items:flex-start">${E.sortedRules(ev.settings).map((r) => chip(r, ev.positions.get(e.id)?.[r.id])).join("")}</span></div>`;
  if (e.attachments?.length) html += `<div style="margin-top:12px"><div class="muted">Screenshots</div>${attachmentList(e.attachments)}</div>`;
  return html + noteBlock(e.note) + popActions("entry", e.id);
}

function reprimandInfo(r) {
  const ev = E.evaluate(data, asOf());
  const numbers = new Map((ev.activeGroup?.reprimands ?? []).map((x, i) => [x.id, i + 1]));
  const n = numbers.get(r.id), signed = Day.parse(r.signedDate);
  const points = ev.entries.filter((e) => (r.pointEntryIDs ?? []).includes(e.id));
  let html = `<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px"><span style="font-size:20px" class="${n ? "red" : "muted"}">${icon("triangle-alert")}</span>
    <div><b class="head">${n ? `Reprimand ${n} of ${ev.settings.terminationAt}` : "Reprimand"}</b><div class="muted">Signed ${Day.long(signed)}</div></div></div>`;
  html += line("Threshold", thresholdText(r, ev.settings));
  html += signed > ev.asOf ? line("Status", "After the date you're viewing", "muted")
    : n ? line("Status", `In effect until ${Day.short(ev.activeGroup.expires)}`, "red") : line("Status", "Expired", "muted");
  html += line("Own expiration", Day.short(E.ownExpiry(r, ev.settings)) + (r.expirationOverride ? " (override)" : ""));
  html += line("Points used", points.length ? points.map((e) => `${Day.short(Day.parse(e.date))} · ${esc(E.displayType(e))} · ${E.fmtPts(ev.evals.get(e.id)?.points ?? 0)} pt`).join("<br>") : `<span class="muted">None selected</span>`);
  if (r.attachments?.length) html += `<div style="margin-top:12px"><div class="muted">Documents</div>${attachmentList(r.attachments)}</div>`;
  return html + noteBlock(r.note) + popActions("rep", r.id);
}

function filterMenu(anchor) {
  const item = (on, label, attrs) => `<button ${attrs}><span class="check">${on ? "✓" : ""}</span>${label}</button>`;
  const html = `
    <h4>Time window</h4>
    ${item(!ui.windowFilter, "All time", `data-action="set-window" data-days="0"`)}
    ${E.sortedRules(data.settings).map((r) => item(ui.windowFilter === r.days, `Last ${r.days} days`, `data-action="set-window" data-days="${r.days}"`)).join("")}
    <hr><h4>Show</h4>
    ${Object.entries(FILTERS).map(([k, [label]]) => item(ui.filter === k, label, `data-action="set-filter" data-filter="${k}"`)).join("")}
    ${ui.filter !== "all" || ui.windowFilter ? `<hr>${item(false, "Clear Filters", `data-action="clear-filters"`)}` : ""}`;
  showPopover(html, anchor, { side: "below", width: 260, menu: true });
}

function confirmDelete(kind, id) {
  const text = kind === "entry" ? "Delete this entry? Any reprimand using it will no longer include it." : "Delete this reprimand? Its points will count again.";
  showDialog(`<div class="form"><h2>Delete?</h2><div>${text}</div></div>
    <div class="dialog-actions"><span class="spacer"></span><button class="btn-subtle" data-action="close">Cancel</button>
    <button class="btn-primary" style="background:var(--red)" data-action="confirm-delete" data-kind="${kind}" data-id="${id}">Delete</button></div>`);
}

// ----- Entry editor -----

function openEntryEditor(entry) {
  overlay = { kind: "entry", entry: structuredClone(entry), isNew: !data.entries.some((e) => e.id === entry.id), added: [], removed: [], original: JSON.stringify(entry) };
  renderEntryEditor();
}

function renderEntryEditor() {
  const { entry: e, isNew } = overlay;
  const preview = E.run([...data.entries.filter((x) => x.id !== e.id), e], data.settings).evals.get(e.id) ?? {};
  const s = data.settings, longest = E.sortedRules(s).at(-1)?.days ?? 365;
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${v}</option>`).join("");
  showDialog(`
    <div class="form">
      <h2>${isNew ? "Add Entry" : "Edit Entry"}</h2>
      <div class="group">
        <div class="field"><span>Date</span><input type="date" data-bind="date" value="${e.date}"></div>
        <div class="field"><span>Type</span><select data-bind="type">${opt(E.ENTRY_TYPES, e.type)}</select></div>
        ${E.HIDDEN_TYPES.has(e.type) ? `<div class="note" style="padding-top:8px">This only breaks a sick occurrence and won't show in the list. To see it again, use Filter → Worked, ADO & shift changes.</div>` : ""}
        ${e.type === "other" ? `
          <div class="field"><span>Label</span><input data-bind="otherLabel" value="${esc(e.otherLabel)}" placeholder="e.g. Tardy"></div>
          <div class="field"><span>Points</span><input type="number" step="0.5" data-bind="otherPoints" value="${e.otherPoints ?? 0}"></div>
          <div class="field"><span>Breaks a sick occurrence</span><input type="checkbox" data-bind="otherBreaksString" ${e.otherBreaksString !== false ? "checked" : ""}></div>` : ""}
        ${e.type === "callSick" ? `
          <div class="field"><span>Point</span><select data-bind="stringMode">${opt(E.STRING_MODES, e.stringMode)}</select></div>
          ${preview.stringNumber ? `<div class="field"><span>Sick occurrence</span><span>${preview.stringNumber} in ${longest} days, call-in ${preview.stringPosition} of ${s.maxSickString}</span></div>` : ""}
          ${preview.medicalLeave ? `<div class="field red">This is past ${s.maxSickString} call-ins in a row, so it triggers medical leave.</div>` : ""}` : ""}
        ${e.type === "callPersonal" && preview.stringNumber ? `<div class="field"><span>Occurrence</span><span>${preview.stringNumber} in ${longest} days</span></div>` : ""}
        <div class="field"><span>Points by the rules</span><span>${E.fmtPts(preview.basePoints ?? 0)}</span></div>
        <div class="field"><span>Override points</span><input type="checkbox" data-bind="override" ${e.pointsOverride != null ? "checked" : ""}></div>
        ${e.pointsOverride != null ? `<div class="field"><span>Points (override)</span><input type="number" step="0.5" data-bind="pointsOverride" value="${e.pointsOverride}"></div>` : ""}
      </div>
      ${E.HIDDEN_TYPES.has(e.type) ? "" : `
      <div class="group"><h3>Details (optional)</h3>
        <div class="field"><span>Shift called out of</span><span>
          <input type="text" class="time-text" data-time="shiftStart" value="${esc(fmtTime(e.shiftStart))}" placeholder="7:00 AM"> to
          <input type="text" class="time-text" data-time="shiftEnd" value="${esc(fmtTime(e.shiftEnd))}" placeholder="3:30 PM"></span></div>
        <div class="field"><span>Submitted to CastLife</span><span>
          <input type="date" data-submit="date" value="${esc((e.submittedAt ?? "").slice(0, 10))}">
          <input type="text" class="time-text" data-submit="time" value="${esc(fmtTime((e.submittedAt ?? "").slice(11, 16)))}" placeholder="6:15 AM">
          <button class="btn-subtle small" data-action="submitted-now">Now</button></span></div>
        <div class="note" style="padding-top:0">Type times like 7:00 AM, 7am or 15:30. Leave the submission date blank to use the call-in date.</div>
        <div class="field" style="flex-direction:column;align-items:stretch;gap:8px">
          <span style="display:flex;align-items:center">Screenshots<span class="spacer"></span>
            <button class="btn-subtle small" data-action="add-attachment">${icon("image-plus")} ${isMobile() ? "Add Photo" : "Add Screenshot…"}</button></span>
          ${attachmentList(e.attachments, { removable: true })}
          ${isMobile() ? "" : `<span class="note" style="padding:0">You can also paste a screenshot (⌘V / Ctrl+V)${tauri ? " or drag image files here" : ""}.</span>`}
        </div>
      </div>`}
      <div class="group"><div class="field" style="flex-direction:column;align-items:stretch"><span>Note</span><textarea rows="3" data-bind="note">${esc(e.note)}</textarea></div></div>
    </div>
    <div class="dialog-actions">
      ${isNew ? "" : `<button class="btn-subtle btn-danger" data-action="delete" data-kind="entry" data-id="${e.id}">Delete…</button>`}
      <span class="spacer"></span>
      <button class="btn-subtle" data-action="close">Cancel</button>
      <button class="btn-primary" data-action="save-entry">${isNew ? "Add" : "Save"}</button>
    </div>`);
}

// ----- Reprimand editor -----

function openReprimandEditor(rep) {
  overlay = { kind: "rep", rep: structuredClone(rep), isNew: !data.reprimands.some((r) => r.id === rep.id), added: [], removed: [], original: JSON.stringify(rep) };
  renderReprimandEditor();
}

function renderReprimandEditor() {
  const { rep: r, isNew } = overlay;
  const s = data.settings, { evals } = E.run(data.entries, s);
  const usedElsewhere = E.neutralized(data.reprimands.filter((x) => x.id !== r.id));
  const sel = new Set(r.pointEntryIDs);
  const signed = Day.parse(r.signedDate);
  const candidates = E.sortEntries(data.entries).reverse().filter((e) =>
    sel.has(e.id) || (Day.parse(e.date) <= signed && (evals.get(e.id)?.points ?? 0) > 0 && !usedElsewhere.has(e.id)));
  const total = r.pointEntryIDs.reduce((a, id) => a + (evals.get(id)?.points ?? 0), 0);
  const rule = s.rules.find((x) => x.days === r.ruleDays);
  const byRules = Day.iso(Day.addMonths(signed, s.reprimandMonths));
  showDialog(`
    <div class="form">
      <h2>${isNew ? "Record Reprimand" : "Edit Reprimand"}</h2>
      <div class="group">
        <div class="field"><span>Date signed</span><input type="date" data-bind="signedDate" value="${r.signedDate}"></div>
        <div class="field"><span>Threshold hit</span><select data-bind="ruleDays">
          ${E.sortedRules(s).map((x) => `<option value="${x.days}" ${x.days === r.ruleDays ? "selected" : ""}>${E.fmtPts(x.threshold)} pts in ${x.days} days</option>`).join("")}
          <option value="0" ${r.ruleDays === 0 ? "selected" : ""}>Other / unspecified</option></select></div>
        <div class="field"><span>Expires (by the rules)</span><span>${Day.short(Day.parse(byRules))}</span></div>
        <div class="field"><span>Override this reprimand's expiration</span><input type="checkbox" data-bind="expOverride" ${r.expirationOverride ? "checked" : ""}></div>
        ${r.expirationOverride ? `<div class="field"><span>Expires</span><input type="date" data-bind="expirationOverride" value="${r.expirationOverride}"></div>` : ""}
        <div class="field" style="flex-direction:column;align-items:stretch"><span>Note</span><textarea rows="2" data-bind="note">${esc(r.note)}</textarea></div>
      </div>
      <div class="group"><h3>Documents (optional)</h3>
        <div class="field" style="flex-direction:column;align-items:stretch;gap:8px">
          <span style="display:flex;align-items:center">Images or PDFs of the signed reprimand<span class="spacer"></span>
            <button class="btn-subtle small" data-action="add-attachment">${icon("paperclip")} Add Image or PDF…</button></span>
          ${attachmentList(r.attachments, { removable: true })}
          ${isMobile() ? "" : `<span class="note" style="padding:0">You can also paste an image (⌘V / Ctrl+V)${tauri ? " or drag files here" : ""}.</span>`}
        </div>
      </div>
      <div class="group">
        <div class="field"><b>Points included (optional)</b><span>
          <button class="btn-subtle" data-action="rep-suggest" ${r.ruleDays === 0 ? "disabled" : ""}>Select points in window</button>
          <button class="btn-subtle" data-action="rep-clear">Clear</button></span></div>
        <div class="checklist">
          ${candidates.length ? candidates.map((e) => `<label><input type="checkbox" data-point="${e.id}" ${sel.has(e.id) ? "checked" : ""}>
            <span style="width:100px">${Day.short(Day.parse(e.date))}</span><span>${esc(E.displayType(e))}</span><span>${E.fmtPts(evals.get(e.id)?.points ?? 0)} pt</span></label>`).join("")
            : `<div class="note" style="padding-top:8px">No unused points on or before the signed date.</div>`}
        </div>
        <div class="note">${r.pointEntryIDs.length ? `Selected: ${E.fmtPts(total)} pts` : "None selected"}
          ${rule && r.pointEntryIDs.length && total < rule.threshold ? `<span class="orange">(below the ${E.fmtPts(rule.threshold)}-point threshold)</span>` : ""}<br>
          Points you include are used up and can never count toward another reprimand. You can leave this empty, e.g. for older reprimands; it still counts toward your reprimand total and expiration.</div>
      </div>
    </div>
    <div class="dialog-actions">
      ${isNew ? "" : `<button class="btn-subtle btn-danger" data-action="delete" data-kind="rep" data-id="${r.id}">Delete…</button>`}
      <span class="spacer"></span>
      <button class="btn-subtle" data-action="close">Cancel</button>
      <button class="btn-primary" data-action="save-rep">${isNew ? "Record" : "Save"}</button>
    </div>`, true);
}

function newReprimand(ruleDays, prefill) {
  const r = { id: uuid(), signedDate: Day.iso(asOf()), ruleDays, pointEntryIDs: [], note: "" };
  if (prefill) r.pointEntryIDs = E.suggestedPoints(data, ruleDays, asOf(), r.id);
  return r;
}

// ----- Settings -----

function settingsPage(lead = "") {
  const s = data.settings, appearance = pref(STORE.appearance, "dark"), layout = pref(STORE.layout, "adaptive");
  const seg = (key, cur, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${v === cur ? "on" : ""}" data-action="pref" data-key="${key}" data-value="${v}">${l}</button>`).join("")}</div>`;
  const num = (key, step = 1) => `<input type="number" step="${step}" data-setting="${key}" value="${s[key]}">`;
  return `
    <div class="settings">
      <h2 class="page-title">Settings</h2>
      <div class="settings-grid">
      ${lead}
      <div class="group"><h3>Appearance</h3>
        <div class="field"><span>Theme</span>${seg(STORE.appearance, appearance, [["system", "System"], ["light", "Light"], ["dark", "Dark"]])}</div>
        ${isMobile() ? "" : `<div class="field"><span>Call-ins & reprimands</span>${seg(STORE.layout, layout, [["tabs", "Tabs"], ["sideBySide", "Side by side"], ["adaptive", "Adaptive"]])}</div>
        <div class="note">Adaptive shows them side by side when the window is wide enough, and as tabs otherwise.</div>`}
      </div>
      <div class="group"><h3>Reprimand thresholds</h3>
        ${s.rules.map((r, i) => `<div class="field"><span><input type="number" step="0.5" data-rule="${i}" data-key="threshold" value="${r.threshold}"> points in
          <input type="number" data-rule="${i}" data-key="days" value="${r.days}"> days</span>
          <button class="iconbtn" style="font-size:16px" data-action="remove-rule" data-index="${i}">${icon("circle-minus")}</button></div>`).join("")}
        <div class="field"><button class="btn-subtle" data-action="add-rule">Add Threshold</button></div>
        <div class="field"><span>Extra days a point counts past its window</span>${num("dropOffBufferDays")}</div>
        <div class="field"><span>Days to show the "double-check CastLife" notice after a point drops off</span>${num("dropOffWarningDays")}</div>
      </div>
      <div class="group"><h3>Points</h3>
        <div class="field"><span>Call In Personal</span>${num("personalPoints", 0.5)}</div>
        <div class="field"><span>Call In Sick (first in occurrence)</span>${num("sickPoints", 0.5)}</div>
      </div>
      <div class="group"><h3>Sick occurrences</h3>
        <div class="field"><span>Next sick call within this many days continues it</span>${num("sickStringGapDays")}</div>
        <div class="field"><span>Call-ins per occurrence before medical leave</span>${num("maxSickString")}</div>
      </div>
      <div class="group"><h3>Reprimands</h3>
        <div class="field"><span>Each lasts this many months from signing</span>${num("reprimandMonths")}</div>
        <div class="field"><span>Termination at this many in effect</span>${num("terminationAt")}</div>
        <div class="field"><span>Days to show the "double-check with leadership" notice after reprimands expire</span>${num("expiryWarningDays")}</div>
        <div class="note">Both notices can be dismissed early with their Confirm button.</div>
      </div>
      ${syncGroup()}
      <div class="group"><h3>Help</h3>
        <div class="field"><span>New here, or need a refresher?</span><span class="sync-btns">
          <button class="btn-subtle" data-action="start-tour">${icon("map")} Take the Tour</button>
          <button class="btn-subtle" data-action="whats-new">${icon("sparkles")} What's New</button></span></div>
        ${tauri ? `<div class="field"><span>Updates</span><span class="sync-btns">
          <button class="btn-subtle" data-action="check-updates">${icon("download")} Check for Updates</button></span></div>
        <div class="note">Point Tracker checks GitHub for a new version when it opens and every 15 minutes. Only the version number is looked up; none of your records are sent.</div>` : ""}
      </div>
      <div class="group"><h3>Data</h3>
        <div class="field"><span>Backup</span><span><button class="btn-subtle" data-action="export">Export Backup…</button>
          <button class="btn-subtle" data-action="import">Import Backup…</button></span></div>
        <div class="field"><span>Auto-save every</span><span><input type="number" min="${AUTOSAVE_MIN_SECONDS}" step="15" data-setting="autosaveSeconds" value="${s.autosaveSeconds}"> seconds</span></div>
        <div class="note">Adding, editing or deleting anything is always saved right away; this is an extra timed save on top of that.</div>
        <div class="field"><button class="btn-subtle" data-action="restore-rules">Restore Default Rules</button>
          ${env.demo ? `<button class="btn-subtle btn-danger" data-action="reset-sample">Reset Sample Data</button>` : ""}</div>
        ${env.path ? `<div class="note" style="padding-top:8px;user-select:text">Saved automatically to ${esc(env.path)}</div>` : ""}
      </div>
    </div>
    </div>`;
}

const renderSettings = render;

// ---------- Appearance ----------

function applyAppearance() {
  const mode = pref(STORE.appearance, "dark");
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  tauri?.window?.getCurrentWindow?.().setTheme?.(mode === "system" ? null : mode).catch?.(() => {});
}

// ---------- Events ----------

let clickTimer = null;

document.addEventListener("click", (ev) => {
  const link = ev.target.closest("a[data-external]");
  if (link) {
    ev.preventDefault();
    if (tauri?.opener) tauri.opener.openUrl(link.href).catch((err) => alert(`Couldn't open link: ${err}`));
    else window.open(link.href, "_blank", "noopener");
    return;
  }
  const row = ev.target.closest("[data-row]");
  if (row && !ev.target.closest("[data-action]")) {
    // Single click shows info; wait briefly so a double-click can open the editor instead.
    clearTimeout(clickTimer);
    if (ev.detail > 1) return;
    clickTimer = setTimeout(() => {
      clickTimer = null;
      const isEntry = row.dataset.row === "entry";
      const item = (isEntry ? data.entries : data.reprimands).find((x) => x.id === row.dataset.id);
      if (item) showPopover(isEntry ? entryInfo(item) : reprimandInfo(item), row);
    }, isMobile() ? 0 : 250);
    return;
  }

  const t = ev.target.closest("[data-action]");
  if (!t) return;
  const a = t.dataset.action;
  const s = data.settings;
  switch (a) {
    case "close": closeOverlay(); break;
    case "sync-pair": showPairDialog(); break;
    case "whats-new": showWhatsNew(); break;
    case "check-updates": checkForUpdates({ manual: true }); break;
    case "update-download": openRelease(t.dataset.url); break;
    case "update-install": installUpdate(); break;
    case "start-tour": case "intro-tour": startAppTour(); break;
    case "intro-skip": closeOverlay(); break;
    case "intro-sync":
      closeOverlay();
      if (S.supported()) showJoinDialog(); else importBackup().catch((err) => alert(`Couldn't import: ${err}`));
      break;
    case "sync-join": showJoinDialog(); break;
    case "sync-join-go": joinWithCode(document.getElementById("sync-code")?.value); break;
    case "sync-now": syncToastWanted = true; S.syncNow().then((r) => { if (!r.synced) syncToastWanted = false; }); break;
    case "sync-off":
      ask("Your data stays on this device; it just stops syncing. You can pair again any time.", { title: "Turn Off Nearby Sync?", okLabel: "Turn Off", danger: true })
        .then((ok) => { if (ok) { S.unpair(); refreshSyncGroup(); } });
      break;
    case "tab": ui.tab = t.dataset.tab; render(); break;
    case "today": ui.asOverride = null; render(); break;
    case "day": ui.asOverride = asOf() + Number(t.dataset.delta); if (ui.asOverride === Day.today()) ui.asOverride = null; render(); break;
    case "calendar":
      showPopover(`<input type="date" data-bind="asOf" value="${Day.iso(asOf())}" style="width:100%"><div style="margin-top:10px;display:flex;justify-content:flex-end"><button class="btn-subtle" data-action="today-close">Today</button></div>`, t, { side: "below", width: 240 });
      break;
    case "today-close": ui.asOverride = null; closeOverlay(); render(); break;
    case "m-page": if (t.dataset.page === "leaves") ui.leaveView = null; ui.mpage = t.dataset.page; closeOverlay(); render(); document.getElementById("m-page")?.scrollTo(0, 0); break;
    case "m-add": showAddSheet(); break;
    case "m-add-step": showAddSheet(t.dataset.step); break;
    case "m-new":
      closeOverlay();
      openEntryEditor({ id: uuid(), date: Day.iso(asOf()), type: t.dataset.type, note: "", stringMode: "auto", otherLabel: "", otherPoints: 0, otherBreaksString: true, created: stamp() });
      break;
    case "m-card": {
      ui.cardIndex = Number(t.dataset.index);
      document.getElementById("m-cards")?.scrollToCard?.(ui.cardIndex);
      break;
    }
    case "m-cal-day": ui.calSelected = Number(t.dataset.day); render(); break;
    case "about": showAbout(); break;
    case "leave-confirm": {
      const trig = data.entries.find((e) => e.id === t.dataset.id);
      if (!trig) break;
      const l = { ...newLeaveDraft(), triggerEntryId: trig.id, startDate: occurrenceStart(trig.id) ?? trig.date, triggerDate: trig.date, status: "Approved" };
      touchLeave(l);
      data.leaves.push(l);
      persist();
      goToLeave(l.id);
      break;
    }
    case "leave-dismiss": data.confirmations.leaveDismissed.push(t.dataset.id); save(); break;
    case "leave-edit": goToLeave(t.dataset.id); break;
    case "leave-page": ui.leaveView = null; goToLeave(null); break;
    case "leave-history": ui.leaveView = "history"; render(); break;
    case "leave-new": openLeaveDetails(newLeaveDraft(), true); break;
    case "leave-details": { const l = data.leaves.find((x) => x.id === t.dataset.id); if (l) openLeaveDetails(l); break; }
    case "ld-save": {
      const l = overlay.draft;
      if (document.querySelector("#overlay .time-text.invalid")) { alert("The shift time couldn't be read. Try 7:00 AM, 7am or 15:30."); break; }
      if (!l.startDate) { alert("Choose the start date."); break; }
      if (!l.triggerDate) l.triggerDate = l.startDate;
      if (!l.returnDate) { delete l.returnDate; delete l.returnShiftStart; }
      touchLeave(l);
      const i = data.leaves.findIndex((x) => x.id === l.id);
      i >= 0 ? (data.leaves[i] = l) : data.leaves.push(l);
      const isNew = overlay.isNew;
      closeOverlay();
      persist();
      isNew ? goToLeave(l.id) : render();
      break;
    }
    case "leave-delete": {
      const l = data.leaves.find((x) => x.id === t.dataset.id);
      if (!l) break;
      ask("This deletes the medical leave record, its documents and reminders. The call-ins themselves stay.", { title: "Delete Medical Leave?", okLabel: "Delete", danger: true }).then((ok) => {
        if (!ok) return;
        deleteFiles((l.attachments ?? []).map((a) => a.file));
        data.leaves = data.leaves.filter((x) => x.id !== l.id);
        if (ui.leaveView === l.id) ui.leaveView = null;
        closeOverlay(); save();
      });
      break;
    }
    case "leave-notes": { const l = data.leaves.find((x) => x.id === t.dataset.id); if (l) openLeaveNotes(l); break; }
    case "notes-save": {
      const l = data.leaves.find((x) => x.id === t.dataset.id);
      if (l) { l.note = document.getElementById("leave-notes").value; touchLeave(l); }
      closeOverlay(); save();
      break;
    }
    case "doc-upload": { const l = data.leaves.find((x) => x.id === t.dataset.id); if (l) uploadLeaveDocs(l).catch((err) => alert(err)); break; }
    case "doc-menu": {
      const l = data.leaves.find((x) => x.id === t.dataset.leave), doc = l?.attachments.find((x) => x.file === t.dataset.file);
      if (!doc) break;
      const item = (on, label, attrs) => `<button ${attrs}><span class="check">${on ? "✓" : ""}</span>${label}</button>`;
      const ref = `data-leave="${l.id}" data-file="${esc(doc.file)}"`;
      showPopover(`
        ${item(false, "Open", `data-action="open-attachment" data-file="${esc(doc.file)}"`)}
        ${item(false, "Rename…", `data-action="doc-rename" ${ref}`)}
        <hr><h4>Type</h4>
        ${DOC_TYPES.map((ty) => item(doc.docType === ty, esc(ty), `data-action="doc-type" data-type="${esc(ty)}" ${ref}`)).join("")}
        <hr>${item(false, `<span class="red">Delete…</span>`, `data-action="doc-delete" ${ref}`)}`, t, { side: "below", width: 220, menu: true });
      break;
    }
    case "doc-type": case "doc-rename": case "doc-delete": {
      const l = data.leaves.find((x) => x.id === t.dataset.leave), doc = l?.attachments.find((x) => x.file === t.dataset.file);
      if (!doc) break;
      closeOverlay();
      if (a === "doc-rename") { showRenameDoc(l, doc); break; }
      if (a === "doc-delete") {
        ask(`"${doc.name}" will be removed from this leave.`, { title: "Delete Document?", okLabel: "Delete", danger: true }).then((ok) => {
          if (!ok) return;
          deleteFiles([doc.file]);
          l.attachments = l.attachments.filter((x) => x !== doc);
          touchLeave(l); save();
        });
        break;
      }
      doc.docType = t.dataset.type;
      touchLeave(l); save();
      break;
    }
    case "doc-rename-save": {
      const l = data.leaves.find((x) => x.id === t.dataset.leave), doc = l?.attachments.find((x) => x.file === t.dataset.file);
      const n = document.getElementById("doc-name")?.value.trim();
      if (!doc || !n) break;
      doc.name = n;
      closeOverlay(); touchLeave(l); save();
      break;
    }
    case "reminder-add": { const l = data.leaves.find((x) => x.id === t.dataset.id); if (l) openReminder(l); break; }
    case "reminder-edit": {
      const l = data.leaves.find((x) => x.id === t.dataset.leave), r = l?.reminders.find((x) => x.id === t.dataset.id);
      if (r) openReminder(l, r);
      break;
    }
    case "reminder-save": {
      const l = data.leaves.find((x) => x.id === overlay.leaveId);
      const label = document.getElementById("rem-label").value.trim(), date = document.getElementById("rem-date").value;
      if (!label || !date) { alert("Add what the reminder is for and its date."); break; }
      const r = l.reminders.find((x) => x.id === overlay.remId);
      if (r) Object.assign(r, { label, date }); else l.reminders.push({ id: uuid(), label, date });
      touchLeave(l); closeOverlay(); save();
      break;
    }
    case "reminder-delete": {
      const l = data.leaves.find((x) => x.id === overlay.leaveId);
      l.reminders = l.reminders.filter((x) => x.id !== overlay.remId);
      touchLeave(l); closeOverlay(); save();
      break;
    }
    case "lc-scroll": {
      const track = document.getElementById("lc-track");
      track?.scrollBy({ left: Number(t.dataset.dir) * (track.clientWidth * 0.8), behavior: "smooth" });
      break;
    }
    case "leave-return": { const l = data.leaves.find((x) => x.id === t.dataset.id); if (l) showReturnToWork(l); break; }
    case "leave-return-save": {
      const l = data.leaves.find((x) => x.id === t.dataset.id);
      const date = document.getElementById("return-date").value;
      const time = parseTime(document.getElementById("return-time").value);
      if (!l || !date) { alert("Choose the date of your first shift back."); break; }
      if (time === null) { alert("That shift time couldn't be read. Try 7:00 AM, 7am or 15:30."); break; }
      l.returnDate = date;
      if (time) l.returnShiftStart = time; else delete l.returnShiftStart;
      // Returning to work closes the sick occurrence (hidden "Worked / Returned" entry).
      data.entries.push({ id: uuid(), date, type: "worked", note: "Returned from medical leave", stringMode: "auto", otherLabel: "", otherPoints: 0,
        otherBreaksString: true, created: stamp(), leaveId: l.id, ...(time ? { shiftStart: time } : {}) });
      closeOverlay(); save();
      break;
    }
    case "update-now": location.reload(); break;
    case "update-dismiss": dismissedUpdate = document.getElementById("update-notice")?.dataset.version ?? null; document.getElementById("update-notice")?.remove(); break;
    case "page": if (t.dataset.page === "leaves") ui.leaveView = null; ui.page = t.dataset.page; ui.expanded = null; closeOverlay(); render(); break;
    case "expand": ui.expanded = t.dataset.table; render(); break;
    case "collapse": ui.expanded = null; render(); break;
    case "cal-nav": ui.calMonth = Day.addMonths(ui.calMonth ?? monthStart(asOf()), Number(t.dataset.delta)); render(); break;
    case "cal-today": ui.calMonth = monthStart(Day.today()); ui.calSelected = Day.today(); render(); break;
    case "reload": load().then(() => { render(); startAutosave(); }); break;
    case "set-sort": ui.newestFirst = t.dataset.value === "new"; closeOverlay(); render(); break;
    case "more-menu": {
      const item = (on, label, attrs) => `<button ${attrs}><span class="check">${on ? "✓" : ""}</span>${label}</button>`;
      showPopover(`<h4>Sort</h4>
        ${item(ui.newestFirst, "Newest first", `data-action="set-sort" data-value="new"`)}
        ${item(!ui.newestFirst, "Oldest first", `data-action="set-sort" data-value="old"`)}
        ${tauri ? `<hr><h4>Backup</h4>${item(false, "Export Backup…", `data-action="export"`)}${item(false, "Import Backup…", `data-action="import"`)}` : ""}`,
        t, { side: "below", width: 220, menu: true });
      break;
    }
    case "expire-details": {
      const ev2 = E.evaluate(data, asOf()), g = ev2.activeGroup;
      if (!g) break;
      const rows = g.reprimands.map((r, i) => line(`Reprimand ${i + 1}`, `Signed ${Day.short(Day.parse(r.signedDate))}<br><span class="muted">${thresholdText(r, ev2.settings)} · own expiration ${Day.short(E.ownExpiry(r, ev2.settings))}</span>`)).join("");
      showPopover(`<b class="head">Reprimands in effect</b>
        <div class="muted" style="margin:4px 0 8px">All ${g.reprimands.length} expire together on ${Day.long(g.expires)}, one ${ev2.settings.reprimandMonths === 12 ? "year" : `${ev2.settings.reprimandMonths} months`} after the newest was signed.</div>
        ${rows}`, t, { side: "below", width: 360 });
      break;
    }
    case "exit-fullscreen": tauri?.window?.getCurrentWindow().setFullscreen(false); break;
    case "sort": ui.newestFirst = !ui.newestFirst; render(); break;
    case "filter-menu": filterMenu(t); break;
    case "set-window": ui.windowFilter = Number(t.dataset.days); closeOverlay(); render(); break;
    case "set-filter": ui.filter = t.dataset.filter; closeOverlay(); render(); break;
    case "clear-filters": ui.filter = "all"; ui.windowFilter = 0; closeOverlay(); render(); break;
    case "add-entry":
      openEntryEditor({ id: uuid(), date: Day.iso(asOf()), type: "callSick", note: "", stringMode: "auto", otherLabel: "", otherPoints: 0, otherBreaksString: true, created: stamp() });
      break;
    case "record": {
      const earned = E.evaluate(data, asOf()).windows.find((w) => w.earned);
      const days = Number(t.dataset.rule) || (t.dataset.prefill ? 0 : earned?.rule.days ?? 0);
      openReprimandEditor(newReprimand(days, !!t.dataset.prefill));
      break;
    }
    case "edit": {
      const isEntry = t.dataset.kind === "entry";
      const item = (isEntry ? data.entries : data.reprimands).find((x) => x.id === t.dataset.id);
      closeOverlay();
      isEntry ? openEntryEditor(item) : openReprimandEditor(item);
      break;
    }
    case "delete": confirmDelete(t.dataset.kind, t.dataset.id); break;
    case "confirm-delete": {
      const id = t.dataset.id;
      const gone = (t.dataset.kind === "entry" ? data.entries : data.reprimands).find((x) => x.id === id);
      deleteFiles((gone?.attachments ?? []).map((a) => a.file));
      if (t.dataset.kind === "entry") {
        for (const l of data.leaves.filter((x) => x.triggerEntryId === id)) deleteFiles((l.attachments ?? []).map((a) => a.file));
        data.leaves = data.leaves.filter((x) => x.triggerEntryId !== id);
      }
      if (t.dataset.kind === "entry") {
        data.entries = data.entries.filter((e) => e.id !== id);
        for (const r of data.reprimands) r.pointEntryIDs = (r.pointEntryIDs ?? []).filter((x) => x !== id);
      } else data.reprimands = data.reprimands.filter((r) => r.id !== id);
      closeOverlay(); save();
      break;
    }
    case "save-entry": {
      const bad = document.querySelector("#overlay .time-text.invalid");
      if (bad) { bad.focus(); alert("One of the times couldn't be read. Try a format like 7:00 AM, 7am or 15:30."); break; }
      const e = overlay.entry, i = data.entries.findIndex((x) => x.id === e.id);
      deleteFiles(overlay.removed); overlay.added = [];
      i >= 0 ? (data.entries[i] = e) : data.entries.push(e);
      closeOverlay(); save();
      break;
    }
    case "save-rep": {
      const r = overlay.rep, i = data.reprimands.findIndex((x) => x.id === r.id);
      deleteFiles(overlay.removed); overlay.added = [];
      if (!r.expirationOverride) delete r.expirationOverride;
      i >= 0 ? (data.reprimands[i] = r) : data.reprimands.push(r);
      closeOverlay(); save();
      break;
    }
    case "rep-suggest": overlay.rep.pointEntryIDs = E.suggestedPoints(data, overlay.rep.ruleDays, Day.parse(overlay.rep.signedDate), overlay.rep.id); renderReprimandEditor(); break;
    case "rep-clear": overlay.rep.pointEntryIDs = []; renderReprimandEditor(); break;
    case "pref": setPref(t.dataset.key, t.dataset.value); if (t.dataset.key === START_CARD) ui.cardIndex = null; applyAppearance(); render(); renderSettings(); break;
    case "add-rule": s.rules.push({ id: uuid(), days: 30, threshold: 3 }); save(); renderSettings(); break;
    case "remove-rule": s.rules.splice(Number(t.dataset.index), 1); save(); renderSettings(); break;
    case "restore-rules": data.settings = E.defaultSettings(); save(); startAutosave(); break;
    case "add-attachment": pickAttachments().catch((err) => alert(err)); break;
    case "open-attachment": openAttachment(t.dataset.file).catch((err) => alert(`Couldn't open it: ${err}`)); break;
    case "remove-attachment": {
      const ed = editing();
      if (!ed) break;
      const file = t.dataset.file;
      ed.item.attachments = (ed.item.attachments ?? []).filter((a) => a.file !== file);
      // New this edit: delete now. Already saved: delete only when the edit is saved.
      if (overlay.added.includes(file)) { overlay.added = overlay.added.filter((f) => f !== file); deleteFiles([file]); }
      else overlay.removed.push(file);
      ed.rerender();
      break;
    }
    case "submitted-now": overlay.entry.submittedAt = nowLocal(); renderEntryEditor(); break;
    case "confirm-drop": data.confirmations.dropOffs.push(t.dataset.key); save(); break;
    case "confirm-expiry": data.confirmations.expirations.push(t.dataset.key); save(); break;
    case "export": closeOverlay(); exportBackup().catch((err) => alert(err)); break;
    case "import": closeOverlay(); importBackup().catch((err) => alert(`Couldn't import: ${err}`)); break;
    case "reset-sample":
      loadSample().then((d) => {
        data = { ...d, settings: E.defaultSettings() };
        data.confirmations ??= {}; data.confirmations.dropOffs ??= []; data.confirmations.expirations ??= [];
        data.confirmations.leaveDismissed ??= []; data.leaves ??= [];
        normalizeLeaves();
        save(); renderSettings();
      });
      break;
  }
});

document.addEventListener("dblclick", (ev) => {
  const row = ev.target.closest("[data-row]");
  const calDay = ev.target.closest("[data-calday]");
  if (!row && calDay) {
    openEntryEditor({ id: uuid(), date: Day.iso(Number(calDay.dataset.calday)), type: "callSick", note: "", stringMode: "auto", otherLabel: "", otherPoints: 0, otherBreaksString: true, created: stamp() });
    return;
  }
  if (!row) return;
  clearTimeout(clickTimer);
  if (row.dataset.row === "entry") openEntryEditor(data.entries.find((e) => e.id === row.dataset.id));
  else openReprimandEditor(data.reprimands.find((r) => r.id === row.dataset.id));
});

document.addEventListener("contextmenu", (ev) => {
  const row = ev.target.closest("[data-row]");
  if (!row) return;
  ev.preventDefault();
  const kind = row.dataset.row;
  showPopover(`<button data-action="edit" data-kind="${kind}" data-id="${row.dataset.id}">Edit…</button>
    <button data-action="delete" data-kind="${kind}" data-id="${row.dataset.id}">Delete…</button>`,
    { x: ev.clientX, y: ev.clientY, getBoundingClientRect: () => ({}) }, { side: "point", width: 160, menu: true });
});

// Form fields in dialogs. Selects, dates and checkboxes re-render the dialog (they change the preview);
// text fields just update the draft so typing isn't interrupted.
document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.dataset.bind === "asOf") { if (el.value) { const d = Day.parse(el.value); ui.asOverride = d === Day.today() ? null : d; render(); } return; }
  if (el.dataset.setting) {
    let v = Number(el.value);
    if (Number.isNaN(v)) return;
    if (el.dataset.setting === "autosaveSeconds") v = Math.max(AUTOSAVE_MIN_SECONDS, Math.round(v));
    data.settings[el.dataset.setting] = v;
    save();
    if (el.dataset.setting === "autosaveSeconds") startAutosave();
    return;
  }
  if (el.dataset.rule !== undefined) {
    const v = Number(el.value);
    if (!Number.isNaN(v)) { data.settings.rules[Number(el.dataset.rule)][el.dataset.key] = v; save(); }
    return;
  }
  if (el.dataset.point && overlay?.kind === "rep") {
    const ids = overlay.rep.pointEntryIDs;
    overlay.rep.pointEntryIDs = el.checked ? [...ids, el.dataset.point] : ids.filter((x) => x !== el.dataset.point);
    renderReprimandEditor();
    return;
  }
  if (overlay?.kind === "leaveDetails" && (el.dataset.ld || el.dataset.ldTime)) {
    const l = overlay.draft;
    if (el.dataset.ldTime) {
      const t = parseTime(el.value);
      el.classList.toggle("invalid", t === null);
      if (t === null) return;
      el.value = fmtTime(t);
      if (t) l[el.dataset.ldTime] = t; else delete l[el.dataset.ldTime];
    } else l[el.dataset.ld] = el.value;
    return;
  }
  if (el.matches("[data-leave-sort]")) { ui.leaveSort = el.value; render(); return; }
  if (el.id === "return-time") { const t = parseTime(el.value); el.classList.toggle("invalid", t === null); if (t) el.value = fmtTime(t); return; }
  if ((el.dataset.time || el.dataset.submit) && overlay?.kind === "entry") {
    const e = overlay.entry;
    if (el.classList.contains("time-text")) {
      const t = parseTime(el.value);
      el.classList.toggle("invalid", t === null);
      el.title = t === null ? "Couldn't read this time. Try 7:00 AM, 7am or 15:30." : "";
      if (t === null) return;
      el.value = fmtTime(t);
      if (el.dataset.time) { if (t) e[el.dataset.time] = t; else delete e[el.dataset.time]; return; }
    }
    // Submission: date (defaults to the call-in date) + optional time.
    const root = el.closest(".field");
    const date = root.querySelector('[data-submit="date"]').value;
    const time = parseTime(root.querySelector('[data-submit="time"]').value);
    if (time === null) return;
    if (date || time) e.submittedAt = time ? `${date || e.date}T${time}` : date;
    else delete e.submittedAt;
    return;
  }
  const key = el.dataset.bind;
  if (!key || !overlay) return;
  if (overlay.kind === "entry") {
    const e = overlay.entry;
    if (key === "override") e.pointsOverride = el.checked ? (E.run([...data.entries.filter((x) => x.id !== e.id), e], data.settings).evals.get(e.id)?.basePoints ?? 0) : null;
    else if (key === "otherBreaksString") e.otherBreaksString = el.checked;
    else if (key === "pointsOverride" || key === "otherPoints") e[key] = Number(el.value) || 0;
    else e[key] = el.value;
    if (["date", "type", "stringMode", "override", "otherPoints", "otherBreaksString"].includes(key)) renderEntryEditor();
  } else if (overlay.kind === "rep") {
    const r = overlay.rep;
    if (key === "ruleDays") r.ruleDays = Number(el.value);
    else if (key === "expOverride") r.expirationOverride = el.checked ? Day.iso(Day.addMonths(Day.parse(r.signedDate), data.settings.reprimandMonths)) : null;
    else r[key] = el.value;
    if (["signedDate", "ruleDays", "expOverride"].includes(key)) renderReprimandEditor();
  }
});

document.addEventListener("input", (ev) => {
  const el = ev.target, key = el.dataset.bind;
  if (overlay?.kind === "leaveDetails" && el.dataset.ld) { overlay.draft[el.dataset.ld] = el.value; return; }
  if (el.matches("[data-leave-search]")) {
    ui.leaveSearch = el.value;
    const pos = el.selectionStart;
    render();
    const again = document.querySelector("[data-leave-search]");
    again?.focus(); again?.setSelectionRange(pos, pos);
    return;
  }
  if (!overlay || !key || el.tagName === "SELECT" || el.type === "checkbox" || el.type === "date") return;
  if (overlay.kind === "entry") overlay.entry[key] = el.type === "number" ? Number(el.value) || 0 : el.value;
  else if (overlay.kind === "rep") overlay.rep[key] = el.value;
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    // Close the top-most thing: the file viewer, a pop-up or dialog, then the expanded table.
    if (V.closeViewer()) return;
    if (document.getElementById("overlay").innerHTML) closeOverlay();
    else if (ui.expanded) { ui.expanded = null; render(); }
  }
  // In the app, the menu bar's File → Save handles ⌘S / Ctrl+S. This covers the browser preview.
  if (!tauri && (ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "s") {
    ev.preventDefault();
    manualSave();
  }
});
tauri?.event?.listen("menu-save", () => manualSave());
tauri?.event?.listen("menu-about", () => showAbout());

// Paste a screenshot from the clipboard into the open editor.
document.addEventListener("paste", (ev) => {
  if (!editing()) return;
  const files = [...(ev.clipboardData?.items ?? [])].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter(Boolean);
  if (!files.length) return;
  ev.preventDefault();
  if (!tauri) { storeWebFiles(files, editing().pdf, !!editing().any).then(addAttachments); return; }
  Promise.all(files.map((f) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(f);
  }))).then(async (b64s) => {
    const added = [];
    for (const dataBase64 of b64s) {
      try { added.push(await tauri.core.invoke("save_attachment_bytes", { name: `Pasted image ${nowLocal().replace("T", " ")}.png`, dataBase64 })); }
      catch (err) { alert(err); }
    }
    addAttachments(added);
  });
});

// Drag image (or PDF) files onto the window while an editor is open.
tauri?.webview?.getCurrentWebview?.().onDragDropEvent((event) => {
  if (event.payload.type === "drop" && editing()) importPaths(event.payload.paths ?? []);
});

let lastSide = null;
let lastMobile = isMobile();
addEventListener("resize", async () => {
  if (isMobile() !== lastMobile) { lastMobile = isMobile(); return render(); }
  if (isMobile()) return;
  if (tauri?.window) ui.fullscreen = await tauri.window.getCurrentWindow().isFullscreen().catch(() => false);
  const side = sideBySide();
  if (side !== lastSide || tauri?.window) { lastSide = side; render(); }
  else updateRepExpand();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyAppearance);

// Home Screen (web) version: offline support and update notices. Skipped on desktop and on plain http
// (local testing), except http://localhost/?sw for testing the update flow.
const swAllowed = location.protocol === "https:" || (location.hostname === "localhost" && new URLSearchParams(location.search).has("sw"));
if (!tauri && "serviceWorker" in navigator && swAllowed) setupUpdates();

/**
 * Checks for a newer version when the app opens, comes back to the foreground, and every 30 minutes.
 * The new version downloads in the background; when it's ready, a notice asks to close and reopen.
 */
async function setupUpdates() {
  const sw = navigator.serviceWorker;
  const hadVersion = !!sw.controller; // false on the very first install: no notice then
  let reg;
  try { reg = await sw.register("sw.js"); } catch { return; }
  sw.addEventListener("controllerchange", () => { if (hadVersion) showUpdateNotice(); });
  const check = () => reg.update().catch(() => {});
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  setInterval(check, 30 * 60 * 1000);
}

async function showUpdateNotice() {
  if (document.getElementById("update-notice")) return;
  const v = await fetch("version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  const n = Object.assign(document.createElement("div"), { id: "update-notice", className: "update-notice" });
  n.innerHTML = `${icon("download")}
    <div><b class="head">Update ready${v?.version ? ` · ${esc(W.versionName(v.version))} (Build ${esc(v.build)})` : ""}</b>
      <div>Close and reopen Point Tracker to finish updating.</div></div>
    <button class="btn-primary small" data-action="update-now">Update Now</button>
    <button class="update-x" data-action="update-dismiss" aria-label="Dismiss">${icon("x")}</button>`;
  document.body.append(n);
  lucide.createIcons();
}

// ---------- Desktop updates (GitHub releases) ----------
// Uses Tauri's updater: it reads latest.json from the newest published release (GitHub's file servers,
// not its rate-limited API), and installs only updates signed with the project's signing key.

const RELEASES = "https://github.com/TrueCRaysball/point-tracker/releases";
const UPDATE_CHECK_EVERY = 15 * 60 * 1000;
let dismissedUpdate = null; // a version whose notice was closed: not shown again until the next launch
let lastUpdateCheck = 0;
let pendingUpdate = null; // the updater's Update object for the version in the notice
let installing = false;

/** Opens a release page in the browser (only ever this app's own GitHub releases). */
function openRelease(url) {
  if (!url?.startsWith(`${RELEASES}/`)) url = `${RELEASES}/latest`;
  tauri.opener.openUrl(url).catch((err) => alert(`Couldn't open GitHub: ${err}`));
}

/** Desktop: looks for a newer version. manual: say so when there isn't one or GitHub can't be reached. */
async function checkForUpdates({ manual = false } = {}) {
  if (!tauri?.updater || installing) return;
  lastUpdateCheck = Date.now();
  try {
    const update = await tauri.updater.check({ timeout: 30000 });
    if (!update) {
      if (manual) toast("circle-check", `You're on the latest version (${esc(W.versionName(await appVersion()))}).`);
      return;
    }
    if (!manual && update.version === dismissedUpdate) return;
    pendingUpdate = update;
    showDesktopUpdate(await tauri.core.invoke("app_info"), update);
  } catch (err) {
    console.error("Update check failed:", err);
    if (manual) toast("wifi-off", `Couldn't check for updates. Check your internet connection and try again. <span class="muted">(${esc(String(err))})</span>`);
  }
}

function showDesktopUpdate(info, update) {
  if (overlay?.kind === "welcome") return setTimeout(() => showDesktopUpdate(info, update), 15000); // after the intro
  document.getElementById("update-notice")?.remove();
  const page = `${RELEASES}/tag/v${update.version}`;
  const how = info.self_update ? "Install it now; Point Tracker restarts when it's done."
    : info.os === "linux" ? "Update it with your package manager, or download it from GitHub."
    : "Download it from GitHub.";
  const n = Object.assign(document.createElement("div"), { id: "update-notice", className: "update-notice" });
  n.dataset.version = update.version;
  n.innerHTML = `${icon("download")}
    <div><b class="head">${/^\d/.test(W.versionName(update.version)) ? "Version " : ""}${esc(W.versionName(update.version))} is available</b>
      <div class="update-text">You have ${esc(W.versionName(info.version))}. ${how} Your records stay just as they are.</div></div>
    ${info.self_update ? `<button class="btn-primary small" data-action="update-install">Install Update</button>`
      : `<button class="btn-primary small" data-action="update-download" data-url="${esc(page)}">View on GitHub</button>`}
    <button class="update-x" data-action="update-dismiss" aria-label="Not now">${icon("x")}</button>`;
  document.body.append(n);
  lucide.createIcons();
}

/** Downloads and installs the update in the notice, then restarts (Windows' installer restarts it itself). */
async function installUpdate() {
  const n = document.getElementById("update-notice");
  if (!pendingUpdate || !n || installing) return;
  installing = true;
  const head = n.querySelector(".head"), text = n.querySelector(".update-text");
  n.querySelectorAll("button").forEach((b) => b.remove());
  head.textContent = `Updating to ${W.versionName(pendingUpdate.version)}…`;
  text.textContent = "Downloading…";
  try {
    // Make sure everything is on disk before the app is replaced.
    await tauri.core.invoke("save_data", { json: JSON.stringify(data, null, 2) });
    let total = 0, got = 0;
    await pendingUpdate.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        text.textContent = total ? `Downloading… ${Math.min(100, Math.round((got / total) * 100))}%` : "Downloading…";
      } else if (ev.event === "Finished") text.textContent = "Installing…";
    });
    text.textContent = "Restarting…";
    await tauri.process.relaunch();
  } catch (err) {
    installing = false;
    head.textContent = "The update didn't install";
    text.textContent = `${err}. You can try again later or download it from GitHub.`;
    n.insertAdjacentHTML("beforeend", `<button class="btn-primary small" data-action="update-download" data-url="${esc(`${RELEASES}/tag/v${pendingUpdate.version}`)}">View on GitHub</button>
      <button class="update-x" data-action="update-dismiss" aria-label="Close">${icon("x")}</button>`);
    lucide.createIcons();
  }
}

/** Checks a few seconds after opening, then every 15 minutes (and on coming back after that long). */
function setupDesktopUpdates() {
  setTimeout(() => checkForUpdates(), 5000);
  setInterval(() => checkForUpdates(), UPDATE_CHECK_EVERY);
  addEventListener("focus", () => { if (Date.now() - lastUpdateCheck > UPDATE_CHECK_EVERY) checkForUpdates(); });
}

await load();
if (env.migrated) persist(); // first launch: copy the Mac app's records into this app's own file
document.title = env.demo ? "Point Tracker Demo" : "Point Tracker";
applyAppearance();
render();
startAutosave();
lastSide = sideBySide();
initSync();
if (tauri) setupDesktopUpdates();
maybeShowIntro().then((shown) => { if (!shown) maybeShowWhatsNew(); });
