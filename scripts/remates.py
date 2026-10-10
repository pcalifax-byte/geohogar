"""Remates judiciales y bienes adjudicados (solo inmuebles).
Fuentes:
 - rematejudicialcr.com  (API pública /api/public/edict-explorer y /edicts/{id}; robots.txt solo bloquea /dashboard y /login)
 - rematesrjc.com        (páginas de lista index.php?page=N; el detalle remate.php responde 406 a bots → solo datos de la tarjeta)
 - ventadebienes.bncr.fi.cr/propiedades (BN, tarjetas con data-*)
 - Banco Popular: catálogo PDF del cartel vigente enlazado en /venta-de-propiedades/
 - ventadebienes.bancobcr.com (BCR) → bloqueado por Radware Bot Manager: no se usa.
"""
import json, re, html, subprocess, time, datetime, os, unicodedata

UA = "Mozilla/5.0 (X11; Linux x86_64) MapMarketBot/1.0"
def get(url, timeout=40, binary=False):
    r = subprocess.run(["curl", "-sL", "--max-time", str(timeout), "-A", UA, "-H", "Accept: text/html,application/json,*/*", url], capture_output=True)
    return r.stdout if binary else r.stdout.decode("utf-8", "ignore")
def norm(s): return unicodedata.normalize("NFD", str(s or "").lower()).encode("ascii", "ignore").decode()
def txt(h): return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h))).strip()
PROV = {"san jose": "San José", "alajuela": "Alajuela", "cartago": "Cartago", "heredia": "Heredia", "guanacaste": "Guanacaste", "puntarenas": "Puntarenas", "limon": "Limón"}
def prov_of(s):
    n = norm(s)
    for k, v in PROV.items():
        if k in n: return v
def money(s):
    s = re.sub(r"[^\d.,]", "", s or "")
    if not s: return None
    if re.search(r",\d{2}$", s): s = s.replace(".", "").replace(",", ".")
    else: s = s.replace(",", "")
    try: return float(s)
    except ValueError: return None
def tipo_de(texto, area=None):
    t = norm(texto)
    if re.search(r"casa|vivienda|habitacion|construccion|apartamento|edificacion", t): return "Casa"
    if re.search(r"finca|agricola|ganader|potrero|cafetal|montana|repasto|charral", t) or (area and area >= 10000): return "Finca"
    if re.search(r"lote|terreno|solar", t): return "Lote/Terreno"
    return "Inmueble"
def gravamen_de(texto):
    t = norm(texto)
    if "libre de gravamenes" in t and "anotaciones" in t and "libre de gravamenes y anotaciones" in t: return "Libre de gravámenes y anotaciones"
    if "libre de gravamenes hipotecarios" in t:
        extra = [w for w in ["servidumbre", "condiciones", "plazo de convalidacion", "afectacion", "reservas"] if w in t]
        return "Libre de gravámenes hipotecarios" + (" (soporta " + ", ".join(extra) + ")" if extra else "")
    if "libre de gravamenes" in t: return "Libre de gravámenes" + (" (soporta servidumbre)" if "servidumbre" in t else "")
    if "soportando" in t or "servidumbre" in t: return "Con servidumbre/gravámenes (ver edicto)"
    if "hipoteca" in t: return "Con hipoteca (ver edicto)"
    return "Ver edicto"
HORA = re.compile(r"(?:a las|alas)\s+([a-z0-9: ]{2,40}?(?:horas?|a\.?\s?m\.?|p\.?\s?m\.?))", re.I)

def rematejudicialcr(today, delay=1.2, max_detail=400, prev=None):
    prev = prev or {}
    out, allr, pg = [], [], 1
    while True:
        j = json.loads(get(f"https://rematejudicialcr.com/api/public/edict-explorer?page={pg}&per_page=100"))
        allr += j["results"]
        if len(allr) >= j["total"] or not j["results"]: break
        pg += 1; time.sleep(delay)
    nd = 0
    for r in allr:
        if not r.get("is_active"): continue
        dates = [(r.get("first_auction_date"), r.get("first_auction_price_value")), (r.get("second_auction_date"), r.get("second_auction_price_value")), (r.get("third_auction_date"), r.get("third_auction_price_value"))]
        if not any(d and d >= today for d, _ in dates): continue
        rid = f"rjcr-{r['id']}"; old = prev.get(rid, {})
        det = None
        if not old.get("_detalle") and nd < max_detail:
            try: det = json.loads(get(f"https://rematejudicialcr.com/api/public/edicts/{r['id']}")); nd += 1; time.sleep(delay)
            except Exception: det = None
        raw = (det or {}).get("raw_text") or ""; summ = (det or {}).get("source_text_summary") or ""
        pt = (r.get("point_coordinates") or [{}])[0]
        loc = [x.strip() for x in (r.get("location_str") or "").split(",")]
        b1 = r.get("first_auction_price_value")
        o = dict(id=rid, kind="remate", fuente="rematejudicialcr.com", tipo=old.get("tipo") if old.get("_detalle") and not det else tipo_de(summ + " " + raw[:600], r.get("area_m2")) if det else "Inmueble",
                 provincia=loc[0] if loc else None, canton=loc[1] if len(loc) > 1 else None, distrito=loc[2] if len(loc) > 2 else None,
                 moneda=r.get("first_auction_currency") or "CRC", base1=b1, base2=r.get("second_auction_price_value") or (b1 and round(b1 * .75, 2)), base3=r.get("third_auction_price_value") or (b1 and round(b1 * .25, 2)),
                 fecha1=r.get("first_auction_date"), fecha2=r.get("second_auction_date"), fecha3=r.get("third_auction_date"),
                 hora=old.get("hora") if not det else ((HORA.search(raw) or [None, None])[1]), gravamen=(old.get("gravamen") or "Ver edicto") if not det else gravamen_de(raw),
                 juzgado=r.get("court_name"), expediente=r.get("case_number"), finca=r.get("property_number"), area_m2=r.get("area_m2"),
                 resumen=(summ or old.get("resumen") or "")[:400], lat=pt.get("lat"), lon=pt.get("lng"), coord="exacta" if pt.get("lat") else "aproximada",
                 url=f"https://rematejudicialcr.com/explorar", url_nota="Buscar por expediente " + (r.get("case_number") or ""), _detalle=bool(det) or old.get("_detalle", False))
        if o["tipo"] == "Inmueble" and old.get("tipo"): o["tipo"] = old["tipo"]
        out.append(o)
    return out

def rematesrjc(today, delay=1.5, max_pages=80):
    out, seen = [], set()
    for pg in range(1, max_pages + 1):
        h = get(f"https://rematesrjc.com/index.php?page={pg}")
        arts = re.findall(r'<article class="entrada">([\s\S]*?)</article>', h)
        if not arts: break
        for a in arts:
            g = lambda r: (re.search(r, a, re.S) or [None, None])[1]
            rid = g(r'remate\.php\?id=(\d+)'); tipo = (g(r'<span class="propiedad\w*">([^<]+)') or "").strip()
            if not rid or rid in seen: continue
            seen.add(rid)
            if norm(tipo) in ("vehiculo", "vehiculos", "carro", "moto"): continue
            f = g(r'entrada-fecha">([^<]+)'); m = re.match(r"(\d{2})-(\d{2})-(\d{4})", f or "")
            fecha = f"{m[3]}-{m[2]}-{m[1]}" if m else None
            if not fecha or fecha < today: continue
            desc = txt(g(r'class="description">([\s\S]*?)</p>') or "")
            b1 = money(g(r'class="price">([^<]+)'))
            out.append(dict(id=f"rjc-{rid}", kind="remate", fuente="rematesrjc.com", tipo=tipo_de(tipo + " " + desc),
                            provincia=prov_of(g(r"Provincia:\s*([^<]+)") or ""), canton=(g(r"Cantón:\s*([^<]+)") or "").replace("CANTÓN", "").strip(" 0123456789-") or None, distrito=None,
                            moneda="CRC", base1=b1, base2=b1 and round(b1 * .75, 2), base3=b1 and round(b1 * .25, 2), fecha1=fecha, fecha2=None, fecha3=None,
                            hora=None, gravamen=gravamen_de(desc), juzgado=None, expediente=None, resumen=desc[:400], coord="aproximada",
                            url=f"https://rematesrjc.com/remate.php?id={rid}", base_nota="Precio mostrado por RJC (puede ser conversión a ₡ de una base en dólares)"))
        time.sleep(delay)
    return out

BN_T = {"vivienda": "Casa", "terreno": "Lote/Terreno", "terreno-con-construccion": "Casa", "finca": "Finca", "inmobiliario": "Inmueble"}
def bn():
    h = get("https://ventadebienes.bncr.fi.cr/propiedades"); out = []
    for c in re.split(r'<a href="https://ventadebienes\.bncr\.fi\.cr/propiedades/', h)[1:]:
        slug = c.split('"', 1)[0]; g = lambda r: (re.search(r, c, re.S) or [None, None])[1]
        tipo = g(r'data-tipo="([^"]+)"')
        if tipo not in BN_T: continue
        precio = money(g(r'class="data-precio">([^<]*)')); precio = precio / 100 if precio else None
        desc = g(r'bnv_tag_descuento">([^<]*)'); title = html.unescape(g(r'<div class="title">([^<]*)') or "").strip()
        aval = money((re.search(r"Valor avalúo:\s*₡([\d.,]+)", txt(c)) or [None, None])[1])
        out.append(dict(id="bn-" + slug[-20:], kind="adjudicado", fuente="BN Venta de Bienes", banco="Banco Nacional", tipo=BN_T[tipo], titulo=title,
                        provincia=prov_of(g(r'data-provincia="([^"]*)"')), canton=(txt(g(r'data-canton="[^"]*">([^<]*)') or "")).title() or None, distrito=(txt(g(r'data-distrito="[^"]*">([^<]*)') or "")).title() or None,
                        moneda="CRC", precio=precio, avaluo=aval, descuento=int(re.sub(r"\D", "", desc)) if desc and re.search(r"\d", desc) else None,
                        modalidad=(g(r'class="data-estado">([^<]*)') or "").replace("-", " "), habitaciones=g(r'data-habitacion="([^"]*)"'), banos=g(r'data-banios="([^"]*)"'),
                        terreno_m2=money(g(r'class="data-terreno">([^<]*)')), construccion_m2=money(g(r'class="data-construccion">([^<]*)')),
                        imagen=g(r"background:url\('([^']+)'"), coord="aproximada", url="https://ventadebienes.bncr.fi.cr/propiedades/" + slug))
    return out

def bp(tmpdir="/tmp"):
    h = get("https://www.bancopopular.fi.cr/venta-de-propiedades/")
    m = re.findall(r'href="(https?://www\.bancopopular\.fi\.cr/wp-content/uploads/[^"]*Catalogo-de-Propiedades[^"]*\.pdf)"', h)
    if not m: return [], None
    url = m[0].replace("http://", "https://"); pdf = os.path.join(tmpdir, "bp_catalogo.pdf")
    open(pdf, "wb").write(get(url, 240, binary=True))
    t = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, errors="ignore").stdout
    out, prov = [], None
    blocks = re.split(r"\n\s*\n", t)
    lines = [l.strip() for l in t.splitlines()]
    for i, l in enumerate(lines):
        pm = re.match(r"PROPIEDADES EN\s+([A-ZÁÉÍÓÚ ]+?)\s{2,}", l + "  ")
        if pm: prov = prov_of(pm.group(1))
        em = re.search(r"EXPEDIENTE\s+([\w-]+)", l)
        if not em: continue
        loc = re.sub(r"^(NUEVA|\d+%|DE DESCUENTO)\s+", "", lines[i - 1]).strip() if i else ""
        loc = re.split(r"\s{2,}", loc)[-1]
        win = " ".join(lines[i:i + 8])
        base = money((re.search(r"Precio base de venta\s+₡([\d.,]+)", win) or [None, None])[1]); av = money((re.search(r"Precio avalúo\s+₡([\d.,]+)", win) or [None, None])[1])
        con = re.search(r"Contacto:\s*([^0-9]+?)\s+(\d{4})\s*-\s*(\d{4})", win)
        parts = [x.strip() for x in loc.split(",")]
        out.append(dict(id="bp-" + em.group(1), kind="adjudicado", fuente="Banco Popular (catálogo PDF)", banco="Banco Popular", tipo="Inmueble", titulo=f"Bien adjudicado BP · {loc}",
                        provincia=prov, canton=parts[0] if parts else None, distrito=parts[1] if len(parts) > 1 else None, moneda="CRC", precio=base, avaluo=av,
                        descuento=round((1 - base / av) * 100) if base and av and av > base else 0, expediente=em.group(1),
                        contacto=con.group(1).strip() if con else None, telefono=(con.group(2) + con.group(3)) if con else None,
                        coord="aproximada", url=url, url_nota="Catálogo PDF del cartel vigente (buscar por expediente)"))
    return out, url

def geocode_all(items, cache, http_json, sleep=1.1):
    for x in items:
        if x.get("lat"): continue
        parts = [p for p in [x.get("distrito"), x.get("canton"), x.get("provincia")] if p]
        while parts:
            q = ", ".join(parts) + ", Costa Rica"
            if q not in cache:
                try:
                    r = http_json("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cr&q=" + __import__("urllib.parse").parse.quote(q))
                    cache[q] = [float(r[0]["lat"]), float(r[0]["lon"])] if r else None
                except Exception: cache[q] = None
                time.sleep(sleep)
            if cache[q]: x["lat"], x["lon"] = cache[q]; break
            parts = parts[1:]

def build(prev_items=None, today=None, log=print):
    today = today or datetime.date.today().isoformat()
    prev = {x["id"]: x for x in (prev_items or [])}
    res, fuentes = [], {}
    for name, fn in [("rematejudicialcr.com", lambda: rematejudicialcr(today, prev=prev)), ("rematesrjc.com", lambda: rematesrjc(today)), ("BN", bn)]:
        try: items = fn(); res += items; fuentes[name] = {"n": len(items), "estado": "ok"}
        except Exception as e: fuentes[name] = {"n": 0, "estado": f"error: {e}"}; log(name, e)
    try: items, url = bp(); res += items; fuentes["Banco Popular"] = {"n": len(items), "estado": "ok", "pdf": url}
    except Exception as e: fuentes["Banco Popular"] = {"n": 0, "estado": f"error: {e}"}
    fuentes["BCR"] = {"n": 0, "estado": "bloqueado (Radware Bot Manager en ventadebienes.bancobcr.com)"}
    fuentes["rematesinteligentescr.com"] = {"n": 0, "estado": "no usado: app (Firebase) y robots.txt bloquea /api/"}
    # quitar remates cuya última fecha ya pasó
    def vigente(x):
        if x["kind"] != "remate": return True
        return any(d and d >= today for d in [x.get("fecha1"), x.get("fecha2"), x.get("fecha3")])
    res = [x for x in res if vigente(x)]
    # deduplicar: el mismo edicto aparece en rematejudicialcr (con coordenadas SNIT) y en RJC
    key = lambda x: (x.get("fecha1"), round((x.get("base1") or 0) / 1000), x.get("provincia"))
    k_rjcr = {key(x) for x in res if x["fuente"] == "rematejudicialcr.com"}
    res = [x for x in res if not (x["fuente"] == "rematesrjc.com" and key(x) in k_rjcr)]
    # conservar coordenadas ya geocodificadas
    for x in res:
        if not x.get("lat") and x["id"] in prev and prev[x["id"]].get("lat"): x["lat"], x["lon"] = prev[x["id"]]["lat"], prev[x["id"]]["lon"]
    return res, fuentes
