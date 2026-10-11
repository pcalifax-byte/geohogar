#!/usr/bin/env python3
"""MapMarket · actualización diaria de datos.

Uso:  python3 scripts/update.py [--no-push] [--no-listings] [--max-new N] [--delay 1.5]

- Tipo de cambio (compra/venta) y TBP desde los indicadores públicos del BCCR (bccr.fi.cr),
  con respaldo en api.hacienda.go.cr para el tipo de cambio.
- Tasas de bancos: intenta leer la página pública de cada banco (patrón configurable en tasas.json);
  si no se puede, conserva el valor anterior y registra fecha_verificacion / estado.
- Revisa cada anuncio real (throttle) -> status activa / vendida / retirada.
- Agrega anuncios nuevos de Anuntico (opcional) con amenidades extraídas por palabras clave.
- Refresca medianas de mercado de Anuntico.
- Escribe scripts/last_run.json; hace commit+push solo si cambió algo en data/.
Idempotente: correrlo dos veces seguidas no genera un segundo commit si nada cambió.
"""
import json, re, os, sys, time, html, subprocess, hashlib, argparse, datetime, urllib.parse, urllib.robotparser
sys.path.insert(0, os.path.dirname(__file__))
from amenidades import extraer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
D = lambda n: os.path.join(ROOT, "data", n)
UA = "MapMarketBot/1.0 (+https://pcalifax-byte.github.io/geohogar/)"
ap = argparse.ArgumentParser()
ap.add_argument("--no-push", action="store_true"); ap.add_argument("--no-listings", action="store_true")
ap.add_argument("--max-new", type=int, default=30); ap.add_argument("--delay", type=float, default=1.5)
ap.add_argument("--no-remates", action="store_true")
ap.add_argument("--limit-check", type=int, default=0, help="revisar solo N anuncios (0 = todos)")
A = ap.parse_args()
NOW = datetime.datetime.now(datetime.timezone.utc); TODAY = NOW.date().isoformat()
summary = {"inicio": NOW.isoformat(timespec="seconds"), "errores": []}

def load(n): return json.load(open(D(n), encoding="utf-8"))
def save(n, o, compact=False):
    with open(D(n), "w", encoding="utf-8") as f:
        json.dump(o, f, ensure_ascii=False, **({"separators": (",", ":")} if compact else {"indent": 1}))
def digest():
    h = hashlib.sha256()
    for n in sorted(os.listdir(os.path.join(ROOT, "data"))):
        if n != "meta.json": h.update(open(D(n), "rb").read())
    return h.hexdigest()

def http(url, timeout=25):
    """Devuelve (status, url_final, texto). Sigue redirecciones."""
    r = subprocess.run(["curl", "-sL", "--compressed", "--max-time", str(timeout), "-A", UA, "-o", "-", "-w", "\n__META__%{http_code} %{url_effective}", url],
                       capture_output=True, text=True, errors="ignore")
    body, _, meta = r.stdout.rpartition("\n__META__")
    try: code, final = meta.split(" ", 1)
    except ValueError: code, final = "000", url
    return int(code or 0), final.strip(), body

_robots = {}
def allowed(url):
    p = urllib.parse.urlparse(url); base = f"{p.scheme}://{p.netloc}"
    if base not in _robots:
        rp = urllib.robotparser.RobotFileParser(); c, _, t = http(base + "/robots.txt", 15)
        rp.parse(t.splitlines() if c == 200 else []); _robots[base] = rp
    return _robots[base].can_fetch("*", url)

# ---------------- 1. Tipo de cambio y TBP (BCCR) ----------------
def bccr_indicator(code):
    c, _, h = http("https://www.bccr.fi.cr/")
    m = re.search(r'data-cmp-resource="([^"]+)"[\s\S]{0,400}?data-indicator="' + str(code) + '"', h)
    res = m.group(1) if m else "/content/bccr/cr/es/home/jcr:content/root/container/container/economicindicators/item_1774647998142"
    c, _, t = http(f"https://www.bccr.fi.cr{res}.indicator.{code}.json")
    j = json.loads(t); s = j["series"][-1]
    return float(s["valorDatoPorPeriodo"]), s["fecha"][:10], j.get("nombreIndicador")

def update_fx():
    fx = load("tipo_cambio.json"); old = dict(fx)
    try:
        compra, f1, _ = bccr_indicator(317); venta, f2, _ = bccr_indicator(318)
        fx.update(compra=round(compra, 2), venta=round(venta, 2), fecha=max(f1, f2), fuente="BCCR (bccr.fi.cr, indicadores 317/318)")
    except Exception as e:
        summary["errores"].append(f"BCCR tipo de cambio: {e}")
        try:
            c, _, t = http("https://api.hacienda.go.cr/indicadores/tc/dolar"); j = json.loads(t)
            fx.update(compra=j["compra"]["valor"], venta=j["venta"]["valor"], fecha=j["venta"]["fecha"], fuente="api.hacienda.go.cr (tipo de cambio BCCR)")
        except Exception as e2: summary["errores"].append(f"Hacienda tipo de cambio: {e2}")
    fx["referencia"] = round(fx["venta"]); fx["verificado"] = True
    if fx != old: save("tipo_cambio.json", fx)
    summary["tipo_cambio"] = {"compra": fx["compra"], "venta": fx["venta"], "fecha": fx["fecha"], "fuente": fx["fuente"], "cambio": fx != old}

def update_rates():
    t = load("tasas.json"); old = json.dumps(t, sort_keys=True); changed = []
    try:
        v, f, n = bccr_indicator(423)
        if t["tbp"].get("valor") != round(v, 2): changed.append("TBP")
        t["tbp"] = {"valor": round(v, 2), "fecha": f, "fuente": "BCCR indicador 423 (Tasa básica pasiva)", "verificado": True}
    except Exception as e: summary["errores"].append(f"TBP: {e}")
    for b in t["bancos"]:
        b["intento_verificacion"] = TODAY
        url, pat = b.get("url_tasas"), b.get("patron")  # patrón regex con un grupo numérico, configurable
        if not url or not pat:
            b["estado_verificacion"] = "sin página/patrón configurado: se conserva el dato reportado"; continue
        try:
            if not allowed(url): b["estado_verificacion"] = "robots.txt no permite"; continue
            c, _, h = http(url, 20); txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h)))
            m = re.search(pat, txt, re.I)
            if c == 200 and m:
                val = float(m.group(1).replace(",", "."))
                if 2 < val < 25:
                    if b.get("crc") != val: changed.append(b["id"])
                    b.update(crc=val, verificado=True, fuente=url, fecha_verificacion=TODAY, estado_verificacion="leído de la página del banco")
                    continue
            b["estado_verificacion"] = f"no se pudo leer (HTTP {c}); se conserva el dato anterior"
        except Exception as e: b["estado_verificacion"] = f"error: {e}"
        time.sleep(A.delay)
    t["fecha_verificacion"] = TODAY if any(b.get("verificado") for b in t["bancos"]) else t.get("fecha_verificacion")
    # solo guardar si cambió algo relevante (ignorar intento_verificacion para idempotencia del commit)
    def core(o): return json.dumps({**o, "bancos": [{k: v for k, v in b.items() if k != "intento_verificacion"} for b in o["bancos"]]}, sort_keys=True)
    if core(t) != core(json.loads(old)): save("tasas.json", t)
    summary["tasas_cambiadas"] = changed

# ---------------- 2. Mercado (Anuntico) ----------------
def median_from(path):
    c, _, h = http("https://anuntico.com" + path); h = html.unescape(h)
    m = re.search(r"mediana\)\s*es\s*₡([\d\s\xa0]+)", h)
    return float(re.sub(r"\D", "", m.group(1))) if (c == 200 and m) else None
def update_market():
    m = load("mercado.json"); old = json.dumps(m, sort_keys=True)
    try:
        for tipo, path in [("Casa", "/casas-venta"), ("Apartamento", "/apartamentos-venta"), ("Lote/Terreno", "/lotes-venta")]:
            v = median_from(path); time.sleep(A.delay)
            if v: m["por_tipo"][tipo]["mediana"] = v
        v = median_from("/lotes-venta/cartago"); time.sleep(A.delay)
        if v: m["por_tipo"]["Lote/Terreno"].setdefault("por_provincia", {})["Cartago"] = v
        for prov, slug in [("San José","san-jose"),("Alajuela","alajuela"),("Cartago","cartago"),("Heredia","heredia"),("Guanacaste","guanacaste"),("Puntarenas","puntarenas"),("Limón","limon")]:
            v = median_from(f"/casas-venta/{slug}"); time.sleep(A.delay)
            if v: m["casas_por_provincia"][prov] = v
        if json.dumps(m, sort_keys=True) != old:
            m["fecha"] = TODAY; save("mercado.json", m)
            # mantener coherente la capa coropleta
            capas = load("capas.json")
            for prov, v in m["casas_por_provincia"].items():
                capas["medians"]["prov"].setdefault(prov, {})["value"] = v
            save("capas.json", capas, compact=True)
        summary["mercado_cambio"] = json.dumps(m, sort_keys=True) != old
    except Exception as e: summary["errores"].append(f"mercado: {e}")

# ---------------- 3. Estado de anuncios ----------------
SOLD = re.compile(r"(propiedad|casa|apartamento|lote|inmueble|anuncio)\s+(ya\s+)?(fue\s+)?vendid[oa]|\bVENDID[OA]\b(?!\s+(por|a)\b)|estado:\s*vendid", re.I)
GONE = re.compile(r"(este anuncio|el anuncio|esta publicaci[oó]n)\s+(ya\s+)?(no est[aá] disponible|ha (sido )?(expirado|eliminad|desactivad)|fue (eliminad|retirad|desactivad))|anuncio (expirado|inactivo)", re.I)
def check(p):
    url = p["url"]; lid = re.sub(r"\D", "", str(p["id"]))[-6:]
    if not allowed(url): return None
    c, final, h = http(url)
    if c in (404, 410): return "retirada"
    if c == 0 or c >= 500 or c == 429: return None  # error transitorio: no cambiar
    if lid and lid not in final: return "retirada"   # redirige a otra página (listado/portada)
    seg = lambda x: urllib.parse.urlparse(x).path.strip("/").split("/")[:2]
    if seg(final) != seg(url): return "retirada"       # redirige a otra sección/país: el anuncio original ya no existe
    t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h)))
    if p["source"] == "encuentra24":
        hh = h.replace('\\"', '"')
        if f'"adId":"{p["id"]}"' not in hh and f'"id":"{p["id"]}"' not in hh: return "retirada"   # la página ya no contiene el anuncio
    if p["source"] == "anuntico":
        if '"RealEstateListing"' not in h: return "retirada"
        if re.search(r'"availability":"https://schema.org/(SoldOut|Discontinued)"', h): return "vendida" if "SoldOut" in h else "retirada"
    head = t[: t.find("Descripción")] if "Descripción" in t else t[:3000]   # solo título/estado, no la descripción libre
    if SOLD.search(head): return "vendida"
    if GONE.search(t): return "retirada"
    return "activa"

def update_listings(props):
    real = [p for p in props if not p.get("demo") and p.get("url")]
    if A.limit_check: real = real[: A.limit_check]
    cnt = {"revisados": 0, "nuevas_vendidas": 0, "nuevas_retiradas": 0, "reactivadas": 0, "sin_cambio_error": 0}
    for i, p in enumerate(real):
        try: st = check(p)
        except Exception as e: st = None; summary["errores"].append(f"check {p['id']}: {e}")
        cnt["revisados"] += 1
        if st is None: cnt["sin_cambio_error"] += 1
        else:
            p["verificado"] = TODAY
            prev = p.get("status", "activa")
            if st != prev:
                p["status"] = st; p["status_fecha"] = TODAY
                if st == "vendida": cnt["nuevas_vendidas"] += 1
                elif st == "retirada": cnt["nuevas_retiradas"] += 1
                else: cnt["reactivadas"] += 1
        if i % 50 == 0: print(f"  revisados {i}/{len(real)}", flush=True)
        time.sleep(A.delay)
    summary["anuncios"] = cnt

# ---------------- 4. Nuevos anuncios Anuntico ----------------
GC = os.path.join(os.path.dirname(__file__), "geocache.json")
def geocode(parts, cache):
    parts = [x for x in parts if x]
    while parts:
        q = ", ".join(parts) + ", Costa Rica"
        if q not in cache:
            u = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(dict(q=q, countrycodes="cr", format="json", limit=1))
            c, _, t = http(u); time.sleep(1.1)
            try: r = json.loads(t); cache[q] = [float(r[0]["lat"]), float(r[0]["lon"])] if r else None
            except Exception: cache[q] = None
        if cache[q]: return cache[q]
        parts = parts[1:]
TYPES = {"casas": "Casa", "apartamentos": "Apartamento", "lotes": "Lote/Terreno", "fincas": "Finca"}
def parse_anuntico(u, h):
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S)
    j = json.loads(blocks[0]); bc = [x.get("name") for x in json.loads(blocks[1]).get("itemListElement", [])] if len(blocks) > 1 else []
    if j.get("@type") != "RealEstateListing": return None
    t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h)))
    g = lambda r: (lambda m: int(re.sub(r"\D", "", m.group(1))) if m else None)(re.search(r, t))
    me, of = j.get("mainEntity", {}), j.get("offers", {})
    tel = re.findall(r"(?:wa\.me/|tel:)\+?(?:506)?(\d{8})", h)
    img = j.get("image"); img = img if isinstance(img, list) else ([img] if img else [])
    p = dict(id="anun-" + str(j.get("identifier")), title=html.unescape(j.get("name") or ""), type=TYPES.get(u.split("/")[1].split("-")[0], "Casa"),
             price=float(of["price"]) if of.get("price") else None, currency=of.get("priceCurrency"),
             province=bc[2] if len(bc) > 2 else None, canton=bc[3] if len(bc) > 3 else None, district=bc[4] if len(bc) > 4 else None,
             beds=me.get("numberOfBedrooms") or g(r"(\d+) Habitaciones"), baths=me.get("numberOfBathroomsTotal") or g(r"(\d+) Baños"),
             garages=g(r"(\d+) Parqueos"), area=g(r"([\d\s\xa0]+) m² Construcción") or (me.get("floorSize") or {}).get("value"),
             lot=g(r"([\d\s\xa0]+) m² Terreno"), agent=(of.get("seller") or {}).get("name"), phone=tel[0] if tel else None,
             images=img[:12], desc=me.get("description"), year=me.get("yearBuilt"), date=j.get("datePosted"),
             url=j.get("url") or "https://anuntico.com" + u, source="anuntico", coord="aproximada", demo=False, status="activa")
    p["location"] = ", ".join(x for x in [p["district"], p["canton"], p["province"]] if x)
    p["amenidades"] = extraer(p)
    return p
def add_new(props):
    have = {p["url"].split("anuntico.com")[-1] for p in props if p.get("source") == "anuntico"}
    cache = json.load(open(GC)) if os.path.exists(GC) else {}
    found = []
    for slug in ["cartago", "san-jose", "heredia", "alajuela", "guanacaste", "puntarenas", "limon"]:
        c, _, h = http(f"https://anuntico.com/casas-venta/{slug}"); time.sleep(A.delay)
        for u in re.findall(r'href="(/(?:casas|apartamentos|lotes|fincas)-venta/[a-z-]+/[^"]+-\d+)"', h):
            if u not in have and u not in found: found.append(u)
    new = []
    for u in found[: A.max_new]:
        c, _, h = http("https://anuntico.com" + u); time.sleep(A.delay)
        try: p = parse_anuntico(u, h)
        except Exception as e: summary["errores"].append(f"nuevo {u}: {e}"); continue
        if not p: continue
        ll = geocode([p["district"], p["canton"], p["province"]], cache)
        if not ll: continue
        p["lat"], p["lon"] = ll; new.append(p)
    json.dump(cache, open(GC, "w"), ensure_ascii=False)
    props[:0] = new
    summary["nuevas"] = len(new); summary["candidatas_nuevas"] = len(found)

# ---------------- 5. Remates y adjudicados ----------------
def update_remates():
    import remates
    try: prev = load("remates.json").get("items", [])
    except Exception: prev = []
    try:
        items, fuentes = remates.build(prev, TODAY, log=lambda *a: summary["errores"].append(" ".join(map(str, a))))
        cache = json.load(open(GC)) if os.path.exists(GC) else {}
        remates.geocode_all(items, cache, lambda u: json.loads(http(u)[2])); json.dump(cache, open(GC, "w"), ensure_ascii=False)
        old_ids = {x["id"] for x in prev}; new_ids = {x["id"] for x in items}
        items.sort(key=lambda x: x["id"])
        newdoc = {"fuentes": fuentes, "items": items}
        try: olddoc = load("remates.json"); olddoc.pop("fecha", None)
        except Exception: olddoc = None
        if newdoc != olddoc: save("remates.json", {"fecha": TODAY, **newdoc}, compact=True)
        summary["remates"] = {"total": len(items), "nuevos": len(new_ids - old_ids), "eliminados_vencidos_o_retirados": len(old_ids - new_ids),
                              "por_fuente": {k: v.get("n") for k, v in fuentes.items()}}
    except Exception as e: summary["errores"].append(f"remates: {e}")

# ---------------- main ----------------
def main():
    before = digest()
    update_fx(); update_rates(); update_market()
    if not A.no_remates: update_remates()
    props = load("propiedades.json"); ps = json.dumps(props, sort_keys=True)
    for p in props:  # amenidades para cualquier anuncio que aún no las tenga
        if "amenidades" not in p: p["amenidades"] = extraer(p)
        p.setdefault("status", "activa")
    if not A.no_listings:
        update_listings(props)
        if A.max_new: add_new(props)
    from clean import clean          # calidad de datos: precios 0/dudosos, moneda, duplicados, puntos apilados
    props, summary["limpieza"] = clean(props, TODAY)
    if json.dumps(props, sort_keys=True) != ps: save("propiedades.json", props, compact=True)
    import seo; summary["paginas_og"] = seo.run()
    changed = digest() != before
    st = {}
    for p in props: st[p.get("status", "activa")] = st.get(p.get("status", "activa"), 0) + 1
    summary.update(total_propiedades=len(props), por_estado=st, datos_cambiaron=changed, fin=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"))
    if changed:
        meta = load("meta.json"); meta["last_updated"] = NOW.isoformat(timespec="seconds").replace("+00:00", "Z")
        meta["ultimo_resumen"] = {k: summary.get(k) for k in ("tipo_cambio", "tasas_cambiadas", "anuncios", "nuevas")}
        save("meta.json", meta)
    json.dump(summary, open(os.path.join(ROOT, "scripts", "last_run.json"), "w"), ensure_ascii=False, indent=1)
    if changed:
        subprocess.run(["git", "-C", ROOT, "add", "data", "p", "sitemap.xml", "scripts/last_run.json", "scripts/geocache.json"], check=True)
        msg = f"Datos {TODAY}: TC {summary['tipo_cambio']['venta']}, vendidas+{summary.get('anuncios',{}).get('nuevas_vendidas',0)}, retiradas+{summary.get('anuncios',{}).get('nuevas_retiradas',0)}, nuevas {summary.get('nuevas',0)}"
        subprocess.run(["git", "-C", ROOT, "commit", "-m", msg], check=True)
        if not A.no_push: subprocess.run(["git", "-C", ROOT, "push"], check=True)
        print("Commit:", msg)
    else: print("Sin cambios en data/: no se hace commit.")
    print(json.dumps(summary, ensure_ascii=False, indent=1))
if __name__ == "__main__": main()
