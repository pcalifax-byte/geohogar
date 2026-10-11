/* MapMarket · 3 niveles de anuncio: normal (borde blanco) · destacado Pro (verde) · destacado pagado 7 días (dorado) */
(function () {
  const T = s => (window.MMT ? MMT(s) : s);
  window.MMTier = p => { if (!p) return 0; if (p.destacado_until && new Date(p.destacado_until) > new Date()) return 2; const s = window.Feat && Feat.Dest && Feat.Dest.set; return s && s.has(String(p.id)) ? 1 : 0 };
  const st = document.createElement('style');
  st.textContent = `.pb.destV{border-color:#16a34a!important;border-width:2.5px;box-shadow:0 0 0 3px #16a34a55,0 2px 6px #0008;font-weight:800}
  .pb.dest{background:#f59e0b!important;color:#422006!important;border-color:#fff7d6!important;box-shadow:0 0 0 3px #f59e0b77,0 2px 6px #0008}
  #mmTierLeg{position:fixed;left:8px;bottom:84px;z-index:500;font:12px system-ui,sans-serif}`;
  document.head.appendChild(st);
  window.addEventListener('mm-feat-ready', () => {
    const d = document.createElement('div'); d.id = 'mmTierLeg'; d.className = 'rounded-xl shadow px-2 py-1 bg-white/95 dark:bg-slate-800/95 dark:text-white flex gap-2 items-center';
    d.innerHTML = `<span class="inline-flex items-center gap-1"><i class="inline-block w-3 h-3 rounded-full bg-teal-700 border-2 border-white"></i>${T('Normal')}</span><span class="inline-flex items-center gap-1"><i class="inline-block w-3 h-3 rounded-full bg-teal-700 border-2 border-green-600"></i>${T('Destacado Pro')}</span><span class="inline-flex items-center gap-1"><i class="inline-block w-3 h-3 rounded-full bg-amber-500 border-2 border-white"></i>${T('Destacado premium')}</span><button aria-label="${T('Cerrar')}" class="ml-1 w-6 h-6">✕</button>`;
    d.querySelector('button').onclick = () => { d.remove(); localStorage.setItem('mm_tierleg', '0') };
    if (localStorage.getItem('mm_tierleg') !== '0') document.body.appendChild(d);
    setTimeout(() => App.refresh && App.refresh(), 2500);
  });
})();
