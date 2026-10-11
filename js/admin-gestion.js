/* MapMarket · admin: Usuarios, Perfiles y permisos, Anuncios, Imágenes, Auditoría (todo vía RPC con verificación es_admin en el servidor) */
(function () {
  const btn = (a, t, cls = '') => `<button data-g="${a}" class="rounded-lg border dark:border-slate-600 px-3 ${cls}" style="min-height:40px">${t}</button>`;
  const money = a => (a.moneda === 'CRC' ? '₡' : '$') + Number(a.precio).toLocaleString('es-CR');
  const d = t => t ? new Date(t).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' }) : '–';
  const ask = (m, def = '') => new Promise(ok => { const dl = document.createElement('dialog'); dl.className = 'rounded-xl p-4 w-[min(92vw,420px)] dark:bg-slate-800 dark:text-white'; dl.innerHTML = `<form method="dialog"><p class="font-semibold mb-2">${E(m)}</p><textarea class="w-full border rounded p-2 dark:bg-slate-900" rows="3" aria-label="Nota">${E(def)}</textarea><div class="flex justify-end gap-2 mt-3"><button value="no" class="px-3 h-10">Cancelar</button><button value="si" class="px-3 h-10 rounded bg-teal-600 text-white">Confirmar</button></div></form>`; document.body.appendChild(dl); dl.onclose = () => { ok(dl.returnValue === 'si' ? dl.querySelector('textarea').value.trim() : null); dl.remove() }; dl.showModal() });
  const rpc = async (f, a) => { const { data, error } = await C.rpc(f, a); if (error) throw error; return data };
  const rerender = () => show(cur);
  const bind = (fn) => setTimeout(() => { const o = $('out'); o.onclick = async e => { const b = e.target.closest('[data-g]'); if (!b) return; b.disabled = true; try { await fn(b.dataset.g, b, b.closest('[data-id]')) } catch (er) { alert(er.message) } finally { b.disabled = false } } }, 0);
  const sel = () => [...document.querySelectorAll('#out input.gsel:checked')].map(x => x.value);

  if (typeof T !== 'undefined') {
  // ---------- Usuarios ----------
  const U = { q: '', f: '', o: 'created_at', p: 0 };
  T.usuarios = ['👥 Usuarios', async () => {
    const rows = await rpc('admin_usuarios', { q: U.q, filtro: U.f, orden: U.o, lim: 25, desde: U.p * 25 }); const tot = rows[0]?.total || 0;
    bind(async (g, b, r) => {
      if (g === 'buscar') { U.q = $('uQ').value.trim(); U.f = $('uF').value; U.o = $('uO').value; U.p = 0; return rerender() }
      if (g === 'pag') { U.p = Math.max(0, U.p + (+b.dataset.n)); return rerender() }
      const id = r.dataset.id, fila = rows.find(x => x.id === id);
      if (g.startsWith('plus:')) {
        let hasta; const v = g.slice(5); const base = fila.plus_activo && fila.plus_until && new Date(fila.plus_until) > new Date() && $('uExt').checked ? new Date(fila.plus_until) : new Date();
        if (v === 'fecha') { const x = r.querySelector('.uFecha').value; if (!x) return alert('Elige una fecha'); hasta = new Date(x + 'T23:59:59') }
        else if (v !== 'revocar') { hasta = new Date(base); if (v.endsWith('d')) hasta.setDate(hasta.getDate() + parseInt(v)); else hasta.setMonth(hasta.getMonth() + parseInt(v)) }
        const nota = await ask(v === 'revocar' ? `¿Revocar el plan pagado de ${fila.email}?` : `Otorgar ${r.querySelector('.uNivel').value === 'pro' ? 'Pro' : 'Plus'} a ${fila.email} hasta ${hasta.toLocaleDateString('es-CR')}. Motivo / nota:`); if (nota === null) return;
        await rpc('admin_plan', { uid: id, nivel: v === 'revocar' ? 'free' : r.querySelector('.uNivel').value, hasta: v === 'revocar' ? null : hasta.toISOString(), nota }); return rerender()
      }
      if (g === 'datos') { const x = await rpc('admin_usuario_datos', { uid: id }); const box = r.querySelector('.uDatos'); box.classList.toggle('hidden'); box.innerHTML = x ? Object.entries(x).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `<div><span class="opacity-60">${E(k)}:</span> ${k === 'foto_url' ? `<a class="underline" target="_blank" rel="noopener" href="${E(v)}">ver foto</a>` : E(v)}</div>`).join('') || 'Sin datos personales' : 'Sin perfil'; return }
      if (g === 'rol') { const nuevo = r.querySelector('.uRol').value; if (nuevo === fila.rol) return; const nota = await ask(`Cambiar rol de ${fila.email}: ${fila.rol} → ${nuevo}. Motivo:`); if (nota === null) return; await rpc('admin_rol', { uid: id, nuevo, nota }); return rerender() }
    });
    return `<div class="flex flex-wrap gap-2 mb-3"><input id="uQ" value="${E(U.q)}" placeholder="Buscar correo o nombre" aria-label="Buscar usuario" class="h-10 px-3 rounded-lg border dark:bg-slate-800 flex-1 min-w-[180px]">
      <select id="uF" aria-label="Filtro" class="h-10 px-2 rounded-lg border dark:bg-slate-800">${[['', 'Todos'], ['plus', 'Plus'], ['pro', 'Pro'], ['gratis', 'Gratis'], ['prueba', 'En prueba'], ['plus_admin', 'Plus otorgado por admin'], ['usuario', 'Rol usuario'], ['agente', 'Rol agente'], ['admin', 'Rol admin']].map(([v, t]) => `<option value="${v}" ${U.f === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="uO" aria-label="Orden" class="h-10 px-2 rounded-lg border dark:bg-slate-800">${[['created_at', 'Más recientes'], ['last_sign_in', 'Último acceso'], ['plus_until', 'Plus hasta'], ['email', 'Correo A-Z'], ['mensajes', 'Más mensajes']].map(([v, t]) => `<option value="${v}" ${U.o === v ? 'selected' : ''}>${t}</option>`).join('')}</select>${btn('buscar', 'Buscar', 'bg-teal-600 text-white border-teal-600')}
      <label class="text-xs flex items-center gap-1"><input id="uExt" type="checkbox" checked> Extender desde el vencimiento actual</label></div>
      <p class="text-xs opacity-70 mb-2">${tot} usuarios · página ${U.p + 1} de ${Math.max(1, Math.ceil(tot / 25))}</p>
      ${rows.map(u => `<article data-id="${u.id}" class="bg-white dark:bg-slate-800 rounded-xl shadow p-3 mb-2 text-sm">
        <div class="flex flex-wrap gap-x-3 gap-y-1 items-baseline"><b>${E(u.email)}</b><span>${E(u.nombre || '')}</span><span class="text-xs rounded-full px-2 ${u.rol === 'admin' ? 'bg-red-100 text-red-800' : u.rol === 'agente' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}">${u.rol}</span>
          <span class="text-xs rounded-full px-2 ${u.plus_activo ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-700'}">${u.plan === 'pro' ? '💎 Pro' : u.plus_activo ? '⭐ Plus' : 'Gratis'}${u.plus_origen ? ' · ' + E(u.plus_origen) : ''}</span>
          ${u.trial_ends_at && new Date(u.trial_ends_at) > new Date() ? '<span class="text-xs">⏳ prueba hasta ' + d(u.trial_ends_at) + '</span>' : u.trial_used ? '<span class="text-xs opacity-60">prueba usada</span>' : ''}</div>
        <div class="text-xs opacity-70 mt-1">Alta ${d(u.created_at)} · último acceso ${d(u.last_sign_in)} · Plus hasta ${d(u.plus_until)} · ❤️ ${u.favoritos} · 🏠 ${u.publicaciones} · 💬 ${u.mensajes}</div>
        <div class="flex flex-wrap gap-1.5 mt-2 items-center"><select class="uNivel h-10 px-2 rounded-lg border dark:bg-slate-900" aria-label="Plan a otorgar"><option value="plus">Plus</option><option value="pro" ${u.plan === 'pro' ? 'selected' : ''}>Pro</option></select>${btn('plus:7d', '+7 días')}${btn('plus:1m', '+1 mes')}${btn('plus:3m', '+3 meses')}${btn('plus:12m', '+1 año')}<input type="date" class="uFecha h-10 px-2 rounded-lg border dark:bg-slate-900" aria-label="Plus hasta fecha">${btn('plus:fecha', 'Hasta fecha')}${u.plus_activo ? btn('plus:revocar', 'Revocar plan', 'text-red-600') : ''}
          <select class="uRol h-10 px-2 rounded-lg border dark:bg-slate-900" aria-label="Rol">${['usuario', 'agente', 'admin'].map(r => `<option ${r === u.rol ? 'selected' : ''}>${r}</option>`).join('')}</select>${btn('rol', 'Cambiar rol')}${btn('datos', '👤 Datos personales')}</div><div class="uDatos hidden mt-2 text-xs grid sm:grid-cols-2 gap-x-4 bg-slate-50 dark:bg-slate-900 rounded-lg p-2"></div></article>`).join('') || '<p>Sin resultados.</p>'}
      <div class="flex gap-2 mt-3">${U.p > 0 ? `<button data-g="pag" data-n="-1" class="rounded-lg border px-3 h-10">← Anterior</button>` : ''}${(U.p + 1) * 25 < tot ? `<button data-g="pag" data-n="1" class="rounded-lg border px-3 h-10">Siguiente →</button>` : ''}</div>`;
  }];

  // ---------- Perfiles y permisos ----------
  T.permisos = ['🛡️ Perfiles y permisos', async () => {
    const { data, error } = await C.from('permisos').select('*').order('feature'); if (error) throw error;
    const F = [...new Set(data.map(r => r.feature))], P = Perm.PERFILES, g = (f, p) => data.find(r => r.feature === f && r.perfil === p) || {};
    bind(async (a, b) => {
      if (a !== 'perm') return; const [f, p] = b.dataset.k.split('|'); const cell = b.closest('td'); const act = cell.querySelector('input[type=checkbox]').checked, l = cell.querySelector('input[type=number]');
      const nota = await ask(`Guardar ${Perm.LBL[f] || f} para «${p}»: ${act ? 'activo' : 'inactivo'}${l && l.value ? ', límite ' + l.value : ''}. Nota:`); if (nota === null) return;
      await rpc('admin_permiso', { p_perfil: p, p_feature: f, p_activo: act, p_limite: l && l.value !== '' ? +l.value : null, nota }); rerender()
    });
    return `<p class="text-sm opacity-80 mb-2">Lo que ve cada perfil. Un usuario suma permisos de su plan (Gratis/Plus/Pro) y su rol (Agente/Admin). Límite vacío = sin límite. 🔒 = bloqueado por seguridad. Favoritos, búsquedas guardadas y alertas también se aplican en el servidor.</p>
      <div class="overflow-x-auto"><table class="text-sm w-full bg-white dark:bg-slate-800 rounded-xl"><tr><th class="text-left p-2">Función</th>${P.map(p => `<th class="p-2 capitalize">${p}</th>`).join('')}</tr>
      ${F.map(f => `<tr class="border-t dark:border-slate-700"><td class="p-2">${E(Perm.LBL[f] || f)}</td>${P.map(p => { const r = g(f, p); const lim = ['favoritos', 'listas', 'anuncios_activos'].includes(f); return `<td class="p-2 text-center"><label class="inline-flex items-center gap-1"><input type="checkbox" ${r.activo ? 'checked' : ''} ${r.bloqueado ? 'disabled' : ''} aria-label="${E(f)} ${p}">${r.bloqueado ? '🔒' : ''}</label>${lim ? `<input type="number" min="0" value="${r.limite ?? ''}" class="w-16 h-9 border rounded ml-1 px-1 dark:bg-slate-900" aria-label="límite ${E(f)} ${p}">` : ''}${r.bloqueado ? '' : `<button data-g="perm" data-k="${f}|${p}" class="ml-1 text-xs underline" style="min-height:36px">Guardar</button>`}</td>` }).join('')}</tr>`).join('')}</table></div>`;
  }];

  // ---------- Anuncios ----------
  const A = { e: '', q: '' };
  T.anuncios = ['📋 Anuncios', async () => {
    let qy = C.from('anuncios').select('*').order('created_at', { ascending: false }).limit(200); if (A.e) qy = qy.eq('estado', A.e); if (A.q) qy = qy.ilike('titulo', '%' + A.q + '%');
    const { data, error } = await qy; if (error) throw error;
    let demos = []; try { const j = await (await fetch('data/propiedades.json', { cache: 'no-store' })).json(); demos = (Array.isArray(j) ? j : j.items || j.propiedades || []).filter(x => x.demo) } catch (e) {}
    const { data: ocs } = await C.from('anuncios_ocultos').select('id'); const H = new Set((ocs || []).map(x => String(x.id)));
    bind(async (g, b, r) => {
      if (g.startsWith('demo')) { const dlg = window.MMDialogo || (async m => confirm(m) ? '' : null);
        if (g === 'demo:restaurar') { if (await dlg('¿Restaurar todos los ejemplos ocultos?', { campo: false }) === null) return; const { error } = await C.from('anuncios_ocultos').delete().neq('id', ''); if (error) throw error; return rerender() }
        const ids = g === 'demo:todos' ? demos.map(x => String(x.id)) : [...document.querySelectorAll('#out input.dsel:checked')].map(x => x.value); if (!ids.length) return alert('Selecciona ejemplos');
        const m = await dlg(`¿Eliminar ${ids.length} anuncio(s) de ejemplo? Se ocultan para todos los usuarios. Motivo:`, { ok: 'Eliminar', peligro: true }); if (m === null) return;
        const { error } = await C.rpc('admin_ocultar_demo', { ids, motivo: m || null }); if (error) throw error; return rerender() }
      if (g === 'filtrar') { A.e = $('aE').value; A.q = $('aQ').value.trim(); return rerender() }
      if (g === 'todos') { document.querySelectorAll('#out input.gsel').forEach(x => x.checked = b.dataset.on !== '1'); b.dataset.on = b.dataset.on === '1' ? '0' : '1'; return }
      const [acc, masivo] = g.split(':'); const ids = masivo ? sel() : [r.dataset.id]; if (!ids.length) return alert('Selecciona anuncios');
      await Admin.anuncios(ids, acc, data); rerender()
    });
    return `<div class="flex flex-wrap gap-2 mb-3"><select id="aE" aria-label="Estado" class="h-10 px-2 rounded-lg border dark:bg-slate-800">${['', 'pendiente', 'aprobado', 'rechazado', 'pausado', 'vendido', 'retirado'].map(v => `<option value="${v}" ${A.e === v ? 'selected' : ''}>${v || 'Todos los estados'}</option>`).join('')}</select><input id="aQ" value="${E(A.q)}" placeholder="Buscar título" aria-label="Buscar anuncio" class="h-10 px-3 rounded-lg border dark:bg-slate-800 flex-1">${btn('filtrar', 'Filtrar', 'bg-teal-600 text-white border-teal-600')}</div>
      <div class="flex flex-wrap gap-1.5 mb-2 text-sm">${btn('todos', '☑ Seleccionar todo')}${btn('aprobar:m', 'Aprobar sel.')}${btn('rechazar:m', 'Rechazar sel.')}${btn('pausar:m', 'Pausar sel.')}${btn('eliminar:m', '🗑️ Eliminar sel.', 'text-red-600')}</div>
      <p class="text-xs opacity-70 mb-2">${data.length} anuncios</p>
      <details class="mb-3 bg-white dark:bg-slate-800 rounded-xl shadow p-3 text-sm"><summary class="cursor-pointer font-semibold">🧪 Anuncios de ejemplo (${demos.length - demos.filter(x => H.has(String(x.id))).length} visibles · ${demos.filter(x => H.has(String(x.id))).length} eliminados)</summary>
        <div class="flex flex-wrap gap-1.5 my-2">${btn('demo:m', '🗑️ Eliminar ejemplos sel.', 'text-red-600')}${btn('demo:todos', '🗑️ Eliminar todos los ejemplos', 'bg-red-600 text-white border-red-600')}${btn('demo:restaurar', '↩️ Restaurar ejemplos')}</div>
        ${demos.map(x => `<label class="flex gap-2 items-center py-1 border-t dark:border-slate-700 ${H.has(String(x.id)) ? 'opacity-40 line-through' : ''}"><input type="checkbox" class="dsel w-5 h-5" value="${E(String(x.id))}" ${H.has(String(x.id)) ? 'disabled' : ''}> ${E(x.title)} · ${E(x.province || '')}</label>`).join('')}</details>
      ${data.map(a => `<article data-id="${a.id}" class="bg-white dark:bg-slate-800 rounded-xl shadow p-3 mb-2 text-sm flex gap-3"><input type="checkbox" class="gsel w-5 h-5 mt-1" value="${a.id}" aria-label="Seleccionar">
        ${a.imagenes?.[0] ? `<img src="${E(a.imagenes[0])}" alt="Foto" loading="lazy" class="w-20 h-20 object-cover rounded">` : ''}
        <div class="flex-1 min-w-0"><b>${E(a.titulo)}</b> <span class="text-xs rounded-full px-2 bg-slate-100 text-slate-700">${a.estado}</span><div class="text-xs opacity-70">${E(a.tipo)} · ${E(a.provincia)} · ${money(a)} · ${d(a.created_at)}${a.motivo_rechazo ? ' · motivo: ' + E(a.motivo_rechazo) : ''}</div>
        <div class="flex flex-wrap gap-1.5 mt-2">${a.estado !== 'aprobado' ? btn('aprobar', '✅ Aprobar') : ''}${btn('rechazar', '⛔ Rechazar')}${a.estado === 'pausado' ? btn('reactivar', '▶️ Reactivar') : btn('pausar', '⏸ Pausar')}${btn('editar', '✏️ Editar')}${btn('eliminar', '🗑️ Eliminar', 'text-red-600')}</div></div></article>`).join('') || '<p>Sin anuncios.</p>'}`;
  }];

  // ---------- Imágenes ----------
  const I = { e: 'pendientes' };
  T.imagenes = ['🖼️ Imágenes', async () => {
    let qy = C.from('imagenes_moderacion').select('*').order('reportes', { ascending: false }).order('created_at', { ascending: false }).limit(120);
    qy = I.e === 'pendientes' ? qy.in('estado', ['sin_revisar', 'marcada']) : qy.eq('estado', I.e);
    const { data, error } = await qy; if (error) throw error;
    bind(async (g, b, r) => {
      if (g === 'ver') { b.closest('figure').querySelector('img').classList.toggle('blur-xl'); return }
      if (g === 'filtrar') { I.e = $('iE').value; return rerender() }
      if (g === 'todos') { document.querySelectorAll('#out input.gsel').forEach(x => x.checked = true); return }
      const [acc, m] = g.split(':'); const ids = m ? sel().map(Number) : [+r.dataset.id]; if (!ids.length) return alert('Selecciona imágenes');
      const nota = await ask(acc === 'banear' ? '¿Suspender al dueño (no podrá publicar) y pausar sus anuncios? Motivo:' : `¿${acc} ${ids.length} imagen(es)? Nota:`); if (nota === null) return;
      if (acc === 'eliminar') { const paths = data.filter(x => ids.includes(x.id)).map(x => (x.url.split('/object/public/anuncios/')[1] || '')).filter(Boolean); if (paths.length) await C.storage.from('anuncios').remove(paths) }
      await rpc('admin_imagenes', { ids, accion: acc, nota }); rerender()
    });
    const sc = x => { const s = x.score || {}; const c = s.servidor || s.cliente; return c ? Object.entries(c).filter(([, v]) => typeof v === 'number').map(([k, v]) => k + ' ' + Math.round(v * 100) + '%').join(' · ') : 'sin puntaje' };
    return `<div class="flex flex-wrap gap-2 mb-3"><select id="iE" aria-label="Estado" class="h-10 px-2 rounded-lg border dark:bg-slate-800">${[['pendientes', 'Pendientes y marcadas'], ['marcada', 'Marcadas'], ['sin_revisar', 'Sin revisar'], ['aprobada', 'Aprobadas'], ['rechazada', 'Rechazadas']].map(([v, t]) => `<option value="${v}" ${I.e === v ? 'selected' : ''}>${t}</option>`).join('')}</select>${btn('filtrar', 'Filtrar', 'bg-teal-600 text-white border-teal-600')}${btn('todos', '☑ Todo')}${btn('aprobar:m', 'Aprobar sel.')}${btn('rechazar:m', 'Rechazar sel.')}${btn('eliminar:m', '🗑️ Eliminar sel.', 'text-red-600')}</div>
      <p class="text-xs opacity-70 mb-2">Las imágenes se muestran difuminadas. Marcadas/rechazadas quedan ocultas al público.</p>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">${data.map(x => `<figure data-id="${x.id}" class="bg-white dark:bg-slate-800 rounded-xl shadow p-2 text-xs"><div class="relative overflow-hidden rounded"><input type="checkbox" class="gsel absolute top-1 left-1 w-5 h-5 z-10" value="${x.id}" aria-label="Seleccionar"><img src="${E(x.url)}" alt="Imagen a revisar" loading="lazy" class="blur-xl w-full h-36 object-cover"></div>
        <figcaption class="mt-1"><b>${x.estado}</b> · 🚩${x.reportes} · ${E(x.fuente || '')}<div class="opacity-70">${E(sc(x))}</div><div class="flex flex-wrap gap-1 mt-1">${btn('ver', '👁️')}${btn('aprobar', '✅')}${btn('rechazar', '⛔')}${btn('eliminar', '🗑️')}${btn('banear', '🚫 Ban')}</div></figcaption></figure>`).join('') || '<p>No hay imágenes pendientes.</p>'}</div>`;
  }];

  // ---------- Auditoría ----------
  T.auditoria = ['🧾 Auditoría', async () => {
    const { data, error } = await C.from('admin_auditoria').select('*').order('created_at', { ascending: false }).limit(200); if (error) throw error;
    return `<div class="overflow-x-auto"><table class="w-full text-xs bg-white dark:bg-slate-800 rounded-xl"><tr class="text-left opacity-60"><th class="p-2">Cuándo</th><th>Admin</th><th>Acción</th><th>Objetivo</th><th>Detalle</th><th>Nota</th></tr>${data.map(r => `<tr class="border-t dark:border-slate-700 align-top"><td class="p-2 whitespace-nowrap">${d(r.created_at)}</td><td>${E((r.admin_id || '').slice(0, 8))}</td><td>${E(r.accion)}</td><td>${E((r.objetivo_id || '').slice(0, 8))}</td><td class="max-w-[320px] break-all">${E(JSON.stringify(r.detalle))}</td><td>${E(r.nota || '')}</td></tr>`).join('')}</table></div>`;
  }];

  // ---------- Reseñas (moderación) ----------
  const RS = { e: 'pendiente' };
  T.resenas = ['⭐ Reseñas', async () => {
    const data = await rpc('admin_lista_resenas', { p_estado: RS.e || null });
    bind(async (g, b, r) => {
      if (g === 'rfiltrar') { RS.e = $('rsE').value; return rerender() }
      if (g === 'rtodos') { document.querySelectorAll('#out input.rsel').forEach(x => x.checked = !x.checked); return }
      const [acc, m] = g.split(':'); const ids = (m ? [...document.querySelectorAll('#out input.rsel:checked')].map(x => +x.value) : [+r.dataset.id]); if (!ids.length) return alert('Selecciona reseñas');
      if (acc === 'eliminar') { const ok = window.MMDialogo ? await MMDialogo(`¿Eliminar ${ids.length} reseña(s)?`, { campo: false, ok: 'Eliminar', peligro: true }) : confirm('¿Eliminar?'); if (ok === null || ok === false) return }
      await rpc('admin_resenas', { ids, accion: acc }); rerender()
    });
    const st = n => '★'.repeat(n) + '☆'.repeat(5 - n);
    return `<div class="flex flex-wrap gap-2 mb-3"><select id="rsE" aria-label="Estado" class="h-10 px-2 rounded-lg border dark:bg-slate-800">${[['pendiente', 'Pendientes'], ['aprobada', 'Aprobadas'], ['rechazada', 'Rechazadas'], ['reportadas', 'Reportadas'], ['', 'Todas']].map(([v, l]) => `<option value="${v}" ${RS.e === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${btn('rfiltrar', 'Filtrar', 'bg-teal-600 text-white border-teal-600')}</div>
      <div class="flex flex-wrap gap-1.5 mb-2 text-sm">${btn('rtodos', '☑ Seleccionar todo')}${btn('aprobar:m', '✅ Aprobar sel.')}${btn('rechazar:m', '⛔ Rechazar sel.')}${btn('eliminar:m', '🗑️ Eliminar sel.', 'text-red-600')}</div>
      <p class="text-xs opacity-70 mb-2">${data.length} reseñas</p>
      ${data.map(x => `<article data-id="${x.id}" class="bg-white dark:bg-slate-800 rounded-xl shadow p-3 mb-2 text-sm flex gap-3"><input type="checkbox" class="rsel w-5 h-5 mt-1" value="${x.id}" aria-label="Seleccionar"><div class="flex-1 min-w-0">
        <div><span class="text-amber-500 text-base">${st(x.estrellas)}</span> <span class="text-xs rounded-full px-2 bg-slate-100 dark:bg-slate-700">${x.estado}</span>${x.reportes ? ` <span class="text-xs rounded-full px-2 bg-red-100 text-red-800">🚩 ${x.reportes}</span>` : ''}</div>
        <div class="text-xs opacity-70">${E(x.autor)} → <a class="underline" href="perfil.html?id=${x.agente_id}" target="_blank">${E(x.agente)}</a> · ${d(x.created_at)}</div>${x.comentario ? `<p class="mt-1">${E(x.comentario)}</p>` : ''}
        <div class="flex flex-wrap gap-1.5 mt-2">${btn('aprobar', '✅ Aprobar')}${btn('rechazar', '⛔ Rechazar')}${x.reportes ? btn('limpiar_reportes', 'Quitar reportes') : ''}${btn('eliminar', '🗑️ Eliminar', 'text-red-600')}</div></div></article>`).join('') || '<p class="opacity-60">Sin reseñas.</p>'}`;
  }];

  // ---------- Reportes (agrupados por anuncio, con acciones directas) ----------
  const R = { e: 'abierto', q: '' };
  const MOT = { vendida: 'Ya se vendió', datos: 'Datos incorrectos', duplicado: 'Duplicado', fraude: 'Fraude/estafa', otro: 'Otro' };
  const chip = (t, c = 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100') => `<span class="text-xs rounded-full px-2 ${c}">${E(t)}</span>`;
  const uuidDe = pid => { const m = String(pid || '').match(/^u-([0-9a-f-]{36})$/i); return m ? m[1] : null };
  T.reportes = ['🚩 Reportes', async () => {
    let qy = C.from('reportes').select('*').order('created_at', { ascending: false }).limit(500);
    qy = R.e === 'abierto' ? qy.eq('estado', 'nuevo') : R.e === 'cerrado' ? qy.neq('estado', 'nuevo') : qy;
    const [r, u] = await Promise.all([qy, C.from('reportes_usuarios').select('*').order('created_at', { ascending: false }).limit(100)]); if (r.error) throw r.error;
    const G = {}; r.data.forEach(x => (G[x.property_id] = G[x.property_id] || []).push(x));
    const uids = [...new Set(Object.keys(G).map(uuidDe).filter(Boolean))];
    const an = uids.length ? ((await C.from('anuncios').select('id,titulo,precio,moneda,estado,imagenes,owner_id,provincia,tipo,lat,lon,descripcion').in('id', uids)).data || []) : [];
    const AN = Object.fromEntries(an.map(a => [a.id, a]));
    const owners = [...new Set(an.map(a => a.owner_id).filter(Boolean))];
    const pf = owners.length ? ((await C.from('profiles').select('id,nombre,baneado').in('id', owners)).data || []) : [];
    const PF = Object.fromEntries(pf.map(p => [p.id, p]));
    let grupos = Object.entries(G).map(([pid, rs]) => ({ pid, rs, a: AN[uuidDe(pid)] }));
    if (R.q) { const q = R.q.toLowerCase(); grupos = grupos.filter(g => (g.pid + ' ' + (g.a?.titulo || '')).toLowerCase().includes(q)) }
    grupos.sort((x, y) => y.rs.length - x.rs.length);
    bind(async (g, b, card) => {
      if (g === 'filtrar') { R.e = $('rE').value; R.q = $('rQ').value.trim(); return rerender() }
      if (g === 'todos') { document.querySelectorAll('#out input.gsel').forEach(x => x.checked = b.dataset.on !== '1'); b.dataset.on = b.dataset.on === '1' ? '0' : '1'; return }
      const [acc, m] = g.split(':'); const cards = m ? sel().map(v => document.querySelector(`#out [data-id="${CSS.escape(v)}"]`)).filter(Boolean) : [card];
      if (!cards.length) return alert('Selecciona reportes');
      const repIds = cards.flatMap(c => c.dataset.rids.split(',').map(Number));
      if (acc === 'resuelto' || acc === 'descartado' || acc === 'reabrir') { const nota = await ask(`${acc === 'reabrir' ? 'Reabrir' : acc === 'resuelto' ? 'Marcar resuelto' : 'Descartar'}: ${repIds.length} reporte(s). Nota:`); if (nota === null) return; await rpc('admin_reportes', { ids: repIds, accion: acc, nota: nota || null }); return rerender() }
      if (acc === 'mapa') { window.open('index.html?p=' + encodeURIComponent(card.dataset.pid), '_blank'); return }
      if (acc === 'bloquear') { const o = card.dataset.owner; if (!o) return alert('Este anuncio no tiene dueño en MapMarket.'); const nota = await ask('¿Suspender al dueño (no podrá publicar) y pausar sus anuncios? Motivo:'); if (nota === null) return; await rpc('admin_bloquear_dueno', { uid: o, nota }); return rerender() }
      const ids = cards.map(c => uuidDe(c.dataset.pid)).filter(Boolean); if (!ids.length) return alert('Solo se puede actuar sobre anuncios publicados en MapMarket.');
      const ok = await Admin.anuncios(ids, acc, an); if (ok && acc === 'eliminar') await rpc('admin_reportes', { ids: repIds, accion: 'resuelto', nota: 'Anuncio eliminado' }); rerender()
    });
    const est = { aprobado: 'bg-emerald-100 text-emerald-900', pendiente: 'bg-amber-100 text-amber-900', pausado: 'bg-slate-200 text-slate-800', rechazado: 'bg-red-100 text-red-900' };
    return `<div class="flex flex-wrap gap-2 mb-3"><select id="rE" aria-label="Estado" class="h-10 px-2 rounded-lg border dark:bg-slate-800">${[['abierto', 'Abiertos'], ['cerrado', 'Resueltos / descartados'], ['todos', 'Todos']].map(([v, t]) => `<option value="${v}" ${R.e === v ? 'selected' : ''}>${t}</option>`).join('')}</select><input id="rQ" value="${E(R.q)}" placeholder="Buscar anuncio" aria-label="Buscar anuncio" class="h-10 px-2 rounded-lg border dark:bg-slate-800 flex-1 min-w-[160px]">${btn('filtrar', 'Filtrar')}</div>
      <div class="flex flex-wrap gap-1.5 mb-2 text-sm">${btn('todos', '☑ Seleccionar todo')}${btn('resuelto:m', '✔ Resolver sel.')}${btn('descartado:m', '✖ Descartar sel.')}${btn('pausar:m', 'Pausar sel.')}${btn('rechazar:m', 'Rechazar sel.')}${btn('eliminar:m', '🗑️ Eliminar sel.', 'text-red-600')}</div>
      <p class="text-xs opacity-70 mb-2">${grupos.length} anuncios · ${r.data.length} reportes</p>
      ${grupos.map(({ pid, rs, a }) => { const o = a && PF[a.owner_id]; const cnt = {}; rs.forEach(x => cnt[x.motivo] = (cnt[x.motivo] || 0) + 1); const abiertos = rs.some(x => x.estado === 'nuevo');
        return `<article data-id="${E(pid)}" data-pid="${E(pid)}" data-rids="${rs.map(x => x.id).join(',')}" data-owner="${a?.owner_id || ''}" class="bg-white dark:bg-slate-800 rounded-xl shadow p-3 mb-2 text-sm flex gap-3"><input type="checkbox" class="gsel w-5 h-5 mt-1" value="${E(pid)}" aria-label="Seleccionar">
        ${a?.imagenes?.[0] ? `<img src="${E(a.imagenes[0])}" alt="Foto" loading="lazy" class="w-20 h-20 object-cover rounded">` : '<div class="w-20 h-20 rounded bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs">Sin fotos</div>'}
        <div class="flex-1 min-w-0"><div class="flex flex-wrap gap-1 items-center"><b>${E(a?.titulo || pid)}</b>${a ? chip(a.estado, est[a.estado]) : chip('sin dueño en MapMarket')}${chip('🚩 ' + rs.length, 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100')}${abiertos ? '' : chip('cerrado')}</div>
          <div class="text-xs opacity-70">${a ? `${E(a.tipo)} · ${E(a.provincia)} · ${money(a)} · ` : ''}${o ? `Dueño: ${E(o.nombre || a.owner_id.slice(0, 8))}${o.baneado ? ' (suspendido)' : ''}` : ''}</div>
          <div class="text-xs mt-1">${Object.entries(cnt).map(([k, v]) => chip(`${MOT[k] || k} ×${v}`, 'bg-amber-50 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100')).join(' ')}</div>
          <ul class="text-xs mt-1 opacity-80">${rs.slice(0, 5).map(x => `<li>${d(x.created_at)} · ${E(MOT[x.motivo] || x.motivo)}${x.detalle ? ': ' + E(x.detalle) : ''}${x.estado !== 'nuevo' ? ` · <i>${E(x.estado)}${x.nota_admin ? ' — ' + E(x.nota_admin) : ''}</i>` : ''}</li>`).join('')}${rs.length > 5 ? `<li>+${rs.length - 5}…</li>` : ''}</ul>
          <div class="flex flex-wrap gap-1.5 mt-2">${btn('mapa', '🗺️ Ver en mapa')}${a ? btn('editar', '✏️ Editar') + (a.estado === 'pausado' ? btn('reactivar', '▶️ Reactivar') : btn('pausar', '⏸ Pausar')) + btn('rechazar', '⛔ Rechazar') + btn('eliminar', '🗑️ Eliminar', 'text-red-600') + (a.owner_id ? btn('bloquear', '🚫 Bloquear dueño') : '') : ''}${abiertos ? btn('resuelto', '✔ Resuelto') + btn('descartado', '✖ Descartar') : btn('reabrir', '↩ Reabrir')}</div></div></article>` }).join('') || '<p class="opacity-70">Sin reportes.</p>'}
      <h2 class="font-bold mt-6">Usuarios reportados (chat)</h2>${(u.data || []).length ? '<ul class="text-sm mt-2 space-y-1">' + u.data.map(x => `<li class="bg-white dark:bg-slate-800 rounded p-2">${d(x.created_at)} · <a class="underline" href="mensajes.html?c=${x.conversacion_id}">conv #${x.conversacion_id ?? '–'}</a> · usuario ${E((x.reported_id || '').slice(0, 8))}… · ${E(x.motivo)}</li>`).join('') + '</ul>' : '<p class="opacity-70 text-sm">Ninguno.</p>'}`
  }];

  // ---------- Retiros ----------
  const RT = { e: 'pendiente' };
  T.retiros = ['📰 Retiros', async () => {
    let qy = C.from('retiros').select('*').order('created_at', { ascending: false }).limit(300); if (RT.e !== 'todos') qy = RT.e === 'cerrado' ? qy.neq('estado', 'pendiente') : qy.eq('estado', RT.e);
    const { data, error } = await qy; if (error) throw error;
    const ref = x => { const m = String(x.listing_ref).match(/u-([0-9a-f-]{36})/i) || String(x.listing_ref).match(/([0-9a-f]{8}-[0-9a-f-]{27})/i); return m ? m[1] : null };
    const ids = [...new Set(data.map(ref).filter(Boolean))];
    const an = ids.length ? ((await C.from('anuncios').select('id,titulo,precio,moneda,estado,imagenes,owner_id,provincia,tipo').in('id', ids)).data || []) : []; const AN = Object.fromEntries(an.map(a => [a.id, a]));
    bind(async (g, b, card) => {
      if (g === 'filtrar') { RT.e = $('tE').value; return rerender() }
      if (g === 'todos') { document.querySelectorAll('#out input.gsel').forEach(x => x.checked = true); return }
      const [acc, m] = g.split(':'); const cards = m ? sel().map(v => document.querySelector(`#out [data-id="${v}"]`)).filter(Boolean) : [card]; if (!cards.length) return alert('Selecciona solicitudes');
      const rids = cards.map(c => +c.dataset.id);
      if (['retirado', 'corregido', 'rechazado', 'pendiente'].includes(acc)) { const nota = await ask(`Marcar ${rids.length} solicitud(es) como «${acc}». Nota:`); if (nota === null) return; await rpc('admin_retiros', { ids: rids, estado_nuevo: acc, nota: nota || null }); return rerender() }
      if (acc === 'mapa') { window.open('index.html?p=' + encodeURIComponent('u-' + card.dataset.aid), '_blank'); return }
      const aids = cards.map(c => c.dataset.aid).filter(Boolean); if (!aids.length) return alert('La solicitud no corresponde a un anuncio publicado en MapMarket.');
      const ok = await Admin.anuncios(aids, acc, an); if (ok && (acc === 'eliminar' || acc === 'pausar')) await rpc('admin_retiros', { ids: rids, estado_nuevo: 'retirado', nota: 'Anuncio ' + acc }); rerender()
    });
    return `<div class="flex flex-wrap gap-2 mb-3"><select id="tE" aria-label="Estado" class="h-10 px-2 rounded-lg border dark:bg-slate-800">${[['pendiente', 'Pendientes'], ['cerrado', 'Atendidas'], ['todos', 'Todas']].map(([v, t]) => `<option value="${v}" ${RT.e === v ? 'selected' : ''}>${t}</option>`).join('')}</select>${btn('filtrar', 'Filtrar')}</div>
      <div class="flex flex-wrap gap-1.5 mb-2 text-sm">${btn('todos', '☑ Seleccionar todo')}${btn('retirado:m', 'Marcar retirado sel.')}${btn('rechazado:m', 'Rechazar solicitud sel.')}${btn('pausar:m', 'Pausar anuncios sel.')}</div>
      ${data.map(x => { const a = AN[ref(x)]; return `<article data-id="${x.id}" data-aid="${a?.id || ''}" class="bg-white dark:bg-slate-800 rounded-xl shadow p-3 mb-2 text-sm flex gap-3"><input type="checkbox" class="gsel w-5 h-5 mt-1" value="${x.id}" aria-label="Seleccionar">
        ${a?.imagenes?.[0] ? `<img src="${E(a.imagenes[0])}" alt="Foto" loading="lazy" class="w-20 h-20 object-cover rounded">` : ''}
        <div class="flex-1 min-w-0"><div class="flex flex-wrap gap-1 items-center"><b>${E(a?.titulo || x.listing_ref)}</b>${chip(x.estado, x.estado === 'pendiente' ? 'bg-amber-100 text-amber-900' : undefined)}${a ? chip('anuncio: ' + a.estado) : ''}<span class="text-xs opacity-60 ml-auto">${d(x.created_at)}</span></div>
          ${a ? `<div class="text-xs opacity-70">${E(a.tipo)} · ${E(a.provincia)} · ${money(a)}</div>` : ''}
          <p class="text-xs mt-1">${E(x.nombre)} (<a class="underline" href="mailto:${E(x.email)}?subject=${encodeURIComponent('Tu solicitud de retiro en MapMarket')}">${E(x.email)}</a>) · ${E(x.relacion)}</p><p class="text-xs opacity-80 whitespace-pre-wrap">${E(x.motivo)}</p>${x.nota_admin ? `<p class="text-xs italic opacity-70">Nota: ${E(x.nota_admin)}</p>` : ''}
          <div class="flex flex-wrap gap-1.5 mt-2">${a ? btn('mapa', '🗺️ Ver en mapa') + btn('editar', '✏️ Editar') + (a.estado === 'pausado' ? btn('reactivar', '▶️ Reactivar') : btn('pausar', '⏸ Pausar')) + btn('eliminar', '🗑️ Eliminar', 'text-red-600') : ''}${btn('retirado', 'Marcar retirado')}${btn('corregido', 'Corregido')}${btn('rechazado', 'Rechazar solicitud')}${x.estado !== 'pendiente' ? btn('pendiente', '↩ Reabrir') : ''}</div></div></article>` }).join('') || '<p class="opacity-70">Sin solicitudes.</p>'}`
  }];

  // ---------- Fotos reportadas ----------
  const FR = { e: 'abierto' };
  T.fotosrep = ['📷 Fotos reportadas', async () => {
    const data = await rpc('admin_lista_reportes_fotos', { p_estado: FR.e }) || [];
    bind(async (g, b, card) => {
      if (g === 'filtrar') { FR.e = $('fE').value; return rerender() }
      if (g === 'ver') { b.closest('figure').querySelector('img').classList.toggle('blur-xl'); return }
      if (g === 'todos') { document.querySelectorAll('#out input.gsel').forEach(x => x.checked = true); return }
      const [acc, m] = g.split(':'); const figs = m ? sel().map(v => document.querySelector(`#out figure[data-id="${CSS.escape(v)}"]`)).filter(Boolean) : [card]; if (!figs.length) return alert('Selecciona imágenes');
      const urls = figs.map(f => f.dataset.url), imgIds = figs.map(f => +f.dataset.img).filter(Boolean);
      const nota = await ask(`${acc}: ${figs.length} foto(s). Nota:`); if (nota === null) return;
      if (['aprobar', 'rechazar', 'eliminar', 'banear'].includes(acc)) {
        if (!imgIds.length) return alert('Esta foto no está en la cola de moderación.');
        if (acc === 'eliminar') { const paths = urls.map(u => u.split('/object/public/anuncios/')[1]).filter(Boolean); if (paths.length) await C.storage.from('anuncios').remove(paths) }
        await rpc('admin_imagenes', { ids: imgIds, accion: acc, nota }); await rpc('admin_reportes_fotos', { urls, accion: acc === 'aprobar' ? 'descartado' : 'resuelto', nota });
      } else await rpc('admin_reportes_fotos', { urls, accion: acc, nota });
      rerender()
    });
    return `<div class="flex flex-wrap gap-2 mb-3"><select id="fE" aria-label="Estado" class="h-10 px-2 rounded-lg border dark:bg-slate-800">${[['abierto', 'Abiertos'], ['cerrado', 'Resueltos / descartados'], ['todos', 'Todos']].map(([v, t]) => `<option value="${v}" ${FR.e === v ? 'selected' : ''}>${t}</option>`).join('')}</select>${btn('filtrar', 'Filtrar')}</div>
      <div class="flex flex-wrap gap-1.5 mb-2 text-sm">${btn('todos', '☑ Seleccionar todo')}${btn('rechazar:m', '⛔ Ocultar sel.')}${btn('aprobar:m', '✅ Aprobar sel.')}${btn('descartado:m', '✖ Descartar reportes sel.')}</div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">${data.map((x, i) => `<figure data-id="f${i}" data-url="${E(x.url)}" data-img="${x.img_id || ''}" class="bg-white dark:bg-slate-800 rounded-xl shadow p-2 text-xs"><div class="relative overflow-hidden rounded"><input type="checkbox" class="gsel absolute top-1 left-1 w-5 h-5 z-10" value="f${i}" aria-label="Seleccionar"><img src="${E(x.url)}" alt="Imagen a revisar" loading="lazy" class="w-full h-32 object-cover blur-xl"></div>
        <figcaption class="mt-1"><b>🚩 ${x.n}</b> · ${E(x.img_estado || 'sin moderación')}<div class="opacity-70">${E((x.motivos || []).join(', '))} · ${d(x.ultimo)}</div><div class="flex flex-wrap gap-1 mt-1">${btn('ver', '👁️')}${btn('aprobar', '✅')}${btn('rechazar', '⛔')}${btn('eliminar', '🗑️')}${x.owner_id ? btn('banear', '🚫 Ban') : ''}${FR.e === 'abierto' ? btn('descartado', '✖') : btn('reabrir', '↩')}</div></figcaption></figure>`).join('') || '<p class="opacity-70">Sin fotos reportadas.</p>'}</div>`
  }];

  // ---------- Métricas ----------
  T.metricas = ['📈 Métricas', async () => {
    const m = await rpc('admin_metricas', {}); const n = v => Number(v || 0).toLocaleString(window.MMLocale || 'es-CR');
    const K = (t, v, s = '') => `<div class="bg-white dark:bg-slate-800 rounded-xl shadow p-3"><div class="text-xs opacity-70">${t}</div><div class="text-2xl font-extrabold">${v}</div>${s ? `<div class="text-[11px] opacity-60">${s}</div>` : ''}</div>`;
    const alt = m.altas_dia || [], mx = Math.max(1, ...alt.map(x => x.n)); const pl = m.planes || {}, an = m.anuncios || {};
    return `<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">${K('Usuarios', n(m.usuarios), `${n(m.activos_7d)} activos 7 d · ${n(m.activos_30d)} 30 d`)}${K('MRR estimado', '₡' + n(m.mrr_crc), `${n(m.pagos_onvo)} suscripciones ONVO activas`)}${K('Conversión a pago', (m.conversion_pct ?? 0) + ' %', 'gratis → pago (ONVO)')}${K('Destacados pagados 30 d', '₡' + n(m.destacados_pagados_30d))}
      ${K('Planes', `${n(pl.plus)} Plus · ${n(pl.pro)} Pro`, `${n(pl.prueba)} en prueba · ${n(pl.free)} gratis`)}${K('Anuncios', n(Object.values(an).reduce((a, b) => a + b, 0)), Object.entries(an).map(([k, v]) => k + ' ' + v).join(' · '))}${K('Pendientes de moderar', `${n(m.reportes_abiertos)} 🚩 · ${n(m.retiros_pendientes)} 📰 · ${n(m.imagenes_pendientes)} 🖼️`)}${K('Actividad 7 d', `${n(m.vistas_7d)} 👁️`, `${n(m.mensajes_7d)} mensajes · ${n(m.visitas_30d)} visitas (30 d) · ${n(m.zonas_guardadas)} zonas · ${n(m.push_subs)} push`)}</div>
      <h3 class="font-bold mt-4">Altas por día (30 días)</h3><svg viewBox="0 0 310 80" class="w-full h-24 bg-white dark:bg-slate-800 rounded-xl" role="img" aria-label="Altas por día">${alt.map((x, i) => { const h = Math.round(x.n / mx * 64); return `<rect x="${i * 10 + 4}" y="${74 - h}" width="8" height="${h}" class="fill-teal-500"><title>${x.d}: ${x.n}</title></rect>` }).join('')}</svg>
      <p class="text-xs opacity-70 mt-2">Eventos de pago (30 d): ${Object.entries(m.pagos_eventos_30d || {}).map(([k, v]) => E(k) + ' ' + v).join(' · ') || '—'}. El MRR es una estimación con precios de lista (Plus mensual/anual prorrateado, Pro) de suscripciones ONVO activas no canceladas.</p>`
  }];

  }
  // Acciones de anuncios compartidas (panel y ficha del mapa)
  window.Admin = {
    async anuncios(ids, acc, data) {
      const C2 = (typeof C !== 'undefined' && C) || await Auth.client(); let cambios = null;
      if (acc === 'editar') { const a = (data || []).find(x => x.id === ids[0]); const t = await ask('Nuevo título', a?.titulo || ''); if (t === null) return; const p = await ask('Nuevo precio (solo número)', a ? String(a.precio) : ''); if (p === null) return; const ds = await ask('Descripción', a?.descripcion || ''); if (ds === null) return; cambios = { titulo: t, precio: p, descripcion: ds } }
      const motivo = acc === 'editar' ? 'Edición de moderación' : await ask(acc === 'rechazar' ? 'Motivo del rechazo (lo verá el dueño):' : acc === 'eliminar' ? `¿ELIMINAR ${ids.length} anuncio(s) definitivamente, con sus fotos? Motivo (lo verá el dueño):` : `¿${acc} ${ids.length} anuncio(s)? Nota para el dueño (opcional):`);
      if (motivo === null) return false;
      if (acc === 'eliminar') { const { data: rs } = await C2.from('anuncios').select('imagenes').in('id', ids); const paths = (rs || []).flatMap(r => r.imagenes || []).map(u => u.split('/object/public/anuncios/')[1]).filter(Boolean); if (paths.length) { const { error } = await C2.storage.from('anuncios').remove(paths); if (error) console.warn('fotos', error) } }
      const { error } = await C2.rpc('admin_anuncios', { ids, accion: acc, motivo, cambios }); if (error) throw error; return true;
    }
  };
})();
