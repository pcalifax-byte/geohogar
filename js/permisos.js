/* MapMarket · matriz de permisos por perfil (tabla public.permisos). Valores por defecto seguros si no carga.
   El servidor aplica los límites críticos (RLS); esto solo decide qué se muestra. */
(function () {
  const D = { favoritos: { gratis: [1, 10], plus: [1, null], pro: [1, null], agente: [1, 10], admin: [1, null] }, listas: { gratis: [1, 2], plus: [1, null], pro: [1, null], agente: [1, 2], admin: [1, null] },
    anuncios_activos: { gratis: [1, 1], plus: [1, 3], pro: [1, 5], agente: [1, 1], admin: [1, null] },
    busquedas_guardadas: { plus: [1], pro: [1], admin: [1] }, alertas: { plus: [1], pro: [1], admin: [1] }, exportar_reportes: { plus: [1], pro: [1], admin: [1] }, filtros_avanzados: { plus: [1], pro: [1], admin: [1] },
    destacar: { pro: [1], admin: [1] }, plusvalia: { plus: [1], pro: [1], admin: [1] }, capa_privada: { admin: [1] }, moderacion: { admin: [1] } };
  const LBL = { plusvalia: 'Capa Plusvalía / Inversión', favoritos: 'Favoritos', anuncios_activos: 'Anuncios activos', listas: 'Listas de favoritos', busquedas_guardadas: 'Búsquedas guardadas', alertas: 'Alertas (precio y zona)', exportar_reportes: 'Exportar reportes', filtros_avanzados: 'Filtros avanzados', destacar: 'Destacar anuncios', capa_privada: 'Capa privada (datos admin)', moderacion: 'Moderación' };
  const P = window.Perm = {
    LBL, PERFILES: ['gratis', 'plus', 'pro', 'agente', 'admin'], m: null,
    tabla() { if (this.m) return this.m; const m = {}; for (const f in D) { m[f] = {}; for (const p of this.PERFILES) { const v = D[f][p]; m[f][p] = { activo: !!v, limite: v ? (v[1] ?? null) : null, bloqueado: f === 'capa_privada' || f === 'moderacion' } } } return m },
    async load() { try { const c = await Auth.client(); if (!c) return; const { data, error } = await c.from('permisos').select('*'); if (error || !data || !data.length) return; const m = this.tabla(); data.forEach(r => { (m[r.feature] = m[r.feature] || {})[r.perfil] = { activo: r.activo, limite: r.limite, bloqueado: r.bloqueado } }); this.m = m } catch (e) { console.warn('permisos', e) } },
    perfiles(u) { if (!u) return ['gratis']; const a = [u.nivel === 'pro' ? 'pro' : u.plan === 'plus' ? 'plus' : 'gratis']; if (u.rol === 'agente' || u.rol === 'admin') a.push(u.rol); return a },
    can(f, u) { const m = this.tabla()[f]; return !!m && this.perfiles(u).some(p => m[p] && m[p].activo) },
    lim(f, u) { const m = this.tabla()[f]; if (!this.can(f, u)) return 0; let mx = 0; for (const p of this.perfiles(u)) { const x = m[p]; if (x && x.activo) { if (x.limite == null) return Infinity; mx = Math.max(mx, x.limite) } } return mx },
    feat(label) { const t = String(label).toLowerCase(); return /búsquedas|busquedas|alertas por zona/.test(t) ? 'busquedas_guardadas' : /alerta/.test(t) ? 'alertas' : /reporte|export|csv/.test(t) ? 'exportar_reportes' : /filtro/.test(t) ? 'filtros_avanzados' : /destac/.test(t) ? 'destacar' : null }
  };
  P.ready = P.load().then(async () => { try { const u = await Auth.user(); const l = P.lim('favoritos', u); if (window.GH_CONFIG && l !== Infinity) GH_CONFIG.limiteFavoritosGratis = l } catch (e) {} });
})();
