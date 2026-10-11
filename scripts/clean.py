"""Limpieza de calidad de datos para data/propiedades.json (idempotente).
- precio 0/vacío -> price=None, precio_flag='a_consultar' (fuera de estadísticas)
- USD > 20M -> casi seguro colones marcados como USD: currency='CRC', precio_flag='moneda_corregida'
- precios absurdamente bajos (USD < 5 000 / CRC < 3M; p. ej. precio por m² o alquiler) -> precio_flag='dudoso' (fuera de medianas)
- duplicados (mismo título+precio+coordenada) -> se elimina la copia
- puntos apilados con ubicación aproximada -> pequeño desplazamiento en espiral (lat0/lon0 guardan el original)
- verificación: 'sin verificar' si update.py nunca revisó el anuncio o hace > 14 días
"""
import math, datetime
def clean(props, today=None):
    today = today or datetime.date.today().isoformat()
    st = {"a_consultar": 0, "moneda_corregida": 0, "dudoso": 0, "duplicados": 0, "desplazados": 0, "sin_verificar": 0}
    seen, out = set(), []
    for p in props:
        k = (p.get("title"), p.get("price"), round(p.get("lat0", p.get("lat", 0)), 4), round(p.get("lon0", p.get("lon", 0)), 4))
        if not p.get("demo") and not p.get("mine") and k in seen: st["duplicados"] += 1; continue
        seen.add(k); out.append(p)
        if p.get("demo"): continue
        pr, cur = p.get("price"), p.get("currency")
        if p.get("precio_flag") == "moneda_corregida": st["moneda_corregida"] += 1
        elif not pr or pr <= 0: p["price"] = None; p["precio_flag"] = "a_consultar"; st["a_consultar"] += 1
        elif cur == "USD" and pr > 20_000_000: p["currency"] = "CRC"; p["precio_flag"] = "moneda_corregida"; p["precio_original"] = f"{pr} USD"; st["moneda_corregida"] += 1
        elif (cur == "USD" and pr < 5000) or (cur == "CRC" and pr < 3_000_000): p["precio_flag"] = "dudoso"; st["dudoso"] += 1
        else: p.pop("precio_flag", None)
        v = p.get("verificado")
        if not v or (datetime.date.fromisoformat(today) - datetime.date.fromisoformat(v)).days > 14: p["verificacion"] = "sin verificar"; st["sin_verificar"] += 1
        else: p.pop("verificacion", None)
    groups = {}
    for p in out:
        if p.get("coord") == "exacta" or p.get("mine"): continue
        la, lo = p.setdefault("lat0", p["lat"]), p.setdefault("lon0", p["lon"])
        groups.setdefault((round(la, 4), round(lo, 4)), []).append(p)
    for g in groups.values():
        for i, p in enumerate(g):
            if i == 0: p["lat"], p["lon"] = p["lat0"], p["lon0"]; continue
            a, r = i * 2.39996, 0.0012 * math.sqrt(i)          # espiral de Fermat, ~130 m · √i
            p["lat"] = round(p["lat0"] + r * math.sin(a), 6); p["lon"] = round(p["lon0"] + r * math.cos(a), 6); st["desplazados"] += 1
    return out, st
if __name__ == "__main__":
    import json, os, sys
    f = os.path.join(os.path.dirname(__file__), "..", "data", "propiedades.json")
    d, s = clean(json.load(open(f, encoding="utf-8")))
    json.dump(d, open(f, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":")); print(json.dumps(s), len(d))
