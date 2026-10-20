/* Rosée Skin Atelier service worker
   - Pages: network first, fall back to the cached page, then the offline page
   - Static assets: cache first, refreshed in the background
   - The booking API is never cached
   Bump VERSION whenever you deploy changes so visitors get the update. */
const VERSION = "rosee-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;

const PRECACHE = [
  "/",
  "/index.html",
  "/offline.html",
  "/manifest.webmanifest",
  "/assets/css/styles.css",
  "/assets/js/app.js",
  "/assets/fonts/fraunces-latin-full-normal.woff2",
  "/assets/fonts/fraunces-latin-full-italic.woff2",
  "/assets/fonts/figtree-latin-wght-normal.woff2",
  "/assets/fonts/mrs-saint-delafield-latin-400-normal.woff2",
  "/assets/icons/favicon.svg",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never cache booking traffic

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = (await cache.match(request, { ignoreSearch: true })) ||
                   (await caches.match("/", { ignoreSearch: true }));
    return cached || caches.match("/offline.html");
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}
