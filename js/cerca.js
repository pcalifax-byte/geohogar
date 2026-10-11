/* MapMarket · «📍 Mi ubicación» + «Cerca de mí» (radio). La ubicación se usa solo en el dispositivo: nunca se envía al servidor. */
(function () {
  const $ = i => document.getElementById(i), KEY = 'mm_cerca_km', R = [1, 3, 5, 10, 25];
  const hav = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)) };
  const C = window.Cerca = {
    pos: null, punto: null, km: +(localStorage.getItem(KEY) || 5), on: false, watch: null, dot: null, acc: null, circle: null, first: true, pick: false,
    centro() { return this.punto || this.pos },
    dist(p) { const c = this.centro(); return c && p && p.lat != null ? hav(c.lat, c.lon, p.lat, p.lon) : null },
    within(lat, lon) { if (!this.on) return true; const c = this.centro(); return !c || hav(c.lat, c.lon, lat, lon) <= this.km },
    fmt(d) { return d == null ? '' : d < 1 ? Math.round(d * 1000) + ' m' : (d < 10 ? d.toFixed(1).replace('.', ',') : Math.round(d)) + ' km' },
    txt(p) { const d = this.dist(p); return d == null ? '' : ' · a ' + this.fmt(d) },
    err(e) {
      const m = !window.isSecureContext ? 'La ubicación requiere una conexión segura (HTTPS).' : !navigator.geolocation ? 'Tu navegador no permite obtener la ubicación.'
        : e && e.code === 1 ? 'Permiso de ubicación denegado. Actívalo en la configuración del navegador o de la app, o mantén presionado el mapa para elegir un punto.'
        : e && e.code === 2 ? 'No se pudo determinar tu ubicación (GPS o red no disponibles). Puedes mantener presionado el mapa para elegir un punto.'
        : e && e.code === 3 ? 'La ubicación tardó demasiado. Inténtalo de nuevo al aire libre o elige un punto en el mapa.' : 'No se pudo obtener la ubicación.';
      Feat.toast(m); this.btn(false);
    },
    btn(active) { const b = $('mmLoc'); if (b) { b.classList.toggle('mm-loc-on', !!active); b.setAttribute('aria-pressed', !!active) } },
    locate() {
      if (this.watch != null) { this.stopWatch(); return }
      if (!window.isSecureContext || !navigator.geolocation) return this.err();
      this.btn(true); this.first = true;
      this.watch = navigator.geolocation.watchPosition(p => {
        this.pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; this.punto = null;
        const ll = [this.pos.lat, this.pos.lon], map = MapController.map;
        if (!this.dot) { this.acc = L.circle(ll, { radius: this.pos.acc, color: '#2563eb', weight: 1, fillOpacity: .12, interactive: false }).addTo(map); this.dot = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).bindTooltip('Estás aquí').addTo(map) }
        else { this.dot.setLatLng(ll); this.acc.setLatLng(ll).setRadius(this.pos.acc) }
        if (this.first) { this.first = false; map.setView(ll, Math.max(map.getZoom(), 14)); this.panel(true) }
        if (this.on) this.apply(false);
      }, e => { this.stopWatch(); this.err(e) }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    },
    stopWatch() { if (this.watch != null) navigator.geolocation.clearWatch(this.watch); this.watch = null; this.btn(false); [this.dot, this.acc].forEach(l => l && MapController.map.removeLayer(l)); this.dot = this.acc = null; this.pos = null; if (this.on && !this.punto) this.off() },
    setPunto(lat, lon) { this.punto = { lat, lon }; this.on = true; this.panel(true); this.apply(true); Feat.toast('📌 Punto elegido: mostrando a ' + this.km + ' km') },
    apply(fit) {
      const c = this.centro(), map = MapController.map; if (!c) return;
      if (this.circle) this.circle.setLatLng([c.lat, c.lon]).setRadius(this.km * 1000);
      else this.circle = L.circle([c.lat, c.lon], { radius: this.km * 1000, color: '#0d9488', weight: 2, dashArray: '6 6', fillOpacity: .05, interactive: false }).addTo(map);
      App.refresh(); window.dispatchEvent(new Event('mm-cerca'));
      if (fit) map.fitBounds(this.circle.getBounds(), { padding: [20, 20] });
      const n = App.visible.length; const s = $('ccN'); if (s) s.textContent = n + ' resultado' + (n === 1 ? '' : 's');
    },
    setKm(k) { this.km = Math.max(.5, Math.min(100, +k)); localStorage.setItem(KEY, this.km); this.on = true; this.panel(true); if (!this.centro()) { this.locate(); return } this.apply(true) },
    off() { this.on = false; this.punto = null; if (this.circle) MapController.map.removeLayer(this.circle); this.circle = null; App.refresh(); window.dispatchEvent(new Event('mm-cerca')); this.panel(false) },
    panel(show) {
      let p = $('ccPanel');
      if (!show) { p && p.classList.add('hidden'); return }
      if (!p) { p = document.createElement('div'); p.id = 'ccPanel'; p.setAttribute('role', 'region'); p.setAttribute('aria-label', 'Cerca de mí'); p.className = 'fixed z-[1100] left-2 right-2 sm:left-auto sm:right-3 sm:w-80 bottom-24 rounded-2xl shadow-xl bg-white/95 dark:bg-slate-800/95 backdrop-blur p-3 text-sm'; document.body.appendChild(p) }
      p.classList.remove('hidden');
      const c = this.centro();
      p.innerHTML = `<div class="flex items-center gap-2"><b>📍 Cerca ${this.punto ? 'del punto' : 'de mí'}</b><span id="ccN" class="text-xs opacity-70"></span><button id="ccX" class="ml-auto w-11 h-11 -my-2 -mr-2" aria-label="Cerrar">✕</button></div>
        <div class="flex flex-wrap gap-1.5 mt-2">${R.map(k => `<button data-k="${k}" class="cck rounded-full border dark:border-slate-600 px-3 ${this.on && this.km === k ? 'bg-teal-600 text-white border-teal-600' : ''}" style="min-height:40px">${k} km</button>`).join('')}</div>
        <label class="flex items-center gap-2 mt-2 text-xs">Radio <input id="ccR" type="range" min="0.5" max="100" step="0.5" value="${this.km}" class="flex-1" aria-label="Radio en kilómetros"><b id="ccV" class="w-14 text-right">${this.km} km</b></label>
        <div class="flex flex-wrap gap-2 mt-2 text-xs">${c ? '' : '<span class="opacity-70">Sin ubicación: toca «Mi ubicación» o mantén presionado el mapa para elegir un punto.</span>'}<button id="ccPick" class="underline" style="min-height:36px">📌 Elegir un punto en el mapa</button>${this.on ? '<button id="ccOff" class="underline text-red-600" style="min-height:36px">Quitar filtro</button>' : ''}</div>
        <p class="text-[10px] opacity-60 mt-1">Tu ubicación se usa solo en este dispositivo; no se envía a MapMarket.</p>`;
      $('ccX').onclick = () => this.panel(false);
      p.querySelectorAll('.cck').forEach(b => b.onclick = () => this.setKm(+b.dataset.k));
      $('ccR').oninput = e => $('ccV').textContent = e.target.value + ' km'; $('ccR').onchange = e => this.setKm(+e.target.value);
      $('ccPick').onclick = () => { this.pick = true; Feat.toast('Toca el mapa en el punto que quieras'); };
      if ($('ccOff')) $('ccOff').onclick = () => this.off();
      if (this.on) { const n = App.visible.length; $('ccN').textContent = n + ' resultado' + (n === 1 ? '' : 's') }
    },
    init() {
      const map = MapController.map;
      const Ctl = L.Control.extend({ options: { position: 'bottomright' }, onAdd() {
        const d = L.DomUtil.create('div', 'leaflet-bar mm-locbar');
        d.innerHTML = '<button id="mmLoc" type="button" title="Mi ubicación" aria-label="Mi ubicación" aria-pressed="false">📍</button><button id="mmNear" type="button" title="Cerca de mí" aria-label="Cerca de mí: filtrar por radio">◎</button>';
        L.DomEvent.disableClickPropagation(d); return d } });
      new Ctl().addTo(map);
      $('mmLoc').onclick = () => this.locate();
      $('mmNear').onclick = () => { const p = $('ccPanel'); if (p && !p.classList.contains('hidden')) this.panel(false); else { this.panel(true); if (!this.centro()) this.locate() } };
      map.on('contextmenu', e => this.setPunto(e.latlng.lat, e.latlng.lng));            // clic derecho / mantener presionado
      map.on('click', e => { if (this.pick) { this.pick = false; this.setPunto(e.latlng.lat, e.latlng.lng) } });
      // Filtrado y orden por distancia
      const fa = Filters.apply.bind(Filters);
      Filters.apply = list => { let r = fa(list); if (this.on && this.centro()) { r = r.filter(p => this.dist(p) <= this.km).sort((a, b) => this.dist(a) - this.dist(b)) } return r };
      const cs = Chat.search.bind(Chat);
      Chat.search = f => { let r = cs(f); if (this.on && this.centro()) r = r.filter(p => this.dist(p) <= this.km).sort((a, b) => this.dist(a) - this.dist(b)); return r };
      const ask = Chat.ask.bind(Chat);
      Chat.ask = async q => {
        const m = /cerca\s+de\s+(m[ií]|aqu[ií]|mi ubicaci[oó]n)(?:\s*(?:a|en|de)?\s*(\d+(?:[.,]\d+)?)\s*(?:km|kil[oó]metros?))?/i.exec(q) || /(?:a|en)\s*(\d+(?:[.,]\d+)?)\s*km\s+de\s+m[ií]/i.exec(q);
        if (m) {
          const km = +(String(m[2] || (m[1] && /^\d/.test(m[1]) ? m[1] : '') || this.km).replace(',', '.'));
          this.km = km || this.km; localStorage.setItem(KEY, this.km); this.on = true;
          if (!this.centro()) { this.locate(); await new Promise(ok => { let t = 0; const iv = setInterval(() => { if (this.centro() || ++t > 30 || this.watch == null) { clearInterval(iv); ok() } }, 300) }) }
          if (!this.centro()) { Chat.add(q.replace(/[<>&]/g, ''), true); Chat.bot('No tengo tu ubicación. Activa el permiso de ubicación o mantén presionado el mapa para elegir un punto, y vuelve a preguntar.'); return }
          this.apply(false);
          q = q.replace(m[0], '').replace(/\s+/g, ' ').trim() || 'propiedades';
        }
        return ask(q);
      };
      // Distancia en la ficha
      const sc = UI.showCard.bind(UI);
      UI.showCard = p => { sc(p); const d = this.dist(p); if (d == null) return; const h = document.querySelector('#card h2'); if (!h) return; const s = document.createElement('div'); s.className = 'text-xs font-semibold text-blue-700 dark:text-blue-300 mt-0.5'; s.textContent = '📍 a ' + this.fmt(d) + (this.punto ? ' del punto elegido' : ' de ti') + ' (en línea recta)'; h.insertAdjacentElement('afterend', s) };
    }
  };
  window.addEventListener('mm-feat-ready', () => { try { C.init() } catch (e) { console.warn('cerca', e) } });
})();
