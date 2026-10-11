/* MapMarket · mapa: «Dibujar zona» con lápiz + «Guardar zona y avisarme», agendar visitas (.ics), destacado pagado 7 días.
   cuenta.html: visitas, estadísticas de mis anuncios (gráfico), correo de respaldo de notificaciones. admin: métricas en admin-gestion.js */
(function () {
  const T = s => (window.MMT ? MMT(s) : s), $ = id => document.getElementById(id);
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LOC = () => window.MMLocale || 'es-CR';
  const cli = async () => { if (!window.Auth || Auth.demo) throw new Error(T('Disponible cuando inicias sesión.')); const u = await Auth.user(); if (!u) { if (confirm(T('Inicia sesión para continuar. ¿Ir a iniciar sesión?'))) location.href = 'login.html?next=' + encodeURIComponent(location.pathname.slice(1) + location.search); throw new Error('login') } return [await Auth.client(), u] };
  const toast = m => { const t = document.createElement('div'); t.className = 'fixed bottom-20 left-1/2 -translate-x-1/2 z-[3000] bg-slate-900 text-white text-sm rounded-xl px-4 py-2 shadow'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3500) };
  const ics = (titulo, inicio, min, url) => { const f = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''); const a = new Date(inicio), b = new Date(a.getTime() + min * 6e4);
    const txt = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MapMarket//Visitas//ES', 'BEGIN:VEVENT', 'UID:mm-' + a.getTime() + '@mapmarketapp.com', 'DTSTAMP:' + f(new Date()), 'DTSTART:' + f(a), 'DTEND:' + f(b), 'SUMMARY:' + T('Visita') + ': ' + titulo.replace(/[,;\n]/g, ' '), 'URL:' + url, 'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:MapMarket', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const l = document.createElement('a'); l.href = URL.createObjectURL(new Blob([txt], { type: 'text/calendar' })); l.download = 'visita-mapmarket.ics'; l.click() };
  window.MMics = ics;

  // ───────── Mapa (index.html) ─────────
  window.addEventListener('mm-feat-ready', () => {
    if (typeof MapController === 'undefined' || !$('bDraw')) return;
    const map = MapController.map; let capa = null, zona = null;
    const bSave = document.createElement('button'); bSave.id = 'bSaveZone'; bSave.className = 'hidden px-2 py-1 rounded-full border border-teal-600 text-teal-700 dark:text-teal-300'; bSave.textContent = '🔔 ' + T('Guardar zona y avisarme'); $('bClear').after(bSave);
    const pintar = v => { if (capa) map.removeLayer(capa); capa = L.polygon(v, { color: '#7c3aed', weight: 3, fillOpacity: .08 }).addTo(map) };
    $('bDraw').onclick = () => MMDibujo.dibujar(map, zona, v => { if (!v || v.length < 3) return; zona = v; pintar(v); Filters.state.polygon = v; $('bClear').classList.remove('hidden'); bSave.classList.remove('hidden'); App.refresh() });
    $('bClear').onclick = () => { if (capa) map.removeLayer(capa); capa = null; zona = null; try { Layers.clearDraw() } catch (e) { } Filters.state.polygon = null; $('bClear').classList.add('hidden'); bSave.classList.add('hidden'); App.refresh() };
    bSave.onclick = async () => { try { const [c] = await cli(); const n = prompt(T('Nombre de la zona (te avisaremos de propiedades nuevas, destacadas o con rebaja dentro de ella):'), T('Mi zona')); if (!n) return;
      const f = Filters.state; const { error } = await c.rpc('guardar_zona', { p_nombre: n.slice(0, 80), p_geojson: MMDibujo.toGeo(zona), p_filtros: { type: f.type || null, max: isFinite(f.max) ? f.max : null, beds: f.beds || null } }); if (error) throw error;
      toast('✅ ' + T('Zona guardada. Te avisaremos aquí, por push y por correo.')); if (window.MMNotif && Notification && Notification.permission === 'default' && confirm(T('¿Activar notificaciones push en este dispositivo?'))) MMNotif.suscribir().catch(() => { }) } catch (e) { if (e.message !== 'login') alert(e.message) } };
    // Destacado pagado: añadir al conjunto de destacados
    // Botones extra en la ficha
    const sc = UI.showCard.bind(UI);
    UI.showCard = p => { sc(p); try { extraCard(p) } catch (e) { } };
    async function extraCard(p) {
      if (!p || !String(p.id).startsWith('u-')) return; const card = $('card'); if (!card || card.querySelector('#mmXtra')) return;
      const box = document.createElement('div'); box.id = 'mmXtra'; box.className = 'flex flex-wrap gap-2 px-3 pb-3'; const id = String(p.id).slice(2);
      const u = window.Auth && !Auth.demo ? await Auth.user() : null; const mio = u && p.owner_id === u.id;
      const B = (t, f) => { const b = document.createElement('button'); b.className = 'rounded-lg border dark:border-slate-600 px-3 text-sm'; b.style.minHeight = '44px'; b.textContent = t; b.onclick = f; box.appendChild(b) };
      if (!mio && p.status === 'activa') B('📅 ' + T('Agendar visita'), () => visita(p, id));
      if (mio) { B('★ ' + T('Destacar 7 días · ₡1.990'), () => destacarPago(id)); B('📊 ' + T('Estadísticas'), () => location.href = 'cuenta.html#stats') }
      const host = card.querySelector('.overflow-y-auto') || card; host.appendChild(box);
      // Contactar: WhatsApp directo del anunciante (si lo hizo público) o chat interno
      if (!mio) try { const c = await Auth.client(); const { data: pp } = await c.from('perfiles_publicos').select('telefono,whatsapp').eq('id', p.owner_id).maybeSingle();
        const tel = pp && pp.telefono ? String(pp.telefono).replace(/\D/g, '') : ''; const num = tel.length === 8 ? '506' + tel : tel;
        const link = 'https://mapmarketapp.com/index.html?p=' + p.id, msg = (window.MMLang === 'en' ? 'Hi! I am interested in your MapMarket listing: ' : '¡Hola! Me interesa tu anuncio en MapMarket: ') + p.title + ' ' + link;
        card.querySelectorAll('a[href^="https://wa.me"]').forEach(a => {
          if (num && pp.whatsapp !== false) { a.href = 'https://wa.me/' + num + '?text=' + encodeURIComponent(msg); a.target = '_blank'; a.rel = 'noopener' }
          else { a.removeAttribute('target'); a.href = '#'; a.onclick = e => { e.preventDefault(); const chat = [...card.querySelectorAll('button')].find(b => /mensaje|message/i.test(b.textContent)); chat ? chat.click() : (location.href = 'mensajes.html') }; a.title = T('El anunciante no comparte WhatsApp: escríbele por el chat de MapMarket'); a.innerHTML = '💬 ' + T('Contactar por chat') }
        }) } catch (e) { }
    }
    async function visita(p, id) {
      try { await cli() } catch (e) { return }
      const hoy = new Date(Date.now() + 864e5), f = hoy.toISOString().slice(0, 10), slots = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
      UI.modal(`<h2 class="text-xl font-bold pr-6">📅 ${T('Agendar visita')}</h2><p class="text-xs opacity-70" data-noi18n>${E(p.title)}</p>
        <label class="block text-sm mt-3">${T('Fecha')}<input id="vF" type="date" min="${f}" value="${f}" class="w-full mt-1 px-2 rounded border dark:bg-slate-700 dark:border-slate-600" style="min-height:44px"></label>
        <div class="text-sm mt-3">${T('Hora')}</div><div id="vH" class="flex flex-wrap gap-2 mt-1">${slots.map((h, i) => `<button type="button" data-h="${h}" class="vh rounded-lg border px-3 dark:border-slate-600 ${i === 1 ? 'bg-teal-600 text-white' : ''}" style="min-height:44px">${h}</button>`).join('')}</div>
        <label class="block text-sm mt-3">${T('Nota para el anunciante (opcional)')}<textarea id="vN" maxlength="300" class="w-full mt-1 p-2 rounded border dark:bg-slate-700 dark:border-slate-600"></textarea></label>
        <p class="text-xs opacity-70 mt-2">${T('El anunciante confirma o rechaza; te avisamos y te recordamos un día antes.')}</p>
        <button id="vOk" class="mt-3 w-full rounded-xl bg-teal-600 text-white font-semibold" style="min-height:48px">${T('Enviar solicitud')}</button>`);
      let h = slots[1]; document.querySelectorAll('.vh').forEach(b => b.onclick = () => { h = b.dataset.h; document.querySelectorAll('.vh').forEach(x => x.classList.remove('bg-teal-600', 'text-white')); b.classList.add('bg-teal-600', 'text-white') });
      $('vOk').onclick = async () => { try { const [c] = await cli(); const ini = new Date($('vF').value + 'T' + h + ':00-06:00'); const { error } = await c.rpc('pedir_visita', { p_anuncio: id, p_inicio: ini.toISOString(), p_nota: $('vN').value.trim() || null }); if (error) throw error; UI.close(); toast('✅ ' + T('Solicitud enviada. Te avisaremos cuando la confirmen.')) } catch (e) { alert(e.message) } };
    }
    async function destacarPago(id) {
      try { const [c] = await cli(); if (!confirm(T('Destacar este anuncio 7 días por ₡1.990 (pago único con ONVO Pay). ¿Continuar?'))) return;
        const { data, error } = await c.functions.invoke('onvo-checkout', { body: { periodo: 'destacado', anuncio: id, idioma: window.MMLang || 'es' } });
        if (error || !data || !data.url) throw new Error((data && data.error) || T('El pago del destacado aún no está disponible. Inténtalo más tarde.')); location.href = data.url } catch (e) { if (e.message !== 'login') alert(e.message) }
    }
  });

  // ───────── cuenta.html: visitas, estadísticas, correo de respaldo ─────────
  async function cuenta() {
    const main = document.querySelector('main') || document.body; if (!/cuenta\.html/.test(location.pathname) || !window.Auth || Auth.demo) return;
    const u = await Auth.user(); if (!u) return; const c = await Auth.client();
    const sec = (id, h) => { const s = document.createElement('section'); s.id = id; s.className = 'bg-white dark:bg-slate-800 rounded-2xl shadow p-4 mt-4'; s.innerHTML = h; main.appendChild(s); return s };
    // Visitas
    const sv = sec('visitas', `<h2 class="font-bold">📅 ${T('Visitas')}</h2><div id="vL" class="text-sm mt-2">${T('Cargando…')}</div>`);
    const cargarV = async () => { const { data } = await c.from('visitas').select('*, anuncios(titulo)').order('inicio', { ascending: true }).limit(100); const L = data || [];
      $('vL').innerHTML = L.length ? L.map(v => { const mio = v.owner_id === u.id; const fut = new Date(v.inicio) > new Date(); return `<div class="border-t dark:border-slate-700 py-2" data-v="${v.id}"><div><b data-noi18n>${E(v.anuncios?.titulo || '')}</b> · ${new Date(v.inicio).toLocaleString(LOC(), { dateStyle: 'medium', timeStyle: 'short' })} · <span class="text-xs rounded-full px-2 bg-slate-100 dark:bg-slate-700">${T(v.estado)}</span> <span class="text-xs opacity-70">${mio ? T('te la pidieron') : T('la pediste')}</span></div>${v.nota ? `<div class="text-xs opacity-80" data-noi18n>${E(v.nota)}</div>` : ''}
        <div class="flex flex-wrap gap-2 mt-1">${mio && v.estado === 'pendiente' ? `<button data-a="confirmada" class="rounded-lg bg-teal-600 text-white px-3" style="min-height:40px">✅ ${T('Confirmar')}</button><button data-a="rechazada" class="rounded-lg border px-3" style="min-height:40px">⛔ ${T('Rechazar')}</button>` : ''}${fut && ['pendiente', 'confirmada'].includes(v.estado) ? `<button data-a="cancelada" class="rounded-lg border px-3" style="min-height:40px">${T('Cancelar')}</button>` : ''}${v.estado === 'confirmada' ? `<button data-a="ics" class="rounded-lg border px-3" style="min-height:40px">📆 ${T('Agregar al calendario')}</button>` : ''}</div></div>` }).join('') : `<p class="opacity-70">${T('No tienes visitas agendadas.')}</p>`;
      $('vL').querySelectorAll('[data-a]').forEach(b => b.onclick = async () => { const id = +b.closest('[data-v]').dataset.v, v = L.find(x => x.id === id);
        if (b.dataset.a === 'ics') return ics(v.anuncios?.titulo || 'MapMarket', v.inicio, v.duracion_min, 'https://mapmarketapp.com/index.html?p=u-' + v.anuncio_id);
        const { error } = await c.rpc('responder_visita', { p_id: id, p_estado: b.dataset.a }); if (error) return alert(error.message); cargarV() }) };
    cargarV();
    // Estadísticas
    sec('stats', `<h2 class="font-bold">📊 ${T('Estadísticas de mis anuncios')} <span class="text-xs font-normal opacity-70">(${T('últimos 30 días')})</span></h2><div id="sL" class="text-sm mt-2">${T('Cargando…')}</div>`);
    const { data: st, error: se } = await c.rpc('mis_estadisticas', { dias: 30 });
    if (se) $('sL').textContent = se.message; else { const G = {}; (st || []).forEach(r => (G[r.anuncio_id] = G[r.anuncio_id] || { t: r.titulo, d: [] }).d.push(r));
      $('sL').innerHTML = Object.values(G).map(g => { const mx = Math.max(1, ...g.d.map(x => +x.vistas)); const tv = g.d.reduce((a, x) => a + +x.vistas, 0), tc = g.d.reduce((a, x) => a + +x.contactos, 0), fav = +g.d[g.d.length - 1].favoritos;
        return `<div class="border-t dark:border-slate-700 py-3"><b data-noi18n>${E(g.t)}</b><div class="text-xs opacity-80">👁️ ${tv} ${T('vistas')} · 💬 ${tc} ${T('contactos')} · ❤️ ${fav} ${T('favoritos')}</div>
        <svg viewBox="0 0 300 60" class="w-full h-16 mt-1" role="img" aria-label="${T('Vistas por día')}">${g.d.map((x, i) => { const h = Math.round(+x.vistas / mx * 52); return `<rect x="${i * 10 + 1}" y="${58 - h}" width="8" height="${h}" rx="1" class="fill-teal-500"><title>${new Date(x.dia + 'T12:00').toLocaleDateString(LOC())}: ${x.vistas} ${T('vistas')}, ${x.contactos} ${T('contactos')}</title></rect>` }).join('')}<line x1="0" y1="58.5" x2="300" y2="58.5" stroke="currentColor" opacity=".2"/></svg></div>` }).join('') || `<p class="opacity-70">${T('Aún no tienes anuncios publicados.')}</p>` }
    // Preferencias de notificación
    const { data: pf } = await c.from('profiles').select('notif_correo').eq('id', u.id).maybeSingle();
    const sn = sec('notifpref', `<h2 class="font-bold">🔔 ${T('Notificaciones')}</h2><label class="flex items-center gap-2 mt-2 text-sm"><input id="nCor" type="checkbox" class="w-5 h-5" ${pf?.notif_correo !== false ? 'checked' : ''}> ${T('Enviarme por correo las notificaciones que no lea')}</label><button id="nPush" class="mt-2 rounded-lg border px-3 text-sm" style="min-height:44px">🔔 ${T('Activar notificaciones push en este dispositivo')}</button><p class="text-xs opacity-70 mt-1">${T('En la app de Android las notificaciones push aún no están disponibles: te avisamos en la campana 🔔 y por correo.')}</p>`);
    $('nCor').onchange = async e => { await c.from('profiles').update({ notif_correo: e.target.checked }).eq('id', u.id); toast('✅ ' + T('Guardado')) };
    $('nPush').onclick = () => window.MMNotif && MMNotif.suscribir().catch(e => alert(e.message));
    if (location.hash) setTimeout(() => { const t = document.querySelector(location.hash); t && t.scrollIntoView() }, 400);
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', () => setTimeout(cuenta, 800)) : setTimeout(cuenta, 800);
})();
