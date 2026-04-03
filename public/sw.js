// ALPHACORE Service Worker — offline shell + icon caching
const CACHE_NAME = "alphacore-v5";
const OFFLINE_URL = "/offline";

const PRECACHE_URLS = [
  "/",
  "/tasks",
  "/calendar",
  "/projects",
  "/notes",
  "/routines",
  "/settings",
  "/medical",
  "/offline",
  "/manifest.json",
  "/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Cache-first for static assets (icons, manifest)
  if (
    event.request.url.includes("/icons/") ||
    event.request.url.includes("/manifest.json") ||
    event.request.url.includes("/apple-touch-icon")
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
