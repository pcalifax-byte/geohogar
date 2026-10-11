/* MapMarket · i18n ES/EN.
   - Idioma: ?lang= → localStorage mm_idioma → navigator.language (en* → en) → es.
   - El español es el texto fuente; en inglés se traduce el DOM con data/i18n/en.json (texto exacto,
     y fragmentos largos como respaldo), atributos visibles, <title>/<meta>, y textos dinámicos (MutationObserver).
   - window.MMT(s) traduce desde JS; window.MMLang; Intl con es-CR / en-US.
   - Elementos con data-noi18n (contenido de usuarios) no se traducen. */
(function () {
  const qs = new URLSearchParams(location.search).get('lang');
  if (qs === 'en' || qs === 'es') localStorage.setItem('mm_idioma', qs);
  let lang = localStorage.getItem('mm_idioma');
  if (lang !== 'en' && lang !== 'es') lang = (navigator.languages || [navigator.language || 'es']).some(l => /^en/i.test(l)) && !(navigator.languages || []).some(l => /^es/i.test(l)) ? 'en' : 'es';
  window.MMLang = lang; document.documentElement.lang = lang === 'en' ? 'en' : 'es';
  const LOC = lang === 'en' ? 'en-US' : 'es-CR'; window.MMLocale = LOC;
  let D = {}, RX = null, RXmap = {};
  const T = window.MMT = s => { if (lang !== 'en' || s == null) return s; const k = String(s).trim(); return D[k] || frag(String(s)) };
  function frag(s) { if (!RX) return s; return s.replace(RX, m => RXmap[m] || m) }
  const PAT = [ // patrones para textos con datos
    [/^\[Ejemplo\] (Casa|Apartamento|Lote|Lote\/Terreno|Finca|Oficina|Local|Bodega|Condominio|Edificio|Negocio) en (.+)$/, (m, t, l) => `[Example] ${({ Casa: 'House', Apartamento: 'Apartment', Lote: 'Lot', 'Lote/Terreno': 'Lot/Land', Finca: 'Farm', Oficina: 'Office', Local: 'Retail space', Bodega: 'Warehouse', Condominio: 'Condo', Edificio: 'Building', Negocio: 'Business' })[t] || t} in ${l}`],
    [/^(\d+) hab\.?$/, (m, n) => `${n} bd`], [/^(\d+)\+ hab\.$/, (m, n) => `${n}+ bd`], [/^(\d+) resultados?$/, (m, n) => `${n} result${n === '1' ? '' : 's'}`],
    [/^a ([\d.,]+ (?:km|m))$/, (m, d) => `${d} away`], [/^📍 a ([\d.,]+ (?:km|m)) de ti \(en línea recta\)$/, (m, d) => `📍 ${d} from you (straight line)`], [/^📍 a ([\d.,]+ (?:km|m)) del punto elegido \(en línea recta\)$/, (m, d) => `📍 ${d} from the chosen point (straight line)`],
    [/^Contenido actualizado · (.+)$/, (m, t) => `Content updated · ${t}`], [/^Subiendo foto (\d+) de (\d+)…$/, (m, a, b) => `Uploading photo ${a} of ${b}…`], [/^Revisando foto (\d+)…$/, (m, a) => `Checking photo ${a}…`],
    [/^(\d+) de (\d+) propiedades(?: \((\d+) demo\))?$/, (m, a, b, d) => `${a} of ${b} properties${d ? ` (${d} examples)` : ''}`],
    [/^Busca gratis y publica tu primera propiedad\. ¿Vendes más\? Plus desde (₡[\d.,]+)\/mes \(3 anuncios\) o Pro (₡[\d.,]+)\/mes \(5 anuncios \+ destacados\)\.$/, (m, a, b) => `Search for free and post your first property. Selling more? Plus from ${a}/mo (3 listings) or Pro ${b}/mo (5 listings + featured).`],
    [/^Propiedad ficticia de demostración: (.+?) en (.+) para probar filtros y ficha\.$/, (m, t, l) => `Fictional demo property: ${({ casa: 'house', apartamento: 'apartment', 'lote/terreno': 'lot/land', lote: 'lot', 'casa/terreno de playa': 'beach house/land' })[t.toLowerCase()] || t} in ${l} to try out filters and the listing card.`],
    [/^\[Ejemplo\] Casa\/Terreno de playa en (.+)$/, (m, l) => `[Example] Beach house/land in ${l}`],
    [/^(\d+) anuncios? activos?$/, (m, n) => `${n} active listing${n === '1' ? '' : 's'}`],
    [/^Encontré (\d+) propiedad(es)?/, (m, n) => `I found ${n} propert${n === '1' ? 'y' : 'ies'}`],
  ];
  const SKIP = 'SCRIPT,STYLE,NOSCRIPT,TEXTAREA,CODE,PRE,svg'.split(',');
  const done = new WeakMap();
  function trText(raw) {
    const k = raw.replace(/\s+/g, ' ').trim(); if (!k || !/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(k)) return null;
    let t = D[k]; if (!t) for (const [r, f] of PAT) if (r.test(k)) { t = k.replace(r, f); break }
    if (!t) { const f = frag(k); if (f !== k) t = f }
    if (!t || t === k) return null;
    const lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0]; return lead + t + trail;
  }
  function node(n) {
    if (n.nodeType === 3) { if (done.get(n) === n.nodeValue) return; const p = n.parentNode; if (!p || SKIP.includes(p.nodeName) || (p.closest && p.closest('[data-noi18n],.leaflet-tile-container'))) return;
      if (p.nodeName === 'OPTION' && !p.hasAttribute('value')) p.setAttribute('value', p.textContent);
      const t = trText(n.nodeValue); if (t != null) n.nodeValue = t; done.set(n, n.nodeValue); return }
    if (n.nodeType !== 1 || SKIP.includes(n.nodeName) || n.hasAttribute('data-noi18n')) return;
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) { const v = n.getAttribute(a); if (v) { const t = trText(v); if (t != null) n.setAttribute(a, t.trim()) } }
    if (n.nodeName === 'INPUT' && /^(button|submit)$/i.test(n.type) && n.value) { const t = trText(n.value); if (t) n.value = t.trim() }
    for (let c = n.firstChild; c; c = c.nextSibling) node(c);
  }
  function head() {
    const t = trText(document.title); if (t) document.title = t.trim();
    document.querySelectorAll('meta[name=description],meta[property="og:title"],meta[property="og:description"],meta[name="twitter:title"],meta[name="twitter:description"]').forEach(m => { const t = trText(m.content || ''); if (t) m.content = t.trim() });
    const ol = document.querySelector('meta[property="og:locale"]'); if (ol) ol.content = 'en_US';
  }
  // Intl: formatos según idioma (los textos usan es-CR por defecto)
  if (lang === 'en') {
    const fix = l => (l === 'es-CR' || l === 'es') ? 'en-US' : l;
    const nl = Number.prototype.toLocaleString; Number.prototype.toLocaleString = function (l, o) { return nl.call(this, fix(l), o) };
    for (const f of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) { const o = Date.prototype[f]; Date.prototype[f] = function (l, op) { return o.call(this, fix(l), op) } }
    const NF = Intl.NumberFormat; Intl.NumberFormat = function (l, o) { return new NF(fix(l), o) }; Intl.NumberFormat.prototype = NF.prototype; Intl.NumberFormat.supportedLocalesOf = NF.supportedLocalesOf;
  }
  // Selector de idioma + persistencia (localStorage y perfil)
  async function setLang(l) {
    localStorage.setItem('mm_idioma', l);
    try { if (window.Auth && !Auth.demo) { const u = await Auth.user(); if (u) { const c = await Auth.client(); await c.from('profiles').update({ idioma: l }).eq('id', u.id) } } } catch (e) { }
    const u = new URL(location.href); u.searchParams.delete('lang'); location.replace(u.toString());
  }
  window.MMSetLang = setLang;
  function selector() {
    if (document.getElementById('mmLang')) return;
    const b = document.createElement('button'); b.id = 'mmLang'; b.type = 'button'; b.setAttribute('data-noi18n', '');
    b.textContent = lang === 'en' ? '🇨🇷 ES' : '🇺🇸 EN'; b.title = lang === 'en' ? 'Ver en español' : 'View in English'; b.setAttribute('aria-label', b.title);
    b.onclick = () => setLang(lang === 'en' ? 'es' : 'en');
    const ref = document.getElementById('tgDark');
    if (ref) { b.className = ref.className; ref.parentElement.insertBefore(b, ref) }
    else { const h = document.querySelector('header'); const box = h && (h.querySelector('div') || h); if (box) { b.className = 'text-sm border rounded-lg px-2 dark:border-slate-600 ml-1'; b.style.minHeight = '40px'; box.appendChild(b) } else { b.className = 'fixed top-2 right-2 z-[2000] text-sm bg-white/90 dark:bg-slate-800/90 border rounded-lg px-2 shadow'; b.style.minHeight = '40px'; document.body.appendChild(b) } }
  }
  // SEO: hreflang
  function hreflang() {
    const base = location.origin + location.pathname;
    [['es', base], ['en', base + '?lang=en'], ['x-default', base]].forEach(([h, u]) => { if (document.querySelector(`link[hreflang="${h}"]`)) return; const l = document.createElement('link'); l.rel = 'alternate'; l.hreflang = h; l.href = u; document.head.appendChild(l) });
  }
  // Chat en inglés: traduce términos de búsqueda al vocabulario del buscador (que es en español)
  const Q = [[/\bhouses?\b|\bhomes?\b/gi, 'casa'], [/\bapartments?\b|\bcondos?\b|\bflats?\b/gi, 'apartamento'], [/\blots?\b|\bland\b/gi, 'lote'], [/\bfarms?\b/gi, 'finca'], [/\boffices?\b/gi, 'oficina'],
    [/\bbed(room)?s?\b|\bbd\b/gi, 'habitaciones'], [/\bbath(room)?s?\b/gi, 'baños'], [/\b(under|below|up to|max(imum)?|less than)\b/gi, 'hasta'], [/\b(over|above|from|at least|more than|min(imum)?)\b/gi, 'desde'],
    [/\bnear me\b|\bclose to me\b|\bnearby\b/gi, 'cerca de mí'], [/\bwithin\b/gi, 'a'], [/\bthousand\b|\bk\b/gi, 'mil'], [/\bmillion\b/gi, 'millones'], [/\bdollars?\b|\busd\b/gi, 'dólares'],
    [/\bpool\b/gi, 'piscina'], [/\bgym\b/gi, 'gimnasio'], [/\bgarden\b/gi, 'jardín'], [/\bsecurity\b/gi, 'seguridad'], [/\bgarage\b/gi, 'garaje'], [/\bwith\b/gi, 'con'], [/\bin\b/gi, 'en'],
    [/\btalk to an agent\b|\bhuman\b|\bagent\b/gi, 'hablar con un agente'], [/\bclear filters\b|\breset\b/gi, 'limpiar filtros'], [/\b(hi|hello|hey)\b/gi, 'hola'], [/\bforeclosures?\b|\bauctions?\b/gi, 'remate'], [/\bbank[- ]owned\b/gi, 'adjudicado']];
  function chatEN() {
    if (lang !== 'en' || !window.Chat || Chat._en) return; Chat._en = 1;
    const ask = Chat.ask.bind(Chat), add = Chat.add.bind(Chat); let orig = null;
    Chat.add = (h, user) => add(user && orig != null ? String(orig).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) : h, user);
    Chat.ask = async q => {
      orig = q; const kb = Chat.kb && Chat.kb.intents || [], n = Chat.N ? Chat.N(q) : q.toLowerCase();
      const isTopic = kb.some(i => i.keywords.some(k => /[a-z]/.test(k) && n.includes(Chat.N ? Chat.N(k) : k))) && !/\b(houses?|apartments?|lots?|bedrooms?|under|near me|up to)\b/i.test(q);
      let s = q; if (!isTopic) for (const [r, v] of Q) s = s.replace(r, v);
      try { return await ask(s) } finally { orig = null }
    };
  }
  async function start() {
    if (lang === 'en') {
      try { D = await PRE } catch (e) { D = {} }
      const keys = Object.keys(D).filter(k => k.length >= 8 && /\s/.test(k) && D[k] !== k).sort((a, b) => b.length - a.length).slice(0, 1500);
      keys.forEach(k => RXmap[k] = D[k]);
      if (keys.length) RX = new RegExp('(?<![\\wÁÉÍÓÚÑáéíóúñ])(' + keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\wÁÉÍÓÚÑáéíóúñ])', 'g');
      head(); node(document.body);
      new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') node(m.target); else m.addedNodes.forEach(node) } if (document.title && /[áéíóúñ]|·/.test(document.title)) head() }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      const ac = window.alert, cf = window.confirm, pr = window.prompt;
      window.alert = m => ac(T(String(m))); window.confirm = m => cf(T(String(m))); window.prompt = (m, d) => pr(T(String(m)), d);
    }
    document.documentElement.classList.remove('mm-i18n-wait');
    selector(); hreflang(); chatEN(); window.addEventListener('mm-feat-ready', () => { selector(); chatEN() });
  }
  const PRE = lang === 'en' ? fetch('data/i18n/en.json').then(r => r.json()) : null;
  if (lang === 'en') { document.documentElement.classList.add('mm-i18n-wait'); const st = document.createElement('style'); st.textContent = '.mm-i18n-wait body{visibility:hidden}'; document.head.appendChild(st); setTimeout(() => document.documentElement.classList.remove('mm-i18n-wait'), 2500) }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
