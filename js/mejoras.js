/* MapMarket · mejoras UX: galería, WhatsApp fijo, validación de publicación + calidad de fotos, conteo/promedio en vista,
   ayuda de Dibujar zona, botón Publicar, panel de beneficios, enlace a perfil público, propuesta de valor y testimonios reales. */
(function () {
  const T = s => (window.MMT ? MMT(s) : s), $ = id => document.getElementById(id);
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = m => (window.Feat && Feat.toast ? Feat.toast(m) : console.log(m));
  const LOC = () => window.MMLocale || 'es-CR';
  const usd = p => (p.currency === 'CRC' ? p.price / ((window.CONFIG && CONFIG.fx) || 510) : p.price);

  const normWa = v => { const d = String(v || '').replace(/\D/g, '').replace(/^506(?=\d{8}$)/, ''); return /^[2-8]\d{7}$/.test(d) ? '+506' + d : null };
  window.MMWa = () => normWa($('nWa') && $('nWa').value);
  const waUrl = p => { const n = normWa(p.whatsapp); if (!n) return null; const link = 'https://mapmarketapp.com/index.html?p=' + encodeURIComponent(p.id);
    return 'https://wa.me/' + n.slice(1) + '?text=' + encodeURIComponent(T('Hola, me interesa esta propiedad en MapMarket:') + ' ' + (p.title || '') + ' ' + link) };
  const enApp = () => /MapMarketApp/i.test(navigator.userAgent) || !!window.Capacitor;
  // En la app Android (WebView) target=_blank no abre nada: se navega en la misma ventana y Capacitor lo pasa a WhatsApp.
  const abrirWa = u => { if (enApp() || /Android|iPhone|iPad/i.test(navigator.userAgent)) location.href = u; else window.open(u, '_blank', 'noopener') };
  window.MMAbrirWa = abrirWa;
  /* ---------- 1) Ficha: galería + WhatsApp fijo + perfil ---------- */
  function mejorarFicha() {
    const card = $('card'); if (!card || card.classList.contains('hidden') || card.dataset.mmOk === card.innerHTML.length + '') return;
    const sc = card.querySelector('.snap-x');
    if (sc && !sc.closest('.mmGal')) {
      const w = document.createElement('div'); w.className = 'mmGal'; sc.parentNode.insertBefore(w, sc); w.appendChild(sc);
      sc.querySelectorAll('.snap-center').forEach(x => { x.classList.remove('h-48', 'h-64', 'md:h-72'); x.style.height = 'min(56vh,340px)' });
      sc.querySelectorAll('img').forEach(x => { x.classList.remove('h-48', 'h-64', 'md:h-72'); x.style.height = '100%'; x.decoding = 'async' });
      const n = sc.children.length;
      if (n > 1) {
        w.insertAdjacentHTML('beforeend', `<span class="mmCnt" aria-live="polite">1/${n}</span><button class="mmArr" style="left:8px" aria-label="${T('Anterior')}">‹</button><button class="mmArr" style="right:8px" aria-label="${T('Siguiente')}">›</button>`);
        const cnt = w.querySelector('.mmCnt'), go = d => sc.scrollBy({ left: d * sc.clientWidth, behavior: 'smooth' });
        const [a, b] = w.querySelectorAll('.mmArr'); a.onclick = () => go(-1); b.onclick = () => go(1);
        sc.addEventListener('scroll', () => { cnt.textContent = Math.round(sc.scrollLeft / sc.clientWidth) + 1 + '/' + n }, { passive: true });
      }
    }
    // botón WhatsApp grande y fijo (WhatsApp del anuncio) o chat interno
    const pc = (typeof UI !== 'undefined') && UI.cur;
    if (pc && !card.querySelector('.mmSticky')) {
      const u = waUrl(pc), s = document.createElement('div'); s.className = 'mmSticky'; const c = document.createElement(u ? 'a' : 'button');
      if (u) { c.href = u; c.rel = 'noopener'; c.innerHTML = '🟢 ' + E(T('Contactar por WhatsApp')); c.onclick = e => { e.preventDefault(); abrirWa(u) } }
      else { c.type = 'button'; c.style.background = '#0f766e'; c.innerHTML = '💬 ' + E(T('Escribir por chat de MapMarket')) + `<span style="font-size:11px;font-weight:400;display:block;opacity:.85">${E(T('El anunciante aún no agregó WhatsApp'))}</span>`; c.style.flexDirection = 'column';
        c.onclick = () => { const b = [...card.querySelectorAll('button')].find(b => !b.closest('.mmSticky') && /mensaje|message|chat/i.test(b.textContent)); b ? b.click() : (location.href = 'mensajes.html') } }
      s.appendChild(c); card.appendChild(s);
      // los demás enlaces wa.me de la ficha apuntan al mismo número
      card.querySelectorAll('a[href*="wa.me"]').forEach(a => { if (a.closest('.mmSticky')) return; if (u) { a.href = u; a.onclick = e => { e.preventDefault(); abrirWa(u) } } });
    }
    // perfil público del anunciante
    const p = (typeof UI !== 'undefined') && UI.cur;
    if (p && p.owner_id && !card.querySelector('.mmPerfil')) {
      const h = card.querySelector('h2'); if (h) h.insertAdjacentHTML('afterend', `<a class="mmPerfil inline-flex items-center gap-1 text-sm text-teal-700 dark:text-teal-300 underline" style="min-height:36px" href="perfil.html?id=${encodeURIComponent(p.owner_id)}">👤 ${T('Ver perfil del anunciante')} <span class="mmRat no-underline"></span></a>`);
      (async () => { try { const c = await client(); const { data } = await c.rpc('resumen_resenas', { ids: [p.owner_id] }); const r = data && data[0]; const el = card.querySelector('.mmRat'); if (r && r.total && el) el.innerHTML = `· <span class="text-amber-500">★</span> ${r.promedio} (${r.total})` } catch (e) {} })();
    }
    card.dataset.mmOk = card.innerHTML.length + '';
  }

  /* ---------- 1b) Publicar: campos obligatorios + fotos 4–6 con resolución y desenfoque ---------- */
  function nitidez(img) { // varianza del laplaciano en 256px (bajo = borrosa)
    const W = 256, H = Math.max(1, Math.round(img.naturalHeight / img.naturalWidth * W)), c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, W, H); const d = x.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2];
    let s = 0, s2 = 0, n = 0; for (let y = 1; y < H - 1; y++) for (let k = 1; k < W - 1; k++) { const i = y * W + k, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W]; s += l; s2 += l * l; n++ }
    return n ? s2 / n - (s / n) ** 2 : 0;
  }
  async function revisarFotos(files) {
    const res = [];
    for (const f of files) { const u = URL.createObjectURL(f); try { const im = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = u }); res.push({ f, w: im.naturalWidth, h: im.naturalHeight, blur: nitidez(im) < 60 }) } catch (e) { res.push({ f, w: 0, h: 0, blur: false }) } finally { URL.revokeObjectURL(u) } }
    return res;
  }
  const MINW = 800, MINH = 600;
  function hookPublicar() {
    if (typeof UI === 'undefined' || UI._mmPub) return; UI._mmPub = 1; const orig = UI.publish.bind(UI);
    UI.publish = function (map, onSaved) {
      orig(map, onSaved);
      const save = $('nSave'), fin = $('nFotos'); if (!save) return;
      ['nT', 'nP', 'nB', 'nBa', 'nA', 'nL', 'nD'].forEach(id => { const i = $(id); if (i) { i.required = true; const l = i.closest('label'); if (l && !/\*/.test(l.firstChild.textContent || '')) l.firstChild.textContent += ' *' } });
      const d = $('nD'); if (d && d.tagName === 'INPUT') { const ta = document.createElement('textarea'); ta.id = 'nD'; ta.rows = 4; ta.className = d.className; ta.value = d.value; ta.required = true; ta.placeholder = T('Describe la propiedad (mínimo 40 caracteres): estado, acabados, acceso, servicios…'); d.replaceWith(ta) }
      $('nErr').insertAdjacentHTML('beforebegin', `<div class="mt-3 rounded-lg border border-green-500 p-3 text-sm"><label class="block font-semibold">🟢 ${T('WhatsApp para este anuncio')} *<div class="flex mt-1"><span class="px-2 flex items-center rounded-l border dark:border-slate-600 bg-slate-100 dark:bg-slate-700">+506</span><input id="nWa" inputmode="tel" maxlength="12" placeholder="8888 8888" class="flex-1 px-2 rounded-r border dark:bg-slate-700 dark:border-slate-600" style="min-height:44px"></div></label>
        <label class="flex gap-2 items-start mt-2 text-xs"><input id="nWaOk" type="checkbox" class="w-5 h-5"> <span>${T('Acepto que este número se muestre a usuarios con sesión iniciada para que me contacten por WhatsApp sobre este anuncio.')}</span></label></div>`);
      (async () => { try { const c = await Auth.client(), u = await Auth.user(); if (!u) return; const { data } = await c.from('profiles').select('telefono').eq('id', u.id).maybeSingle(); if (data && data.telefono && !$('nWa').value) $('nWa').value = data.telefono.replace('+506', '') } catch (e) {} })();
      const top = save.closest('.mt-4') || save.parentNode;
      top.insertAdjacentHTML('beforebegin', planesPanel(true));
      if (fin) {
        fin.insertAdjacentHTML('afterend', `<p class="text-[11px] mt-1">📸 ${T('Sube de 4 a 6 fotos horizontales, nítidas y de al menos 800×600 px.')}</p><div id="nFotosQ" class="text-xs mt-1" role="status"></div>`);
        fin.addEventListener('change', async () => { const q = $('nFotosQ'); q.textContent = '⏳ ' + T('Revisando fotos…'); const r = await revisarFotos([...fin.files]); fin._mmQ = r;
          q.innerHTML = r.map((x, i) => `<div>${x.w < MINW || x.h < MINH ? '❌' : x.blur ? '⚠️' : '✅'} ${i + 1}. ${E(x.f.name.slice(0, 28))} · ${x.w}×${x.h}${x.w < MINW || x.h < MINH ? ' — ' + T('resolución muy baja') : x.blur ? ' — ' + T('parece borrosa') : ''}</div>`).join('') + (r.length < 4 ? `<div class="text-amber-600">${T('Recomendado: al menos 4 fotos.')}</div>` : r.length > 6 ? `<div class="text-red-600">${T('Máximo 6 fotos.')}</div>` : '') });
      }
      const prev = save.onclick;
      save.onclick = async e => {
        const v = id => ($(id) ? $(id).value.trim() : ''), tipo = v('nY'), lote = /Lote|Finca/i.test(tipo), err = [];
        if (!v('nT')) err.push(T('Título')); if (!(+v('nP') > 0)) err.push(T('Precio')); else if ((v('nC') === 'CRC' ? +v('nP') / 500 : +v('nP')) > 20e6) err.push(T('Precio (parece incorrecto: revisa la moneda y los ceros)'));
        if (!lote && !(+v('nB') >= 0 && v('nB') !== '')) err.push(T('Habitaciones')); if (!lote && v('nBa') === '') err.push(T('Baños'));
        if (!(+v('nA') > 0)) err.push(T('Área m²')); if (!v('nL')) err.push(T('Zona / cantón')); if (v('nD').length < 40) err.push(T('Descripción (mín. 40 caracteres)'));
        if (!(UI.draft && UI.draft.lat)) err.push(T('Ubicación en el mapa'));
        if ($('nSrv') && $('nSrv').checked) { if (!window.MMWa()) err.push(T('WhatsApp (8 dígitos de Costa Rica)')); else if (!$('nWaOk').checked) err.push(T('Aceptar que se muestre el WhatsApp')) }
        const srv = $('nSrv') && $('nSrv').checked, q = fin && (fin._mmQ || (fin.files.length ? await revisarFotos([...fin.files]) : []));
        if (srv && q) { if (q.length < 4 || q.length > 6) err.push(T('Fotos: de 4 a 6')); if (q.some(x => x.w < MINW || x.h < MINH)) err.push(T('Fotos con resolución mínima 800×600')) }
        if (err.length) { $('nErr').innerHTML = '⚠️ ' + T('Completa:') + ' ' + err.map(E).join(', '); $('nErr').scrollIntoView({ block: 'center', behavior: 'smooth' }); return }
        if (srv && q && q.some(x => x.blur) && !confirm(T('Algunas fotos parecen borrosas. ¿Publicar de todos modos?'))) return;
        return prev && prev.call(save, e);
      };
    };
  }

  /* ---------- 5) Panel de beneficios ---------- */
  function planesPanel(compacto) {
    const L = (window.GH_CONFIG && GH_CONFIG.limitesAnuncios) || { free: 1, plus: 3, pro: 5 };
    const c = (ic, t, d, cl) => `<div class="rounded-xl border-2 ${cl} p-2"><div class="font-bold">${ic} ${t}</div><div class="text-xs opacity-80">${d}</div></div>`;
    return `<div class="mt-3 ${compacto ? '' : 'max-w-5xl mx-auto'}"><div class="text-sm font-semibold mb-1">💡 ${T('Más visibilidad para tus anuncios')}</div><div class="grid grid-cols-2 ${compacto ? '' : 'sm:grid-cols-4'} gap-2 text-sm">
      ${c('🆓', T('Gratis'), L.free + ' ' + T('anuncio activo'), 'border-slate-200 dark:border-slate-600')}
      ${c('⭐', 'Plus', L.plus + ' ' + T('anuncios activos') + ' · ₡3.990/' + T('mes'), 'border-teal-500')}
      ${c('🟢', 'Pro', L.pro + ' ' + T('anuncios activos') + ' + ' + T('destacado verde') + ' · ₡6.990/' + T('mes'), 'border-green-600')}
      ${c('🥇', T('Destacado premium'), T('Borde dorado y primero en la lista, 7 días') + ' · ₡1.990', 'border-amber-500')}</div>
      <a href="planes.html" class="inline-block text-sm underline text-teal-700 dark:text-teal-300 mt-1" style="min-height:36px">${T('Ver planes')} →</a></div>`;
  }

  /* ---------- 3) Conteo + promedio de la vista / zona ---------- */
  function stats() {
    if (typeof App === 'undefined' || typeof MapController === 'undefined' || !MapController.map) return;
    let el = $('mmStats'); if (!el) { el = document.createElement('div'); el.id = 'mmStats'; el.setAttribute('aria-live', 'polite'); document.body.appendChild(el) }
    const b = MapController.map.getBounds(), L = (App.visible || []).filter(p => p.lat && b.contains([p.lat, p.lon])), pr = L.filter(p => p.price > 0).map(usd);
    pr.sort((a, b) => a - b); const avg = pr.length ? (pr.length % 2 ? pr[(pr.length - 1) / 2] : (pr[pr.length / 2 - 1] + pr[pr.length / 2]) / 2) : 0, zona = typeof Filters !== 'undefined' && Filters.state && Filters.state.polygon;
    el.textContent = `${zona ? '✏️ ' + T('En la zona') : '🗺️ ' + T('En esta vista')}: ${L.length.toLocaleString(LOC())} ${L.length === 1 ? T('propiedad') : T('propiedades')}${avg ? ' · ' + T('precio mediano') + ' $' + Math.round(avg).toLocaleString(LOC()) : ''}`;
  }
  function hookMapa() {
    if (typeof App === 'undefined' || typeof MapController === 'undefined' || !MapController.map || App._mmS) return false; App._mmS = 1;
    const r = App.refresh.bind(App); App.refresh = function () { const x = r.apply(this, arguments); setTimeout(stats, 0); return x };
    MapController.map.on('moveend', stats); stats();
    // ayuda de Dibujar zona (primera vez)
    const bd = $('bDraw'); if (bd) bd.addEventListener('click', () => { if (localStorage.getItem('mm_hint_dibujo')) return; localStorage.setItem('mm_hint_dibujo', '1');
      const h = document.createElement('div'); h.className = 'mmHint'; h.setAttribute('role', 'dialog');
      h.innerHTML = `<div class="text-3xl">✏️</div><b>${T('Dibuja tu zona')}</b><p class="text-sm mt-1">${T('Arrastra el dedo o el mouse alrededor del área que te interesa y suelta: la zona se cierra sola y verás solo las propiedades dentro.')}</p><button class="mt-3 rounded-lg bg-teal-600 text-white px-4" style="min-height:44px">${T('Entendido')}</button>`;
      document.body.appendChild(h); h.querySelector('button').onclick = () => h.remove(); setTimeout(() => h.remove(), 9000) }, true);
    // botón Publicar prominente
    if ($('bPub') && !$('mmPubFab')) { const f = document.createElement('button'); f.id = 'mmPubFab'; f.type = 'button'; f.textContent = '➕ ' + T('Publicar propiedad'); f.onclick = () => $('bPub').click(); document.body.appendChild(f) }
    return true;
  }

  /* ---------- 7) Propuesta de valor + conteo real + testimonios reales ---------- */
  async function client() { return window.Auth && Auth.client ? Auth.client() : null }
  async function activos() { try { const c = await client(); const { data } = await c.rpc('stats_publicos'); return (data && data.activos) || 0 } catch (e) { return 0 } }
  async function testimonios() { try { const c = await client(); const { data } = await c.from('testimonios').select('autor,texto').eq('visible', true).order('created_at', { ascending: false }).limit(6); return data || [] } catch (e) { return [] } }
  const VP = () => T('Encuentra propiedades en venta en Costa Rica directamente en el mapa.') + ' ' + T('Publica la tuya y conecta por WhatsApp con compradores.');
  async function valorLanding() {
    const ov = $('mmInicio'); if (!ov || ov.dataset.mmVp) return; ov.dataset.mmVp = 1; const h1 = ov.querySelector('h1'); if (!h1) return;
    const n = await activos(); h1.insertAdjacentHTML('beforebegin', `<p class="text-lg font-semibold mt-4 leading-snug">${E(VP())}</p>${n > 0 ? `<p class="text-sm mt-1 text-teal-700 dark:text-teal-300">🏠 ${n.toLocaleString(LOC())} ${n === 1 ? T('anuncio activo') : T('anuncios activos')}</p>` : ''}`);
    const g = $('mmIniG'); if (g) g.insertAdjacentHTML('afterend', planesPanel(false));
    const t = await testimonios(); if (t.length && g) g.insertAdjacentHTML('afterend', `<section class="mt-6"><h2 class="text-lg font-bold">💬 ${T('Lo que dicen nuestros usuarios')}</h2><div class="grid sm:grid-cols-2 gap-3 mt-2">${t.map(x => `<blockquote class="rounded-xl bg-white dark:bg-slate-800 p-3 shadow text-sm" data-noi18n>“${E(x.texto)}”<footer class="mt-1 text-xs opacity-70">— ${E(x.autor)}</footer></blockquote>`).join('')}</div></section>`);
  }
  async function valorLogin() {
    if (!/login\.html/.test(location.pathname) || $('mmVp')) return; const f = document.querySelector('form') || document.querySelector('main'); if (!f) return;
    const n = await activos(); f.insertAdjacentHTML('beforebegin', `<div id="mmVp" class="mb-4"><p class="text-lg font-semibold leading-snug">${E(VP())}</p>${n > 0 ? `<p class="text-sm mt-1 text-teal-700 dark:text-teal-300">🏠 ${n.toLocaleString(LOC())} ${n === 1 ? T('anuncio activo') : T('anuncios activos')}</p>` : ''}</div>`);
  }

  /* ---------- Admin: testimonios reales ---------- */
  async function adminTestimonios() {
    if (!/admin\.html/.test(location.pathname) || $('mmTesti')) return; const c = await client(); if (!c) return;
    const { data: ok } = await c.rpc('es_admin'); if (!ok) return;
    const s = document.createElement('section'); s.id = 'mmTesti'; s.className = 'max-w-5xl mx-auto m-4 p-4 rounded-2xl bg-white dark:bg-slate-800 shadow';
    s.innerHTML = `<h2 class="font-bold">💬 ${T('Testimonios (solo reales, con permiso del autor)')}</h2><div class="grid sm:grid-cols-3 gap-2 mt-2"><input id="tA" maxlength="80" placeholder="${T('Autor')}" class="border rounded px-2 dark:bg-slate-700" style="min-height:44px"><input id="tX" maxlength="500" placeholder="${T('Texto')}" class="border rounded px-2 sm:col-span-2 dark:bg-slate-700" style="min-height:44px"></div><button id="tAdd" class="mt-2 rounded-lg bg-teal-600 text-white px-4" style="min-height:44px">${T('Agregar')}</button><div id="tL" class="mt-3 text-sm"></div>`;
    (document.querySelector('main') || document.body).appendChild(s);
    const load = async () => { const { data } = await c.from('testimonios').select('*').order('created_at', { ascending: false }); $('tL').innerHTML = (data || []).map(x => `<div class="border-t dark:border-slate-700 py-2 flex gap-2 items-center"><span class="flex-1" data-noi18n>“${E(x.texto)}” — ${E(x.autor)}</span><button data-v="${x.id}" class="border rounded px-2" style="min-height:40px">${x.visible ? T('Ocultar') : T('Mostrar')}</button><button data-d="${x.id}" class="text-red-600 border border-red-500 rounded px-2" style="min-height:40px">🗑️</button></div>`).join('') || `<p class="opacity-60">${T('Sin testimonios: la sección está oculta en la app.')}</p>`;
      $('tL').querySelectorAll('[data-v]').forEach(b => b.onclick = async () => { const x = data.find(y => y.id == b.dataset.v); await c.from('testimonios').update({ visible: !x.visible }).eq('id', x.id); load() });
      $('tL').querySelectorAll('[data-d]').forEach(b => b.onclick = async () => { if (!confirm(T('¿Eliminar testimonio?'))) return; await c.from('testimonios').delete().eq('id', b.dataset.d); load() }) };
    $('tAdd').onclick = async () => { const a = $('tA').value.trim(), x = $('tX').value.trim(); if (!a || !x) return; const { error } = await c.from('testimonios').insert({ autor: a, texto: x }); if (error) return alert(error.message); $('tA').value = $('tX').value = ''; load() };
    load();
  }

  /* ---------- Mis anuncios sin WhatsApp (cuenta.html) ---------- */
  async function cuentaWa() {
    if (!/cuenta\.html/.test(location.pathname) || $('mmWaFalta')) return; const c = await client(), u = c && await Auth.user(); if (!u) return;
    const { data } = await c.from('anuncios').select('id,titulo').eq('owner_id', u.id).is('whatsapp', null).in('estado', ['aprobado', 'pendiente', 'pausado']);
    if (!data || !data.length) return; const box = document.createElement('div'); box.id = 'mmWaFalta'; box.className = 'max-w-3xl mx-auto px-4 mt-4';
    const { data: pf } = await c.from('profiles').select('telefono').eq('id', u.id).maybeSingle();
    box.innerHTML = `<div class="rounded-2xl border-2 border-green-500 bg-green-50 dark:bg-green-950 p-4"><b>🟢 ${data.length} ${T('anuncio(s) sin WhatsApp')}</b><p class="text-sm mt-1">${T('Los compradores no pueden escribirte por WhatsApp. Agrega tu número (se mostrará a usuarios con sesión iniciada).')}</p>
      <div class="flex gap-2 mt-2"><span class="px-2 flex items-center rounded border dark:border-slate-600">+506</span><input id="mmWaIn" inputmode="tel" value="${E(((pf && pf.telefono) || '').replace('+506', ''))}" placeholder="8888 8888" class="flex-1 px-2 rounded border dark:bg-slate-700 dark:border-slate-600" style="min-height:44px"><button id="mmWaSv" class="rounded-lg bg-green-600 text-white px-4 font-semibold" style="min-height:44px">${T('Guardar en todos')}</button></div><p id="mmWaMsg" class="text-xs mt-1" role="status"></p></div>`;
    const m = document.querySelector('main'); m ? m.before(box) : document.body.prepend(box);
    $('mmWaSv').onclick = async () => { const n = normWa($('mmWaIn').value); if (!n) { $('mmWaMsg').textContent = '⚠️ ' + T('Número inválido: 8 dígitos de Costa Rica.'); return }
      const { error } = await c.from('anuncios').update({ whatsapp: n }).in('id', data.map(x => x.id)); if (error) { $('mmWaMsg').textContent = '❌ ' + error.message; return } box.remove(); toast('✅ ' + T('WhatsApp guardado')) };
  }

  /* ---------- arranque ---------- */
  const start = () => {
    valorLogin(); adminTestimonios(); setTimeout(cuentaWa, 1500);
    const card = $('card'); if (card) new MutationObserver(() => setTimeout(mejorarFicha, 30)).observe(card, { childList: true, attributes: true, attributeFilter: ['class'] });
    let k = 0; const t = setInterval(() => { if ((typeof UI !== 'undefined') && UI.publish) hookPublicar(); const ok = hookMapa(); if ($('mmInicio')) valorLanding(); if ((ok || (typeof App !== 'undefined' && App._mmS)) && typeof UI !== 'undefined' && UI._mmPub || ++k > 60 || !$('card')) clearInterval(t) }, 250);
    new MutationObserver(() => { if ($('mmInicio')) valorLanding() }).observe(document.body, { childList: true });
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
