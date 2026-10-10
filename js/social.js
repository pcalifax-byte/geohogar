/* MapMarket · Mensajes entre usuarios + votos 👍/👎 (Supabase; requiere supabase_setup.sql v4) */
(function () {
  const $ = i => document.getElementById(i), E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let ready = null;
  async function sb() {
    if (Auth.demo) return null;
    const c = await Auth.client();
    if (ready === null) ready = c.rpc('mas_gustados', { n: 1 }).then(r => !r.error, () => false);
    return (await ready) ? c : null;
  }
  async function me() { const u = await Auth.user(); return u && !u.demo ? u : null }
  const pedirLogin = (next) => { if (confirm('Inicia sesión para continuar. ¿Ir a iniciar sesión?')) location.href = 'login.html?next=' + encodeURIComponent(next || location.pathname.split('/').pop() + location.search) };

  /* ---------- Votos ---------- */
  const Votos = {
    cache: {}, mine: {},
    async resumen(ids) {
      const c = await sb(); const out = {}; ids.forEach(i => out[i] = this.cache[i] || { likes: 0, dislikes: 0 });
      if (!c) return out;
      const { data } = await c.rpc('votos_resumen', { ids: ids.map(String) }); (data || []).forEach(r => out[r.listing_id] = this.cache[r.listing_id] = { likes: +r.likes, dislikes: +r.dislikes });
      const u = await me(); if (u) { const { data: m } = await c.from('votos').select('listing_id,valor').in('listing_id', ids.map(String)); (m || []).forEach(r => this.mine[r.listing_id] = r.valor) }
      return out;
    },
    async votar(id, valor) {
      const u = await me(); if (!u) return pedirLogin('index.html?p=' + id);
      const c = await sb(); if (!c) { alert('Los votos estarán disponibles cuando se active la base de datos.'); return }
      id = String(id); const prev = this.mine[id] || 0;
      const r = prev === valor ? await c.from('votos').delete().eq('listing_id', id).eq('user_id', u.id) : await c.from('votos').upsert({ user_id: u.id, listing_id: id, valor }, { onConflict: 'user_id,listing_id' });
      if (r.error) { alert(r.error.message); return }
      this.mine[id] = prev === valor ? 0 : valor; delete this.cache[id];
    },
    html(id, s, compact) {
      const v = this.mine[id] || 0;
      return `<span class="inline-flex items-center gap-1 ${compact ? 'text-xs' : 'text-sm'}" data-votos="${E(id)}"><button data-v="1" class="vt rounded-full px-2 py-0.5 border dark:border-slate-600 ${v === 1 ? 'bg-teal-600 text-white border-teal-600' : ''}" aria-label="Me gusta">👍 ${s.likes}</button><button data-v="-1" class="vt rounded-full px-2 py-0.5 border dark:border-slate-600 ${v === -1 ? 'bg-rose-600 text-white border-rose-600' : ''}" aria-label="No me gusta">👎 ${s.dislikes}</button></span>`;
    },
    async mount(el, id, compact) {
      id = String(id); const s = (await this.resumen([id]))[id];
      el.innerHTML = this.html(id, s, compact);
      el.querySelectorAll('.vt').forEach(b => b.onclick = async ev => { ev.stopPropagation(); await this.votar(id, +b.dataset.v); this.mount(el, id, compact) });
    },
    async masGustados() {
      const c = await sb(); if (!c) { Feat.toast('Los votos aún no están activos en el servidor'); return }
      const { data, error } = await c.rpc('mas_gustados', { n: 100 }); if (error) return Feat.toast(error.message);
      const ids = new Set((data || []).map(r => String(r.listing_id)));
      const list = App.all.filter(p => ids.has(String(p.id)));
      if (!list.length) return Feat.toast('Todavía no hay propiedades con votos positivos');
      const score = Object.fromEntries((data || []).map(r => [String(r.listing_id), r]));
      list.sort((a, b) => score[b.id].score - score[a.id].score);
      App.chatIds = new Set(list.map(p => p.id)); App.refresh();
      UI.modal(`<h2 class="text-xl font-bold">👍 Más gustadas</h2><p class="text-xs opacity-70">Ordenadas por votos (👍 − 👎). El mapa muestra solo estas; usa «✖» en la barra para volver.</p><div class="mt-3 space-y-1">${list.slice(0, 30).map((p, i) => `<button data-id="${E(p.id)}" class="mg w-full text-left flex gap-2 items-center border rounded-lg px-2 py-1.5 dark:border-slate-600"><b class="w-6 text-teal-600">${i + 1}</b><span class="flex-1 truncate">${E(p.title)}</span><span class="text-xs">👍 ${score[p.id].likes} · 👎 ${score[p.id].dislikes}</span><b class="text-xs">${E(DataService.short(p))}</b></button>`).join('')}</div>`);
      document.querySelectorAll('.mg').forEach(b => b.onclick = () => { UI.close(); Feat.open(b.dataset.id) });
    }
  };

  /* ---------- Mensajes ---------- */
  const Msg = {
    async iniciar(p) {
      const u = await me(); if (!u) return pedirLogin('index.html?p=' + p.id);
      const c = await sb(); if (!c) { alert('Los mensajes estarán disponibles cuando se active la base de datos de MapMarket.'); return }
      const { data, error } = await c.rpc('iniciar_conversacion', { listing: String(p.id) });
      if (error) { alert(/tuyo/.test(error.message) ? 'Este anuncio es tuyo.' : error.message); return }
      location.href = 'mensajes.html?c=' + data;
    },
    async badge() {
      const a = $('bMsg'); if (!a) return; const c = await sb(), u = await me(); if (!c || !u) return;
      const upd = async () => { const { data } = await c.rpc('no_leidos'); const n = +data || 0; const s = a.querySelector('span'); s.textContent = n > 99 ? '99+' : n; s.classList.toggle('hidden', !n) };
      upd(); c.channel('mm-badge').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes' }, upd).subscribe();
    },
    cardButton(p) {
      const has = !p.demo && !p.mine;
      return `<button id="fMsg" class="col-span-2 border-2 border-teal-600 text-teal-700 dark:text-teal-300 rounded-xl py-2.5 font-semibold" ${has ? '' : 'disabled'}>✉️ Enviar mensaje${has ? '' : ' (no disponible)'}</button><p class="col-span-2 text-[11px] opacity-60 -mt-1">${p.mine ? 'Es tu publicación.' : p.demo ? 'Propiedad de demostración.' : Feat.Dest.set.has(String(p.id)) ? 'Le escribes al agente que destacó este anuncio, dentro de MapMarket.' : 'Este anuncio fue tomado de un portal público y no tiene dueño en MapMarket: tu mensaje llega a «MapMarket soporte». Para el anunciante usa WhatsApp.'}</p>`;
    }
  };

  window.Social = { Votos, Msg, sb, me };

  // Integración con index.html
  window.addEventListener('mm-feat-ready', () => {
    const sc = UI.showCard.bind(UI);
    UI.showCard = function (p) {
      sc(p);
      const box = $('fCmp') && $('fCmp').parentNode; if (!box) return;
      box.insertAdjacentHTML('afterbegin', Msg.cardButton(p));
      $('fMsg') && ($('fMsg').onclick = () => Msg.iniciar(p));
      const v = document.createElement('div'); v.className = 'flex items-center gap-2 px-4 -mt-1 mb-1'; v.innerHTML = '<span class="text-xs opacity-60">¿Te gusta?</span><span id="fVotos"></span>';
      box.parentNode.insertBefore(v, box); Votos.mount($('fVotos'), p.id);
    };
    const bar = $('bPub') && $('bPub').parentNode;
    if (bar) { const b = document.createElement('button'); b.id = 'bTop'; b.className = 'px-2 py-1 rounded-full border dark:border-slate-600'; b.textContent = '👍 Más gustados'; bar.insertBefore(b, $('bPub')); b.onclick = () => Votos.masGustados() }
    const tb = $('bUser'); if (tb) { const a = document.createElement('a'); a.id = 'bMsg'; a.href = 'mensajes.html'; a.title = 'Mensajes'; a.className = 'relative px-2 py-1.5 rounded-lg border dark:border-slate-600 whitespace-nowrap'; a.innerHTML = '💬<span class="hidden absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center"></span>'; tb.parentNode.insertBefore(a, tb); Msg.badge() }
  });
})();
