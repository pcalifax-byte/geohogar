/* MapMarket · Publicar: pegar coordenadas / enlace de Google Maps + herramienta «Lápiz» para dibujar el terreno.
   El polígono se guarda con el anuncio (anuncios.poligono, GeoJSON) y se muestra en el mapa (zoom ≥ 15) y en la ficha. */
(function () {
  const $ = i => document.getElementById(i), CR = { s: 8, n: 11.3, w: -86, e: -82.5 };
  const T = window.MMT || (k => k); // listo para i18n
  const enCR = (a, o) => a >= CR.s && a <= CR.n && o >= CR.w && o <= CR.e;

  /* ---------- Parser de coordenadas ---------- */
  function olcDecode(code) { // Open Location Code completo (p. ej. 762H2W8Q+XX)
    const A = '23456789CFGHJMPQRVWX'; code = code.toUpperCase().replace('+', '').replace(/0+$/, '');
    if (code.length < 8) return null; let lat = -90, lon = -180, rs = 20;
    for (let i = 0; i < Math.min(code.length, 10); i += 2) { const a = A.indexOf(code[i]), b = A.indexOf(code[i + 1]); if (a < 0 || b < 0) return null; lat += a * rs; lon += b * rs; if (i < 8) rs /= 20 }
    const r = rs * (code.length >= 10 ? 1 : 20); return { lat: lat + r / 2, lon: lon + r / 2 };
  }
  const CORTO = /^\s*(https?:\/\/)?(maps\.app\.goo\.gl\/|goo\.gl\/maps\/|g\.co\/kgs\/)\S+/i;
  async function resolveCoords(txt) {
    const s = String(txt || '').trim(), m = s.match(CORTO);
    if (!m) return parseCoords(s);
    const url = (m[1] ? '' : 'https://') + m[0].trim();
    try {
      const C = window.GH_CONFIG || {}, r = await fetch(C.supabaseUrl + '/functions/v1/resolve-maps-link', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey }, body: JSON.stringify({ url }) });
      const d = await r.json();
      if (d && d.lat != null) { const p = parseCoords(d.lat + ', ' + d.lon); if (!p.error && d.approx) p.aviso = T('Ubicación aproximada (el enlace no trae coordenadas exactas): revisa y mueve el pin.'); return p }
      if (r.status === 429) return { error: T('Demasiadas consultas. Espera un minuto e intenta de nuevo.') };
    } catch (e) {}
    return { error: T('No pudimos leer ese enlace corto. Ábrelo en Google Maps, mantén presionado el punto y copia las coordenadas.') };
  }
  function parseCoords(txt) {
    const s = String(txt || '').trim(); if (!s) return { error: T('Pega coordenadas o un enlace.') };
    let m, lat, lon;
    const dec = decodeURIComponent(s);
    if ((m = dec.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/))) { lat = +m[1]; lon = +m[2] }
    else if ((m = dec.match(/[?&](?:q|query|ll|destination|center)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/))) { lat = +m[1]; lon = +m[2] }
    else if ((m = dec.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/))) { lat = +m[1]; lon = +m[2] }
    else if ((m = dec.match(/(\d{1,2})\s*°\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:[.,]\d+)?)?\s*(?:["″”]|'')?\s*([NS])[\s,;]*(\d{1,3})\s*°\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:[.,]\d+)?)?\s*(?:["″”]|'')?\s*([EWO])/i))) {
      const f = (d, mi, se) => +d + +mi / 60 + (+(String(se || 0).replace(',', '.'))) / 3600;
      lat = f(m[1], m[2], m[3]) * (/S/i.test(m[4]) ? -1 : 1); lon = f(m[5], m[6], m[7]) * (/[WO]/i.test(m[8]) ? -1 : 1);
    }
    else if ((m = dec.match(/\b([23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{0,3})\b/i))) { const r = olcDecode(m[1]); if (r) { lat = r.lat; lon = r.lon } }
    else if ((m = dec.match(/\b[23456789CFGHJMPQRVWX]{4,6}\+[23456789CFGHJMPQRVWX]{2,3}\b/i))) return { error: T('Ese Plus Code es corto (sin la parte de región). Copia el código completo, p. ej. 66XXXXXX+XX, o usa las coordenadas.') };
    else if ((m = dec.match(/(-?\d{1,3}[.,]\d+)\s*[,;\s]\s*(-?\d{1,3}[.,]\d+)/))) { lat = +m[1].replace(',', '.'); lon = +m[2].replace(',', '.') }
    if (lat == null || isNaN(lat) || isNaN(lon)) return { error: T('No reconocí el formato. Ejemplos: 9.9281, -84.0907 · 9°55\'41"N 84°05\'26"W · enlace de Google Maps con @lat,lng.') };
    if (!enCR(lat, lon) && enCR(lon, lat)) [lat, lon] = [lon, lat];
    if (!enCR(lat, lon) && lon > 0 && enCR(lat, -lon)) lon = -lon; // longitud sin signo
    if (!enCR(lat, lon)) return { error: T('Esa ubicación está fuera de Costa Rica') + ` (${lat.toFixed(5)}, ${lon.toFixed(5)}).` };
    return { lat: +lat.toFixed(6), lon: +lon.toFixed(6) };
  }

  /* ---------- Geometría ---------- */
  const R = 6378137, rad = Math.PI / 180;
  function area(ll) { if (ll.length < 3) return 0; let s = 0; for (let i = 0; i < ll.length; i++) { const [a1, o1] = ll[i], [a2, o2] = ll[(i + 1) % ll.length]; s += (o2 - o1) * rad * (2 + Math.sin(a1 * rad) + Math.sin(a2 * rad)) } return Math.abs(s * R * R / 2) }
  const hav = (a, b) => { const x = Math.sin((b[0] - a[0]) * rad / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin((b[1] - a[1]) * rad / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)) };
  function perim(ll, closed = true) { let s = 0; for (let i = 0; i < ll.length - (closed ? 0 : 1); i++) s += hav(ll[i], ll[(i + 1) % ll.length]); return s }
  const fmtA = m2 => m2 >= 10000 ? (m2 / 10000).toLocaleString('es-CR', { maximumFractionDigits: 2 }) + ' ha (' + Math.round(m2).toLocaleString('es-CR') + ' m²)' : Math.round(m2).toLocaleString('es-CR') + ' m²';
  const fmtL = m => m >= 1000 ? (m / 1000).toLocaleString('es-CR', { maximumFractionDigits: 2 }) + ' km' : Math.round(m).toLocaleString('es-CR') + ' m';
  function simplify(pts, tol) { // Douglas-Peucker en píxeles
    if (pts.length < 3) return pts; const sq = tol * tol;
    const d2 = (p, a, b) => { let x = a.x, y = a.y, dx = b.x - x, dy = b.y - y; if (dx || dy) { const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy); if (t > 1) { x = b.x; y = b.y } else if (t > 0) { x += dx * t; y += dy * t } } dx = p.x - x; dy = p.y - y; return dx * dx + dy * dy };
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
    while (st.length) { const [f, l] = st.pop(); let mx = 0, ix = 0; for (let i = f + 1; i < l; i++) { const d = d2(pts[i], pts[f], pts[l]); if (d > mx) { mx = d; ix = i } } if (mx > sq) { keep[ix] = 1; st.push([f, ix], [ix, l]) } }
    return pts.filter((_, i) => keep[i]);
  }
  function chaikin(pts, it = 2) { for (let k = 0; k < it; k++) { const o = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; o.push({ x: .75 * a.x + .25 * b.x, y: .75 * a.y + .25 * b.y }, { x: .25 * a.x + .75 * b.x, y: .25 * a.y + .75 * b.y }) } pts = o } return pts }
  const toGeo = ll => ({ type: 'Polygon', coordinates: [[...ll.map(([a, o]) => [+o.toFixed(7), +a.toFixed(7)]), [+ll[0][1].toFixed(7), +ll[0][0].toFixed(7)]]] });
  const fromGeo = g => g && g.coordinates && g.coordinates[0] ? g.coordinates[0].slice(0, -1).map(([o, a]) => [a, o]) : [];

  /* ---------- Herramienta de dibujo ---------- */
  function dibujar(map, inicial, onDone) {
    let verts = inicial ? inicial.slice() : [], hist = [verts.slice()], fut = [], tool = 'lapiz', color = localStorage.getItem('mm_dib_color') || '#e11d48', grosor = +(localStorage.getItem('mm_dib_grosor') || 3), lock = true, raw = null, live = null;
    const layer = L.layerGroup().addTo(map), el = map.getContainer();
    const bar = document.createElement('div'); bar.id = 'dibBar'; bar.className = 'fixed z-[1500] inset-x-2 bottom-2 rounded-2xl shadow-2xl bg-white/95 dark:bg-slate-800/95 backdrop-blur p-2 text-sm';
    const B = (id, t, lbl) => `<button id="${id}" type="button" title="${lbl}" aria-label="${lbl}" class="dbB rounded-xl border dark:border-slate-600 px-2 min-w-[48px]" style="min-height:48px">${t}</button>`;
    bar.innerHTML = `<div id="dibInfo" class="text-center text-xs font-semibold mb-1" aria-live="polite"></div><div class="flex flex-wrap gap-1.5 justify-center">
      ${B('dbLapiz', '✏️<span class="hidden sm:inline"> Lápiz</span>', T('Lápiz: dibuja a mano alzada'))}${B('dbPuntos', '📐<span class="hidden sm:inline"> Puntos</span>', T('Polígono por puntos'))}${B('dbMover', '✋<span class="hidden sm:inline"> Mover</span>', T('Mover vértices'))}${B('dbBorr', '🧽<span class="hidden sm:inline"> Borrador</span>', T('Borrador: toca un vértice para quitarlo'))}
      ${B('dbUndo', '↶', T('Deshacer'))}${B('dbRedo', '↷', T('Rehacer'))}${B('dbClear', '🗑️', T('Borrar todo'))}${B('dbLock', '🔒', T('Bloquear/desbloquear mover el mapa'))}
      <label class="flex items-center gap-1 text-xs px-1">${T('Grosor')}<input id="dbG" type="range" min="1" max="8" value="${grosor}" class="w-16" aria-label="${T('Grosor')}"></label><input id="dbC" type="color" value="${color}" class="w-12 rounded" style="height:48px" aria-label="${T('Color')}">
      <button id="dbOk" type="button" class="rounded-xl bg-teal-600 text-white px-4 font-semibold" style="min-height:48px">✅ ${T('Listo')}</button><button id="dbX" type="button" class="rounded-xl border dark:border-slate-600 px-3" style="min-height:48px">✕</button></div>`;
    document.body.appendChild(bar);
    const ll2p = ([a, o]) => map.latLngToContainerPoint([a, o]), p2ll = p => { const q = map.containerPointToLatLng([p.x, p.y]); return [q.lat, q.lng] };
    const push = () => { hist.push(verts.slice()); fut = []; draw() };
    function draw() {
      layer.clearLayers(); const st = { color, weight: grosor, fillColor: color, fillOpacity: .15 };
      if (verts.length >= 3) L.polygon(verts, st).addTo(layer); else if (verts.length) L.polyline(verts, st).addTo(layer);
      if (tool === 'mover' || tool === 'borrador' || tool === 'puntos') verts.forEach((v, i) => {
        const m = L.marker(v, { draggable: tool === 'mover', icon: L.divIcon({ className: '', html: `<div style="width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:#fff;border:3px solid ${i === 0 ? '#0d9488' : color};box-shadow:0 1px 3px #0006"></div>`, iconSize: [0, 0] }) }).addTo(layer);
        m.on('drag', e => { verts[i] = [e.latlng.lat, e.latlng.lng]; info() }); m.on('dragend', push);
        m.on('click', e => { L.DomEvent.stop(e); if (tool === 'borrador') { verts.splice(i, 1); push() } else if (tool === 'puntos' && i === 0 && verts.length >= 3) { setTool('mover') } });
      });
      info(); document.querySelectorAll('.dbB').forEach(b => b.classList.remove('bg-teal-600', 'text-white'));
      const on = { lapiz: 'dbLapiz', puntos: 'dbPuntos', mover: 'dbMover', borrador: 'dbBorr' }[tool]; $(on) && $(on).classList.add('bg-teal-600', 'text-white'); $('dbLock').textContent = lock ? '🔒' : '🔓';
    }
    function info() { $('dibInfo').textContent = verts.length >= 3 ? `${T('Área')}: ${fmtA(area(verts))} · ${T('Perímetro')}: ${fmtL(perim(verts))}` : tool === 'lapiz' ? T('Dibuja el contorno del terreno con el dedo, el mouse o el lápiz') : tool === 'puntos' ? T('Toca para agregar vértices; toca el primero para cerrar') : T('Dibuja primero un contorno'); }
    function setTool(t) { tool = t; applyLock(); draw() }
    function applyLock() { const l = lock && (tool === 'lapiz'); l ? map.dragging.disable() : map.dragging.enable(); el.style.touchAction = l ? 'none' : ''; el.style.cursor = tool === 'lapiz' && lock ? 'crosshair' : '' }
    const down = e => { if (tool !== 'lapiz' || !lock || e.target.closest('#dibBar') || (e.button != null && e.button > 0)) return; e.preventDefault(); el.setPointerCapture && el.setPointerCapture(e.pointerId); const r = el.getBoundingClientRect(); raw = [{ x: e.clientX - r.left, y: e.clientY - r.top }]; live = L.polyline([], { color, weight: grosor }).addTo(map) };
    const move = e => { if (!raw) return; const r = el.getBoundingClientRect(), p = { x: e.clientX - r.left, y: e.clientY - r.top }, q = raw[raw.length - 1]; if (Math.hypot(p.x - q.x, p.y - q.y) < 3) return; raw.push(p); live.addLatLng(p2ll(p)) };
    const up = () => { if (!raw) return; map.removeLayer(live); live = null; let pts = raw; raw = null; if (pts.length < 4) return; pts = simplify(pts, 3); if (pts.length < 3) return; pts = simplify(chaikin(pts, 2), 1.2); verts = pts.map(p2ll); push() };
    el.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    const clk = e => { if (tool !== 'puntos') return; const p = map.latLngToContainerPoint(e.latlng); if (verts.length >= 3 && p.distanceTo(ll2p(verts[0])) < 18) { setTool('mover'); return } verts.push([e.latlng.lat, e.latlng.lng]); push() };
    map.on('click', clk);
    const fin = ok => { el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); map.off('click', clk); map.dragging.enable(); el.style.touchAction = ''; el.style.cursor = ''; map.removeLayer(layer); bar.remove(); onDone(ok ? verts : null) };
    $('dbLapiz').onclick = () => setTool('lapiz'); $('dbPuntos').onclick = () => setTool('puntos'); $('dbMover').onclick = () => setTool('mover'); $('dbBorr').onclick = () => setTool('borrador');
    $('dbUndo').onclick = () => { if (hist.length > 1) { fut.push(hist.pop()); verts = hist[hist.length - 1].slice(); draw() } };
    $('dbRedo').onclick = () => { if (fut.length) { const v = fut.pop(); hist.push(v); verts = v.slice(); draw() } };
    $('dbClear').onclick = () => { verts = []; push() }; $('dbLock').onclick = () => { lock = !lock; applyLock(); draw() };
    $('dbG').oninput = e => { grosor = +e.target.value; localStorage.setItem('mm_dib_grosor', grosor); draw() }; $('dbC').oninput = e => { color = e.target.value; localStorage.setItem('mm_dib_color', color); draw() };
    $('dbOk').onclick = () => { if (verts.length && verts.length < 3) return alert(T('El contorno necesita al menos 3 vértices.')); fin(true) }; $('dbX').onclick = () => fin(false);
    if (verts.length >= 3) { map.fitBounds(L.polygon(verts).getBounds(), { padding: [40, 120] }); tool = 'mover' } else if (map.getZoom() < 16) map.setZoom(17);
    applyLock(); draw();
  }

  /* ---------- Integración con «Publicar» ---------- */
  const IDS = ['nT', 'nY', 'nV', 'nP', 'nC', 'nB', 'nBa', 'nA', 'nL', 'nD'];
  const guardar = () => { const d = UI.draft = UI.draft || {}; IDS.forEach(k => { if ($(k)) d[k] = $(k).value }); d.am = [...document.querySelectorAll('.nAm:checked')].map(x => x.value) };
  function patch() {
    const orig = UI.publish.bind(UI);
    UI.publish = function (map, onSaved) {
      orig(map, onSaved); const pick = $('nPick'); if (!pick) return; const d = UI.draft || (UI.draft = {});
      const verts = fromGeo(d.poly), a = verts.length >= 3 ? area(verts) : 0;
      pick.parentElement.insertAdjacentHTML('afterend', `<div class="mt-2 rounded-lg border dark:border-slate-600 p-2 text-sm">
        <label class="block text-xs font-semibold" for="nCoord">${T('Pegar coordenadas o enlace de Google Maps')}</label>
        <div class="flex gap-2 mt-1"><input id="nCoord" class="flex-1 px-2 rounded border dark:bg-slate-700 dark:border-slate-600" style="min-height:44px" placeholder="9.9281, -84.0907 · 9°55'41&quot;N 84°05'26&quot;W · https://maps.google.com/…@9.92,-84.09"><button id="nCoordOk" type="button" class="rounded-lg bg-teal-600 text-white px-3" style="min-height:44px">${T('Usar')}</button></div>
        <p id="nCoordMsg" class="text-xs mt-1" role="status"></p>
        ${d.lat ? `<a class="text-xs underline text-teal-700 dark:text-teal-300" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${d.lat},${d.lon}">🔎 ${T('Abrir en Google Maps para verificar')}</a>` : ''}
        <div class="flex flex-wrap items-center gap-2 mt-2"><button id="nDraw" type="button" class="rounded-lg border border-rose-500 text-rose-700 dark:text-rose-300 px-3" style="min-height:44px">✏️ ${verts.length >= 3 ? T('Editar contorno del terreno') : T('Dibujar contorno del terreno (Lápiz)')}</button>${a ? `<span class="text-xs">✅ ${fmtA(a)} · ${fmtL(perim(verts))}</span><button id="nDrawDel" type="button" class="text-xs underline text-red-600" style="min-height:36px">${T('Quitar')}</button>` : '<span class="text-xs opacity-60">' + T('Opcional') + '</span>'}</div></div>`);
      $('nCoordOk').onclick = async () => { const m0 = $('nCoordMsg'), b0 = $('nCoordOk'); if (CORTO.test($('nCoord').value)) { m0.className = 'text-xs mt-1 opacity-80'; m0.textContent = '⏳ ' + T('Leyendo enlace…'); b0.disabled = true } const r = await resolveCoords($('nCoord').value), m = $('nCoordMsg'); if (b0) b0.disabled = false; if (r.error) { m.className = 'text-xs mt-1 text-red-600'; m.textContent = r.error; return } guardar(); d.lat = r.lat; d.lon = r.lon; UI.publish(map, onSaved); map.setView([r.lat, r.lon], 17); const m2 = $('nCoordMsg'); if (m2) { m2.className = 'text-xs mt-1 text-emerald-600'; m2.textContent = '📍 ' + T('Ubicación colocada') + `: ${r.lat}, ${r.lon}` + (r.aviso ? ' · ⚠️ ' + r.aviso : '') } };
      $('nCoord').onpaste = () => setTimeout(() => { if (CORTO.test($('nCoord').value)) $('nCoordOk').click() }, 50);
      $('nCoord').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('nCoordOk').click() } };
      $('nDraw').onclick = () => { guardar(); UI.close(); if (d.lat && !verts.length) map.setView([d.lat, d.lon], 18); dibujar(map, verts, v => { if (v) { if (v.length >= 3) { d.poly = toGeo(v); d.area_terreno = Math.round(area(v)); if (!d.lat) { const c = L.polygon(v).getBounds().getCenter(); d.lat = c.lat; d.lon = c.lng } } else { d.poly = null; d.area_terreno = null } } UI.publish(map, onSaved) }) };
      if ($('nDrawDel')) $('nDrawDel').onclick = () => { guardar(); d.poly = null; d.area_terreno = null; UI.publish(map, onSaved) };
    };
  }

  /* ---------- Mostrar contornos en el mapa y en la ficha ---------- */
  let capa = null;
  function contornos() {
    const map = MapController.map; if (!capa) capa = L.layerGroup().addTo(map);
    capa.clearLayers(); if (map.getZoom() < 15) return; const b = map.getBounds().pad(.2);
    (App.visible || []).filter(p => p.poly && b.contains([p.lat, p.lon])).slice(0, 200).forEach(p => L.polygon(fromGeo(p.poly), { color: '#e11d48', weight: 2, fillOpacity: .08, dashArray: '4 3' }).on('click', () => UI.showCard(p)).addTo(capa));
  }
  function svg(p) {
    const v = fromGeo(p.poly); if (v.length < 3) return ''; const xs = v.map(x => x[1]), ys = v.map(x => x[0]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), k = Math.cos(((y0 + y1) / 2) * rad), w = (x1 - x0) * k || 1e-9, h = (y1 - y0) || 1e-9, s = 90 / Math.max(w, h);
    const pts = v.map(([a, o]) => `${(5 + (o - x0) * k * s).toFixed(1)},${(5 + (y1 - a) * s).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 100 100" width="64" height="64" aria-hidden="true"><polygon points="${pts}" fill="#e11d4822" stroke="#e11d48" stroke-width="2"/></svg>`;
  }
  window.MMDibujo = { dibujar, parseCoords: resolveCoords, parseSync: parseCoords, area, perim, fmtA, fmtL, toGeo, fromGeo };
  window.addEventListener('mm-feat-ready', () => {
    try { patch() } catch (e) { console.warn('dibujo', e) }
    const map = MapController.map; map.on('moveend zoomend', contornos);
    const rf = App.refresh.bind(App); App.refresh = function () { rf(); try { contornos() } catch (e) { } };
    const sc = UI.showCard.bind(UI);
    UI.showCard = p => { sc(p); if (!p || !p.poly) return; const h = document.querySelector('#card h2'); if (!h) return; const v = fromGeo(p.poly);
      const box = document.createElement('button'); box.type = 'button'; box.className = 'mt-2 flex items-center gap-2 text-xs rounded-lg border dark:border-slate-600 p-1 pr-3 text-left'; box.innerHTML = svg(p) + `<span><b>${T('Terreno dibujado')}</b><br>${fmtA(area(v))} · ${T('perímetro')} ${fmtL(perim(v))}<br><span class="underline">${T('Ver en el mapa')}</span></span>`;
      box.onclick = () => { map.fitBounds(L.polygon(v).getBounds(), { padding: [30, 30] }) }; h.parentElement.appendChild(box) };
  });
})();
