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
        const nota = await ask(v === 'revocar' ? `¿Revocar Plus a ${fila.email}?` : `Otorgar Plus a ${fila.email} hasta ${hasta.toLocaleDateString('es-CR')}. Motivo / nota:`); if (nota === null) return;
        await rpc('admin_plus', { uid: id, hasta: v === 'revocar' ? null : hasta.toISOString(), nota }); return rerender()
      }
      if (g === 'rol') { const nuevo = r.querySelector('.uRol').value; if (nuevo === fila.rol) return; const nota = await ask(`Cambiar rol de ${fila.email}: ${fila.rol} → ${nuevo}. Motivo:`); if (nota === null) return; await rpc('admin_rol', { uid: id, nuevo, nota }); return rerender() }
    });
    return `<div class="flex flex-wrap gap-2 mb-3"><input id="uQ" value="${E(U.q)}" placeholder="Buscar correo o nombre" aria-label="Buscar usuario" class="h-10 px-3 rounded-lg border dark:bg-slate-800 flex-1 min-w-[180px]">
      <select id="uF" aria-label="Filtro" class="h-10 px-2 rounded-lg border dark:bg-slate-800">${[['', 'Todos'], ['plus', 'Plus activo'], ['gratis', 'Gratis'], ['prueba', 'En prueba'], ['plus_admin', 'Plus otorgado por admin'], ['usuario', 'Rol usuario'], ['agente', 'Rol agente'], ['admin', 'Rol admin']].map(([v, t]) => `<option value="${v}" ${U.f === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="uO" aria-label="Orden" class="h-10 px-2 rounded-lg border dark:bg-slate-800">${[['created_at', 'Más recientes'], ['last_sign_in', 'Último acceso'], ['plus_until', 'Plus hasta'], ['email', 'Correo A-Z'], ['mensajes', 'Más mensajes']].map(([v, t]) => `<option value="${v}" ${U.o === v ? 'selected' : ''}>${t}</option>`).join('')}</select>${btn('buscar', 'Buscar', 'bg-teal-600 text-white border-teal-600')}
      <label class="text-xs flex items-center gap-1"><input id="uExt" type="checkbox" checked> Extender desde el vencimiento actual</label></div>
      <p class="text-xs opacity-70 mb-2">${tot} usuarios · página ${U.p + 1} de ${Math.max(1, Math.ceil(tot / 25))}</p>
      ${rows.map(u => `<article data-id="${u.id}" class="bg-white dark:bg-slate-800 rounded-xl shadow p-3 mb-2 text-sm">
        <div class="flex flex-wrap gap-x-3 gap-y-1 items-baseline"><b>${E(u.email)}</b><span>${E(u.nombre || '')}</span><span class="text-xs rounded-full px-2 ${u.rol === 'admin' ? 'bg-red-100 text-red-800' : u.rol === 'agente' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}">${u.rol}</span>
          <span class="text-xs rounded-full px-2 ${u.plus_activo ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-700'}">${u.plus_activo ? '⭐ Plus' : 'Gratis'}${u.plus_origen ? ' · ' + E(u.plus_origen) : ''}</span>
          ${u.trial_ends_at && new Date(u.trial_ends_at) > new Date() ? '<span class="text-xs">⏳ prueba hasta ' + d(u.trial_ends_at) + '</span>' : u.trial_used ? '<span class="text-xs opacity-60">prueba usada</span>' : ''}</div>
        <div class="text-xs opacity-70 mt-1">Alta ${d(u.created_at)} · último acceso ${d(u.last_sign_in)} · Plus hasta ${d(u.plus_until)} · ❤️ ${u.favoritos} · 🏠 ${u.publicaciones} · 💬 ${u.mensajes}</div>
        <div class="flex flex-wrap gap-1.5 mt-2 items-center">${btn('plus:7d', '+7 días')}${btn('plus:1m', '+1 mes')}${btn('plus:3m', '+3 meses')}${btn('plus:12m', '+1 año')}<input type="date" class="uFecha h-10 px-2 rounded-lg border dark:bg-slate-900" aria-label="Plus hasta fecha">${btn('plus:fecha', 'Hasta fecha')}${u.plus_activo ? btn('plus:revocar', 'Revocar Plus', 'text-red-600') : ''}
          <select class="uRol h-10 px-2 rounded-lg border dark:bg-slate-900" aria-label="Rol">${['usuario', 'agente', 'admin'].map(r => `<option ${r === u.rol ? 'selected' : ''}>${r}</option>`).join('')}</select>${btn('rol', 'Cambiar rol')}</div></article>`).join('') || '<p>Sin resultados.</p>'}
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
    return `<p class="text-sm opacity-80 mb-2">Lo que ve cada perfil. Un usuario suma permisos de su plan (Gratis/Plus) y su rol (Agente/Admin). Límite vacío = sin límite. 🔒 = bloqueado por seguridad. Favoritos, búsquedas guardadas y alertas también se aplican en el servidor.</p>
      <div class="overflow-x-auto"><table class="text-sm w-full bg-white dark:bg-slate-800 rounded-xl"><tr><th class="text-left p-2">Función</th>${P.map(p => `<th class="p-2 capitalize">${p}</th>`).join('')}</tr>
      ${F.map(f => `<tr class="border-t dark:border-slate-700"><td class="p-2">${E(Perm.LBL[f] || f)}</td>${P.map(p => { const r = g(f, p); const lim = ['favoritos', 'listas'].includes(f); return `<td class="p-2 text-center"><label class="inline-flex items-center gap-1"><input type="checkbox" ${r.activo ? 'checked' : ''} ${r.bloqueado ? 'disabled' : ''} aria-label="${E(f)} ${p}">${r.bloqueado ? '🔒' : ''}</label>${lim ? `<input type="number" min="0" value="${r.limite ?? ''}" class="w-16 h-9 border rounded ml-1 px-1 dark:bg-slate-900" aria-label="límite ${E(f)} ${p}">` : ''}${r.bloqueado ? '' : `<button data-g="perm" data-k="${f}|${p}" class="ml-1 text-xs underline" style="min-height:36px">Guardar</button>`}</td>` }).join('')}</tr>`).join('')}</table></div>`;
  }];

  // ---------- Anuncios ----------
  const A = { e: '', q: '' };
  T.anuncios = ['📋 Anuncios', async () => {
    let qy = C.from('anuncios').select('*').order('created_at', { ascending: false }).limit(200); if (A.e) qy = qy.eq('estado', A.e); if (A.q) qy = qy.ilike('titulo', '%' + A.q + '%');
    const { data, error } = await qy; if (error) throw error;
    bind(async (g, b, r) => {
      if (g === 'filtrar') { A.e = $('aE').value; A.q = $('aQ').value.trim(); return rerender() }
      if (g === 'todos') { document.querySelectorAll('#out input.gsel').forEach(x => x.checked = b.dataset.on !== '1'); b.dataset.on = b.dataset.on === '1' ? '0' : '1'; return }
      const [acc, masivo] = g.split(':'); const ids = masivo ? sel() : [r.dataset.id]; if (!ids.length) return alert('Selecciona anuncios');
      await Admin.anuncios(ids, acc, data); rerender()
    });
    return `<div class="flex flex-wrap gap-2 mb-3"><select id="aE" aria-label="Estado" class="h-10 px-2 rounded-lg border dark:bg-slate-800">${['', 'pendiente', 'aprobado', 'rechazado', 'pausado', 'vendido', 'retirado'].map(v => `<option value="${v}" ${A.e === v ? 'selected' : ''}>${v || 'Todos los estados'}</option>`).join('')}</select><input id="aQ" value="${E(A.q)}" placeholder="Buscar título" aria-label="Buscar anuncio" class="h-10 px-3 rounded-lg border dark:bg-slate-800 flex-1">${btn('filtrar', 'Filtrar', 'bg-teal-600 text-white border-teal-600')}</div>
      <div class="flex flex-wrap gap-1.5 mb-2 text-sm">${btn('todos', '☑ Seleccionar todo')}${btn('aprobar:m', 'Aprobar sel.')}${btn('rechazar:m', 'Rechazar sel.')}${btn('pausar:m', 'Pausar sel.')}${btn('eliminar:m', '🗑️ Eliminar sel.', 'text-red-600')}</div>
      <p class="text-xs opacity-70 mb-2">${data.length} anuncios</p>
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
