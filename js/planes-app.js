/* MapMarket · planes en la app: destacados primero en la lista, insignia dorada, límite de anuncios y CTA de primera visita */
(function () {
  window.addEventListener('mm-feat-ready', () => {
    const D = () => (window.Feat && Feat.Dest && Feat.Dest.set) || new Set();
    // Destacados primero (orden estable: respeta el orden por distancia de «Cerca de mí»)
    const fa = Filters.apply.bind(Filters);
    Filters.apply = list => { const r = fa(list); return r.map((p, i) => [p, i, window.MMTier ? MMTier(p) : +D().has(String(p.id))]).sort((a, b) => (b[2] - a[2]) || a[1] - b[1]).map(x => x[0]) };
    // Insignia dorada en la ficha
    const sc = UI.showCard.bind(UI);
    UI.showCard = p => { const cd0 = document.getElementById('card'); if (cd0) cd0.style.boxShadow = ''; sc(p); const t = window.MMTier ? MMTier(p) : +D().has(String(p && p.id)); if (!p || !t) return; const h = document.querySelector('#card h2'); if (!h || h.querySelector('.mmGold')) return; const b = document.createElement('span'); b.className = 'mmGold ml-2 align-middle text-[11px] rounded-full px-2 py-0.5 font-bold ' + (t === 2 ? 'bg-amber-400 text-amber-950' : 'bg-green-600 text-white'); b.textContent = t === 2 ? '★ ' + (window.MMT ? MMT('Destacado premium') : 'Destacado premium') : '★ ' + (window.MMT ? MMT('Destacado Pro') : 'Destacado Pro'); h.appendChild(b); const card = document.getElementById('card'); if (card) card.style.boxShadow = t === 2 ? '0 0 0 3px #f59e0b' : '0 0 0 3px #16a34a' };
    // Mensaje claro cuando el servidor rechaza por límite de anuncios
    window.addEventListener('unhandledrejection', e => { const m = String(e.reason && e.reason.message || ''); if (m.includes('LIMITE_ANUNCIOS')) { e.preventDefault(); Plus.upsell('Más anuncios activos') } });
    // CTA de primera visita
    if (!localStorage.getItem('mm_cta_planes') && !Auth.demo) setTimeout(async () => {
      if (await Auth.user()) return; localStorage.setItem('mm_cta_planes', '1');
      const P = GH_CONFIG.precios, d = document.createElement('div'); d.id = 'mmCta'; d.className = 'fixed z-[1200] left-2 right-2 top-36 sm:top-auto sm:right-auto sm:left-3 sm:w-96 sm:bottom-6 rounded-2xl shadow-xl bg-white dark:bg-slate-800 p-4 text-sm'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Planes MapMarket');
      d.innerHTML = `<div class="flex"><b>👋 Bienvenido a MapMarket</b><button class="ml-auto w-11 h-11 -m-3" aria-label="Cerrar">✕</button></div><p class="mt-1 opacity-80">Busca gratis y publica tu primera propiedad. ¿Vendes más? Plus desde ₡${P.mensual.toLocaleString('es-CR')}/mes (3 anuncios) o Pro ₡${P.pro.toLocaleString('es-CR')}/mes (5 anuncios + destacados).</p><div class="flex gap-2 mt-3"><a href="planes.html" class="flex-1 text-center rounded-xl bg-violet-600 text-white font-semibold" style="min-height:44px;line-height:44px">Ver planes</a><a href="login.html#registro" class="flex-1 text-center rounded-xl border dark:border-slate-600" style="min-height:44px;line-height:44px">Crear cuenta</a></div>`;
      d.querySelector('button').onclick = () => d.remove(); document.body.appendChild(d);
    }, 4000);
  });
})();
