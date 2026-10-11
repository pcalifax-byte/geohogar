/* MapMarket · herramientas de admin en la ficha (mapa) y en perfil.html: Eliminar / Pausar / Editar.
   Anuncios de usuarios → RPC admin_anuncios (auditada). Ejemplos (estáticos) → admin_ocultar_demo (tabla anuncios_ocultos, aplica a todos).
   Usa diálogos propios (no window.confirm/prompt, que pueden fallar en WebViews). */
(function () {
  const T = s => (window.MMT ? MMT(s) : s), $ = id => document.getElementById(id);
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = m => (window.Feat && Feat.toast ? Feat.toast(m) : alert(m));
  function dialogo(msg, { campo = true, def = '', ok = T('Confirmar'), peligro = false } = {}) {
    return new Promise(res => {
      const d = document.createElement('div'); d.className = 'fixed inset-0 z-[4000] bg-black/50 flex items-center justify-center p-4'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
      d.innerHTML = `<div class="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 dark:text-white p-4 shadow-xl"><p class="font-semibold">${E(msg)}</p>${campo ? `<textarea rows="3" class="w-full mt-2 border rounded p-2 dark:bg-slate-700 dark:border-slate-600" placeholder="${E(T('Motivo (opcional)'))}">${E(def)}</textarea>` : ''}
        <div class="flex justify-end gap-2 mt-3"><button data-x class="rounded-lg border px-4 dark:border-slate-600" style="min-height:44px">${T('Cancelar')}</button><button data-ok class="rounded-lg px-4 text-white ${peligro ? 'bg-red-600' : 'bg-teal-600'}" style="min-height:44px">${E(ok)}</button></div></div>`;
      document.body.appendChild(d); const ta = d.querySelector('textarea'); (ta || d.querySelector('[data-ok]')).focus();
      const fin = v => { d.remove(); res(v) }; d.querySelector('[data-x]').onclick = () => fin(null); d.onclick = e => { if (e.target === d) fin(null) };
      d.querySelector('[data-ok]').onclick = () => fin(ta ? ta.value.trim() : true);
    });
  }
  window.MMDialogo = dialogo;
  let esAdmin = null; const admin = async () => { if (esAdmin !== null) return esAdmin; try { const c = await Auth.client(); const { data } = await c.rpc('es_admin'); esAdmin = !!data } catch (e) { esAdmin = false } return esAdmin };
  async function borrarFotos(c, ids) { const { data: rs } = await c.from('anuncios').select('imagenes').in('id', ids); const paths = (rs || []).flatMap(r => r.imagenes || []).map(u => String(u).split('/object/public/anuncios/')[1]).filter(Boolean); if (paths.length) { const { error } = await c.storage.from('anuncios').remove(paths); if (error) console.warn('fotos', error) } }
  async function accion(id, acc, extra) { // id: 'u-<uuid>' | uuid | id de ejemplo
    const c = await Auth.client(), uid = String(id).replace(/^u-/, ''), real = /^[0-9a-f-]{36}$/i.test(uid);
    if (!real) { if (acc !== 'eliminar') throw new Error(T('Los ejemplos solo se pueden eliminar.')); const { error } = await c.rpc('admin_ocultar_demo', { ids: [String(id)], motivo: extra || null }); if (error) throw error; return true }
    if (acc === 'eliminar') await borrarFotos(c, [uid]);
    const { error } = await c.rpc('admin_anuncios', { ids: [uid], accion: acc, motivo: extra && extra.motivo !== undefined ? extra.motivo : extra || null, cambios: extra && extra.cambios || null }); if (error) throw error; return true;
  }
  async function editar(p) {
    const t = await dialogo(T('Nuevo título'), { def: p.title || p.titulo || '', ok: T('Siguiente') }); if (t === null) return false;
    const pr = await dialogo(T('Nuevo precio (solo número)'), { def: String(p.price || p.precio || ''), ok: T('Siguiente') }); if (pr === null) return false;
    const ds = await dialogo(T('Descripción'), { def: p.desc || p.descripcion || '', ok: T('Guardar') }); if (ds === null) return false;
    return accion(p.id, 'editar', { motivo: 'Edición de moderación', cambios: { titulo: t, precio: pr, descripcion: ds } });
  }
  function quitarDelMapa(id) { try { App.all = App.all.filter(x => String(x.id) !== String(id)); App.refresh(); $('card').classList.add('hidden') } catch (e) {} }
  function barra(p, cont, alTerminar) {
    const real = /^u-/.test(String(p.id)) || /^[0-9a-f-]{36}$/i.test(String(p.id));
    const w = document.createElement('div'); w.className = 'mmAdminBar mt-2 p-2 rounded-xl border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40';
    w.innerHTML = `<div class="text-[11px] font-bold text-red-700 dark:text-red-300 mb-1">🛡️ ${T('Admin')}</div><div class="flex flex-wrap gap-2">
      <button data-a="eliminar" class="rounded-lg bg-red-600 text-white px-3 font-semibold" style="min-height:44px">🗑️ ${T('Eliminar anuncio')}</button>
      ${real ? `<button data-a="pausar" class="rounded-lg border border-amber-500 text-amber-700 dark:text-amber-300 px-3" style="min-height:44px">⏸️ ${T('Pausar')}</button><button data-a="editar" class="rounded-lg border px-3 dark:border-slate-600" style="min-height:44px">✏️ ${T('Editar')}</button>` : `<span class="text-xs opacity-70 self-center">${T('Ejemplo: se ocultará para todos')}</span>`}</div>`;
    w.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      const a = b.dataset.a; try {
        let ok;
        if (a === 'editar') ok = await editar(p);
        else { const m = await dialogo(a === 'eliminar' ? T('¿ELIMINAR este anuncio definitivamente (con sus fotos)? Motivo (lo verá el dueño):') : T('¿Pausar este anuncio? Nota para el dueño (opcional):'), { ok: a === 'eliminar' ? T('Eliminar') : T('Pausar'), peligro: a === 'eliminar' }); if (m === null) return; ok = await accion(p.id, a, m) }
        if (ok) { toast('✅ ' + (a === 'eliminar' ? T('Anuncio eliminado') : a === 'pausar' ? T('Anuncio pausado') : T('Cambios guardados'))); alTerminar && alTerminar(a) }
      } catch (e) { toast('❌ ' + (e.message || e)) } });
    cont.appendChild(w);
  }
  window.MMAdminFicha = { barra, accion, admin };
  // Ficha del mapa
  const card = $('card');
  if (card) new MutationObserver(async () => {
    if (card.classList.contains('hidden') || card.querySelector('.mmAdminBar') || typeof UI === 'undefined' || !UI.cur || !(await admin())) return;
    const p = UI.cur, h = card.querySelector('h2'); if (!h || card.querySelector('.mmAdminBar')) return;
    barra(p, h.parentElement, a => { if (a === 'eliminar' || a === 'pausar') quitarDelMapa(p.id) });
  }).observe(card, { childList: true, attributes: true, attributeFilter: ['class'] });
  // Ejemplos ocultos por admin: se quitan del mapa para todos
  (async function ocultos() {
    if (typeof App === 'undefined' || typeof Filters === 'undefined' || !App.all || !App.all.length) return setTimeout(ocultos, 400);
    try { const c = await Auth.client(); const { data } = await c.from('anuncios_ocultos').select('id').limit(5000); const H = new Set((data || []).map(x => String(x.id))); window.MMOcultos = H;
      const ap = Filters.apply.bind(Filters); Filters.apply = list => ap(list).filter(p => !H.has(String(p.id))); App.refresh() } catch (e) {}
  })();
})();
