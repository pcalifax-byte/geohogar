/* MapMarket · capa privada solo para administradores (datos de terceros en Supabase con RLS rol=admin). No muestra fotos. */
(function () {
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let layer = null, on = false;
  async function load(c) {
    const all = [];
    for (const [t, cols, col] of [['privado_propiedades', 'id,fuente,titulo,tipo,precio,moneda,provincia,lat,lon,url', '#0369a1'], ['privado_remates', 'id,kind,fuente,titulo,provincia,canton,fecha,lat,lon,url', '#b91c1c']]) {
      for (let from = 0; ; from += 1000) { const { data, error } = await c.from(t).select(cols).not('lat', 'is', null).range(from, from + 999); if (error) throw error; data.forEach(d => all.push([d, col, t])); if (data.length < 1000) break }
    }
    window.addEventListener('mm-cerca', () => { if (!layer) return; layer.clearLayers(); all.filter(([d]) => !window.Cerca || Cerca.within(d.lat, d.lon)).forEach(a => mkr(a).addTo(layer)) });
    layer = L.markerClusterGroup({ iconCreateFunction: k => L.divIcon({ html: `<div class="cl" style="border-color:#334155;background:#334155">🔒${k.getChildCount()}</div>`, className: '', iconSize: [40, 40] }) });
    all.filter(([d]) => !window.Cerca || Cerca.within(d.lat, d.lon)).forEach(a => mkr(a).addTo(layer));
    return all.length;
  }
  function mkr([d, col, t]) {
    return L.circleMarker([d.lat, d.lon], { radius: 6, color: col, weight: 2, fillOpacity: .6 }).bindPopup(`<b>🔒 ${E(d.titulo || d.tipo || d.kind)}</b><br><small>${E(d.fuente || '')} · ${E([d.canton, d.provincia].filter(Boolean).join(', '))}${d.fecha ? ' · ' + E(d.fecha) : ''}${d.precio ? ' · ' + (d.moneda === 'CRC' ? '₡' : '$') + Number(d.precio).toLocaleString('es-CR') : ''}</small>${d.url ? `<br><a target="_blank" rel="noopener noreferrer" href="${E(d.url)}">Abrir fuente</a>` : ''}<br><small>Solo administradores</small>${window.Cerca && Cerca.dist(d) != null ? '<br><small>a ' + Cerca.fmt(Cerca.dist(d)) + '</small>' : ''}`);
  }
  window.addEventListener('mm-feat-ready', async () => {
    try {
      const u = await Auth.user(); if (!u || u.rol !== 'admin' || Auth.demo) return;
      const c = await Auth.client(); const { data: adm } = await c.rpc('es_admin'); if (!adm) return;
      const bar = document.getElementById('bPub') && document.getElementById('bPub').parentNode; if (!bar) return;
      const b = document.createElement('button'); b.id = 'bPriv'; b.className = 'px-2 py-1 rounded-full border border-slate-700 dark:border-slate-400'; b.textContent = '🔒 Capa privada (admin)'; bar.insertBefore(b, document.getElementById('bPub'));
      b.onclick = async () => { b.disabled = true; try { if (!layer) { const n = await load(c); Feat.toast(n + ' puntos privados cargados') } on = !on; on ? layer.addTo(MapController.map) : MapController.map.removeLayer(layer); b.classList.toggle('bg-slate-700', on); b.classList.toggle('text-white', on) } catch (e) { Feat.toast('Error: ' + e.message) } b.disabled = false };
    } catch (e) { console.warn(e) }
  });
})();
