/* MapMarket · centro de notificaciones (campana + realtime) y Web Push. Todas las páginas. */
(function () {
  const T = s => (window.MMT ? MMT(s) : s), E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C0 = window.GH_CONFIG || {};
  let C = null, U = null, items = [], abierto = false;
  const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map(c => c.charCodeAt(0))) };
  const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && C0.vapidPublic;
  async function suscribir() {
    if (!pushOk()) return alert(T('Tu navegador no permite notificaciones push. Recibirás los avisos aquí y por correo.'));
    const perm = await Notification.requestPermission(); if (perm !== 'granted') return alert(T('Permiso de notificaciones denegado.'));
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(C0.vapidPublic) });
    const j = sub.toJSON(); const { error } = await C.from('push_subs').upsert({ endpoint: j.endpoint, user_id: U.id, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent.slice(0, 200) });
    if (error) throw error; render(); toast('🔔 ' + T('Notificaciones push activadas'));
  }
  async function desuscribir() { const reg = await navigator.serviceWorker.ready, s = await reg.pushManager.getSubscription(); if (s) { await C.from('push_subs').delete().eq('endpoint', s.endpoint); await s.unsubscribe() } render() }
  function toast(m) { const t = document.createElement('div'); t.className = 'fixed bottom-20 left-1/2 -translate-x-1/2 z-[3000] bg-slate-900 text-white text-sm rounded-xl px-4 py-2 shadow'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3500) }
  const fecha = t => new Date(t).toLocaleString(window.MMLocale || 'es-CR', { dateStyle: 'short', timeStyle: 'short' });
  async function cargar() { const { data } = await C.from('notificaciones').select('*').order('created_at', { ascending: false }).limit(40); items = data || []; badge(); if (abierto) render() }
  function badge() { const n = items.filter(x => !x.leida).length, b = document.getElementById('mmBellN'); if (b) { b.textContent = n > 9 ? '9+' : n; b.classList.toggle('hidden', !n) } }
  async function render() {
    let p = document.getElementById('mmBellP'); if (!p) return;
    let pushTxt = ''; if (pushOk()) { const reg = await navigator.serviceWorker.getRegistration(); const s = reg && await reg.pushManager.getSubscription(); pushTxt = s ? `<button id="mmPushOff" class="underline">${T('Desactivar push en este dispositivo')}</button>` : `<button id="mmPushOn" class="rounded-lg bg-teal-600 text-white px-3" style="min-height:40px">🔔 ${T('Activar notificaciones push')}</button>` }
    else pushTxt = `<span class="opacity-70">${T('Push no disponible aquí (p. ej. en la app de Android): te avisamos en esta campana y por correo.')}</span>`;
    p.innerHTML = `<div class="flex items-center gap-2 mb-2"><b class="flex-1">🔔 ${T('Notificaciones')}</b>${items.some(x => !x.leida) ? `<button id="mmLeerTodo" class="text-xs underline">${T('Marcar todo como leído')}</button>` : ''}</div>
      <div class="text-xs mb-2">${pushTxt}</div>
      <ul class="max-h-[60vh] overflow-y-auto divide-y dark:divide-slate-700">${items.map(n => `<li><a data-n="${n.id}" href="${E(n.url || '#')}" class="block py-2 ${n.leida ? 'opacity-60' : ''}"><div class="text-sm ${n.leida ? '' : 'font-semibold'}">${E(n.titulo)}</div>${n.cuerpo ? `<div class="text-xs opacity-80" data-noi18n>${E(n.cuerpo)}</div>` : ''}<div class="text-[11px] opacity-60">${fecha(n.created_at)}</div></a></li>`).join('') || `<li class="py-3 text-sm opacity-70">${T('No tienes notificaciones.')}</li>`}</ul>`;
    const on = document.getElementById('mmPushOn'); if (on) on.onclick = () => suscribir().catch(e => alert(e.message));
    const off = document.getElementById('mmPushOff'); if (off) off.onclick = () => desuscribir().catch(e => alert(e.message));
    const lt = document.getElementById('mmLeerTodo'); if (lt) lt.onclick = async () => { await C.from('notificaciones').update({ leida: true }).eq('user_id', U.id).eq('leida', false); cargar() };
    p.querySelectorAll('[data-n]').forEach(a => a.onclick = async () => { await C.from('notificaciones').update({ leida: true }).eq('id', +a.dataset.n) });
  }
  function boton() {
    if (document.getElementById('mmBell')) return;
    const b = document.createElement('button'); b.id = 'mmBell'; b.type = 'button'; b.setAttribute('aria-label', T('Notificaciones')); b.title = T('Notificaciones');
    b.className = 'relative text-sm border rounded-lg px-2 dark:border-slate-600'; b.style.minHeight = '40px'; b.style.minWidth = '40px';
    b.innerHTML = '🔔<span id="mmBellN" class="hidden absolute -top-1 -right-1 bg-red-600 text-white text-[10px] rounded-full px-1 min-w-[16px] leading-4"></span>';
    const ref = document.getElementById('mmLang') || document.getElementById('tgDark');
    if (ref) { if (ref.className) b.className = ref.className + ' relative'; ref.parentElement.insertBefore(b, ref) } else { b.className += ' fixed top-2 right-20 z-[2000] bg-white/90 dark:bg-slate-800/90'; document.body.appendChild(b) }
    b.onclick = e => { e.stopPropagation(); let p = document.getElementById('mmBellP'); if (p) { p.remove(); abierto = false; return }
      p = document.createElement('div'); p.id = 'mmBellP'; p.className = 'fixed z-[2500] right-2 top-14 w-[min(92vw,380px)] bg-white dark:bg-slate-800 dark:text-white rounded-2xl shadow-2xl p-3'; document.body.appendChild(p); abierto = true; render();
      setTimeout(() => document.addEventListener('click', function f(ev) { if (!p.contains(ev.target)) { p.remove(); abierto = false; document.removeEventListener('click', f) } }), 0) };
  }
  async function init() {
    if (!window.Auth || Auth.demo) return; U = await Auth.user(); if (!U) return; C = await Auth.client();
    boton(); await cargar();
    C.channel('notif-' + U.id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificaciones', filter: 'user_id=eq.' + U.id }, pl => { items.unshift(pl.new); badge(); if (abierto) render(); toast(pl.new.titulo) }).subscribe();
  }
  window.MMNotif = { suscribir, cargar };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', () => setTimeout(init, 600)) : setTimeout(init, 600);
})();
