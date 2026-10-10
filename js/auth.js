/* MapMarket · Auth compartido (Supabase Auth o modo demo con localStorage). */
(function () {
  const C = window.GH_CONFIG || {};
  const DEMO = !(C.supabaseUrl && C.supabaseAnonKey);
  const K = { tr: 'gh_demo_trials', s: 'gh_demo_session', u: 'gh_demo_users', fav: 'gh_favoritos', bus: 'gh_busquedas' };
  let sb = null;
  const j = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } };
  const listeners = [];
  const emit = () => Auth.user().then(u => listeners.forEach(f => f(u)));
  async function sbClient() {
    if (DEMO) return null;
    if (sb) return sb;
    if (!window.supabase) await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'; s.onload = ok; s.onerror = ko; document.head.appendChild(s) });
    sb = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey);
    sb.auth.onAuthStateChange(() => emit());
    return sb;
  }
  // Base fija para enlaces de correo: nunca localhost ni la raíz de github.io
  const base = () => (/^https:/.test(location.href) && location.pathname.includes('/geohogar/')) ? new URL('./', location.href).href : (C.siteUrl || new URL('./', location.href).href);
  const cb = (tipo, next) => base() + 'confirmar.html?tipo=' + tipo + (next ? '&next=' + encodeURIComponent(next) : '');
  const back = () => cb('signup', C.redirectTras || 'index.html');
  // Si un correo cayó en otra página (p. ej. Site URL = index.html), mandarlo a confirmar.html
  (function () {
    if (/confirmar\.html$/.test(location.pathname)) return;
    const h = location.hash, q = location.search;
    if (/(^#|&)(access_token|error|error_code)=/.test(h) || /[?&](code|error|error_code|token_hash)=/.test(q)) location.replace(base() + 'confirmar.html' + q + h);
  })();
  const Auth = {
    demo: DEMO,
    onChange(f) { listeners.push(f) },
    async user() {
      if (DEMO) { const s = j(K.s, null); if (!s) return null; const t = j(K.tr, {})[s.email]; const ends = t ? new Date(t) : null;
        const pago = s.plan === 'plus' && (!s.plus_until || new Date(s.plus_until) > new Date()); const trial = !!ends && ends > new Date();
        return { ...s, demo: true, trial_used: !!t, trial_ends_at: t || null, trial_activo: trial && !pago, pagado: pago, plan: pago || trial ? 'plus' : 'gratis' } }
      const c = await sbClient(); const { data } = await c.auth.getUser(); const u = data.user; if (!u) return null;
      const { data: p } = await c.from('profiles').select('plan,plus_until,nombre,trial_used,trial_ends_at').eq('id', u.id).maybeSingle();
      const pago = !!p && p.plan === 'plus' && (!p.plus_until || new Date(p.plus_until) > new Date());
      const trial = !!p && !!p.trial_ends_at && new Date(p.trial_ends_at) > new Date();
      return { id: u.id, email: u.email, nombre: (p && p.nombre) || u.email.split('@')[0], plan: pago || trial ? 'plus' : 'gratis', pagado: pago, trial_activo: trial && !pago, trial_used: !!(p && p.trial_used), trial_ends_at: p && p.trial_ends_at, plus_until: p && p.plus_until };
    },
    async signUp(email, password, nombre) {
      if (DEMO) { const us = j(K.u, {}); if (us[email]) throw new Error('Ya existe una cuenta demo con ese correo.'); us[email] = { password, nombre }; localStorage.setItem(K.u, JSON.stringify(us)); return this._demoLogin(email) }
      const c = await sbClient(); const { error } = await c.auth.signUp({ email, password, options: { data: { nombre }, emailRedirectTo: back() } }); if (error) throw error;
      return 'Revisa tu correo para confirmar la cuenta.';
    },
    async signIn(email, password) {
      if (DEMO) { const us = j(K.u, {}); if (!us[email] || us[email].password !== password) throw new Error('Correo o contraseña incorrectos (cuenta demo).'); return this._demoLogin(email) }
      const c = await sbClient(); const { error } = await c.auth.signInWithPassword({ email, password }); if (error) throw error; emit(); return 'ok';
    },
    async magicLink(email) {
      if (DEMO) { this._demoLogin(email); return 'Modo demo: no se envió ningún correo; iniciaste sesión directamente.' }
      const c = await sbClient(); const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: cb('magic', C.redirectTras || 'index.html') } }); if (error) throw error;
      return 'Te enviamos un enlace mágico. Ábrelo desde tu correo.';
    },
    async resetPassword(email) {
      if (DEMO) return 'Modo demo: no se envía correo de recuperación.';
      const c = await sbClient(); const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: cb('recovery', 'cuenta.html#nueva-clave') }); if (error) throw error;
      return 'Te enviamos un correo para restablecer la contraseña.';
    },
    async resend(email, tipo) {
      if (DEMO) return 'Modo demo.';
      const c = await sbClient();
      const { error } = tipo === 'magic' ? await c.auth.signInWithOtp({ email, options: { emailRedirectTo: cb('magic', C.redirectTras || 'index.html') } })
        : tipo === 'recovery' ? await c.auth.resetPasswordForEmail(email, { redirectTo: cb('recovery', 'cuenta.html#nueva-clave') })
        : await c.auth.resend({ type: 'signup', email, options: { emailRedirectTo: back() } });
      if (error) throw error; return 'Listo: te enviamos un correo nuevo. Revisa también Spam/Promociones.';
    },
    client: () => sbClient(),
    async updatePassword(pw) { if (DEMO) return 'Modo demo.'; const c = await sbClient(); const { error } = await c.auth.updateUser({ password: pw }); if (error) throw error; return 'Contraseña actualizada.' },
    async signOut() { if (DEMO) localStorage.removeItem(K.s); else await (await sbClient()).auth.signOut(); emit() },
    _demoLogin(email) { const us = j(K.u, {}); const prev = j(K.s, {}) || {}; localStorage.setItem(K.s, JSON.stringify({ id: 'demo-' + email, email, nombre: (us[email] && us[email].nombre) || email.split('@')[0], plan: prev.email === email ? prev.plan || 'gratis' : 'gratis' })); emit(); return 'ok' },
    async isPlus() { const u = await this.user(); return !!u && u.plan === 'plus' },
    async startTrial() {
      const u = await this.user(); if (!u) { const e = new Error('Inicia sesión para empezar la prueba.'); e.code = 'LOGIN'; throw e }
      if (u.trial_used) throw new Error('Ya usaste tu prueba gratis de Plus en esta cuenta.');
      if (DEMO) { const t = j(K.tr, {}); t[u.email] = new Date(Date.now() + (C.pruebaDias || 2) * 864e5).toISOString(); localStorage.setItem(K.tr, JSON.stringify(t)); emit(); return t[u.email] }
      const { data, error } = await (await sbClient()).rpc('start_trial'); if (error) throw error; emit(); return data;
    },
    horasPrueba(u) { return u && u.trial_activo ? Math.max(0, Math.ceil((new Date(u.trial_ends_at) - Date.now()) / 36e5)) : 0 },
    pruebaTexto(u) { const h = this.horasPrueba(u); return h > 24 ? `Te quedan ${h} h de prueba (${Math.floor(h / 24)} d ${h % 24} h)` : `Te quedan ${h} h de prueba` },
    async subscribe(periodo) {
      const u = await this.user(); if (!u) { location.href = 'login.html?next=planes.html#registro'; return 'login' }
      const url = (C.tilopay || {})[periodo === 'anual' ? 'anualUrl' : 'mensualUrl'];
      if (url) { location.href = url + (url.includes('?') ? '&' : '?') + 'email=' + encodeURIComponent(u.email); return 'redirect' }
      if (DEMO) { const s = j(K.s, {}); s.plan = 'plus'; s.plus_until = new Date(Date.now() + (periodo === 'anual' ? 365 : 30) * 864e5).toISOString(); localStorage.setItem(K.s, JSON.stringify(s)); emit(); return 'demo' }
      throw new Error('El pago con Tilopay aún no está configurado (GH_CONFIG.tilopay).');
    },
    async setDemoPlan(plan) { const s = j(K.s, null); if (!s) throw new Error('Inicia sesión primero.'); s.plan = plan; if (plan === 'gratis') { delete s.plus_until; const t = j(K.tr, {}); if (t[s.email]) { t[s.email] = new Date(0).toISOString(); localStorage.setItem(K.tr, JSON.stringify(t)) } } localStorage.setItem(K.s, JSON.stringify(s)); emit() },
    /* Favoritos (local en demo / tabla favoritos en Supabase) */
    async favoritos() {
      if (DEMO) return j(K.fav, []);
      const u = await this.user(); if (!u) return j(K.fav, []);
      const { data } = await (await sbClient()).from('favoritos').select('property_id'); return (data || []).map(r => r.property_id);
    },
    async toggleFavorito(id) {
      const favs = await this.favoritos(), has = favs.includes(id);
      if (!has && favs.length >= (C.limiteFavoritosGratis || 10) && !(await this.isPlus())) { const e = new Error('limite'); e.code = 'LIMITE'; throw e }
      if (DEMO || !(await this.user())) { localStorage.setItem(K.fav, JSON.stringify(has ? favs.filter(x => x !== id) : [...favs, id])) }
      else { const c = await sbClient(); has ? await c.from('favoritos').delete().eq('property_id', id) : await c.from('favoritos').insert({ property_id: id }) }
      return !has;
    },
    async guardarBusqueda(b) {
      if (!(await this.isPlus())) { const e = new Error('plus'); e.code = 'PLUS'; throw e }
      if (DEMO) { const l = j(K.bus, []); l.push({ ...b, id: Date.now(), creada: new Date().toISOString() }); localStorage.setItem(K.bus, JSON.stringify(l)); return }
      const c = await sbClient(); const wkt = b.polygon ? 'SRID=4326;POLYGON((' + [...b.polygon, b.polygon[0]].map(([la, lo]) => lo + ' ' + la).join(',') + '))' : null;
      const { error } = await c.from('busquedas_guardadas').insert({ nombre: b.nombre, filtros: b.filtros, zona: wkt, alerta: !!b.alerta }); if (error) throw error;
    },
    async busquedas() { if (DEMO) return j(K.bus, []); const { data } = await (await sbClient()).from('busquedas_guardadas').select('*').order('created_at', { ascending: false }); return data || [] },
    banner() {
      if (!DEMO || document.getElementById('ghDemo')) return;
      const b = document.createElement('div'); b.id = 'ghDemo';
      b.className = 'fixed bottom-0 inset-x-0 z-[3000] text-center text-[11px] py-1 bg-amber-400 text-amber-950';
      b.textContent = 'Modo demostración: el inicio de sesión no es real (datos solo en este navegador).';
      document.body.appendChild(b);
    },
    theme() { const d = localStorage.getItem('geohogar_dark') === '1' || location.hash === '#dark'; document.documentElement.classList.toggle('dark', d); return d }
  };
  window.Auth = Auth;
})();
