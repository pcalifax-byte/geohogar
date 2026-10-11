/* MapMarket · Publicación en servidor (Supabase) con fotos y moderación + anuncios aprobados en el mapa */
(function () {
  const $ = i => document.getElementById(i), PROV = ['San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón'];
  async function backend() { try { return Social && await Social.sb() } catch (e) { return null } }
  // Reduce a ≤1600 px JPEG (también elimina metadatos EXIF/GPS de la foto)
  function shrink(file) {
    return new Promise((ok, ko) => {
      if (!/^image\//.test(file.type)) return ko(new Error('Solo imágenes'));
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); c.toBlob(b => b ? ok(b) : ko(new Error('No se pudo procesar la imagen')), 'image/jpeg', 0.82) };
      img.onerror = () => ko(new Error('Imagen no válida')); img.src = url;
    });
  }
  // Análisis de imágenes en el navegador (nsfwjs, carga diferida). Si no carga, no bloquea: queda «sin revisar» para el admin.
  let _nsfw = null;
  function cargarNsfw() {
    if (_nsfw) return _nsfw;
    const js = src => new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s) });
    _nsfw = js('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js').then(() => js('https://cdn.jsdelivr.net/npm/nsfwjs@2.4.2/dist/nsfwjs.min.js')).then(() => nsfwjs.load()).catch(e => { console.warn('nsfw', e); return null });
    return _nsfw;
  }
  async function analizar(blob) {
    try {
      const m = await Promise.race([cargarNsfw(), new Promise(r => setTimeout(() => r(null), 15000))]); if (!m) return null;
      const img = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = 299; c.height = 299; c.getContext('2d').drawImage(img, 0, 0, 299, 299);
      const pr = await m.classify(c); const o = {}; pr.forEach(x => o[x.className] = +x.probability.toFixed(3)); return o;
    } catch (e) { console.warn('nsfw', e); return null }
  }
  async function enviar(d, files, msg) {
    const c = await backend(), u = await Social.me(); if (!c || !u) throw new Error('Inicia sesión para publicar en MapMarket');
    const urls = [], meta = [];
    for (const [i, f] of [...files].slice(0, 6).entries()) {
      msg(`Subiendo foto ${i + 1} de ${Math.min(files.length, 6)}…`);
      const b = await shrink(f), path = `${u.id}/${Date.now()}-${i}.jpg`;
      msg(`Revisando foto ${i + 1}…`); const sc = await analizar(b);
      const malo = sc ? (sc.Porn || 0) + (sc.Hentai || 0) : 0;
      if (malo >= 0.85) throw new Error(`La foto ${i + 1} parece contenido inapropiado y no se puede publicar. Si es un error, usa otra foto.`);
      const marcar = !!sc && (malo >= 0.5 || (sc.Sexy || 0) >= 0.7);
      if (marcar && !confirm(`La foto ${i + 1} podría no ser apropiada. Quedará oculta hasta que un moderador la revise. ¿Continuar?`)) throw new Error('Publicación cancelada');
      const { error } = await c.storage.from('anuncios').upload(path, b, { contentType: 'image/jpeg', upsert: false }); if (error) throw error;
      urls.push(c.storage.from('anuncios').getPublicUrl(path).data.publicUrl); meta.push({ score: sc, marcar });
    }
    const n = v => v === '' || v == null ? null : +v;
    const row = { titulo: d.nT.trim().slice(0, 140), tipo: d.nY, provincia: PROV.includes(d.nV) ? d.nV : 'San José', zona: (d.nL || '').slice(0, 120) || null, precio: +d.nP, moneda: d.nC, habitaciones: n(d.nB), banos: n(d.nBa), area: n(d.nA), descripcion: (d.nD || '').slice(0, 2000) || null, amenidades: d.am || [], imagenes: urls, lat: d.lat, lon: d.lon, poligono: d.poly || null, area_terreno: d.area_terreno || null };
    const { data: ins, error } = await c.from('anuncios').insert(row).select('id').single(); if (error) { if (/LIMITE_ANUNCIOS/.test(error.message)) { setTimeout(() => Plus.upsell('Más anuncios activos'), 300); throw new Error(error.message.replace(/^.*LIMITE_ANUNCIOS:\s*/, '')) } throw error }
    if (urls.length) { const r = await c.rpc('registrar_imagenes', { anuncio: ins.id, items: urls.map((url, i) => ({ url, ...meta[i] })) }); if (r.error) console.warn('moderación', r.error);
      c.functions.invoke('moderar-imagenes', { body: { anuncio: ins.id } }).catch(() => {}) }
  }
  function patchPublish() {
    const orig = UI.publish.bind(UI);
    UI.publish = function (map, onSaved) {
      orig(map, onSaved);
      const save = $('nSave'); if (!save) return;
      save.insertAdjacentHTML('beforebegin', '');
      $('nErr').insertAdjacentHTML('beforebegin', `<div class="mt-3 rounded-lg border border-teal-300 dark:border-teal-800 p-3 text-sm"><label class="flex gap-2 items-start"><input id="nSrv" type="checkbox" class="w-5 h-5 mt-0.5" checked> <span><b>Publicar en MapMarket</b> para que todos lo vean (lo revisamos antes de mostrarlo, normalmente en 24 h). Requiere iniciar sesión.</span></label>
        <label class="block mt-2">📷 Fotos (hasta 6; se reducen y se les quita la ubicación GPS)<input id="nFotos" type="file" accept="image/jpeg,image/png,image/webp" multiple class="block mt-1 w-full text-xs"></label><p class="text-[11px] opacity-60 mt-1">Al publicar declaras que tienes derecho a vender/anunciar el inmueble y a usar las fotos (<a class="underline" href="terminos.html">Términos</a>).</p></div>`);
      const local = save.onclick;
      save.onclick = async () => {
        const d = {}; ['nT', 'nY', 'nV', 'nP', 'nC', 'nB', 'nBa', 'nA', 'nL', 'nD'].forEach(k => d[k] = $(k).value); d.am = [...document.querySelectorAll('.nAm:checked')].map(x => x.value);
        const dr = UI.draft || {}; d.lat = dr.lat; d.lon = dr.lon; d.poly = dr.poly || null; d.area_terreno = dr.area_terreno || null;
        const srv = $('nSrv').checked, files = $('nFotos').files;
        if (srv && d.nT && +d.nP && d.lat) {
          if (!(await Social.me())) { if (confirm('Para publicar en MapMarket necesitas iniciar sesión. ¿Ir ahora? (Tu borrador queda guardado solo en este navegador si cancelas)')) { location.href = 'login.html?next=index.html'; return } }
          else {
            save.disabled = true; const m = t => $('nErr').textContent = t;
            try { await enviar(d, files, m); Feat.toast('✅ Enviado a revisión. Te avisaremos cuando esté publicado.'); UI.draft = {}; UI.close(); return }
            catch (e) { save.disabled = false; m('❌ ' + (e.message || e)); return }
          }
        }
        return local && local();
      };
    };
  }
  // Antes, al publicar en el servidor también se guardaba una copia local (id local-…) que solo veía el autor y que nadie podía borrar
  // desde admin. Se eliminan esas copias una sola vez (las publicaciones reales viven en Supabase).
  try { if (!localStorage.getItem('mm_local_purga1')) { const k = CONFIG.storageKey, l = JSON.parse(localStorage.getItem(k) || '[]'); if (l.length) localStorage.setItem(k, '[]'); localStorage.setItem('mm_local_purga1', '1'); if (l.length) setTimeout(() => { App.all = App.all.filter(p => !String(p.id).startsWith('local-')); App.refresh() }, 500) } } catch (e) { }
  async function cargarAprobados() {
    const c = await backend(); if (!c) return;
    const { data, error } = await c.from('anuncios').select('*').in('estado', ['aprobado', 'vendido']).order('created_at', { ascending: false }).limit(1000);
    if (error || !data || !data.length) return;
    try { const { data: oc } = await c.from('imagenes_ocultas').select('url').limit(5000); const hid = new Set((oc || []).map(x => x.url)); data.forEach(a => a.imagenes = (a.imagenes || []).filter(u => !hid.has(u))) } catch (e) {}
    const ps = data.map(a => ({ id: 'u-' + a.id, owner_id: a.owner_id, title: a.titulo, type: a.tipo, price: +a.precio, currency: a.moneda, beds: a.habitaciones, baths: a.banos, area: a.area, desc: a.descripcion || '', amenidades: a.amenidades || [], amenities: a.amenidades || [], images: a.imagenes || [], location: (a.zona ? a.zona + ', ' : '') + a.provincia, province: a.provincia, lat: a.lat, lon: a.lon, poly: a.poligono || null, area_terreno: a.area_terreno, destacado_until: a.destacado_until || null, coord: 'exacta', source: 'Publicado en MapMarket', url: '', status: a.estado === 'vendido' ? 'vendida' : 'activa', usuario: true, date: a.created_at.slice(0, 10) }));
    const have = new Set(App.all.map(p => String(p.id)));
    ps.filter(p => !have.has(p.id)).forEach(p => { App.all.push(p); EMBED.properties.push(p) });
    App.refresh();
  }
  window.MMcargarAprobados = cargarAprobados;
  window.addEventListener('mm-feat-ready', () => { try { patchPublish() } catch (e) { console.warn(e) } cargarAprobados() });
  window.Publicar = { cargarAprobados, shrink, analizar };
})();
