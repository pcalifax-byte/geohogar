"""Genera páginas estáticas p/<id>.html con Open Graph por anuncio (para vista previa al compartir por WhatsApp/redes) y sitemap.xml.
GitHub Pages es estático y los rastreadores no ejecutan JS, por eso cada anuncio tiene su HTML mínimo que redirige al mapa."""
import json, os, html, re
ROOT = os.path.join(os.path.dirname(__file__), "..")
SITE = "https://pcalifax-byte.github.io/geohogar/"
def precio(p):
    if not p.get("price"): return "Precio a consultar"
    s = "₡" if p.get("currency") == "CRC" else "$"
    return s + f"{round(p['price']):,}".replace(",", ".")
def run():
    props = json.load(open(os.path.join(ROOT, "data", "propiedades.json"), encoding="utf-8"))
    out = os.path.join(ROOT, "p"); os.makedirs(out, exist_ok=True)
    keep = set()
    for p in props:
        if p.get("demo") or p.get("status") in ("retirada",): continue
        pid = re.sub(r"[^A-Za-z0-9_-]", "", str(p["id"]))[:64]
        if not pid: continue
        keep.add(pid + ".html")
        t = html.escape(f"{p.get('title','Propiedad')} · {precio(p)}"[:140]); E = lambda s: html.escape(str(s or ""), quote=True)
        desc = E(f"{p.get('type','')} en {p.get('location') or p.get('province','Costa Rica')}. {(p.get('desc') or '')[:150]}".strip())
        img = (p.get("images") or [None])[0]; img = img if img and str(img).startswith("https://") else SITE + "icons/og.png"
        url = SITE + "p/" + pid + ".html"; dest = "../index.html?p=" + pid
        doc = f'''<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{t} · MapMarket</title>
<meta name="description" content="{desc}"><link rel="canonical" href="{url}"><meta name="robots" content="noindex,follow">
<meta property="og:type" content="website"><meta property="og:site_name" content="MapMarket"><meta property="og:title" content="{t}"><meta property="og:description" content="{desc}"><meta property="og:image" content="{E(img)}"><meta property="og:url" content="{url}"><meta property="og:locale" content="es_CR">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{t}"><meta name="twitter:description" content="{desc}"><meta name="twitter:image" content="{E(img)}">
<meta http-equiv="refresh" content="0;url={dest}"><script>location.replace("{dest}"+location.hash)</script></head>
<body style="font-family:sans-serif;padding:24px"><h1>{t}</h1><p>{desc}</p><p><a href="{dest}">Ver en el mapa de MapMarket</a></p></body></html>'''
        f = os.path.join(out, pid + ".html")
        if not os.path.exists(f) or open(f, encoding="utf-8").read() != doc: open(f, "w", encoding="utf-8").write(doc)
    for f in os.listdir(out):
        if f.endswith(".html") and f not in keep: os.remove(os.path.join(out, f))
    pages = ["index.html", "planes.html", "guias.html", "login.html", "privacidad.html", "terminos.html", "eliminar-cuenta.html"]
    sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(f"<url><loc>{SITE}{p}</loc></url>\n" for p in pages) + "</urlset>\n"
    open(os.path.join(ROOT, "sitemap.xml"), "w").write(sm)
    return len(keep)
if __name__ == "__main__": print(run(), "páginas OG")
