// Offline-Start der App. HTML zuerst aus dem Netz (damit Updates ankommen), sonst aus dem Cache.
// Anfragen an andere Server (Supabase) laufen nie über den Cache.
const CACHE = 'ueberfuehrung-90870950d3';
const FILES = ['./', 'index.html', 'calc.js', 'seed.js', 'config.js', 'sync.js', 'manifest.webmanifest',
  'fonts/archivo-latin.woff2', 'fonts/archivo-latin-ext.woff2', 'fonts/archivo-narrow-latin.woff2', 'fonts/archivo-narrow-latin-ext.woff2',
  'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // App-Code: Netz zuerst, Kopie in den Cache; offline aus dem Cache
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
