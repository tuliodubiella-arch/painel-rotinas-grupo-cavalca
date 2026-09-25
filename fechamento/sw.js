const CACHE = "fc-shell-v5";
const SHELL = ["./", "./index.html", "./app.js", "./styles.css", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"];
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map(async (url) => {
      const response = await fetch(url);
      if (response.ok || response.type === "opaque") await cache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("fc-shell-") && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.hostname.endsWith("supabase.co")) return; // Nunca armazenar respostas protegidas em cache público.
  if (url.origin !== self.location.origin && url.hostname !== "cdn.jsdelivr.net") return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    if (url.origin !== self.location.origin && cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok || response.type === "opaque") await cache.put(event.request, response.clone());
      return response;
    } catch {
      return event.request.mode === "navigate" ? (await cache.match("./index.html")) || Response.error() : Response.error();
    }
  })());
});

