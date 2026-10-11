/* MapMarket · editar mi anuncio (index.html?editar=<id>): todos los campos, fotos, ubicación y terreno dibujado.
   Cualquier cambio de contenido vuelve a revisión (lo fuerza el servidor: trigger anuncios_guardia). */
(function () {
  const id = new URLSearchParams(location.search).get('editar'); if (!id) return;
  const T = s => (window.MMT ? MMT(s) : s), $ = x => document.getElementById(x);
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PROV = ['San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón'];
  window.addEventListener('mm-feat-ready', () => setTimeout(abrir, 400));
  let a, c, map, pin, capa, nuevas = [];
  async function abrir() {
    try {
      const u = await Auth.user(); if (!u) return location.href = 'login.html?next=' + encodeURIComponent('index.html?editar=' + id);
      c = await Auth.client(); map = MapController.map;
      const r = await c.from('anuncios').select('*').eq('id', id).maybeSingle(); a = r.data;
      if (!a || (a.owner_id !== u.id && u.rol !== 'admin')) return alert(T('No encontramos ese anuncio o no es tuyo.'));
      if (a.lat) { map.setView([a.lat, a.lon], 17); marcar() } form();
    } catch (e) { alert(e.message) }
  }
  const marcar = () => { if (pin) map.removeLayer(pin); pin = L.marker([a.lat, a.lon], { draggable: true }).addTo(map); pin.on('dragend', () => { const l = pin.getLatLng(); a.lat = +l.lat.toFixed(6); a.lon = +l.lng.toFixed(6); upd() });
    if (capa) map.removeLayer(capa); capa = a.poligono ? L.polygon(MMDibujo.fromGeo(a.poligono), { color: '#e11d48', weight: 3, fillOpacity: .1 }).addTo(map) : null };
  const upd = () => { const el = $('eLoc'); if (el) el.textContent = `${a.lat}, ${a.lon}` + (a.area_terreno ? ` · ${MMDibujo.fmtA(a.area_terreno)}` : '') };
  const tipos = () => typeof EMO !== 'undefined' ? Object.keys(EMO) : ['Casa', 'Apartamento', 'Lote/Terreno', 'Comercio', 'Finca'];
  const amen = () => typeof AMEN_LBL !== 'undefined' ? Object.keys(AMEN_LBL) : [];
  function form() {
    const F = (k, l, t = 'text', v = a[k]) => `<label class="block text-sm">${T(l)}<input id="e_${k}" type="${t}" value="${E(v ?? '')}" class="w-full mt-1 px-2 rounded border dark:bg-slate-700 dark:border-slate-600" style="min-height:44px"></label>`;
    const S = (k, l, ops) => `<label class="block text-sm">${T(l)}<select id="e_${k}" class="w-full mt-1 px-2 rounded border dark:bg-slate-700 dark:border-slate-600" style="min-height:44px">${ops.map(o => `<option ${o === a[k] ? 'selected' : ''} value="${E(o)}">${T(o)}</option>`).join('')}</select></label>`;
    UI.modal(`<h2 class="text-xl font-bold pr-6">✏️ ${T('Editar anuncio')}</h2>
      <p class="text-xs mt-1 rounded-lg bg-amber-50 dark:bg-amber-950 p-2">${T('Al guardar cambios de contenido, el anuncio vuelve a revisión antes de mostrarse de nuevo.')}</p>
      <div class="grid grid-cols-2 gap-2 mt-3"><div class="col-span-2">${F('titulo', 'Título *')}</div>${S('tipo', 'Tipo', tipos())}${S('provincia', 'Provincia', PROV)}${F('precio', 'Precio *', 'number')}${S('moneda', 'Moneda', ['USD', 'CRC'])}${F('habitaciones', 'Habitaciones', 'number')}${F('banos', 'Baños', 'number')}${F('area', 'Área construida (m²)', 'number')}${F('zona', 'Zona / barrio')}</div>
      <label class="block text-sm mt-2">${T('Descripción')}<textarea id="e_descripcion" maxlength="2000" rows="4" class="w-full mt-1 p-2 rounded border dark:bg-slate-700 dark:border-slate-600">${E(a.descripcion || '')}</textarea></label>
      ${amen().length ? `<div class="flex flex-wrap gap-1 mt-2">${amen().map(x => `<label class="text-xs border rounded-full px-2 py-0.5 dark:border-slate-600"><input type="checkbox" class="eAm" value="${x}" ${(a.amenidades || []).includes(x) ? 'checked' : ''}> ${AMEN_LBL[x]}</label>`).join('')}</div>` : ''}
      <h3 class="font-semibold mt-3">📷 ${T('Fotos')}</h3><div id="eFotos" class="flex flex-wrap gap-2 mt-1"></div>
      <input id="eAdd" type="file" accept="image/*" multiple class="mt-2 text-sm"><p class="text-xs opacity-70">${T('Máximo 6 fotos. Las nuevas pasan por moderación.')}</p>
      <h3 class="font-semibold mt-3">📍 ${T('Ubicación y terreno')}</h3><p class="text-xs opacity-80">${T('Arrastra el pin en el mapa, pega coordenadas o un enlace de Google Maps, o dibuja el terreno.')}</p><div id="eLoc" class="text-xs font-mono mt-1"></div>
      <div class="flex gap-2 mt-1"><input id="eCoord" placeholder="${T('Pegar coordenadas o enlace de Google Maps')}" class="flex-1 px-2 rounded border dark:bg-slate-700 dark:border-slate-600" style="min-height:44px"><button id="eCoordB" class="rounded-lg border px-3" style="min-height:44px">${T('Usar')}</button></div>
      <div class="flex flex-wrap gap-2 mt-2"><button id="eDraw" class="rounded-lg border px-3" style="min-height:44px">✏️ ${T('Dibujar terreno')}</button>${a.poligono ? `<button id="eNoPoly" class="rounded-lg border px-3 text-red-600" style="min-height:44px">✖ ${T('Quitar terreno')}</button>` : ''}<button id="eMap" class="rounded-lg border px-3" style="min-height:44px">🗺️ ${T('Ver en el mapa')}</button></div>
      <div class="flex gap-2 mt-4"><button id="eSave" class="flex-1 rounded-xl bg-teal-600 text-white font-semibold" style="min-height:48px">💾 ${T('Guardar cambios')}</button><a href="cuenta.html#mis-anuncios" class="rounded-xl border px-4 grid place-items-center" style="min-height:48px">${T('Cancelar')}</a></div><p id="eMsg" class="text-sm mt-2"></p>`);
    fotos(); upd();
    $('eAdd').onchange = e => { nuevas = [...nuevas, ...e.target.files].slice(0, Math.max(0, 6 - (a.imagenes || []).length)); fotos() };
    $('eCoordB').onclick = async () => { const bb = $('eCoordB'); bb.disabled = true; const t0 = bb.textContent; bb.textContent = '⏳'; const r = await MMDibujo.parseCoords($('eCoord').value); bb.disabled = false; bb.textContent = t0; if (!r || r.error) return alert(T((r && r.error) || 'No reconocimos esas coordenadas.')); if (r.aviso) alert(r.aviso); a.lat = r.lat; a.lon = r.lon; marcar(); map.setView([a.lat, a.lon], 17); upd() };
    $('eDraw').onclick = () => { leer(); UI.close(); MMDibujo.dibujar(map, a.poligono ? MMDibujo.fromGeo(a.poligono) : [], v => { if (v && v.length >= 3) { a.poligono = MMDibujo.toGeo(v); a.area_terreno = Math.round(MMDibujo.area(v)) } marcar(); form() }) };
    if ($('eNoPoly')) $('eNoPoly').onclick = () => { leer(); a.poligono = null; a.area_terreno = null; marcar(); form() };
    $('eMap').onclick = () => { leer(); UI.close(); const b = document.createElement('button'); b.className = 'fixed z-[1600] bottom-4 left-1/2 -translate-x-1/2 rounded-xl bg-teal-600 text-white px-4 shadow-xl'; b.style.minHeight = '48px'; b.textContent = '↩ ' + T('Volver al formulario'); b.onclick = () => { b.remove(); form() }; document.body.appendChild(b) };
    $('eSave').onclick = guardar;
  }
  function fotos() {
    $('eFotos').innerHTML = (a.imagenes || []).map((u, i) => `<div class="relative"><img src="${E(u)}" alt="" class="w-20 h-20 object-cover rounded-lg"><button data-i="${i}" aria-label="${T('Quitar foto')}" class="eQ absolute -top-2 -right-2 w-7 h-7 rounded-full bg-red-600 text-white">✕</button></div>`).join('') + nuevas.map(f => `<div class="w-20 h-20 rounded-lg border-2 border-dashed grid place-items-center text-[10px] text-center p-1">🆕 ${E(f.name.slice(0, 18))}</div>`).join('');
    document.querySelectorAll('.eQ').forEach(b => b.onclick = () => { leer(); (a._quitar = a._quitar || []).push(a.imagenes[+b.dataset.i]); a.imagenes = a.imagenes.filter((_, i) => i !== +b.dataset.i); fotos() });
  }
  function leer() { const v = k => $('e_' + k) ? $('e_' + k).value : a[k], n = k => { const x = v(k); return x === '' || x == null ? null : +x };
    Object.assign(a, { titulo: String(v('titulo')).trim().slice(0, 140), tipo: v('tipo'), provincia: v('provincia'), precio: +v('precio'), moneda: v('moneda'), habitaciones: n('habitaciones'), banos: n('banos'), area: n('area'), zona: String(v('zona') || '').slice(0, 120) || null, descripcion: String(v('descripcion') || '').slice(0, 2000) || null });
    if (document.querySelector('.eAm')) a.amenidades = [...document.querySelectorAll('.eAm:checked')].map(x => x.value) }
  async function guardar() {
    leer(); const m = t => $('eMsg').textContent = t; if (!a.titulo || !(a.precio > 0)) return m(T('Título y precio son obligatorios.'));
    try { $('eSave').disabled = true; const urls = [], meta = [];
      for (const [i, f] of nuevas.entries()) { m(T('Subiendo foto') + ` ${i + 1}/${nuevas.length}…`); const b = await Publicar.shrink(f); const sc = await Publicar.analizar(b); const malo = sc ? (sc.Porn || 0) + (sc.Hentai || 0) : 0;
        if (malo >= 0.85) throw new Error(T('Una foto parece contenido inapropiado y no se puede publicar.')); const path = `${a.owner_id}/${Date.now()}-${i}.jpg`;
        const { error } = await c.storage.from('anuncios').upload(path, b, { contentType: 'image/jpeg' }); if (error) throw error; const url = c.storage.from('anuncios').getPublicUrl(path).data.publicUrl; urls.push(url); meta.push({ score: sc, marcar: !!sc && (malo >= 0.5 || (sc.Sexy || 0) >= 0.7) }) }
      const row = { titulo: a.titulo, tipo: a.tipo, provincia: a.provincia, precio: a.precio, moneda: a.moneda, habitaciones: a.habitaciones, banos: a.banos, area: a.area, zona: a.zona, descripcion: a.descripcion, amenidades: a.amenidades || [], imagenes: [...(a.imagenes || []), ...urls], lat: a.lat, lon: a.lon, poligono: a.poligono || null, area_terreno: a.area_terreno || null };
      m(T('Guardando…')); const { error } = await c.from('anuncios').update(row).eq('id', a.id); if (error) throw error;
      if (urls.length) { await c.rpc('registrar_imagenes', { anuncio: a.id, items: urls.map((url, i) => ({ url, ...meta[i] })) }); c.functions.invoke('moderar-imagenes', { body: { anuncio: a.id } }).catch(() => { }) }
      const pref = c.storage.from('anuncios').getPublicUrl('').data.publicUrl; const quitar = (a._quitar || []).filter(u => u.startsWith(pref)).map(u => decodeURIComponent(u.slice(pref.length).replace(/^\//, '')));
      if (quitar.length) await c.storage.from('anuncios').remove(quitar);
      m('✅ ' + T('Cambios guardados. Tu anuncio quedó en revisión.')); setTimeout(() => location.href = 'cuenta.html#mis-anuncios', 1400)
    } catch (e) { m('⚠️ ' + e.message); $('eSave').disabled = false }
  }
})();
