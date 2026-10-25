// Offline support: serve the app shell from cache, refresh it in the background.
const CACHE = "journey-__BUILD__";
const SHELL = ["./", "index.html", "kitchen.html", "kitchen.js", "style.css", "plan.js", "app.js", "manifest.json", "icons/icon-192.png", "icons/icon-512.png"];
// Launch screens are fetched by iOS itself and cached by the browser, so they stay out of the shell.
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/") || (url.origin !== location.origin && !url.host.includes("fonts.g"))) return;
  e.respondWith(caches.match(e.request).then((hit) => {
    const fresh = fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => hit);
    return hit || fresh;
  }));
});

// Daily reminders arrive without a payload; pick the message by the time in India (UTC+5:30).
self.addEventListener("push", (e) => {
  const now = new Date(), h = ((now.getUTCHours() * 60 + now.getUTCMinutes() + 330) / 60) % 24;
  const [title, body] = h < 12 ? ["Good morning 🌅", "Weigh-in, D3, then today's plan. Gym at 8:30 on Mon, Wed, Fri."]
    : h < 21 ? ["Before dinner 🌾", "1 tsp isabgol in a glass of water, then dinner from your plan."]
    : ["Wrap up the day 🦵", "Knee exercises, meds and water done? Tick them off in Journey."];
  e.waitUntil(self.registration.showNotification(title, { body, icon: "icons/icon-192.png", tag: "journey-reminder" }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow("./"))));
});
