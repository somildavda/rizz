// Offline support: serve the app shell from cache, refresh it in the background.
const CACHE = "journey-v1";
const SHELL = ["./", "index.html", "style.css", "plan.js", "app.js", "manifest.json", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || (url.origin !== location.origin && !url.host.includes("fonts.g"))) return;
  e.respondWith(caches.match(e.request).then((hit) => {
    const fresh = fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => hit);
    return hit || fresh;
  }));
});
