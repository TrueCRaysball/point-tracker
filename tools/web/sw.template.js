// Service worker for the Home Screen (web) version: keeps the app working offline.
// Generated into src/sw.js by scripts/web.mjs; each build gets a new cache name, so updates install cleanly.
// It only caches the app's own files. Your data is in IndexedDB, not here, and never leaves the device.
const CACHE = "point-tracker-__BUILD__";
const ASSETS = __ASSETS__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
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
  // App files: from the cache (works offline). Anything else: the network.
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
