/* MapMarket · 📈 Índice de plusvalía estimada por cantón (0–100), sin datos de portales de terceros.
   Componentes: servicios OSM (densidad), infraestructura pública citada (data/plusvalia.json) y mercado (anuncios propios de MapMarket). */
(function () {
  const T = s => (window.MMT ? MMT(s) : s), $ = id => document.getElementById(id);
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DISC = '⚠️ ' + T('ÍNDICE ESTIMADO SOLO CON FINES INFORMATIVOS. NO ES ASESORÍA FINANCIERA NI UN AVALÚO: LA PLUSVALÍA REAL DEPENDE DE CADA PROPIEDAD Y DEL MERCADO.');
  const COL = s => s == null ? '#94a3b8' : s >= 80 ? '#065f46' : s >= 65 ? '#059669' : s >= 50 ? '#84cc16' : s >= 35 ? '#facc15' : '#f97316';
  let D = null, capa = null, ley = null, on = false;
  const med = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 };
  const pip = (x, y, mp) => { let c = false; for (const poly of mp) for (const r of poly) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c } return c };
  function mercado() {
    const rate = (typeof CONFIG !== 'undefined' && CONFIG.USD_CRC) || 500, hoy = Date.now();
    const L = (App.all || []).filter(p => p.usuario && p.status === 'activa' && +p.price > 0 && +(p.area_terreno || p.area) > 0);
    const por = {}; D.cantones.features.forEach(f => por[f.properties.cod] = []);
    L.forEach(p => { const f = D.cantones.features.find(f => pip(p.lon, p.lat, f.geometry.coordinates)); if (f) por[f.properties.cod].push({ m2: (p.currency === 'USD' ? p.price * rate : +p.price) / +(p.area_terreno || p.area), t: new Date(p.date || 0).getTime() }) });
    const res = {}; const meds = [];
    for (const k in por) { const a = por[k]; if (a.length < 5) { res[k] = { n: a.length }; continue }
      const r = { n: a.length, med: med(a.map(x => x.m2)) }; const nu = a.filter(x => hoy - x.t < 90 * 864e5), vi = a.filter(x => hoy - x.t >= 90 * 864e5);
      if (nu.length >= 3 && vi.length >= 3) r.tend = (med(nu.map(x => x.m2)) / med(vi.map(x => x.m2)) - 1) * 100; res[k] = r; meds.push(r.med) }
    meds.sort((a, b) => a - b);
    for (const k in res) { const r = res[k]; if (r.med == null) continue; r.score = r.tend != null ? Math.max(0, Math.min(100, Math.round(50 + r.tend * 2))) : meds.length > 1 ? Math.round(100 * meds.filter(x => x < r.med).length / (meds.length - 1)) : 50 }
    return res;
  }
  function calcular() { const M = mercado(), W = D.pesos;
    D.cantones.features.forEach(f => { const p = f.properties, m = M[p.cod] || { n: 0 }; p.mer = m;
      const parts = [['servicios', p.serv], ['infraestructura', p.infra], ['mercado', m.score]].filter(x => x[1] != null);
      const sw = parts.reduce((a, x) => a + W[x[0]], 0); p.score = Math.round(parts.reduce((a, x) => a + W[x[0]] * x[1], 0) / sw); p.pesosUsados = parts.map(x => [x[0], W[x[0]] / sw, x[1]]) }) }
  const fmt = n => '₡' + Math.round(n).toLocaleString(window.MMLocale || 'es-CR');
  function hist(p) { const H = D.historicos; if (!H) return ''; const o = H.ont[p.cod], ip = H.inec_permisos_m2, iv = ip.provincias[p.provincia], A = u => `<a class="underline text-teal-700 dark:text-teal-300" target="_blank" rel="noopener" href="${E(u)}">`;
    const ed = o ? o.ediciones.map(e => `<tr class="border-t dark:border-slate-700"><td class="py-1">${A(e.url)}${T('Edición')} ${e.anio}</a></td><td class="text-right">${fmt(e.u_med)}/m²</td><td class="text-right opacity-70">${fmt(e.u_p25)}–${fmt(e.u_p75)}</td><td class="text-right">${e.r_med ? fmt(e.r_med) + '/m²' : '—'}</td></tr>`).join('') : '';
    return `<h3 class="font-semibold mt-3">🕰️ ${T('Precios históricos (fuentes oficiales)')}</h3>
      ${o ? `<p class="text-xs opacity-80">${T('Valor fiscal de terreno por zonas homogéneas (ONT, Ministerio de Hacienda). Es un valor de referencia para el impuesto de bienes inmuebles, no un precio de venta.')}</p>
      <table class="w-full text-xs mt-1"><thead><tr class="opacity-70"><th class="text-left">${T('Fuente')}</th><th class="text-right">${T('Mediana urbana')}</th><th class="text-right">${T('Rango p25–p75')}</th><th class="text-right">${T('Mediana rural')}</th></tr></thead><tbody>${ed}</tbody></table>
      <p class="text-xs mt-1">${o.var_anual != null ? `${T('Variación anual promedio (mediana urbana, nominal)')}: <b>${o.var_anual >= 0 ? '+' : ''}${o.var_anual}%</b>` : T('Solo hay una edición publicada con matriz legible: sin tendencia histórica todavía.')}</p>`
      : `<p class="text-xs opacity-80">${T('Sin datos ONT legibles para este cantón (mapa no publicado o escaneado).')}</p>`}
      ${iv ? `<p class="text-xs mt-2">🏗️ ${T('Área con permiso de construcción en la provincia')} (${E(p.provincia)}): ${iv[0].toLocaleString(window.MMLocale || 'es-CR')} m² (2023) → ${iv[1].toLocaleString(window.MMLocale || 'es-CR')} m² (2024), ${((iv[1] / iv[0] - 1) * 100).toFixed(1)}%. ${A(ip.fuente[1])}INEC</a></p>` : ''}
      <p class="text-[11px] opacity-70 mt-1">${T('Fuentes')}: ${A('https://www.hacienda.go.cr/')}Hacienda / ONT</a> · ${A(ip.fuente[1])}INEC</a>. ${T('Informativo: no forma parte del puntaje.')}</p>`;
  }
  function ficha(p) {
    const CAT = { transporte: '🚆 ' + T('Transporte'), salud: '🏥 ' + T('Salud'), empleo: '🏭 ' + T('Zona franca / empleo'), turismo: '🏖️ ' + T('Turismo'), comercial: '🏬 ' + T('Comercial') }; const pr = D.proyectos.filter(x => p.proy.includes(x.id)), m = p.mer, N = { servicios: T('Servicios cercanos (OSM)'), infraestructura: T('Infraestructura pública'), mercado: T('Mercado MapMarket') };
    UI.modal(`<h2 class="text-xl font-bold pr-6">📈 ${E(p.canton)} <span class="text-sm font-normal opacity-70">· ${E(p.provincia)}</span></h2>
      <div class="flex items-center gap-3 mt-2"><div class="text-4xl font-extrabold" style="color:${COL(p.score)}">${p.score}</div><div class="text-sm opacity-80">${T('Índice de plusvalía estimada (0–100)')}</div></div>
      <h3 class="font-semibold mt-3">${T('Por qué este puntaje')}</h3>
      <table class="w-full text-sm mt-1"><tbody>${p.pesosUsados.map(([k, w, v]) => `<tr class="border-t dark:border-slate-700"><td class="py-1">${N[k]}</td><td class="text-right">${v}/100</td><td class="text-right opacity-70">× ${Math.round(w * 100)}%</td><td class="text-right font-semibold">= ${Math.round(v * w)}</td></tr>`).join('')}</tbody></table>
      <ul class="text-xs mt-2 space-y-1 opacity-90">
        <li>🏥 ${p.poi.hospital} ${T('hospitales')} · 🛒 ${p.poi.supermarket} ${T('supermercados')} · 🏬 ${p.poi.mall} ${T('centros comerciales')} · 🚆 ${p.poi.tren} ${T('estaciones de tren')} · 🏫 ${p.poi.school || 0} ${T('centros educativos')} (${p.km2} km²) → ${T('percentil de densidad')} ${p.serv}.</li>
        <li>🏠 ${m.score == null ? `${T('Mercado: datos insuficientes')} (${m.n} ${T('anuncios con área; se necesitan 5')}). ${T('Su peso se reparte entre los otros componentes.')}` : `${T('Mediana')} ${fmt(m.med)}/m² ${T('en')} ${m.n} ${T('anuncios de MapMarket')}${m.tend != null ? ` · ${T('tendencia 90 días')}: ${m.tend >= 0 ? '+' : ''}${m.tend.toFixed(1)}%` : ` · ${T('sin tendencia aún (percentil de precio)')}`}.`}</li></ul>
      <h3 class="font-semibold mt-3">🏗️ ${T('Proyectos públicos en este cantón')}</h3>
      ${pr.length ? pr.map(x => `<div class="mt-2 rounded-lg border dark:border-slate-700 p-2 text-sm"><span class="text-[11px] rounded-full px-2 bg-teal-50 dark:bg-teal-900 mr-1">${CAT[x.cat] || ""}</span><b data-noi18n>${E(x.nombre)}</b> <span class="text-xs rounded-full px-2 bg-slate-100 dark:bg-slate-700">${T(x.estado)}</span> <span class="text-xs opacity-70">+${x.puntos}</span><p class="text-xs mt-1">${T(x.hecho)}</p><ul class="text-xs mt-1 list-disc ml-4">${x.fuentes.map(([t, u]) => `<li><a class="underline text-teal-700 dark:text-teal-300" target="_blank" rel="noopener" href="${E(u)}" data-noi18n>${E(t)}</a></li>`).join('')}</ul></div>`).join('') : `<p class="text-sm opacity-70">${T('No hay proyectos citados en este cantón (puntaje de infraestructura 0).')}</p>`}
      ${hist(p)}
      <div class="mmDisc mt-3 p-3 rounded-xl border-2 border-red-600 dark:border-red-400 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-200 font-bold uppercase text-xs sm:text-sm leading-snug" role="note">${DISC}</div>
      <details class="text-xs mt-2 opacity-80"><summary class="cursor-pointer">${T('Metodología y fuentes')}</summary><p class="mt-1">${T('Puntaje = 40% servicios + 35% infraestructura + 25% mercado (si hay datos). Servicios: densidad ponderada por km² (hospital ×3, tren ×2, supermercado y centro comercial ×1, centro educativo ×0,5) expresada como percentil entre cantones. Infraestructura: suma de puntos por proyecto público citado (máx. 100). Mercado: solo anuncios publicados en MapMarket; con 5+ anuncios usa la tendencia de ₡/m² (90 días vs. antes) o, si no hay, el percentil de la mediana.')}</p><p class="mt-1" data-noi18n>${E(D.limites)}. ${E(D.osm)}</p></details>`);
  }
  async function activar() {
    const u = window.Auth && !Auth.demo ? await Auth.user() : null; if (window.Perm && Perm.ready) await Perm.ready;
    if (window.Perm && !Perm.can('plusvalia', u)) return window.Plus ? Plus.upsell('Plusvalía / Inversión') : alert(T('Disponible en Plus'));
    if (!D) D = await (await fetch('data/plusvalia.json')).json();
    calcular(); const map = MapController.map;
    capa = L.geoJSON(D.cantones, { style: f => ({ color: '#fff', weight: 1, fillColor: COL(f.properties.score), fillOpacity: .5 }), onEachFeature: (f, l) => { l.bindTooltip(`${E(f.properties.canton)}: ${f.properties.score}`, { sticky: true }); l.on('click', () => ficha(f.properties)) } }).addTo(map); capa.bringToBack();
    ley = L.control({ position: 'bottomleft' }); ley.onAdd = () => { const d = L.DomUtil.create('div', 'rounded-xl shadow bg-white/95 dark:bg-slate-800/95 dark:text-white p-2 text-xs'); d.innerHTML = `<b>📈 ${T('Plusvalía estimada')}</b>${[[80, '80–100'], [65, '65–79'], [50, '50–64'], [35, '35–49'], [0, '0–34']].map(([v, t]) => `<div class="flex items-center gap-1"><i style="background:${COL(v)}" class="inline-block w-3 h-3 rounded"></i>${t}</div>`).join('')}<div class="opacity-70 mt-1 max-w-[150px]">${T('Toca un cantón para ver el porqué. Estimación, no asesoría.')}</div>`; L.DomEvent.disableClickPropagation(d); return d }; ley.addTo(map);
    const tl = $('mmTierLeg'); if (tl) tl.style.display = 'none'; on = true; $('bPlusv').classList.add('bg-emerald-600', 'text-white');
  }
  function desactivar() { const map = MapController.map; if (capa) map.removeLayer(capa); if (ley) ley.remove(); capa = ley = null; on = false; const tl = $('mmTierLeg'); if (tl) tl.style.display = ''; $('bPlusv').classList.remove('bg-emerald-600', 'text-white') }
  window.addEventListener('mm-feat-ready', () => {
    const ref = $('bDraw'); if (!ref) return; const b = document.createElement('button'); b.id = 'bPlusv'; b.className = 'px-2 py-1 rounded-full border dark:border-slate-600 whitespace-nowrap'; b.textContent = '📈 ' + T('Plusvalía / Inversión');
    ref.parentNode.insertBefore(b, ref); b.onclick = () => (on ? desactivar() : activar()).catch && 0;
    b.onclick = () => { if (on) desactivar(); else activar().catch(e => alert(e.message)) };
    if (new URLSearchParams(location.search).get('capa') === 'plusvalia') activar().catch(() => { });
  });
})();
