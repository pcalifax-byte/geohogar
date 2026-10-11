/* MapMarket service worker: caché segura.
   - Nunca intercepta Supabase, Tilopay, WhatsApp ni peticiones que no sean GET.
   - HTML y data/*.json: red primero (datos frescos), caché solo si no hay conexión.
   - Estáticos propios y CDNs (Tailwind, Leaflet, teselas OSM): caché con revalidación. */
const V = 'mm-v22', SHELL = ['./', 'js/notif.js', 'js/tiers.js', 'js/inicio.js', 'js/plusvalia.js', 'js/editar.js', 'js/mm-extra.js', 'js/guard.js', 'js/mejoras.js', 'css/mm.css', 'perfil.html', 'js/i18n.js', 'data/i18n/en.json', 'data/faq_en.json', 'index.html', 'login.html', 'planes.html', 'cuenta.html', 'confirmar.html', 'guias.html', 'mensajes.html', 'privacidad.html', 'terminos.html', 'offline.html', 'eliminar-cuenta.html', 'admin.html', '404.html', 'js/publicar.js', 'js/extras.js', 'js/admin-capa.js', 'js/cerca.js', 'js/permisos.js', 'js/admin-gestion.js', 'js/refrescar.js', 'js/planes-app.js', 'js/dibujo.js', 'js/datos.js', 'data/cr_division.json', 'js/features.js', 'js/social.js', 'js/config.js', 'js/auth.js', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting() });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())) });
const NO = /supabase\.co|onvopay|tilopay|wa\.me|whatsapp|nominatim|overpass|api\./i;
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || NO.test(u.hostname) || u.search.includes('code=') || r.headers.has('authorization')) return;
  const same = u.origin === location.origin;
  if (same && (r.mode === 'navigate' || u.pathname.endsWith('.html') || u.pathname.includes('/data/') || u.pathname.includes('/js/'))) {
    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)) } return res })
      .catch(() => caches.match(r, { ignoreSearch: r.mode === 'navigate' }).then(m => m || (r.mode === 'navigate' ? caches.match('offline.html') : undefined))));
    return;
  }
  if (same || /cdn\.tailwindcss|unpkg|jsdelivr|tile\.openstreetmap|basemaps\.cartocdn/.test(u.hostname)) {
    e.respondWith(caches.open(V).then(async c => { const m = await c.match(r); const f = fetch(r).then(res => { if (res.ok || res.type === 'opaque') c.put(r, res.clone()); return res }).catch(() => m); return m || f }));
  }
});
// Web Push
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {} } catch (x) { d = { titulo: e.data && e.data.text() } }
  e.waitUntil(self.registration.showNotification(d.titulo || 'MapMarket', { body: d.cuerpo || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'mm-' + (d.id || Date.now()), data: { url: d.url || 'index.html' }, lang: d.idioma || 'es' }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const url = new URL(e.notification.data && e.notification.data.url || 'index.html', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { for (const c of cs) if (c.url.startsWith(self.registration.scope)) { c.navigate(url); return c.focus() } return clients.openWindow(url) }));
});
