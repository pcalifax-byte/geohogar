/* GeoHogar · Auth compartido (Supabase Auth o modo demo con localStorage). */
(function () {
  const C = window.GH_CONFIG || {};
  const DEMO = !(C.supabaseUrl && C.supabaseAnonKey);
  const K = { s: 'gh_demo_session', u: 'gh_demo_users', fav: 'gh_favoritos', bus: 'gh_busquedas' };
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
  const back = () => new URL(C.redirectTras || 'index.html', location.href).href;
  const Auth = {
    demo: DEMO,
    onChange(f) { listeners.push(f) },
    async user() {
      if (DEMO) { const s = j(K.s, null); return s ? { ...s, demo: true } : null }
      const c = await sbClient(); const { data } = await c.auth.getUser(); const u = data.user; if (!u) return null;
      const { data: p } = await c.from('profiles').select('plan,plus_until,nombre').eq('id', u.id).maybeSingle();
      const plus = p && p.plan === 'plus' && (!p.plus_until || new Date(p.plus_until) > new Date());
      return { id: u.id, email: u.email, nombre: (p && p.nombre) || u.email.split('@')[0], plan: plus ? 'plus' : 'gratis' };
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
      const c = await sbClient(); const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: back() } }); if (error) throw error;
      return 'Te enviamos un enlace mágico. Ábrelo desde tu correo.';
    },
    async resetPassword(email) {
      if (DEMO) return 'Modo demo: no se envía correo de recuperación.';
      const c = await sbClient(); const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: new URL('cuenta.html#nueva-clave', location.href).href }); if (error) throw error;
      return 'Te enviamos un correo para restablecer la contraseña.';
    },
    async updatePassword(pw) { if (DEMO) return 'Modo demo.'; const c = await sbClient(); const { error } = await c.auth.updateUser({ password: pw }); if (error) throw error; return 'Contraseña actualizada.' },
    async signOut() { if (DEMO) localStorage.removeItem(K.s); else await (await sbClient()).auth.signOut(); emit() },
    _demoLogin(email) { const us = j(K.u, {}); const prev = j(K.s, {}) || {}; localStorage.setItem(K.s, JSON.stringify({ id: 'demo-' + email, email, nombre: (us[email] && us[email].nombre) || email.split('@')[0], plan: prev.email === email ? prev.plan || 'gratis' : 'gratis' })); emit(); return 'ok' },
    async isPlus() { const u = await this.user(); return !!u && u.plan === 'plus' },
    async setDemoPlan(plan) { const s = j(K.s, null); if (!s) throw new Error('Inicia sesión primero.'); s.plan = plan; localStorage.setItem(K.s, JSON.stringify(s)); emit() },
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
