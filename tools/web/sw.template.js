// Service worker for the Home Screen (web) version: keeps the app working offline.
// Generated into src/sw.js by scripts/web.mjs; each build gets a new cache name, so updates install cleanly.
// It only caches the app's own files. Your data is in IndexedDB, not here, and never leaves the device.
const CACHE = "point-tracker-__BUILD__";
const ASSETS = __ASSETS__;

self.addEventListener("install", (event) => {
  // cache: "reload" skips the browser's HTTP cache, so an update never stores stale copies.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // Version info: network first (so update notices name the right build), cache when offline.
  if (new URL(req.url).pathname.endsWith("/version.json")) {
    event.respondWith(fetch(req, { cache: "no-store" }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  // App files: from the cache (works offline). Anything else: the network.
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
