// NZ Camp Planner — offline support.
// The app and Leaflet are kept for offline use. Map tiles you have looked at are kept (up to ~2,500), and maps saved with
// "Save maps for this trip" (NZ Topo50 from LINZ, CC BY 4.0) are kept in their own store until you clear them.
// A missing or error page is never stored, so a moved or broken web address can't replace the working copy.
const VERSION = 'nzcamp-2026-11-01b';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'];
const TILE_HOSTS = /(^|\.)(tile\.opentopomap\.org|tile\.openstreetmap\.org|server\.arcgisonline\.com|basemaps\.linz\.govt\.nz|data-cdn\.linz\.govt\.nz)$/;
const KEEP = [VERSION, 'tiles', 'offline-maps'];
const TILE_MAX = 2500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
let trimming = false;
async function trimTiles() {
  if (trimming) return; trimming = true;
  try { const c = await caches.open('tiles'), keys = await c.keys(); for (let i = 0; i < keys.length - TILE_MAX; i++) await c.delete(keys[i]); }
  finally { trimming = false; }
}
// tiles are stored without the access key, so a renewed LINZ key still finds them
const tileKey = u => { const x = new URL(u); x.searchParams.delete('api'); return x.origin + x.pathname.replace(/services;key=[^/]+\//, 'services/'); };
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // the app page: newest copy when online and the page is good; otherwise the saved copy
  if (req.mode === 'navigate' || (url.origin === location.origin && /(\/|index\.html)$/.test(url.pathname))) {
    e.respondWith(fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put('index.html', cp)); return r; }
      return caches.match('index.html').then(c => c || r);
    }).catch(() => caches.match('index.html').then(r => r || caches.match('./'))));
    return;
  }
  // app files and libraries: saved copy first
  if (url.origin === location.origin || url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(n => { if (n.ok) { const cp = n.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return n; })));
    return;
  }
  // map tiles: saved maps first, then recently viewed, then the network (kept for next time)
  if (TILE_HOSTS.test(url.hostname)) {
    const key = tileKey(req.url);
    e.respondWith(caches.match(key).then(hit => hit || fetch(req.url, { mode: 'cors', credentials: 'omit' })
      .then(n => { if (n.ok) { const cp = n.clone(); caches.open('tiles').then(c => { c.put(key, cp); trimTiles(); }); } return n; })
      .catch(() => fetch(req))));
    return;
  }
  // everything else (heights, routing, place search, data refresh) goes straight to the network
});
