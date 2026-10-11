/* MapMarket · extras: «bajó de precio», estimador «¿Cuánto vale mi casa?» y calendario de remates con recordatorios (.ics) */
(function () {
  const $ = i => document.getElementById(i), E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Math.round(n).toLocaleString('es-CR'), PROV = ['San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón'];
  const baja = p => { const h = p.precio_hist || []; if (h.length < 2) return null; const [a, b] = [h[h.length - 2], h[h.length - 1]]; return a[2] === b[2] && b[1] < a[1] ? { pct: (1 - b[1] / a[1]) * 100, antes: a[1], fecha: b[0], cur: b[2] } : null };
  const crc = p => !p.price || p.precio_flag === 'dudoso' ? null : p.currency === 'CRC' ? p.price : p.price * CONFIG.USD_CRC;
  const q = (a, f) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * f, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo) };

  function estimador() {
    UI.modal(`<h2 class="text-xl font-bold">🏷️ ¿Cuánto vale mi propiedad?</h2><p class="text-xs opacity-70">Estimación orientativa con los precios <b>pedidos</b> de anuncios publicados por usuarios en MapMarket (no incluye ejemplos ni datos de terceros; no es un avalúo).</p>
    <div class="grid grid-cols-2 gap-3 mt-3"><label class="text-sm">Tipo<select id="esT" class="mt-1 w-full h-11 px-2 rounded-lg border dark:bg-slate-700 dark:border-slate-600"><option>Casa</option><option>Apartamento</option><option value="Lote">Lote / terreno</option></select></label>
    <label class="text-sm">Provincia<select id="esP" class="mt-1 w-full h-11 px-2 rounded-lg border dark:bg-slate-700 dark:border-slate-600">${PROV.map(p => `<option>${p}</option>`).join('')}</select></label>
    <label class="text-sm">Cantón o zona (opcional)<input id="esC" class="mt-1 w-full h-11 px-2 rounded-lg border dark:bg-slate-700 dark:border-slate-600" placeholder="Ej. Escazú"></label>
    <label class="text-sm">Área (m²)<input id="esA" type="number" min="20" inputmode="numeric" class="mt-1 w-full h-11 px-2 rounded-lg border dark:bg-slate-700 dark:border-slate-600" placeholder="Construcción o lote"></label></div>
    <button id="esGo" class="mt-3 w-full bg-teal-600 text-white rounded-xl font-semibold" style="min-height:44px">Estimar</button><div id="esR" class="mt-3" aria-live="polite"></div>`);
    $('esGo').onclick = () => {
      const t = $('esT').value, pv = $('esP').value, c = Feat && Filters.norm ? Filters.norm($('esC').value) : $('esC').value.toLowerCase(), a = +$('esA').value;
      if (!(a >= 20)) { $('esR').innerHTML = '<p class="text-red-600 text-sm">Indica el área en m² (mínimo 20).</p>'; return }
      const lote = t === 'Lote', okT = p => lote ? /Lote|Finca|Terreno/i.test(p.type) : p.type === t;
      const m2 = p => { const ar = lote ? (p.lot || p.area) : p.area, v = crc(p); return v && ar > 20 ? v / ar : null };
      let base = App.all.filter(p => !p.demo && okT(p) && p.province === pv), zona = c ? base.filter(p => Filters.norm([p.location, p.canton, p.district].join(' ')).includes(c)) : [];
      let set = zona.map(m2).filter(Boolean), lbl = 'en ' + E($('esC').value) + ', ' + pv;
      if (set.length < 5) { set = base.map(m2).filter(Boolean); lbl = 'en ' + pv + (c ? ' (pocos datos para esa zona; se usa la provincia)' : '') }
      if (set.length < 5) { $('esR').innerHTML = `<div class="rounded-xl border border-dashed p-4 text-sm"><b>Datos insuficientes.</b> La estimación usa solo anuncios publicados en MapMarket con área y precio (${set.length} para este filtro; se necesitan al menos 5). A medida que más personas publiquen, estará disponible.</div>`; return }
      const [p25, p50, p75] = [.25, .5, .75].map(f => q(set, f));
      $('esR').innerHTML = `<div class="rounded-xl bg-teal-50 dark:bg-slate-700 p-4"><div class="text-xs opacity-70">Valor estimado (precio pedido) ${lbl}</div><div class="text-3xl font-extrabold text-teal-700 dark:text-teal-300">₡${fmt(p50 * a)}</div><div class="text-sm">Rango probable: ₡${fmt(p25 * a)} – ₡${fmt(p75 * a)} <span class="opacity-60">(≈ $${fmt(p25 * a / CONFIG.USD_CRC)} – $${fmt(p75 * a / CONFIG.USD_CRC)})</span></div><div class="text-xs opacity-70 mt-1">Mediana ₡${fmt(p50)}/m² · basado en ${set.length} anuncios · excluye precios dudosos</div></div><p class="text-[11px] opacity-60 mt-2">Los precios pedidos suelen ser mayores que los de cierre. Para un valor formal pide un avalúo a un perito o a tu banco.</p>`;
    };
  }

  function ics(x, d, base) {
    const dt = d.replace(/-/g, ''), uid = 'mm-' + x.id + '-' + dt + '@mapmarket';
    const txt = s => String(s || '').replace(/[,;\\]/g, m => '\\' + m).replace(/\n/g, '\\n');
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MapMarket//Remates//ES', 'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', 'DTSTART;VALUE=DATE:' + dt, 'SUMMARY:' + txt('Remate: ' + (x.titulo || x.tipo || 'propiedad')), 'DESCRIPTION:' + txt(`Base: ${base}. ${x.juzgado || ''} ${x.expediente || ''}. Revisa el edicto: ${x.url || ''}`), 'LOCATION:' + txt([x.canton, x.provincia].filter(Boolean).join(', ')), 'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:Mañana es el remate', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' })); a.download = 'remate-' + dt + '.ics'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function calendario() {
    UI.modal('<h2 class="text-xl font-bold">📅 Calendario de remates</h2><p class="text-sm">Cargando…</p>');
    await (window.loadRemates ? loadRemates() : null);
    const hoy = new Date().toISOString().slice(0, 10), lim = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10);
    const ev = (REMATES.items || []).filter(x => x.kind === 'remate').map(x => { const n = Remates.next(x); return n && n[0] <= lim ? { x, d: n[0], base: n[1], ronda: n[2] } : null }).filter(Boolean).sort((a, b) => a.d.localeCompare(b.d));
    const render = pv => {
      const L = ev.filter(e => !pv || e.x.provincia === pv), by = {};
      L.forEach(e => (by[e.d] = by[e.d] || []).push(e));
      $('calL').innerHTML = Object.keys(by).length ? Object.entries(by).map(([d, a]) => `<h3 class="font-semibold mt-3 sticky top-0 bg-white dark:bg-slate-800 py-1">${Remates.fecha(d)} <span class="text-xs opacity-60">(${a.length})</span></h3>${a.slice(0, 40).map((e, i) => `<div class="flex gap-2 items-center border-b dark:border-slate-700 py-1.5 text-sm"><span class="flex-1 min-w-0"><b class="block truncate">${E(e.x.titulo || e.x.tipo)}</b><span class="text-xs opacity-70">${E([e.x.canton, e.x.provincia].filter(Boolean).join(', '))} · ${e.ronda} remate · base ${Remates.fmtC(e.base, e.x.moneda)}</span></span><button data-i="${ev.indexOf(e)}" class="cal-ics border rounded-lg px-2 text-xs dark:border-slate-600" style="min-height:40px" aria-label="Agregar recordatorio">🔔 Recordar</button><button data-o="${E(e.x.id)}" class="cal-ver border rounded-lg px-2 text-xs dark:border-slate-600" style="min-height:40px">Ver</button></div>`).join('')}`).join('') : '<p class="text-sm opacity-70 mt-3">No hay remates en los próximos 45 días para ese filtro.</p>';
      document.querySelectorAll('.cal-ics').forEach(b => b.onclick = () => { const e = ev[+b.dataset.i]; ics(e.x, e.d, Remates.fmtC(e.base, e.x.moneda)) });
      document.querySelectorAll('.cal-ver').forEach(b => b.onclick = () => { const x = REMATES.items.find(i => String(i.id) === b.dataset.o); UI.close(); ['remate'].forEach(k => { Remates.on[k] = true; const c = document.querySelector('.rchip[data-k=remate]'); c && c.classList.add('on') }); Remates.render(MapController.map); if (x) MapController.map.setView([x.lat, x.lon], 15) });
    };
    UI.modal(`<h2 class="text-xl font-bold">📅 Calendario de remates</h2><p class="text-xs opacity-70">Próximos 45 días · ${ev.length} fechas. «Recordar» descarga un evento para tu calendario con aviso un día antes. Verifica siempre el edicto oficial.</p>
      <label class="text-sm block mt-2">Provincia<select id="calP" class="ml-2 h-10 px-2 rounded-lg border dark:bg-slate-700 dark:border-slate-600"><option value="">Todas</option>${PROV.map(p => `<option>${p}</option>`).join('')}</select></label><div id="calL" class="max-h-[60vh] overflow-y-auto"></div>`);
    $('calP').onchange = e => render(e.target.value); render('');
  }

  window.addEventListener('mm-feat-ready', () => {
    const sc = UI.showCard.bind(UI);
    UI.showCard = function (p) { sc(p); const b = baja(p); if (!b) return; const h = document.querySelector('#card h2, #card .text-2xl'); const el = document.createElement('div'); el.className = 'inline-block mt-1 text-xs font-semibold rounded-full px-2 py-0.5 bg-emerald-600 text-white'; el.textContent = `⬇️ Bajó ${b.pct.toFixed(0)} % (antes ${b.cur === 'CRC' ? '₡' : '$'}${fmt(b.antes)}, ${b.fecha})`; (h && h.parentNode ? h.parentNode.insertBefore(el, h.nextSibling) : null) };
    const bar = $('bPub') && $('bPub').parentNode; if (!bar) return;
    [['bEst', '🏷️ ¿Cuánto vale?', estimador]].forEach(([id, t, fn]) => { const b = document.createElement('button'); b.id = id; b.className = 'px-2 py-1 rounded-full border dark:border-slate-600'; b.textContent = t; b.onclick = fn; bar.insertBefore(b, $('bPub')) });
  });
  window.Extras = { baja, estimador, calendario };
})();
