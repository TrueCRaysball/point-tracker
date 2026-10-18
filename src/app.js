import * as E from "./engine.js";
import * as WS from "./webstore.js";

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
  else if (env.demo) data = await (await fetch("sample-data.json")).json();
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
}
function persist() {
  data.updatedAt = stamp();
  const json = JSON.stringify(data, null, 2);
  if (tauri) tauri.core.invoke("save_data", { json }).catch((err) => alert(`Couldn't save: ${err}`));
  else WS.setData(webKey(), json).catch((err) => alert(`Couldn't save: ${err}`));
}
function save() {
  persist();
  render();
}

// ---------- Attachments ----------

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic"];
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", heic: "image/heic" };
const thumbCache = new Map();

/** Thumbnails/links for a list of attachments. Images load after render (see hydrateThumbs). */
function attachmentList(list, { removable = false } = {}) {
  if (!list?.length) return "";
  return `<div class="attachments">${list.map((a) => `
    <div class="att" title="${esc(a.name)}">
      <button class="att-open" data-action="open-attachment" data-file="${esc(a.file)}">
        ${a.kind === "image" ? `<img data-thumb="${esc(a.file)}" alt="">`
          : a.kind === "pdf" ? `<span class="att-pdf">${icon("file-text")}<span>PDF</span></span>`
          : `<span class="att-pdf att-file">${icon("file")}<span>${esc((a.name.split(".").pop() || "FILE").toUpperCase().slice(0, 5))}</span></span>`}
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
  for (const img of root.querySelectorAll("img[data-thumb]")) img.src = await thumbSrc(img.dataset.thumb);
}

function deleteFiles(files) {
  for (const file of files) {
    if (tauri) tauri.core.invoke("delete_attachment", { file }).catch(() => {});
    else WS.deleteFile(file).catch(() => {});
    thumbCache.delete(file);
  }
}

/** Opens an attachment: desktop uses the system viewer; web shows it in the app. */
async function openAttachment(file) {
  if (tauri) return tauri.core.invoke("open_attachment", { file });
  const blob = await WS.getFile(file);
  if (!blob) return alert("That file couldn't be found.");
  const att = [...data.entries, ...data.reprimands, ...(data.leaves ?? [])].flatMap((x) => x.attachments ?? []).find((a) => a.file === file);
  const url = URL.createObjectURL(blob);
  const isPdf = blob.type === "application/pdf" || file.endsWith(".pdf");
  if (att?.kind === "file") {
    const f = new File([blob], att.name, { type: blob.type });
    if (navigator.canShare?.({ files: [f] })) return navigator.share({ files: [f] }).catch(() => {});
    return Object.assign(document.createElement("a"), { href: url, download: att.name }).click();
  }
  showViewer(`
    <div class="viewer-head"><b class="head">${esc(att?.name ?? file)}</b><span class="spacer"></span>
      ${navigator.canShare ? `<button class="btn-subtle small" data-action="share-attachment" data-file="${esc(file)}">${icon("share")} Share</button>` : ""}
      <button class="btn-subtle small" data-action="close-viewer">${icon("x")} Close</button></div>
    ${isPdf ? `<iframe class="viewer-body" src="${url}"></iframe>` : `<img class="viewer-body" src="${url}" alt="">`}`);
}

async function shareAttachment(file) {
  const blob = await WS.getFile(file);
  const att = [...data.entries, ...data.reprimands, ...(data.leaves ?? [])].flatMap((x) => x.attachments ?? []).find((a) => a.file === file);
  const f = new File([blob], att?.name ?? file, { type: blob.type });
  if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f] }).catch(() => {});
}

/** The item being edited (entry or reprimand) and whether it takes PDFs. */
const editing = () => overlay?.kind === "entry" ? { item: overlay.entry, pdf: false, rerender: renderEntryEditor }
  : overlay?.kind === "rep" ? { item: overlay.rep, pdf: true, rerender: renderReprimandEditor }
  : overlay?.kind === "leave" ? { item: overlay.leave, pdf: true, any: true, rerender: renderLeaveEditor } : null;

function addAttachments(list) {
  const ed = editing();
  if (!ed || !list.length) return;
  ed.item.attachments = [...(ed.item.attachments ?? []), ...list];
  overlay.added.push(...list.map((a) => a.file));
  ed.rerender();
}

const extOf = (name) => (name.split(".").pop() || "").toLowerCase();
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
      <div>Version ${esc(info.version)} (Build ${esc(info.build)})</div>
      <div class="muted">${esc(info.copyright)}</div>
      <div class="muted small">Not affiliated with or endorsed by The Walt Disney Company (TWDC).</div>
      <button class="btn-primary" data-action="close">OK</button>
    </div>`);
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
  const body = ui.page === "calendar" ? calendarPage(ev) : ui.page === "settings" ? settingsPage() : overviewPage(ev);
  document.getElementById("app").innerHTML = `${hero()}<main class="page page-${ui.page}">${body}</main>${footer()}${ui.expanded ? expandedTable(ev) : ""}`;
  lucide.createIcons();
  updateRepExpand();
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
  const nav = [["overview", "house", "Overview"], ["calendar", "calendar-days", "Calendar"], ["settings", "settings", "Settings"]];
  return `
  <div class="hero" data-tauri-drag-region>
    <div class="hero-art" data-tauri-drag-region></div>
    <div class="header ${IS_MAC && !ui.fullscreen ? "mac-lights" : ""}" data-tauri-drag-region>
      <img class="logo" src="vendor/logo.png" alt="" draggable="false">
      <div data-tauri-drag-region>
        <div class="title">Point Tracker</div>
        <div class="subtitle">Attendance Points and Reprimands</div>
      </div>
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

/** Call-ins that went past the occurrence limit (one per occurrence), up to the viewed date. */
function leaveTriggers(ev) {
  const max = ev.settings.maxSickString;
  return ev.entries.filter((e) => {
    const x = ev.evals.get(e.id);
    return x?.medicalLeave && x.stringPosition === max + 1 && Day.parse(e.date) <= ev.asOf;
  });
}
const leaveFor = (entryId) => data.leaves.find((l) => l.triggerEntryId === entryId);
const onLeaveNow = (l, asOfDay) => Day.parse(l.startDate) <= asOfDay && (!l.returnDate || Day.parse(l.returnDate) > asOfDay);
/** How long an unconfirmed trigger keeps asking (days). */
const LEAVE_CONFIRM_DAYS = 60;

function leaveBanners(ev) {
  const out = [];
  for (const t of leaveTriggers(ev)) {
    if (leaveFor(t.id) || data.confirmations.leaveDismissed.includes(t.id) || ev.asOf - Day.parse(t.date) > LEAVE_CONFIRM_DAYS) continue;
    out.push(`<div class="banner c-red">${icon("hospital")}<span><b>Medical leave triggered:</b> call-in ${ev.settings.maxSickString + 1} of a sick occurrence on ${Day.long(Day.parse(t.date))}. Confirm once it's official.</span>
      <span class="spacer"></span><span class="banner-actions">
      <button class="btn-subtle" data-action="leave-dismiss" data-id="${t.id}" title="It didn't become a medical leave">Dismiss</button>
      <button class="btn-primary small" data-action="leave-confirm" data-id="${t.id}">${icon("check")} Confirm Medical Leave</button></span></div>`);
  }
  for (const l of data.leaves.filter((l) => onLeaveNow(l, ev.asOf))) {
    const day = ev.asOf - Day.parse(l.startDate) + 1, docs = l.attachments?.length ?? 0;
    out.push(`<div class="banner c-amber">${icon("hospital")}<span><b>On medical leave</b> since ${Day.long(Day.parse(l.startDate))} · day ${day}${docs ? ` · ${docs} document${docs === 1 ? "" : "s"}` : ""}</span>
      <span class="spacer"></span><span class="banner-actions">
      <button class="btn-subtle" data-action="leave-edit" data-id="${l.id}">${icon("paperclip")} Documents</button>
      <button class="btn-primary small" data-action="leave-return" data-id="${l.id}">${icon("briefcase")} Return to Work</button></span></div>`);
  }
  return out;
}

function openLeaveEditor(leave) {
  overlay = { kind: "leave", leave: structuredClone(leave), added: [], removed: [], original: JSON.stringify(leave) };
  renderLeaveEditor();
}

function renderLeaveEditor() {
  const l = overlay.leave;
  const trigger = data.entries.find((e) => e.id === l.triggerEntryId);
  showDialog(`
    <div class="form">
      <h2>Medical Leave</h2>
      <div class="group">
        <div class="field"><span>Leave started</span><input type="date" data-leave="startDate" value="${esc(l.startDate)}"></div>
        ${trigger ? `<div class="field"><span>Triggered by</span><span>Sick call-in on ${Day.short(Day.parse(trigger.date))}</span></div>` : ""}
        <div class="field"><span>Confirmed official</span><span>${l.confirmedAt ? fmtDateTime(l.confirmedAt.slice(0, 10)) : "—"}</span></div>
        <div class="field"><span>First shift back</span><span>
          <input type="date" data-leave="returnDate" value="${esc(l.returnDate ?? "")}">
          <input type="text" class="time-text" data-leave-time="returnShiftStart" value="${esc(fmtTime(l.returnShiftStart))}" placeholder="7:00 AM"></span></div>
        <div class="note" style="padding-top:0">Leave "First shift back" empty while you're still on leave.</div>
      </div>
      <div class="group"><h3>Documentation (optional)</h3>
        <div class="field" style="flex-direction:column;align-items:stretch;gap:8px">
          <span style="display:flex;align-items:center">Any files about the leave: PDFs, images, documents<span class="spacer"></span>
            <button class="btn-subtle small" data-action="add-attachment">${icon("paperclip")} Add Files…</button></span>
          ${attachmentList(l.attachments, { removable: true })}
          ${isMobile() ? "" : `<span class="note" style="padding:0">You can also paste an image (⌘V / Ctrl+V)${tauri ? " or drag files here" : ""}.</span>`}
        </div>
        <div class="field" style="flex-direction:column;align-items:stretch"><span>Note</span><textarea rows="3" data-leave="note">${esc(l.note ?? "")}</textarea></div>
      </div>
    </div>
    <div class="dialog-actions">
      <button class="btn-subtle btn-danger" data-action="leave-remove" data-id="${l.id}">Remove Leave Record…</button>
      <span class="spacer"></span>
      <button class="btn-subtle" data-action="close">Cancel</button>
      <button class="btn-primary" data-action="save-leave">Save</button>
    </div>`, true);
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
    : page === "calendar" ? mCalendar(ev) : page === "settings" ? mSettings() : mOverview(ev);
  const app = document.getElementById("app");
  const scroll = document.getElementById("m-page")?.scrollTop ?? 0;
  app.innerHTML = `${mHeader()}<main class="m-page m-${page}" id="m-page">${body}</main>${mTabbar()}`;
  if (page === ui.lastMPage) document.getElementById("m-page").scrollTop = scroll;
  ui.lastMPage = page;
  lucide.createIcons();
  hydrateThumbs(app);
  if (page === "overview") setupCarousel();
  if (page === "settings") showVersionInSettings();
}

function mHeader() {
  const over = ui.asOverride !== null;
  const d = dayParts(asOf());
  return `
  <header class="m-header">
    <div class="hero-art"></div>
    <div class="m-head-row">
      <img class="logo" src="vendor/logo.png" alt="" draggable="false">
      <div class="m-title-wrap"><div class="title">Point Tracker</div>${env.demo ? `<span class="badge">DEMO</span>` : ""}</div>
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
    <div class="m-disclaimer">${disclaimerHTML()}</div>`;
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

/** Fills in the version on the phone's About row. */
async function showVersionInSettings() {
  const v = tauri ? await tauri.core.invoke("app_info").catch(() => null)
    : await fetch("version.json").then((r) => r.json()).catch(() => null);
  const el = document.getElementById("m-version");
  if (el && v?.version) el.textContent = `v${v.version}`;
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
function enableSwipeClose(panel, close, canClose = () => true) {
  if (!panel) return;
  let startY = null, startT = 0, dy = 0, dragging = false;
  panel.addEventListener("touchstart", (e) => {
    startY = e.touches.length === 1 && panel.scrollTop <= 0 ? e.touches[0].clientY : null;
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

/** Full-screen viewer for an attachment (web version). */
function showViewer(html) {
  document.getElementById("viewer")?.remove();
  const v = Object.assign(document.createElement("div"), { id: "viewer", className: "viewer", innerHTML: html });
  document.body.append(v);
  lucide.createIcons();
  enableSwipeClose(v, () => v.remove());
}

// ---------- Overlays ----------

function closeOverlay() {
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
    case "tab": ui.tab = t.dataset.tab; render(); break;
    case "today": ui.asOverride = null; render(); break;
    case "day": ui.asOverride = asOf() + Number(t.dataset.delta); if (ui.asOverride === Day.today()) ui.asOverride = null; render(); break;
    case "calendar":
      showPopover(`<input type="date" data-bind="asOf" value="${Day.iso(asOf())}" style="width:100%"><div style="margin-top:10px;display:flex;justify-content:flex-end"><button class="btn-subtle" data-action="today-close">Today</button></div>`, t, { side: "below", width: 240 });
      break;
    case "today-close": ui.asOverride = null; closeOverlay(); render(); break;
    case "m-page": ui.mpage = t.dataset.page; closeOverlay(); render(); document.getElementById("m-page")?.scrollTo(0, 0); break;
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
      data.leaves.push({ id: uuid(), triggerEntryId: trig.id, startDate: trig.date, confirmedAt: stamp(), attachments: [], note: "" });
      save();
      break;
    }
    case "leave-dismiss": data.confirmations.leaveDismissed.push(t.dataset.id); save(); break;
    case "leave-edit": { const l = data.leaves.find((x) => x.id === t.dataset.id); closeOverlay(); if (l) openLeaveEditor(l); break; }
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
    case "save-leave": {
      const l = overlay.leave;
      if (document.querySelector("#overlay .time-text.invalid")) { alert("The shift time couldn't be read. Try 7:00 AM, 7am or 15:30."); break; }
      if (!l.startDate) { alert("Choose when the leave started."); break; }
      deleteFiles(overlay.removed); overlay.added = [];
      const i = data.leaves.findIndex((x) => x.id === l.id);
      if (!l.returnDate) delete l.returnDate;
      i >= 0 ? (data.leaves[i] = l) : data.leaves.push(l);
      closeOverlay(); save();
      break;
    }
    case "leave-remove": {
      const l = data.leaves.find((x) => x.id === t.dataset.id);
      if (!l || !confirm("Remove this medical leave record and its documents? The call-in that triggered it stays.")) break;
      deleteFiles([...(l.attachments ?? []), ...(overlay?.leave?.attachments ?? [])].map((a) => a.file));
      data.leaves = data.leaves.filter((x) => x.id !== l.id);
      overlay.added = [];
      closeOverlay(); save();
      break;
    }
    case "update-now": location.reload(); break;
    case "update-dismiss": document.getElementById("update-notice")?.remove(); break;
    case "page": ui.page = t.dataset.page; ui.expanded = null; closeOverlay(); render(); break;
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
    case "share-attachment": shareAttachment(t.dataset.file); break;
    case "close-viewer": document.getElementById("viewer")?.remove(); break;
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
      fetch("sample-data.json").then((r) => r.json()).then((d) => {
        data = { ...d, settings: E.defaultSettings() };
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
  if (overlay?.kind === "leave" && (el.dataset.leave || el.dataset.leaveTime)) {
    const l = overlay.leave;
    if (el.dataset.leaveTime) {
      const t = parseTime(el.value);
      el.classList.toggle("invalid", t === null);
      if (t === null) return;
      el.value = fmtTime(t);
      if (t) l[el.dataset.leaveTime] = t; else delete l[el.dataset.leaveTime];
    } else l[el.dataset.leave] = el.value;
    return;
  }
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
  if (overlay?.kind === "leave" && el.dataset.leave === "note") { overlay.leave.note = el.value; return; }
  if (!overlay || !key || el.tagName === "SELECT" || el.type === "checkbox" || el.type === "date") return;
  if (overlay.kind === "entry") overlay.entry[key] = el.type === "number" ? Number(el.value) || 0 : el.value;
  else if (overlay.kind === "rep") overlay.rep[key] = el.value;
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    // Close the top-most thing: a pop-up or dialog first, then the expanded table.
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
    <div><b class="head">Update ready${v?.version ? ` · v${esc(v.version)} (Build ${esc(v.build)})` : ""}</b>
      <div>Close and reopen Point Tracker to finish updating.</div></div>
    <button class="btn-primary small" data-action="update-now">Update Now</button>
    <button class="update-x" data-action="update-dismiss" aria-label="Dismiss">${icon("x")}</button>`;
  document.body.append(n);
  lucide.createIcons();
}

await load();
if (env.migrated) persist(); // first launch: copy the Mac app's records into this app's own file
document.title = env.demo ? "Point Tracker Demo" : "Point Tracker";
applyAppearance();
render();
startAutosave();
lastSide = sideBySide();
