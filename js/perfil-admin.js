/* MapMarket · vista de administrador en perfil.html (correo, rol, plan, todos los anuncios, reseñas, reportes y acciones rápidas). */
(function () {
  const T = s => (window.t ? t(s) : s), E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const d = x => x ? new Date(x).toLocaleDateString(window.MMLang === 'en' ? 'en-US' : 'es-CR', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const ask = async (m, o) => window.MMDialogo ? MMDialogo(m, o || {}) : prompt(m, '');
  async function run() {
    const id = new URLSearchParams(location.search).get('id'); if (!id || !window.Auth) return;
    const c = await Auth.client(); const { data: s } = await c.auth.getSession(); if (!s?.session) return;
    const { data: me } = await c.from('profiles').select('rol').eq('id', s.session.user.id).single(); if (me?.rol !== 'admin') return;
    const { data: A, error } = await c.rpc('admin_perfil', { p_id: id }); if (error || !A) return;
    let box = document.getElementById('mmAdminPerfil'); if (!box) { box = document.createElement('section'); box.id = 'mmAdminPerfil'; box.className = 'max-w-4xl mx-auto px-4 my-6'; (document.getElementById('m') || document.body).insertAdjacentElement('afterend', box) }
    const plan = A.plan === 'pro' ? 'Pro' : (A.plus_until && new Date(A.plus_until) > new Date() ? 'Plus' : T('Gratis'));
    const est = { aprobado: 'bg-emerald-100 text-emerald-800', pendiente: 'bg-amber-100 text-amber-800', pausado: 'bg-slate-200 text-slate-700', rechazado: 'bg-red-100 text-red-800', vendido: 'bg-sky-100 text-sky-800' };
    const b = (k, l, cl = '') => `<button data-a="${k}" class="px-3 py-2 rounded-xl border text-sm ${cl}" style="min-height:40px">${l}</button>`;
    box.innerHTML = `<div class="rounded-2xl border-2 border-red-300 bg-white dark:bg-slate-800 p-4 text-sm">
      <h2 class="text-lg mb-2">🛡️ ${T('Vista de administrador')}</h2>
      <div class="grid sm:grid-cols-2 gap-x-6 gap-y-1">
        <div><b>${T('Correo')}:</b> <a class="underline" href="mailto:${E(A.email)}">${E(A.email)}</a> ${A.confirmado ? '✅' : '⚠️ ' + T('sin confirmar')}</div>
        <div><b>${T('Rol')}:</b> ${E(A.rol)} · <b>${T('Plan')}:</b> ${plan}${A.plus_until ? ' (' + T('hasta') + ' ' + d(A.plus_until) + ')' : ''}${A.plus_origen ? ' · ' + E(A.plus_origen) : ''}</div>
        <div><b>${T('Registro')}:</b> ${d(A.created_at)} · <b>${T('Último acceso')}:</b> ${d(A.last_sign_in_at)}</div>
        <div><b>${T('Teléfono')}:</b> ${E(A.telefono || '—')} · ${E([A.provincia, A.canton].filter(Boolean).join(', ') || '')}</div>
        <div><b>${T('Favoritos')}:</b> ${A.favoritos} · <b>${T('Mensajes')}:</b> ${A.mensajes} · <b>${T('Reseñas escritas')}:</b> ${A.resenas_escritas}</div>
        <div><b>${T('Reportes')}:</b> ${A.reportes_anuncios} ${T('a sus anuncios')} · ${A.reportes_usuario} ${T('al usuario')}${A.baneado ? ' · <b class="text-red-600">' + T('SUSPENDIDO') + '</b>' : ''}</div>
      </div>
      <div class="flex flex-wrap gap-2 mt-3">${b('plus', '⭐ ' + T('Dar Plus 1 mes'))}${b('pro', '💎 ' + T('Dar Pro 1 mes'))}${b('free', T('Quitar plan'))}
        <select id="mmApRol" class="px-2 rounded-xl border dark:bg-slate-700" aria-label="${T('Rol')}">${['usuario', 'agente', 'admin'].map(r => `<option ${r === A.rol ? 'selected' : ''}>${r}</option>`).join('')}</select>${b('rol', T('Cambiar rol'))}
        ${A.baneado ? '' : b('ban', '⛔ ' + T('Suspender usuario'), 'text-red-600 border-red-300')}<a class="px-3 py-2 rounded-xl border text-sm" href="admin.html">${T('Abrir panel admin')}</a></div>
      <h3 class="font-semibold mt-4 mb-1">${T('Todos sus anuncios')} (${A.anuncios.length})</h3>
      ${A.anuncios.map(x => `<div data-id="${x.id}" class="flex gap-2 items-center py-1.5 border-t dark:border-slate-700">${x.foto ? `<img src="${E(x.foto)}" alt="" loading="lazy" class="w-12 h-12 rounded-lg object-cover">` : ''}
        <div class="flex-1 min-w-0"><a class="underline" href="index.html?p=u-${x.id}">${E(x.titulo)}</a> <span class="text-xs rounded-full px-2 ${est[x.estado] || ''}">${E(x.estado)}</span><div class="text-xs opacity-70">${d(x.created_at)}</div></div>
        ${x.estado === 'pausado' ? b('x:reactivar', '▶️') : b('x:pausar', '⏸')}${x.estado === 'pendiente' ? b('x:aprobar', '✅') : ''}${b('x:eliminar', '🗑️', 'text-red-600')}</div>`).join('') || `<p class="opacity-70">${T('Sin anuncios.')}</p>`}
      <h3 class="font-semibold mt-4 mb-1">${T('Reseñas recibidas')} (${A.resenas_recibidas.length})</h3>
      ${A.resenas_recibidas.map(r => `<div class="py-1 border-t dark:border-slate-700"><span class="text-amber-500">${'★'.repeat(r.estrellas)}</span> <span class="text-xs rounded-full px-2 bg-slate-100 text-slate-700">${E(r.estado)}</span> ${E(r.comentario || '')} · <a class="underline text-xs" href="perfil.html?id=${r.autor_id}">${T('autor')}</a></div>`).join('') || `<p class="opacity-70">${T('Sin reseñas.')}</p>`}
    </div>`;
    box.querySelectorAll('[data-a]').forEach(el => el.onclick = async () => {
      const a = el.dataset.a; try {
        if (a.startsWith('x:')) { const acc = a.slice(2), aid = el.closest('[data-id]').dataset.id; const nota = await ask(`${T('¿Confirmar')} "${acc}"? ${T('Motivo')}:`, { peligro: acc === 'eliminar' }); if (nota === null) return; const { error } = await c.rpc('admin_anuncios', { ids: [aid], accion: acc, motivo: nota || null, cambios: null }); if (error) throw error }
        else if (a === 'rol') { const nuevo = document.getElementById('mmApRol').value; const nota = await ask(T('Motivo del cambio de rol:')); if (nota === null) return; const { error } = await c.rpc('admin_rol', { uid: id, nuevo, nota }); if (error) throw error }
        else if (a === 'ban') { const nota = await ask(T('¿Suspender al usuario (no podrá publicar) y pausar sus anuncios? Motivo:'), { peligro: true }); if (nota === null) return; const { error } = await c.rpc('admin_bloquear_dueno', { uid: id, nota }); if (error) throw error }
        else { const nota = await ask(T('Nota (opcional):')); if (nota === null) return; const h = new Date(); h.setMonth(h.getMonth() + 1); const { error } = await c.rpc('admin_plan', { uid: id, nivel: a, hasta: a === 'free' ? null : h.toISOString(), nota }); if (error) throw error }
        run();
      } catch (e) { alert('❌ ' + (e.message || e)) }
    });
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', () => setTimeout(run, 300)) : setTimeout(run, 300);
})();
