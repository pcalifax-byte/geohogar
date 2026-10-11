/* MapMarket · 🔄 Actualizar: vuelve a pedir datos sin caché, conserva filtros, vista del mapa y ficha abierta; busca nueva versión de la app. */
(function () {
  const L1 = () => (document.documentElement.lang || 'es').startsWith('en') ? 'Refresh' : 'Actualizar';
  let busy = false;
  async function refrescar() {
    if (busy) return; busy = true; const b = document.getElementById('bRefresh'); b && b.classList.add('mm-spin');
    try {
      const props = await fetch(CONFIG.dataBase + 'propiedades.json?nocache=' + Date.now(), { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('datos'); return r.json() });
      const keep = App.all.filter(p => p.mine);
      App.all = keep.concat(props.filter(p => !keep.some(k => k.id === p.id)));
      EMBED.properties = App.all.slice();
      if (window.MMcargarAprobados) await MMcargarAprobados(); else App.refresh();
      App.refresh();
      if (UI.cur) { const np = App.all.find(p => p.id === UI.cur.id); if (np && !document.getElementById('card').classList.contains('hidden')) UI.showCard(np) }
      const t = new Date().toLocaleTimeString(document.documentElement.lang === 'en' ? 'en-US' : 'es-CR', { hour: '2-digit', minute: '2-digit' });
      Feat.toast((document.documentElement.lang === 'en' ? 'Content updated · ' : 'Contenido actualizado · ') + t);
      revisarVersion();
    } catch (e) { Feat.toast(document.documentElement.lang === 'en' ? 'Could not refresh. Check your connection.' : 'No se pudo actualizar. Revisa tu conexión.') }
    finally { busy = false; b && b.classList.remove('mm-spin') }
  }
  async function revisarVersion() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration(); if (!reg) return; await reg.update();
      const w = reg.waiting || reg.installing; if (!w) return;
      const es = document.documentElement.lang !== 'en';
      if (confirm(es ? 'Hay una nueva versión de MapMarket. ¿Recargar ahora?' : 'A new version of MapMarket is available. Reload now?')) { w.postMessage && w.postMessage('skipWaiting'); setTimeout(() => location.reload(), 300) }
    } catch (e) {}
  }
  window.MMRefrescar = refrescar;
  window.addEventListener('mm-feat-ready', () => {
    const ref = document.getElementById('bGuide'); if (!ref) return;
    const b = document.createElement('button'); b.id = 'bRefresh'; b.type = 'button'; b.className = ref.className; b.title = L1(); b.setAttribute('aria-label', L1());
    b.innerHTML = '🔄<span class="hidden sm:inline"> ' + L1() + '</span>'; b.onclick = refrescar; ref.parentElement.insertBefore(b, ref);
    // Tirar para actualizar: solo desde la barra superior (no interfiere con el mapa)
    const h = document.querySelector('header'); let y0 = null;
    h.addEventListener('touchstart', e => { y0 = e.touches[0].clientY }, { passive: true });
    h.addEventListener('touchend', e => { if (y0 != null && e.changedTouches[0].clientY - y0 > 70) refrescar(); y0 = null }, { passive: true });
  });
})();
