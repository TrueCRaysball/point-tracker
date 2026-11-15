// In-app file viewer: attachments open inside Point Tracker on every platform, with no need for
// Preview or another app. PDFs render with PDF.js, Word files with Mammoth and spreadsheets with
// SheetJS. Those libraries are in vendor/viewer and load only the first time they're needed.

const TYPES = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "heif", "svg", "avif", "ico", "tif", "tiff"],
  pdf: ["pdf"],
  word: ["docx", "docm", "dotx"],
  sheet: ["xlsx", "xlsm", "xlsb", "xls", "ods", "numbers", "csv", "tsv"],
  rtf: ["rtf"],
  text: ["txt", "text", "md", "markdown", "log", "json", "xml", "yaml", "yml", "ini", "cfg", "html", "htm", "eml", "ics", "vcf"],
  video: ["mp4", "m4v", "mov", "webm"],
  audio: ["mp3", "m4a", "aac", "wav", "ogg", "oga", "flac", "opus"],
};

export const MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
  heic: "image/heic", heif: "image/heif", svg: "image/svg+xml", avif: "image/avif", ico: "image/x-icon",
  tif: "image/tiff", tiff: "image/tiff", pdf: "application/pdf",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg",
  flac: "audio/flac", opus: "audio/ogg",
};

const extOf = (name) => (String(name).split(".").pop() || "").toLowerCase();

/** "image", "pdf", "word", "sheet", "rtf", "text", "video", "audio" or "other". */
export function fileType(name) {
  const ext = extOf(name);
  return Object.keys(TYPES).find((t) => TYPES[t].includes(ext)) ?? "other";
}

/** Icon and color for a file in lists. */
export function fileIcon(name) {
  return {
    image: ["image", "purple"], pdf: ["file-text", "red"], word: ["file-text", "blue"], sheet: ["sheet", "green"],
    rtf: ["file-text", "blue"], text: ["file-text", "teal"], video: ["file-video", "orange"], audio: ["file-audio", "amber"],
  }[fileType(name)] ?? ["file", "blue"];
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ic = (name) => `<i data-lucide="${name}"></i>`;

// ---------- Library loading ----------

const loaded = new Map();
function loadScript(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement("script"), { src });
      s.onload = () => resolve(window[global]);
      s.onerror = () => { loaded.delete(src); reject(new Error("The viewer couldn't load.")); };
      document.head.append(s);
    }));
  }
  return loaded.get(src);
}

let pdfjsPromise = null;
function loadPdfjs() {
  pdfjsPromise ??= import("./vendor/viewer/pdf.min.mjs").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL("vendor/viewer/pdf.worker.min.mjs", location.href).href;
    return lib;
  }).catch((err) => { pdfjsPromise = null; throw err; });
  return pdfjsPromise;
}

// ---------- Viewer ----------

const ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
let current = null; // { el, url, cleanup }

export function closeViewer() {
  if (!current) return false;
  current.cleanup?.();
  if (current.url) URL.revokeObjectURL(current.url);
  current.el.remove();
  current = null;
  return true;
}

export const viewerOpen = () => !!current;

/**
 * Opens a file in the viewer.
 * opts: { name, load: () => Promise<Blob|ArrayBuffer>, openExternal?, share?, download?, swipe? }
 */
export async function openViewer(opts) {
  closeViewer();
  const type = fileType(opts.name);
  // A pop-up window over the dimmed app (full screen on phones). Clicking outside closes it.
  const el = Object.assign(document.createElement("div"), { id: "viewer", className: "vw-backdrop" });
  const [fi, color] = fileIcon(opts.name);
  el.innerHTML = `<div class="viewer vw-type-${type}" role="dialog" aria-label="${esc(opts.name)}">
    <div class="viewer-head">
      <span class="vw-icon c-${color}">${ic(fi)}</span>
      <div class="vw-title"><b>${esc(opts.name)}</b><span class="vw-meta"></span></div>
      <span class="spacer"></span>
      <div class="vw-tools"></div>
      ${opts.openExternal ? `<button class="btn-subtle small vw-ext" title="Open in another app">${ic("external-link")}<span>Open With…</span></button>` : ""}
      ${opts.share ? `<button class="btn-subtle small vw-share" title="Share">${ic("share")}<span>Share</span></button>` : ""}
      ${opts.download ? `<button class="btn-subtle small vw-dl" title="Save a copy">${ic("download")}<span>Save</span></button>` : ""}
      <button class="btn-subtle small vw-close" title="Close (Esc)">${ic("x")}<span>Close</span></button>
    </div>
    <div class="vw-body"><div class="vw-loading">${ic("loader-circle")}<span>Opening…</span></div></div></div>`;
  document.body.append(el);
  el.addEventListener("mousedown", (e) => { if (e.target === el) closeViewer(); });
  const view = { el, url: null, cleanup: null };
  current = view;
  el.querySelector(".vw-close").onclick = closeViewer;
  el.querySelector(".vw-ext")?.addEventListener("click", () => opts.openExternal());
  el.querySelector(".vw-share")?.addEventListener("click", () => opts.share());
  el.querySelector(".vw-dl")?.addEventListener("click", () => opts.download());
  opts.swipe?.(el.firstElementChild, closeViewer);
  lucide.createIcons();

  const body = el.querySelector(".vw-body");
  const tools = el.querySelector(".vw-tools");
  const meta = el.querySelector(".vw-meta");
  try {
    const raw = await opts.load();
    if (current !== view) return;
    const blob = raw instanceof Blob ? raw : new Blob([raw], { type: MIME[extOf(opts.name)] ?? "" });
    const typed = blob.type || !MIME[extOf(opts.name)] ? blob : new Blob([blob], { type: MIME[extOf(opts.name)] });
    meta.textContent = [typeLabel(opts.name), sizeLabel(blob.size)].filter(Boolean).join(" · ");
    await RENDER[type](typed, { view, body, tools, meta, opts });
  } catch (err) {
    if (current !== view) return;
    console.error(err);
    unsupported(body, opts, `Point Tracker couldn't read this file. ${err?.message ?? ""}`);
  }
  lucide.createIcons();
}

function typeLabel(name) {
  const t = fileType(name);
  const ext = extOf(name).toUpperCase();
  return { pdf: "PDF document", word: "Word document", sheet: `${ext} spreadsheet`, image: `${ext} image`,
    rtf: "Rich text", text: `${ext} text`, video: `${ext} video`, audio: `${ext} audio` }[t] ?? (ext ? `${ext} file` : "File");
}

function sizeLabel(n) {
  if (!n) return "";
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function unsupported(body, opts, text) {
  const [fi, color] = fileIcon(opts.name);
  body.innerHTML = `<div class="vw-empty">
    <span class="vw-empty-icon c-${color}">${ic(fi)}</span>
    <b>${esc(opts.name)}</b>
    <p>${esc(text)}</p>
    <div class="vw-empty-actions">
      ${opts.openExternal ? `<button class="btn-primary">${ic("external-link")} Open With Another App</button>`
        : opts.share ? `<button class="btn-primary">${ic("share")} Share</button>`
        : opts.download ? `<button class="btn-primary">${ic("download")} Save a Copy</button>` : ""}
    </div></div>`;
  body.querySelector(".btn-primary")?.addEventListener("click", () => (opts.openExternal ?? opts.share ?? opts.download)());
  lucide.createIcons();
}

/** Zoom buttons. onChange(z) gets "fit" or a number (1 = 100%). */
function zoomControls(tools, onChange) {
  let z = "fit";
  tools.innerHTML = `<div class="vw-zoom">
    <button class="btn-subtle square" data-z="-" title="Zoom out">${ic("zoom-out")}</button>
    <button class="btn-subtle small vw-zlabel" data-z="fit" title="Fit to window">Fit</button>
    <button class="btn-subtle square" data-z="+" title="Zoom in">${ic("zoom-in")}</button></div>`;
  const label = tools.querySelector(".vw-zlabel");
  const set = (next) => {
    z = next;
    label.textContent = z === "fit" ? "Fit" : `${Math.round(z * 100)}%`;
    onChange(z);
  };
  tools.addEventListener("click", (e) => {
    const b = e.target.closest("[data-z]");
    if (!b) return;
    const cur = z === "fit" ? api.fitScale() : z;
    if (b.dataset.z === "fit") return set(z === "fit" ? 1 : "fit");
    const i = b.dataset.z === "+" ? ZOOMS.findIndex((s) => s > cur + 0.001) : ZOOMS.findLastIndex((s) => s < cur - 0.001);
    if (i >= 0) set(ZOOMS[i]);
  });
  const api = { set, get: () => z, fitScale: () => 1 };
  return api;
}

function sandboxFrame(html, css) {
  const frame = document.createElement("iframe");
  frame.className = "vw-frame";
  // No scripts, no navigation: the document is only displayed.
  frame.setAttribute("sandbox", "");
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`;
  return frame;
}

const PAPER_CSS = `
  html { background: #e9ecf1; }
  body { margin: 24px auto; max-width: 780px; background: #fff; color: #1d2433; padding: 56px 64px; box-shadow: 0 2px 12px rgba(0,0,0,.18);
    font: 15px/1.55 -apple-system, "Segoe UI", Calibri, Roboto, "Helvetica Neue", Arial, sans-serif; border-radius: 4px; }
  @media (max-width: 700px) { body { margin: 0; padding: 22px 18px; border-radius: 0; box-shadow: none; } }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; margin: 10px 0; }
  td, th { border: 1px solid #c9ced8; padding: 4px 8px; vertical-align: top; }
  h1, h2, h3 { line-height: 1.25; }
  a { color: #1d63d8; pointer-events: none; }
  p:empty { min-height: 1em; }`;

const SHEET_CSS = `
  html { background: #fff; }
  body { margin: 0; color: #1d2433; font: 14px/1.4 -apple-system, "Segoe UI", Calibri, Roboto, Arial, sans-serif; }
  table { border-collapse: separate; border-spacing: 0; min-width: 100%; }
  td, th { border-right: 1px solid #dde1e8; border-bottom: 1px solid #dde1e8; padding: 6px 10px; white-space: nowrap;
    max-width: 420px; overflow: hidden; text-overflow: ellipsis; }
  th { background: #f1f4f8; color: #5b6475; font-weight: 600; font-size: 12px; position: sticky; top: 0; z-index: 1; }
  th.rn, td.rn { background: #f1f4f8; color: #5b6475; font-size: 12px; text-align: center; position: sticky; left: 0; min-width: 34px; }
  th.rn { z-index: 2; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:nth-child(even) td:not(.rn) { background: #f8fafc; }
  .fill { width: 100%; border-right: 0; background: transparent !important; }`;

const colName = (i) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

/** A sheet as an HTML table with column letters and row numbers, like a spreadsheet app. */
function sheetTable(XLSX, ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "", blankrows: true });
  const cols = Math.max(1, ...rows.map((r) => r.length));
  if (!rows.length) return "<p style='padding:16px'>This sheet is empty.</p>";
  const head = `<tr><th class="rn"></th>${Array.from({ length: cols }, (_, i) => `<th>${colName(i)}</th>`).join("")}<th class="fill"></th></tr>`;
  const body = rows.map((r, ri) => `<tr><td class="rn">${ri + 1}</td>${Array.from({ length: cols }, (_, i) => {
    const v = r[i] ?? "";
    return `<td${/^-?[\d,.]+%?$|^[$€£]-?[\d,.]+$/.test(v) ? ' class="num"' : ""}>${esc(v)}</td>`;
  }).join("")}<td class="fill"></td></tr>`).join("");
  return `<table>${head}${body}</table>`;
}

const RENDER = {
  async image(blob, { view, body, tools, opts }) {
    body.innerHTML = `<div class="vw-scroll vw-center"><img class="vw-img fit" alt=""></div>`;
    const scroll = body.firstChild, img = scroll.firstChild;
    const show = (b) => new Promise((resolve) => {
      if (view.url) URL.revokeObjectURL(view.url);
      view.url = URL.createObjectURL(b);
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = view.url;
    });
    // The system draws most formats; TIFF and HEIC are converted here where it can't.
    if (!(await show(blob))) {
      const converted = await convertImage(blob, extOf(opts.name)).catch(() => null);
      if (current !== view) return;
      if (!converted || !(await show(converted))) {
        unsupported(body, opts, `This ${extOf(opts.name).toUpperCase()} image can't be shown on this device.`);
        return;
      }
    }
    if (current !== view) return;
    const natural = () => [img.naturalWidth || 800, img.naturalHeight || 600];
    const zoom = zoomControls(tools, (z) => {
      img.classList.toggle("fit", z === "fit");
      img.style.width = z === "fit" ? "" : `${natural()[0] * z}px`;
      scroll.classList.toggle("vw-center", z === "fit" || natural()[0] * z < scroll.clientWidth);
    });
    zoom.fitScale = () => Math.min(1, scroll.clientWidth / natural()[0], scroll.clientHeight / natural()[1]);
    img.addEventListener("dblclick", () => zoom.set(zoom.get() === "fit" ? 1 : "fit"));
  },

  async pdf(blob, { view, body, tools, meta }) {
    const lib = await loadPdfjs();
    const doc = await lib.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      standardFontDataUrl: new URL("vendor/viewer/standard_fonts/", location.href).href,
      isEvalSupported: false,
    }).promise;
    if (current !== view) return doc.destroy();
    const pages = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)));
    const baseMeta = meta.textContent;
    body.innerHTML = `<div class="vw-scroll vw-pages"></div>`;
    const scroll = body.firstChild;
    const slots = pages.map((page, i) => {
      const slot = Object.assign(document.createElement("div"), { className: "vw-page" });
      slot.dataset.i = i;
      scroll.append(slot);
      return slot;
    });
    const base = pages.map((p) => p.getViewport({ scale: 1 }));
    // Fit: page width fills the window, up to a comfortable reading width.
    const fitScale = () => Math.max(0.1, Math.min(...base.map((v) => Math.min(scroll.clientWidth - 32, 960) / v.width)));
    let scale = fitScale();
    const rendered = new Map(); // slot index -> scale it was drawn at
    const tasks = new Map();

    const draw = async (i) => {
      if (rendered.get(i) === scale) return;
      tasks.get(i)?.cancel();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const vp = pages[i].getViewport({ scale: scale * dpr });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      const task = pages[i].render({ canvasContext: canvas.getContext("2d"), viewport: vp });
      tasks.set(i, task);
      try { await task.promise; } catch { return; }
      tasks.delete(i);
      slots[i].replaceChildren(canvas);
      rendered.set(i, scale);
    };
    const visible = new Set();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const i = Number(e.target.dataset.i);
        if (e.isIntersecting) { visible.add(i); draw(i); } else visible.delete(i);
      }
    }, { root: scroll, rootMargin: "600px 0px" });
    const layout = () => {
      slots.forEach((slot, i) => {
        slot.style.width = `${base[i].width * scale}px`;
        slot.style.height = `${base[i].height * scale}px`;
      });
      for (const i of visible) draw(i);
    };
    layout();
    slots.forEach((s) => io.observe(s));

    const zoom = zoomControls(tools, (z) => {
      const ratio = scroll.scrollTop / Math.max(1, scroll.scrollHeight);
      scale = z === "fit" ? fitScale() : z;
      layout();
      scroll.scrollTop = ratio * scroll.scrollHeight;
    });
    zoom.fitScale = fitScale;
    const pageLabel = () => {
      const mid = scroll.scrollTop + scroll.clientHeight / 3;
      const i = Math.max(0, slots.findIndex((s) => s.offsetTop + s.offsetHeight > mid));
      meta.textContent = `${baseMeta} · Page ${i + 1} of ${pages.length}`;
    };
    pageLabel();
    scroll.addEventListener("scroll", pageLabel, { passive: true });
    const ro = new ResizeObserver(() => { if (zoom.get() === "fit") { scale = fitScale(); layout(); } });
    ro.observe(scroll);
    view.cleanup = () => { io.disconnect(); ro.disconnect(); doc.destroy(); };
  },

  async word(blob, { body }) {
    const mammoth = await loadScript("vendor/viewer/mammoth.browser.min.js", "mammoth");
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
    body.replaceChildren(sandboxFrame(value || "<p><i>This document is empty.</i></p>", PAPER_CSS));
  },

  async sheet(blob, { body, tools }) {
    const XLSX = await loadScript("vendor/viewer/xlsx.full.min.js", "XLSX");
    const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: "array", cellDates: true });
    const show = (name) => {
      body.replaceChildren(sandboxFrame(sheetTable(XLSX, wb.Sheets[name]), SHEET_CSS));
      tools.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.sheet === name));
    };
    if (wb.SheetNames.length > 1) {
      tools.innerHTML = `<div class="seg vw-sheets">${wb.SheetNames.map((n) => `<button data-sheet="${esc(n)}">${esc(n)}</button>`).join("")}</div>`;
      tools.onclick = (e) => { const b = e.target.closest("[data-sheet]"); if (b) show(b.dataset.sheet); };
    }
    show(wb.SheetNames[0]);
  },

  async rtf(blob, { body }) {
    body.innerHTML = `<div class="vw-scroll"><div class="vw-text vw-paper"></div></div>`;
    body.querySelector(".vw-text").textContent = rtfToText(await blob.text());
  },

  async text(blob, { body, opts }) {
    let text = await blob.text();
    if (extOf(opts.name) === "json") { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch {} }
    body.innerHTML = `<div class="vw-scroll"><pre class="vw-text vw-paper"></pre></div>`;
    body.querySelector(".vw-text").textContent = text;
  },

  async video(blob, ctx) { return media("video", blob, ctx); },
  async audio(blob, ctx) { return media("audio", blob, ctx); },

  async other(blob, { body, opts }) {
    unsupported(body, opts, "Point Tracker can't show this type of file.");
  },
};

/** TIFF or HEIC as a PNG/JPEG blob, for systems that can't draw them. */
async function convertImage(blob, ext) {
  if (ext === "tif" || ext === "tiff") {
    await loadScript("vendor/viewer/pako_inflate.min.js", "pako");
    const UTIF = await loadScript("vendor/viewer/UTIF.js", "UTIF");
    const buf = await blob.arrayBuffer();
    const ifds = UTIF.decode(buf).filter((d) => d.t256);
    if (!ifds.length) throw new Error("No image found.");
    // Multi-page TIFFs (faxes, scans) are stacked into one tall image.
    const pages = ifds.map((d) => { UTIF.decodeImage(buf, d); return { w: d.width, h: d.height, rgba: UTIF.toRGBA8(d) }; });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(...pages.map((p) => p.w));
    canvas.height = pages.reduce((n, p) => n + p.h, 0) + (pages.length - 1) * 16;
    const ctx = canvas.getContext("2d");
    let y = 0;
    for (const p of pages) {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(p.rgba.buffer, p.rgba.byteOffset, p.w * p.h * 4), p.w, p.h), 0, y);
      y += p.h + 16;
    }
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }
  if (ext === "heic" || ext === "heif") return heicToJpeg(blob);
  throw new Error("Unsupported image.");
}

// HEIC goes through a sandboxed frame (vendor/viewer/heic-frame.html, made by scripts/vendor.mjs): its
// converter needs to build code at run time, which the app's security policy doesn't allow. The frame
// can't reach the app, storage or network.
let heicFrame = null; // Promise of the frame's window
let heicSeq = 0;
function heicWindow() {
  heicFrame ??= new Promise((resolve, reject) => {
    const frame = Object.assign(document.createElement("iframe"), { src: "vendor/viewer/heic-frame.html", hidden: true });
    frame.setAttribute("sandbox", "allow-scripts");
    const t = setTimeout(() => { cleanup(); reject(new Error("The HEIC converter didn't load.")); }, 20000);
    const onReady = (e) => {
      if (e.source !== frame.contentWindow || !e.data?.ready) return;
      clearTimeout(t); removeEventListener("message", onReady); resolve(frame.contentWindow);
    };
    const cleanup = () => { removeEventListener("message", onReady); frame.remove(); heicFrame = null; };
    addEventListener("message", onReady);
    document.body.append(frame);
  });
  return heicFrame;
}
async function heicToJpeg(blob) {
  const win = await heicWindow();
  const id = ++heicSeq;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { removeEventListener("message", onMsg); reject(new Error("The HEIC photo took too long.")); }, 60000);
    function onMsg(e) {
      if (e.source !== win || e.data?.id !== id) return;
      clearTimeout(t);
      removeEventListener("message", onMsg);
      if (e.data.blob instanceof Blob) resolve(e.data.blob);
      else reject(new Error(e.data.error || "Couldn't convert the photo."));
    }
    addEventListener("message", onMsg);
    win.postMessage({ id, blob }, "*");
  });
}

async function media(tag, blob, { view, body, opts }) {
  view.url = URL.createObjectURL(blob);
  body.innerHTML = `<div class="vw-scroll vw-center"><${tag} class="vw-media" controls playsinline></${tag}></div>`;
  const m = body.querySelector(tag);
  m.onerror = () => unsupported(body, opts, `This ${extOf(opts.name).toUpperCase()} file can't be played on this device.`);
  m.src = view.url;
}

/** Plain text from an RTF document (good enough to read notes and letters). */
function rtfToText(rtf) {
  let out = "", depth = 0;
  const skipAt = []; // group depths whose contents are hidden (fonts, colors, pictures…)
  const hidden = /^(fonttbl|colortbl|stylesheet|info|pict|header|footer|headerl|headerr|footerl|footerr|object|themedata|colorschememapping|datastore|latentstyles|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|mmathPr)$/;
  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i];
    const skipping = skipAt.length > 0;
    if (c === "{") { depth++; continue; }
    if (c === "}") { if (skipAt.at(-1) === depth) skipAt.pop(); depth--; continue; }
    if (c === "\\") {
      const n = rtf[i + 1];
      if (n === "\\" || n === "{" || n === "}") { if (!skipping) out += n; i++; continue; }
      if (n === "\n" || n === "\r") { if (!skipping) out += "\n"; i++; continue; }
      if (n === "'") { if (!skipping) out += String.fromCharCode(parseInt(rtf.substr(i + 2, 2), 16)); i += 3; continue; }
      if (n === "*") { if (!skipping) skipAt.push(depth); i++; continue; }
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i + 1, i + 40));
      if (!m) { i++; continue; }
      i += m[0].length;
      const word = m[1];
      if (skipping) continue;
      if (hidden.test(word)) { skipAt.push(depth); continue; }
      if (word === "par" || word === "line" || word === "sect" || word === "page") out += "\n";
      else if (word === "tab" || word === "cell") out += "\t";
      else if (word === "row") out += "\n";
      else if (word === "u") { out += String.fromCharCode(((Number(m[2]) % 65536) + 65536) % 65536); if (rtf[i + 1] === "?") i++; }
      else if (word === "emdash") out += "—";
      else if (word === "endash") out += "–";
      else if (word === "bullet") out += "•";
      else if (word === "lquote" || word === "rquote") out += "'";
      else if (word === "ldblquote" || word === "rdblquote") out += '"';
      continue;
    }
    if (c === "\r" || c === "\n") continue;
    if (!skipping) out += c;
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
