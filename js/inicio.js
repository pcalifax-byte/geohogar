/* MapMarket · pantalla de inicio: destacados (dorado → verde → recientes) antes del mapa. Se muestra en cada sesión. */
(function () {
  const Q = new URLSearchParams(location.search);
  if (['p', 'editar', 'capa', 'destacado'].some(k => Q.has(k)) || sessionStorage.getItem('mm_inicio_visto') || localStorage.getItem('mm_inicio_off')) return;
  const T = s => (window.MMT ? MMT(s) : s), E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ov = document.createElement('div'); ov.id = 'mmInicio'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'MapMarket');
  ov.className = 'fixed inset-0 z-[2600] overflow-y-auto bg-slate-50 dark:bg-slate-900 dark:text-white';
  ov.innerHTML = `<div class="max-w-5xl mx-auto p-4 pb-28"><div class="sticky top-0 z-10 -mx-4 px-4 py-2 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur flex items-center gap-2"><b class="text-xl text-teal-700 dark:text-teal-300 whitespace-nowrap">📍 MapMarket</b><span class="text-xs opacity-70 flex-1 min-w-0">${T('propiedades en venta en Costa Rica')}</span><button id="mmIniMapa2" class="rounded-xl bg-teal-600 text-white font-bold px-4 whitespace-nowrap" style="min-height:44px">🗺️ ${T('Ver mapa')}</button></div>
    <h1 class="text-2xl font-extrabold mt-4">★ ${T('Propiedades destacadas')}</h1><p class="text-sm opacity-70">${T('Toca una para verla en el mapa.')}</p>
    <div id="mmIniG" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4"><div class="col-span-full text-center py-10 opacity-60">${T('Cargando…')}</div></div>
    <label class="flex items-center gap-2 text-sm mt-6 opacity-80"><input id="mmIniOff" type="checkbox" class="w-5 h-5"> ${T('No mostrar de nuevo')}</label></div>
    <div class="fixed inset-x-0 bottom-0 p-3 pb-24 sm:pb-3 bg-gradient-to-t from-slate-50 dark:from-slate-900"><button id="mmIniMapa" class="block w-full max-w-md mx-auto rounded-2xl bg-teal-600 hover:bg-teal-700 text-white text-lg font-bold shadow-xl" style="min-height:56px">🗺️ ${T('Ver mapa')}</button></div>`;
  const montar = () => document.body.appendChild(ov); document.body ? montar() : document.addEventListener('DOMContentLoaded', montar);
  const cerrar = () => { sessionStorage.setItem('mm_inicio_visto', '1'); if (document.getElementById('mmIniOff').checked) localStorage.setItem('mm_inicio_off', '1'); ov.remove(); try { MapController.map.invalidateSize() } catch (e) { } };
  ov.addEventListener('click', e => { if (e.target.closest('#mmIniMapa,#mmIniMapa2')) cerrar() });
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape' && document.getElementById('mmInicio')) { cerrar(); document.removeEventListener('keydown', k) } });
  function pintar() {
    const tier = p => (window.MMTier ? MMTier(p) : 0), act = (App.all || []).filter(p => p.status === 'activa' && p.lat && !(window.MMOcultos && MMOcultos.has(String(p.id))));
    let L = act.filter(p => tier(p) > 0).sort((a, b) => tier(b) - tier(a) || String(b.date || '').localeCompare(String(a.date || '')));
    const rec = act.filter(p => p.usuario && !tier(p)).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    if (L.length < 6) L = L.concat(rec.slice(0, 9 - L.length));
    if (L.length < 3) L = L.concat(act.filter(p => p.demo).slice(0, 6 - L.length));
    const g = document.getElementById('mmIniG'); if (!g) return;
    g.innerHTML = L.map((p, i) => { const t = tier(p), img = (p.images || [])[0], emo = (typeof EMO !== 'undefined' && EMO[p.type]) || '🏠';
      const bd = t === 2 ? `<span class="absolute top-2 left-2 text-xs font-bold rounded-full px-2 py-0.5 bg-amber-400 text-amber-950">★ ${T('Destacado premium')}</span>` : t === 1 ? `<span class="absolute top-2 left-2 text-xs font-bold rounded-full px-2 py-0.5 bg-green-600 text-white">★ ${T('Destacado Pro')}</span>` : p.demo ? `<span class="absolute top-2 left-2 text-xs font-bold rounded-full px-2 py-0.5 bg-pink-600 text-white">${T('Ejemplo')}</span>` : `<span class="absolute top-2 left-2 text-xs rounded-full px-2 py-0.5 bg-white/90 text-slate-800">${T('Reciente')}</span>`;
      return `<button data-i="${i}" class="mmIniC text-left rounded-2xl overflow-hidden bg-white dark:bg-slate-800 shadow hover:shadow-lg ${t === 2 ? 'ring-2 ring-amber-400' : t === 1 ? 'ring-2 ring-green-600' : ''}"><div class="relative h-40 bg-slate-200 dark:bg-slate-700 grid place-items-center text-5xl">${img ? `<img src="${E(img)}" alt="" loading="lazy" class="absolute inset-0 w-full h-full object-cover">` : emo}${bd}</div>
        <div class="p-3"><div class="text-lg font-extrabold text-teal-700 dark:text-teal-300">${E(DataService.full ? DataService.full(p) : p.price)}</div><div class="font-semibold line-clamp-1" data-noi18n>${E(p.title)}</div><div class="text-sm opacity-70 line-clamp-1">📍 ${E(p.location || p.province || '')}</div></div></button>` }).join('') || `<div class="col-span-full text-center py-10 opacity-70">${T('Aún no hay destacados. ¡Explora el mapa!')}</div>`;
    g.querySelectorAll('.mmIniC').forEach(b => b.onclick = () => { const p = L[+b.dataset.i]; cerrar(); try { MapController.map.setView([p.lat, p.lon], 16); UI.showCard(p) } catch (e) { } });
  }
  window.addEventListener('mm-feat-ready', () => { pintar(); setTimeout(pintar, 2500); setTimeout(pintar, 6000) });
})();
