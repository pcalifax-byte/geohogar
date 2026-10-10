/* MapMarket · funciones v2: tarjeta mejorada, compartir/reportar, listas, alertas de precio,
   comparador, datos de zona, modo agente (vistas/contactos/calificaciones/destacadas), tiempos aprox. */
(function () {
  const $ = i => document.getElementById(i), E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }, SS = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const BASE = (window.GH_CONFIG && GH_CONFIG.siteUrl) || new URL('./', location.href).href;
  const fmt = n => Math.round(n).toLocaleString('es-CR'), crc = p => p.price ? (p.currency === 'CRC' ? p.price : p.price * CONFIG.USD_CRC) : null;
  const med = a => { a = a.filter(x => x > 0).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null };
  const M = v => v == null ? '—' : '₡' + (v >= 1e6 ? (v / 1e6).toFixed(v >= 1e8 ? 0 : 1) + 'M' : fmt(v));

  /* ---------- Datos remotos (Supabase) con respaldo local ---------- */
  const DB = {
    _ok: null,
    async c() {
      if (Auth.demo) return null;
      try { const c = await Auth.client();
        if (this._ok === null) this._ok = c.from('destacadas').select('property_id').limit(1).then(r => !r.error, () => false); // ¿ya se ejecutó supabase_setup.sql v2?
        return (await this._ok) ? c : null } catch { return null }
    },
    async uid() { const u = await Auth.user(); return u && !u.demo ? u.id : null },
    async insert(t, row, lsKey) {
      const c = await this.c(); if (c) { const { error } = await c.from(t).insert(row); if (!error) return 'remoto'; console.warn(t, error.message) }
      const l = LS(lsKey, []); l.push({ ...row, created_at: new Date().toISOString() }); SS(lsKey, l); return 'local';
    },
    async select(t, q, lsKey) {
      const c = await this.c(); if (c && await this.uid()) { const { data, error } = await q(c.from(t)); if (!error) return data || [] }
      return LS(lsKey, []);
    }
  };

  /* ---------- Eventos: vistas y contactos ---------- */
  const Ev = {
    track(p, tipo) {
      const k = 'mm_ev', l = LS(k, {}); const key = p.id + ':' + tipo; l[key] = (l[key] || 0) + 1; SS(k, l);
      DB.c().then(c => c && c.from('eventos').insert({ property_id: String(p.id), tipo }).then(() => {}, () => {}));
    },
    async stats(ids) {
      const out = {}; ids.forEach(i => out[i] = { vistas: 0, contactos: 0 });
      const c = await DB.c(); if (c) { const { data, error } = await c.rpc('stats_propiedades', { ids: ids.map(String) }); if (!error && data) { data.forEach(r => out[r.property_id] = { vistas: +r.vistas, contactos: +r.contactos }); return out } }
      const l = LS('mm_ev', {}); ids.forEach(i => out[i] = { vistas: l[i + ':vista'] || 0, contactos: l[i + ':contacto'] || 0, local: true }); return out;
    }
  };

  /* ---------- Destacadas ---------- */
  const Dest = {
    set: new Set(LS('mm_destacadas', []).map(String)),
    async load() { const c = await DB.c(); if (c) { const { data, error } = await c.from('destacadas').select('property_id').gt('hasta', new Date().toISOString()); if (!error && data) data.forEach(r => this.set.add(String(r.property_id))) } },
    async toggle(p) {
      if (!Plus.plus) return Plus.upsell('Destacar propiedades (Modo Agente)');
      const id = String(p.id), c = await DB.c(), uid = await DB.uid(), on = !this.set.has(id);
      if (c && uid) { const r = on ? await c.from('destacadas').upsert({ property_id: id, user_id: uid, hasta: new Date(Date.now() + 30 * 864e5).toISOString() }) : await c.from('destacadas').delete().eq('property_id', id).eq('user_id', uid); if (r.error) console.warn(r.error.message) }
      on ? this.set.add(id) : this.set.delete(id); SS('mm_destacadas', [...this.set]); App.refresh(); return on;
    }
  };

  /* ---------- Calificaciones de agentes ---------- */
  const Rate = {
    async get(agent) {
      const c = await DB.c(); if (c) { const { data, error } = await c.rpc('rating_agente', { agente: agent }); if (!error && data && data[0]) return { avg: +data[0].promedio || 0, n: +data[0].total || 0 } }
      const l = LS('mm_ratings', {})[agent]; return l ? { avg: l, n: 1, local: true } : { avg: 0, n: 0 };
    },
    async set(agent, stars) {
      const l = LS('mm_ratings', {}); l[agent] = stars; SS('mm_ratings', l);
      const c = await DB.c(), uid = await DB.uid(); if (c && uid) { const { error } = await c.from('calificaciones_agente').upsert({ agente: agent, user_id: uid, estrellas: stars }, { onConflict: 'agente,user_id' }); if (error) console.warn(error.message) }
    }
  };

  /* ---------- POIs cercanos y tiempos aproximados ---------- */
  const hv = (a, b, c, d) => { const R = 6371, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)) };
  const near = (p, k) => { let best = null; for (const q of (EMBED.pois || [])) if (q.k === k) { const d = hv(p.lat, p.lon, q.lat, q.lon); if (!best || d < best.d) best = { ...q, d } } return best };
  const mins = d => Math.max(2, Math.round(d * 1.4 / (d < 5 ? 25 : 40) * 60)); // factor vial 1.4; 25 km/h urbano, 40 km/h interurbano
  const NK = { hospital: '🏥 Hospital', supermarket: '🛒 Supermercado', tren: '🚆 Tren', mall: '🏬 Centro comercial' };
  let osrmLast = 0;
  async function osrm(p, q) {
    if (Date.now() - osrmLast < 3000) throw new Error('Espera unos segundos entre consultas.'); osrmLast = Date.now();
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${p.lon},${p.lat};${q.lon},${q.lat}?overview=false`); const j = await r.json();
    if (!j.routes || !j.routes[0]) throw new Error('Sin ruta'); return { min: Math.round(j.routes[0].duration / 60), km: (j.routes[0].distance / 1000).toFixed(1) };
  }
  const cercania = p => Object.keys(NK).map(k => { const n = near(p, k); return n && n.d < 60 ? { k, n } : null }).filter(Boolean);

  /* ---------- Comparador ---------- */
  const Cmp = {
    ids: LS('mm_cmp', []),
    has(p) { return this.ids.includes(String(p.id)) },
    toggle(p) { const id = String(p.id); if (this.has(p)) this.ids = this.ids.filter(x => x !== id); else { if (this.ids.length >= 3) { alert('Puedes comparar hasta 3 propiedades.'); return } this.ids.push(id) } SS('mm_cmp', this.ids); this.bar() },
    bar() {
      let b = $('cmpBar'); if (!b) { b = document.createElement('div'); b.id = 'cmpBar'; b.className = 'fixed z-[1002] left-1/2 -translate-x-1/2 bottom-20 md:bottom-4 bg-slate-900 text-white rounded-full shadow-2xl px-4 py-2 text-sm flex gap-3 items-center mm-pop'; document.body.appendChild(b) }
      b.classList.toggle('hidden', !this.ids.length);
      b.innerHTML = `⚖️ Comparar <b>${this.ids.length}</b>/3 <button id="cmpGo" class="bg-teal-500 rounded-full px-3 py-0.5 font-semibold ${this.ids.length < 2 ? 'opacity-50' : ''}">Ver</button><button id="cmpX" class="opacity-70">✕</button>`;
      $('cmpGo').onclick = () => this.ids.length < 2 ? alert('Elige al menos 2 propiedades (botón «⚖️ Comparar» en la ficha).') : this.show();
      $('cmpX').onclick = () => { this.ids = []; SS('mm_cmp', []); this.bar() };
    },
    show() {
      const ps = this.ids.map(i => App.all.find(p => String(p.id) === i)).filter(Boolean);
      const m2 = p => p.area || p.lot, ppm = p => crc(p) && m2(p) ? crc(p) / m2(p) : null;
      const best = (f, low) => { const v = ps.map(f).filter(x => x != null); return v.length ? (low ? Math.min(...v) : Math.max(...v)) : null };
      const row = (l, f, show, low) => { const b = best(f, low); return `<tr class="border-t dark:border-slate-700"><td class="p-2 text-xs opacity-70">${l}</td>${ps.map(p => { const v = f(p); return `<td class="p-2 text-center ${v != null && v === b && ps.length > 1 && low !== undefined ? 'text-teal-600 dark:text-teal-400 font-bold' : ''}">${show(v, p)}</td>` }).join('')}</tr>` };
      const pois = ['hospital', 'supermarket', 'tren'];
      UI.modal(`<h2 class="text-xl font-bold">⚖️ Comparador</h2><div class="overflow-x-auto mt-3"><table class="w-full text-sm"><thead><tr><th></th>${ps.map(p => `<th class="p-2 align-top"><div class="w-full h-20 rounded-lg bg-slate-200 dark:bg-slate-700 bg-cover bg-center" style="background-image:url('${E((p.images || [])[0] || '')}')"></div><div class="text-xs mt-1 font-semibold line-clamp-2">${E(p.title)}</div></th>`).join('')}</tr></thead><tbody>
        ${row('Precio', crc, v => M(v), true)}${row('Precio (original)', p => p.price, (v, p) => E(DataService.short(p)))}${row('m²', m2, v => v ? fmt(v) + ' m²' : '—', false)}${row('₡ / m²', ppm, v => v ? '₡' + fmt(v) : '—', true)}
        ${row('Habitaciones', p => p.beds, v => v ?? '—', false)}${row('Baños', p => p.baths, v => v ?? '—', false)}${row('Tipo', p => p.type, v => E(v))}${row('Ubicación', p => p.location, v => E(v))}
        ${row('Amenidades', p => (p.amenidades || []).length, (v, p) => (p.amenidades || []).map(a => E(AMEN_LBL[a] || a)).join(', ') || '—', false)}
        ${pois.map(k => row(NK[k] + ' más cercano', p => { const n = near(p, k); return n ? n.d : null }, v => v == null ? '—' : `${v.toFixed(1)} km · ~${mins(v)} min`, true)).join('')}
      </tbody></table></div><p class="text-[11px] opacity-60 mt-2">Distancias en línea recta a puntos de OpenStreetMap; minutos aproximados (factor vial 1,4 y velocidad promedio), no son rutas reales. En verde: mejor valor.</p>
      <div class="flex gap-2 mt-3">${ps.map(p => `<button data-id="${E(p.id)}" class="cmpOpen border rounded-lg px-2 py-1 text-xs dark:border-slate-600">Ver ficha: ${E(p.title.slice(0, 22))}…</button>`).join('')}</div>`);
      document.querySelectorAll('.cmpOpen').forEach(b => b.onclick = () => { UI.close(); Feat.open(b.dataset.id) });
    }
  };

  /* ---------- Listas de favoritos ---------- */
  const Lists = {
    key: 'mm_listas',
    local() { return LS(this.key, [{ id: 'fav', nombre: 'Favoritos', items: [] }]) },
    async all() {
      const c = await DB.c(), uid = await DB.uid();
      if (c && uid) { const { data, error } = await c.from('listas').select('id,nombre,lista_items(property_id)').order('created_at'); if (!error) return (data || []).map(l => ({ id: l.id, nombre: l.nombre, items: (l.lista_items || []).map(i => i.property_id) })) }
      return this.local();
    },
    async create(nombre) {
      const ls = await this.all(); if (!Plus.plus && ls.length >= 2) { Plus.upsell('Más de 2 listas de favoritos'); return null }
      const c = await DB.c(), uid = await DB.uid();
      if (c && uid) { const { data, error } = await c.from('listas').insert({ nombre }).select().single(); if (!error) return data.id; alert(error.message); return null }
      const l = this.local(); const id = 'l' + Date.now(); l.push({ id, nombre, items: [] }); SS(this.key, l); return id;
    },
    async add(listId, p) {
      const total = (await this.all()).reduce((a, l) => a + l.items.length, 0), lim = GH_CONFIG.limiteFavoritosGratis || 10;
      if (!Plus.plus && total >= lim) { Plus.upsell(`Más de ${lim} propiedades guardadas`); return false }
      const c = await DB.c(), uid = await DB.uid(), id = String(p.id);
      if (c && uid) { const { error } = await c.from('lista_items').upsert({ lista_id: listId, property_id: id }); if (!error) return true; alert(error.message); return false }
      const l = this.local(); const x = l.find(z => z.id === listId); if (x && !x.items.includes(id)) x.items.push(id); SS(this.key, l); return true;
    },
    async remove(listId, id) {
      const c = await DB.c(), uid = await DB.uid();
      if (c && uid) { await c.from('lista_items').delete().eq('lista_id', listId).eq('property_id', String(id)); return }
      const l = this.local(); const x = l.find(z => z.id === listId); if (x) x.items = x.items.filter(i => i !== String(id)); SS(this.key, l);
    },
    async picker(p) {
      const ls = await this.all();
      UI.modal(`<h2 class="text-lg font-bold">➕ Guardar en lista</h2><p class="text-xs opacity-70">${E(p.title)}</p><div class="mt-3 space-y-1">${ls.map(l => `<button data-l="${E(l.id)}" class="lsAdd w-full text-left border rounded-lg px-3 py-2 dark:border-slate-600 flex">${E(l.nombre)} <span class="ml-auto opacity-60 text-xs">${l.items.length}${l.items.includes(String(p.id)) ? ' · ✓ ya está' : ''}</span></button>`).join('')}</div>
        <div class="flex gap-2 mt-3"><input id="lsNew" placeholder="Nueva lista, ej. Inversión" class="flex-1 px-3 py-2 rounded-lg border dark:bg-slate-700 dark:border-slate-600"><button id="lsCreate" class="bg-teal-600 text-white rounded-lg px-3">Crear</button></div>
        <p class="text-[11px] opacity-60 mt-2">Gratis: 2 listas y ${GH_CONFIG.limiteFavoritosGratis || 10} propiedades en total · Plus: ilimitado. <button id="lsView" class="underline">Ver mis listas</button></p><p id="lsMsg" class="text-sm text-emerald-600 mt-1"></p>`);
      document.querySelectorAll('.lsAdd').forEach(b => b.onclick = async () => { if (await this.add(b.dataset.l, p)) $('lsMsg') ? $('lsMsg').textContent = '✓ Guardada en la lista.' : 0 });
      $('lsCreate').onclick = async () => { const n = $('lsNew').value.trim(); if (!n) return; const id = await this.create(n); if (id && await this.add(id, p)) this.picker(p) };
      $('lsView').onclick = () => this.view();
    },
    async view() {
      const ls = await this.all(), find = id => App.all.find(p => String(p.id) === String(id));
      UI.modal(`<h2 class="text-xl font-bold">❤️ Mis listas</h2>${ls.map(l => `<div class="mt-3"><div class="font-semibold">${E(l.nombre)} <span class="text-xs opacity-60">(${l.items.length})</span></div>${l.items.length ? `<div class="grid gap-1 mt-1">${l.items.map(id => { const p = find(id); return p ? `<div class="flex items-center gap-2 text-sm border rounded-lg px-2 py-1 dark:border-slate-600"><button data-id="${E(id)}" class="lsOpen text-left flex-1 truncate">${E(p.title)} · <b>${E(DataService.short(p))}</b></button><button data-l="${E(l.id)}" data-id="${E(id)}" class="lsDel text-red-600 text-xs">quitar</button></div>` : '' }).join('')}</div>` : '<p class="text-xs opacity-60">Vacía</p>'}</div>`).join('')}
        <button id="lsMap" class="mt-4 border rounded-lg px-3 py-1.5 text-sm dark:border-slate-600">Mostrar todas en el mapa</button>`);
      document.querySelectorAll('.lsOpen').forEach(b => b.onclick = () => { UI.close(); Feat.open(b.dataset.id) });
      document.querySelectorAll('.lsDel').forEach(b => b.onclick = async () => { await this.remove(b.dataset.l, b.dataset.id); this.view() });
      $('lsMap').onclick = () => { App.chatIds = new Set(ls.flatMap(l => l.items).map(x => isNaN(x) ? x : x)); const s = new Set([...App.chatIds].map(String)); App.chatIds = new Set(App.all.filter(p => s.has(String(p.id))).map(p => p.id)); UI.close(); App.refresh() };
    }
  };

  /* ---------- Alertas de precio por zona ---------- */
  const PAlert = {
    async open() {
      if (!Plus.plus) return Plus.upsell('Alertas de precio por zona');
      const poly = Filters.state.polygon, prov = Filters.state.prov || '';
      const list = await DB.select('alertas_precio', q => q.select('*').order('created_at', { ascending: false }), 'mm_alertas_precio');
      UI.modal(`<h2 class="text-xl font-bold">🔔 Alertas de precio</h2><p class="text-sm opacity-80 mt-1">Te avisamos cuando aparezca una propiedad o baje de precio por debajo de tu máximo en ${poly ? '<b>tu zona dibujada</b>' : prov ? '<b>' + E(prov) + '</b>' : 'la zona que elijas (dibuja una zona o elige provincia antes)'}.</p>
        <div class="grid grid-cols-2 gap-2 mt-3"><label class="text-sm col-span-2">Nombre<input id="paN" value="${poly ? 'Mi zona' : E(prov || 'Costa Rica')}" class="w-full mt-1 px-2 py-1 rounded border dark:bg-slate-700 dark:border-slate-600"></label>
        <label class="text-sm">Precio máximo (USD)<input id="paMax" type="number" value="${Filters.state.max === Infinity ? 250000 : Filters.state.max}" class="w-full mt-1 px-2 py-1 rounded border dark:bg-slate-700 dark:border-slate-600"></label>
        <label class="text-sm">Tipo<select id="paT" class="w-full mt-1 px-2 py-1 rounded border dark:bg-slate-700"><option value="">Todos</option>${[...new Set(App.all.map(p => p.type))].filter(Boolean).sort().map(t => `<option ${Filters.state.type === t ? 'selected' : ''}>${E(t)}</option>`).join('')}</select></label></div>
        <button id="paSave" class="mt-3 bg-violet-600 text-white rounded-lg px-4 py-2 font-semibold">Crear alerta</button><p id="paMsg" class="text-sm mt-2"></p>
        <h3 class="font-semibold mt-4">Mis alertas (${list.length})</h3><ul class="text-sm list-disc ml-5">${list.map(a => `<li>${E(a.nombre)} · máx $${fmt(a.precio_max_usd)}${a.tipo ? ' · ' + E(a.tipo) : ''}${a.zona || a.poligono ? ' · zona dibujada' : a.provincia ? ' · ' + E(a.provincia) : ''}</li>`).join('')}</ul>`);
      $('paSave').onclick = async () => {
        const row = { nombre: $('paN').value.trim() || 'Alerta', precio_max_usd: +$('paMax').value || null, tipo: $('paT').value || null, provincia: poly ? null : (prov || null) };
        const wkt = poly ? 'SRID=4326;POLYGON((' + [...poly, poly[0]].map(([a, o]) => o + ' ' + a).join(',') + '))' : null;
        const where = await DB.insert('alertas_precio', { ...row, zona: wkt }, 'mm_alertas_precio');
        $('paMsg').textContent = where === 'remoto' ? '✓ Alerta creada. Te escribiremos por correo.' : '✓ Alerta guardada en este dispositivo (los avisos por correo requieren cuenta y backend).'; $('paMsg').className = 'text-sm mt-2 text-emerald-600';
      };
    }
  };

  /* ---------- Reportar ---------- */
  function report(p) {
    UI.modal(`<h2 class="text-lg font-bold">🚩 Reportar anuncio</h2><p class="text-xs opacity-70">${E(p.title)}</p><div class="space-y-1 mt-3 text-sm">${[['vendida', 'Ya se vendió / no está disponible'], ['datos', 'Datos incorrectos (precio, ubicación, fotos)'], ['duplicado', 'Anuncio duplicado'], ['fraude', 'Posible fraude o estafa'], ['otro', 'Otro']].map(([v, l], i) => `<label class="flex gap-2"><input type="radio" name="rp" value="${v}" ${i ? '' : 'checked'}> ${l}</label>`).join('')}</div>
      <textarea id="rpD" rows="3" maxlength="500" placeholder="Detalles (opcional)" class="w-full mt-2 px-2 py-1 rounded border dark:bg-slate-700 dark:border-slate-600"></textarea><button id="rpGo" class="mt-2 bg-red-600 text-white rounded-lg px-4 py-2">Enviar reporte</button><p id="rpM" class="text-sm mt-2"></p>`);
    $('rpGo').onclick = async () => { const motivo = document.querySelector('[name=rp]:checked').value; const w = await DB.insert('reportes', { property_id: String(p.id), motivo, detalle: $('rpD').value.trim() || null }, 'mm_reportes'); $('rpM').className = 'text-sm mt-2 text-emerald-600'; $('rpM').textContent = w === 'remoto' ? '✓ Gracias, revisaremos el anuncio.' : '✓ Gracias. Reporte guardado (se enviará cuando el servidor esté disponible).'; $('rpGo').disabled = true };
  }

  /* ---------- Visor de fotos a pantalla completa ---------- */
  function viewer(p, start) {
    const imgs = (p.images || []).slice(0, 20); if (!imgs.length) return; let i = start || 0;
    const v = document.createElement('div'); v.className = 'fixed inset-0 z-[5000] bg-black/95 flex items-center justify-center select-none'; document.body.appendChild(v);
    const draw = () => v.innerHTML = `<img src="${E(imgs[i])}" referrerpolicy="no-referrer" class="max-w-full max-h-full object-contain mm-fade"><button data-a="x" class="absolute top-3 right-4 text-white text-3xl">✕</button>${imgs.length > 1 ? '<button data-a="p" class="absolute left-2 top-1/2 text-white text-4xl px-3">‹</button><button data-a="n" class="absolute right-2 top-1/2 text-white text-4xl px-3">›</button>' : ''}<div class="absolute bottom-4 text-white/80 text-sm">${i + 1} / ${imgs.length} · Foto del anuncio (${E(p.source)})</div>`;
    const go = d => { i = (i + d + imgs.length) % imgs.length; draw() }, close = () => { v.remove(); document.removeEventListener('keydown', key) };
    const key = e => e.key === 'Escape' ? close() : e.key === 'ArrowRight' ? go(1) : e.key === 'ArrowLeft' ? go(-1) : 0;
    v.onclick = e => { const a = e.target.dataset.a; a === 'x' ? close() : a === 'p' ? go(-1) : a === 'n' ? go(1) : e.target === v && close() };
    let x0 = null; v.addEventListener('touchstart', e => x0 = e.touches[0].clientX); v.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); x0 = null });
    document.addEventListener('keydown', key); draw();
  }

  /* ---------- Datos de zona ---------- */
  const Zone = {
    on: false,
    pip(pt, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c } return c },
    provAt(lat, lon) { for (const f of (EMBED.provinces && EMBED.provinces.features) || []) { const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; if (polys.some(pl => this.pip([lon, lat], pl[0]))) return f.properties.name } return null },
    stats(ps) {
      const pr = ps.map(crc).filter(Boolean), pm = ps.map(p => { const a = p.area || p.lot, c = crc(p); return a && c && a > 20 ? c / a : null }).filter(Boolean);
      const pmC = ps.filter(p => /Casa|Apart/.test(p.type)).map(p => { const c = crc(p); return c && p.area > 20 ? c / p.area : null }).filter(Boolean);
      const pmL = ps.filter(p => /Lote|Finca/.test(p.type)).map(p => { const c = crc(p); return c && (p.lot || p.area) > 20 ? c / (p.lot || p.area) : null }).filter(Boolean);
      return { n: ps.length, conPrecio: pr.length, mediana: med(pr), promedio: pr.length ? pr.reduce((a, b) => a + b, 0) / pr.length : null, m2: med(pm), m2n: pm.length, m2c: med(pmC), m2l: med(pmL), pr };
    },
    hist(pr) {
      const B = [[0, 50e6], [50e6, 100e6], [100e6, 150e6], [150e6, 250e6], [250e6, 500e6], [500e6, 1e9], [1e9, Infinity]], L = ['<50M', '50–100M', '100–150M', '150–250M', '250–500M', '500M–1MM', '>1MM'];
      const c = B.map(([a, b]) => pr.filter(v => v >= a && v < b).length), mx = Math.max(1, ...c);
      return `<div class="flex items-end gap-1 h-28 mt-2">${c.map((n, i) => `<div class="flex-1 flex flex-col items-center justify-end h-full"><div class="text-[10px]">${n}</div><div class="w-full rounded-t bg-teal-500 mm-grow" style="height:${n / mx * 100}%"></div><div class="text-[9px] opacity-70 mt-0.5 whitespace-nowrap">₡${L[i]}</div></div>`).join('')}</div>`;
    },
    show(prov, canton) {
      const all = App.all.filter(p => !p.demo && p.province === prov && (!p.status || p.status === 'activa')), ps = canton ? all.filter(p => (p.canton || '') === canton) : all, s = this.stats(ps);
      const cant = {}; all.forEach(p => { if (p.canton) (cant[p.canton] = cant[p.canton] || []).push(p) });
      const rows = Object.entries(cant).map(([k, v]) => [k, this.stats(v)]).sort((a, b) => b[1].n - a[1].n).slice(0, 15);
      const box = (l, v, sub) => `<div class="rounded-xl bg-slate-100 dark:bg-slate-700 p-2 text-center"><div class="text-[11px] opacity-70">${l}</div><div class="font-bold text-lg">${v}</div>${sub ? `<div class="text-[10px] opacity-60">${sub}</div>` : ''}</div>`;
      UI.modal(`<h2 class="text-xl font-bold">📊 ${E(canton ? canton + ', ' : '')}${E(prov)}</h2><p class="text-[11px] opacity-60">Calculado con los anuncios reales activos del mapa (sin demos). Precios pedidos, no de venta; valores aproximados.</p>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">${box('Anuncios', s.n, s.conPrecio + ' con precio')}${box('Mediana', M(s.mediana))}${box('Promedio', M(s.promedio))}${box('Mediana ₡/m²', s.m2 ? '₡' + fmt(s.m2) : '—', s.m2n + ' con área')}</div>
        <div class="grid grid-cols-2 gap-2 mt-2">${box('₡/m² casas y aptos (constr.)', s.m2c ? '₡' + fmt(s.m2c) : '—')}${box('₡/m² lotes y fincas (terreno)', s.m2l ? '₡' + fmt(s.m2l) : '—')}</div>
        <h3 class="font-semibold mt-4 text-sm">Distribución de precios</h3>${this.hist(s.pr)}
        ${!canton && rows.length ? `<h3 class="font-semibold mt-4 text-sm">Por cantón <span class="font-normal opacity-60 text-xs">(solo anuncios con cantón conocido)</span></h3><table class="w-full text-sm mt-1"><tr class="text-xs opacity-60"><th class="text-left">Cantón</th><th>n</th><th>Mediana</th><th>₡/m²</th></tr>${rows.map(([k, v]) => `<tr class="border-t dark:border-slate-700"><td><button data-c="${E(k)}" class="znC text-teal-700 dark:text-teal-300 underline">${E(k)}</button></td><td class="text-center">${v.n}</td><td class="text-center">${M(v.mediana)}</td><td class="text-center">${v.m2 ? '₡' + fmt(v.m2) : '—'}</td></tr>`).join('')}</table>` : ''}
        ${canton ? `<button id="znBack" class="mt-3 border rounded-lg px-3 py-1 text-sm dark:border-slate-600">← ${E(prov)}</button>` : ''}`);
      document.querySelectorAll('.znC').forEach(b => b.onclick = () => this.show(prov, b.dataset.c)); $('znBack') && ($('znBack').onclick = () => this.show(prov));
    },
    toggle(btn) { this.on = !this.on; btn.classList.toggle('on', this.on); document.getElementById('map').style.cursor = this.on ? 'help' : ''; if (this.on) Feat.toast('📊 Toca una provincia en el mapa para ver sus datos') }
  };

  /* ---------- Modo Agente ---------- */
  const Agent = {
    async isAgent() { const u = await Auth.user(); if (!u) return false; if (u.rol) return u.rol === 'agente'; return localStorage.getItem('mm_rol') === 'agente' },
    async become() {
      const u = await Auth.user(); if (!u) { location.href = 'login.html?next=index.html'; return }
      const c = await DB.c(); if (c && !u.demo) { const { error } = await c.rpc('hacerme_agente'); if (error) console.warn(error.message) }
      localStorage.setItem('mm_rol', 'agente'); this.panel();
    },
    async panel() {
      const u = await Auth.user();
      if (!u || !(await this.isAgent())) {
        return UI.modal(`<h2 class="text-xl font-bold">🏷️ Modo Agente</h2><p class="text-sm mt-2">Para agentes y propietarios: mira vistas y contactos de tus anuncios, destaca propiedades (Plus) y recibe calificaciones.</p><button id="agB" class="mt-3 bg-teal-600 text-white rounded-lg px-4 py-2">${u ? 'Activar Modo Agente' : 'Iniciar sesión'}</button>`), $('agB').onclick = () => this.become();
      }
      const mine = App.all.filter(p => p.mine), dest = App.all.filter(p => Dest.set.has(String(p.id)));
      const ids = [...new Set([...mine, ...dest].map(p => String(p.id)))], st = await Ev.stats(ids);
      const row = p => { const s = st[String(p.id)] || {}; return `<tr class="border-t dark:border-slate-700"><td class="py-1"><button data-id="${E(p.id)}" class="agO text-left underline">${E(p.title.slice(0, 40))}</button></td><td class="text-center">👁 ${s.vistas || 0}</td><td class="text-center">💬 ${s.contactos || 0}</td><td class="text-center"><button data-id="${E(p.id)}" class="agD text-xs rounded-full px-2 ${Dest.set.has(String(p.id)) ? 'bg-amber-400 text-amber-950' : 'border dark:border-slate-600'}">${Dest.set.has(String(p.id)) ? '★ Destacada' : '☆ Destacar'}</button></td></tr>` };
      UI.modal(`<h2 class="text-xl font-bold">🏷️ Panel de agente</h2><p class="text-xs opacity-70">${E(u.email)} · ${Plus.plus ? '⭐ Plus: puedes destacar' : 'Destacar requiere Plus'}</p>
        <table class="w-full text-sm mt-3"><tr class="text-xs opacity-60"><th class="text-left">Anuncio</th><th>Vistas</th><th>Contactos</th><th></th></tr>${[...new Map([...mine, ...dest].map(p => [p.id, p])).values()].map(row).join('') || '<tr><td colspan="4" class="py-3 text-sm opacity-70">Aún no tienes anuncios. Usa «➕ Publicar propiedad» o destaca un anuncio desde su ficha.</td></tr>'}</table>
        <p class="text-[11px] opacity-60 mt-2">${Object.values(st).some(s => s.local) ? 'Contadores locales de este dispositivo (los globales requieren las tablas de Supabase).' : 'Contadores de todos los visitantes.'} Las destacadas aparecen con pin dorado y primero en los resultados durante 30 días.</p>
        <button id="agPub" class="mt-3 bg-teal-600 text-white rounded-lg px-4 py-2">➕ Publicar propiedad</button>`);
      document.querySelectorAll('.agO').forEach(b => b.onclick = () => { UI.close(); Feat.open(b.dataset.id) });
      document.querySelectorAll('.agD').forEach(b => b.onclick = async () => { const p = App.all.find(x => String(x.id) === b.dataset.id); await Dest.toggle(p); if (Plus.plus) this.panel() });
      $('agPub').onclick = () => { UI.close(); $('bPub').click() };
    }
  };

  /* ---------- Integración con la tarjeta ---------- */
  const stars = (avg, n, agent) => `<span class="mmStars" data-a="${E(agent)}">${[1, 2, 3, 4, 5].map(i => `<button data-s="${i}" class="text-lg leading-none ${i <= Math.round(avg) ? 'text-amber-400' : 'text-slate-300 dark:text-slate-600'}">★</button>`).join('')}</span><span class="text-xs opacity-70 ml-1">${n ? avg.toFixed(1) + ' (' + n + ')' : 'Sin calificaciones'}</span>`;
  function enhanceCard(p) {
    const card = $('card'); if (!card || card.classList.contains('hidden')) return;
    card.classList.add('mm-slide');
    // galería más grande + pantalla completa
    card.querySelectorAll('.h-48').forEach(x => { x.classList.remove('h-48'); x.classList.add('h-64', 'md:h-72') });
    card.querySelectorAll('img').forEach((im, i) => { im.style.cursor = 'zoom-in'; im.onclick = () => viewer(p, i) });
    const wa = [...card.querySelectorAll('a')].find(a => /wa\.me/.test(a.href));
    const link = BASE + 'index.html?p=' + encodeURIComponent(p.id);
    const shareTxt = `Mira esta propiedad en MapMarket: ${p.title} — ${DataService.full(p)} ${link}`;
    if (wa) { wa.className = 'col-span-2 text-center bg-green-600 hover:bg-green-700 text-white rounded-xl py-3 text-base font-bold shadow mm-pulse'; wa.innerHTML = '💬 Contactar por WhatsApp'; wa.addEventListener('click', () => Ev.track(p, 'contacto')); wa.parentNode.prepend(wa) }
    const box = document.createElement('div'); box.className = 'px-4 pb-4 space-y-2';
    const near3 = cercania(p);
    box.innerHTML = `<div class="grid grid-cols-2 gap-2">
       <a target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(shareTxt)}" class="col-span-2 text-center border-2 border-green-600 text-green-700 dark:text-green-400 rounded-xl py-2.5 font-semibold">📤 Compartir por WhatsApp</a>
       <button id="fList" class="border rounded-lg py-2 dark:border-slate-600">➕ Guardar en lista</button><button id="fCmp" class="border rounded-lg py-2 dark:border-slate-600 ${Cmp.has(p) ? 'bg-teal-600 text-white' : ''}">⚖️ ${Cmp.has(p) ? 'En comparación' : 'Comparar'}</button>
       <button id="fCopy" class="border rounded-lg py-2 dark:border-slate-600">🔗 Copiar enlace</button><button id="fRep" class="border rounded-lg py-2 dark:border-slate-600 text-red-600">🚩 Reportar</button>
       <button id="fDest" class="col-span-2 text-xs rounded-lg py-1.5 ${Dest.set.has(String(p.id)) ? 'bg-amber-400 text-amber-950' : 'border border-amber-500 text-amber-700 dark:text-amber-300'}">${Dest.set.has(String(p.id)) ? '★ Destacada' : '☆ Destacar (agentes · Plus)'}</button></div>
     ${p.agent ? `<div class="text-sm flex items-center flex-wrap gap-1"><span class="font-semibold mr-1">👤 ${E(p.agent)}</span><span id="fStars">${stars(0, 0, p.agent)}</span></div>` : ''}
     ${near3.length ? `<div><div class="text-xs font-semibold">🚗 Cerca <span class="font-normal opacity-60">(aprox.: línea recta × 1,4)</span></div><div class="grid grid-cols-2 gap-1 mt-1 text-xs">${near3.map(({ k, n }) => `<div class="rounded-lg bg-slate-100 dark:bg-slate-700 px-2 py-1"><div>${NK[k]}</div><div class="font-semibold truncate" title="${E(n.n)}">${E(n.n || '')}</div><div>${n.d.toFixed(1)} km · ~${mins(n.d)} min <button data-k="${k}" class="fOsrm underline opacity-70">ruta</button></div></div>`).join('')}</div><p id="fOsrmM" class="text-[11px] opacity-70"></p></div>` : ''}
     <div id="fStats" class="text-[11px] opacity-60"></div>`;
    card.appendChild(box);
    $('fList').onclick = () => Lists.picker(p); $('fRep').onclick = () => report(p); $('fDest').onclick = () => Dest.toggle(p).then(() => Feat.open(p.id));
    $('fCmp').onclick = () => { Cmp.toggle(p); enhanceCardRefresh(p) };
    $('fCopy').onclick = async () => { try { if (navigator.share && /Android|iPhone/i.test(navigator.userAgent)) await navigator.share({ title: p.title, text: shareTxt, url: link }); else { await navigator.clipboard.writeText(link); $('fCopy').textContent = '✓ Copiado' } } catch { prompt('Copia el enlace:', link) } };
    card.querySelectorAll('.fOsrm').forEach(b => b.onclick = async () => { const n = near(p, b.dataset.k); $('fOsrmM').textContent = 'Consultando ruta (OSRM demo)…'; try { const r = await osrm(p, n); $('fOsrmM').textContent = `${NK[b.dataset.k]}: ${r.km} km por carretera · ~${r.min} min sin tráfico (OSRM, servidor público de demostración).` } catch (e) { $('fOsrmM').textContent = 'No se pudo calcular: ' + e.message } });
    if (p.agent) Rate.get(p.agent).then(r => { const s = $('fStars'); if (!s) return; s.innerHTML = stars(r.avg, r.n, p.agent); s.querySelectorAll('button').forEach(b => b.onclick = async () => { if (!(await Auth.user())) { if (confirm('Inicia sesión para calificar. ¿Ir a iniciar sesión?')) location.href = 'login.html?next=' + encodeURIComponent('index.html?p=' + p.id); return } await Rate.set(p.agent, +b.dataset.s); const r2 = await Rate.get(p.agent); s.innerHTML = stars(r2.avg, r2.n, p.agent) + ' <span class="text-xs text-emerald-600">¡Gracias!</span>' }) });
    Ev.stats([String(p.id)]).then(st => { const s = st[String(p.id)], el = $('fStats'); if (el && s) el.textContent = `👁 ${s.vistas} vistas · 💬 ${s.contactos} contactos${s.local ? ' (en este dispositivo)' : ''}` });
    history.replaceState(null, '', location.pathname + '?p=' + encodeURIComponent(p.id) + location.hash);
  }
  function enhanceCardRefresh(p) { const b = $('fCmp'); if (b) { b.className = 'border rounded-lg py-2 dark:border-slate-600 ' + (Cmp.has(p) ? 'bg-teal-600 text-white' : ''); b.textContent = '⚖️ ' + (Cmp.has(p) ? 'En comparación' : 'Comparar') } }

  /* ---------- Pines por tipo + leyenda ---------- */
  const TYPES = [['casa', 'Casa', '#0f766e', /^Casa$/], ['playa', 'Casa/Terreno de playa', '#0284c7', /playa/i], ['apto', 'Apartamento', '#4f46e5', /Apart/], ['lote', 'Lote / Finca', '#65a30d', /Lote|Finca/], ['com', 'Comercial', '#7c3aed', /Comercio|Negocio|Edificio|Oficina/]];
  const tclass = p => (TYPES.find(t => t[3].test(p.type || '')) || ['otro'])[0];
  function legend() {
    const d = document.createElement('div'); d.id = 'mmLegend';
    d.className = 'fixed z-[999] left-2 bottom-24 md:bottom-8 bg-white/95 dark:bg-slate-800/95 rounded-xl shadow-lg text-[11px] p-2 space-y-0.5';
    d.innerHTML = `<button id="lgT" class="font-semibold w-full text-left">🗂️ Leyenda ▾</button><div id="lgB">${TYPES.map(t => `<div class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-full" style="background:${t[2]}"></span>${t[1]}</div>`).join('')}
      <div class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-full" style="background:#f59e0b"></span>★ Destacada</div><div class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-full border-2 border-dashed border-slate-500"></span>Ubicación aproximada</div>
      <div class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-full" style="background:#9ca3af"></span>Vendida / retirada</div><div class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-full" style="background:#db2777"></span>Demo</div>
      <div class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-full" style="background:#b91c1c"></span>Remate · <span class="inline-block w-3 h-3 rounded-full" style="background:#ea580c"></span>Adjudicado</div></div>`;
    document.body.appendChild(d); $('lgT').onclick = () => $('lgB').classList.toggle('hidden'); if (innerWidth < 768) $('lgB').classList.add('hidden');
  }

  /* ---------- API pública + arranque ---------- */
  const Feat = window.Feat = {
    Cmp, Lists, PAlert, Zone, Agent, Dest, Ev, Rate, report, viewer,
    toast(t) { const d = document.createElement('div'); d.className = 'fixed z-[4000] top-28 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm rounded-full px-4 py-2 shadow-xl mm-pop'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3500) },
    open(id) { const p = App.all.find(x => String(x.id) === String(id)); if (!p) { const r = (REMATES.items || []).find(x => String(x.id) === String(id)); if (r) { MapController.map.setView([r.lat, r.lon], 15); Remates.card(r) } return } MapController.map.setView([p.lat, p.lon], Math.max(MapController.map.getZoom(), 15)); UI.showCard(p) },
    init() {
      // tarjeta
      const sc = UI.showCard.bind(UI); UI.showCard = function (p) { sc(p); try { Ev.track(p, 'vista'); enhanceCard(p) } catch (e) { console.warn(e) } };
      // pines
      const rd = MapController.render.bind(MapController);
      MapController.render = function (list) {
        list = [...list].sort((a, b) => Dest.set.has(String(a.id)) - Dest.set.has(String(b.id)));
        this.cluster.clearLayers(); this.cluster.addLayers(list.map(p => {
          const st = (p.status && p.status !== 'activa') ? 'off' : p.mine ? 'mine' : p.demo ? 'demo' : '';
          const cls = [st, 't-' + tclass(p), p.coord !== 'exacta' && !p.demo ? 'ap' : '', Dest.set.has(String(p.id)) ? 'dest' : ''].join(' ');
          const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<span class="pb ${cls}">${Dest.set.has(String(p.id)) ? '★ ' : ''}${DataService.short(p)}</span>`, iconSize: [0, 0] }), zIndexOffset: Dest.set.has(String(p.id)) ? 1000 : 0 });
          m.on('click', () => UI.showCard(p)); return m;
        }));
      };
      // botones
      const bar = $('bPub') && $('bPub').parentNode;
      if (bar) { const mk = (id, h, cls) => { const b = document.createElement('button'); b.id = id; b.className = 'px-2 py-1 rounded-full border dark:border-slate-600 ' + (cls || ''); b.innerHTML = h; bar.insertBefore(b, $('bPub')); return b };
        mk('bLists', '❤️ Mis listas').onclick = () => Lists.view();
        mk('bPAlert', '🔔 Alerta de precio' + (Plus.plus ? '' : ' <span class="lk text-[10px]">🔒</span>')).onclick = () => PAlert.open();
        mk('bZone', '📊 Datos de zona', 'chip').onclick = e => Zone.toggle(e.currentTarget);
        mk('bAgent', '🏷️ Modo Agente').onclick = () => Agent.panel();
        const g = document.createElement('a'); g.href = 'guias.html'; g.className = 'px-2 py-1 rounded-full border dark:border-slate-600'; g.textContent = '📚 Guías'; bar.insertBefore(g, $('bPub'));
      }
      MapController.map.on('click', e => { if (!Zone.on) return; const pv = Zone.provAt(e.latlng.lat, e.latlng.lng); pv ? Zone.show(pv) : Feat.toast('Toca dentro de una provincia') });
      legend(); Cmp.bar();
      Dest.load().then(() => Dest.set.size && App.refresh());
      // enlace profundo ?p=<id>
      const pid = new URLSearchParams(location.search).get('p'); if (pid) setTimeout(() => Feat.open(pid), 300);
      App.refresh();
      window.dispatchEvent(new Event('mm-feat-ready'));
    }
  };
})();
