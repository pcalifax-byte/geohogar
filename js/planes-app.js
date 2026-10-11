/* MapMarket · planes en la app: destacados primero en la lista, insignia dorada, límite de anuncios y CTA de primera visita */
(function () {
  window.addEventListener('mm-feat-ready', () => {
    const D = () => (window.Feat && Feat.Dest && Feat.Dest.set) || new Set();
    // Destacados primero (orden estable: respeta el orden por distancia de «Cerca de mí»)
    const fa = Filters.apply.bind(Filters);
    Filters.apply = list => { const r = fa(list), s = D(); if (!s.size) return r; return r.map((p, i) => [p, i]).sort((a, b) => (s.has(String(b[0].id)) - s.has(String(a[0].id))) || a[1] - b[1]).map(x => x[0]) };
    // Insignia dorada en la ficha
    const sc = UI.showCard.bind(UI);
    UI.showCard = p => { sc(p); if (!p || !D().has(String(p.id))) return; const h = document.querySelector('#card h2'); if (!h || h.querySelector('.mmGold')) return; const b = document.createElement('span'); b.className = 'mmGold ml-2 align-middle text-[11px] rounded-full px-2 py-0.5 bg-amber-400 text-amber-950 font-bold'; b.textContent = '★ Destacado'; h.appendChild(b) };
    // Mensaje claro cuando el servidor rechaza por límite de anuncios
    window.addEventListener('unhandledrejection', e => { const m = String(e.reason && e.reason.message || ''); if (m.includes('LIMITE_ANUNCIOS')) { e.preventDefault(); Plus.upsell('Más anuncios activos') } });
    // CTA de primera visita
    if (!localStorage.getItem('mm_cta_planes') && !Auth.demo) setTimeout(async () => {
      if (await Auth.user()) return; localStorage.setItem('mm_cta_planes', '1');
      const P = GH_CONFIG.precios, d = document.createElement('div'); d.className = 'fixed z-[1200] left-2 right-2 sm:left-auto sm:right-3 sm:w-96 bottom-24 rounded-2xl shadow-xl bg-white dark:bg-slate-800 p-4 text-sm'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Planes MapMarket');
      d.innerHTML = `<div class="flex"><b>👋 Bienvenido a MapMarket</b><button class="ml-auto w-11 h-11 -m-3" aria-label="Cerrar">✕</button></div><p class="mt-1 opacity-80">Busca gratis y publica tu primera propiedad. ¿Vendes más? Plus desde ₡${P.mensual.toLocaleString('es-CR')}/mes (3 anuncios) o Pro ₡${P.pro.toLocaleString('es-CR')}/mes (5 anuncios + destacados).</p><div class="flex gap-2 mt-3"><a href="planes.html" class="flex-1 text-center rounded-xl bg-violet-600 text-white font-semibold" style="min-height:44px;line-height:44px">Ver planes</a><a href="login.html#registro" class="flex-1 text-center rounded-xl border dark:border-slate-600" style="min-height:44px;line-height:44px">Crear cuenta</a></div>`;
      d.querySelector('button').onclick = () => d.remove(); document.body.appendChild(d);
    }, 4000);
  });
})();
