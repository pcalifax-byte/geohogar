/* MapMarket service worker: caché segura.
   - Nunca intercepta Supabase, Tilopay, WhatsApp ni peticiones que no sean GET.
   - HTML y data/*.json: red primero (datos frescos), caché solo si no hay conexión.
   - Estáticos propios y CDNs (Tailwind, Leaflet, teselas OSM): caché con revalidación. */
const V = 'mm-v2', SHELL = ['./', 'index.html', 'login.html', 'planes.html', 'cuenta.html', 'confirmar.html', 'guias.html', 'js/features.js', 'js/config.js', 'js/auth.js', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting() });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())) });
const NO = /supabase\.co|tilopay|wa\.me|whatsapp|nominatim|overpass|api\./i;
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || NO.test(u.hostname) || u.search.includes('code=') || r.headers.has('authorization')) return;
  const same = u.origin === location.origin;
  if (same && (r.mode === 'navigate' || u.pathname.endsWith('.html') || u.pathname.includes('/data/') || u.pathname.includes('/js/'))) {
    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)) } return res })
      .catch(() => caches.match(r, { ignoreSearch: r.mode === 'navigate' }).then(m => m || caches.match('index.html'))));
    return;
  }
  if (same || /cdn\.tailwindcss|unpkg|jsdelivr|tile\.openstreetmap|basemaps\.cartocdn/.test(u.hostname)) {
    e.respondWith(caches.open(V).then(async c => { const m = await c.match(r); const f = fetch(r).then(res => { if (res.ok || res.type === 'opaque') c.put(r, res.clone()); return res }).catch(() => m); return m || f }));
  }
});
