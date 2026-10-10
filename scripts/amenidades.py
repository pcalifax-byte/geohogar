"""Extracción de amenidades por palabras clave (español, sin acentos, sinónimos)."""
import re, unicodedata
CATALOGO = {
 "Casa": {
  "garaje": ["garaje","garage","cochera","parqueo","parqueos","estacionamiento"],
  "terraza_patio_rancho": ["terraza","patio","rancho","balcon"],
  "jardin": ["jardin","areas verdes","area verde","zonas verdes","zona verde"],
  "piscina": ["piscina","alberca","pileta"],
  "bbq": ["bbq","parrilla","asador","barbacoa"],
  "cuarto_servicio_lavado": ["cuarto de servicio","cuarto de pilas","area de pilas","lavanderia","cuarto de lavado","area de lavado","pilas"],
  "bodega": ["bodega"],
  "aire_acondicionado": ["aire acondicionado","a/c","climatizad"],
  "seguridad_alarma": ["alarma","camaras","cctv","sistema de seguridad","cerca electrica"],
  "paneles_solares": ["paneles solares","panel solar","energia solar"],
  "pozo_cisterna": ["pozo","cisterna","tanque de agua","tanque de reserva"],
 },
 "Condominio": {
  "seguridad_24_7": ["seguridad 24","vigilancia 24","24/7","control de acceso","caseta de seguridad","guarda"],
  "piscina_cond": ["piscina"],
  "gimnasio": ["gimnasio","gym"],
  "casa_club": ["casa club","club house","clubhouse","salon de eventos","salon comunal","salon social"],
  "bbq_cond": ["bbq","ranchos","zona de parrillas"],
  "parque_infantil": ["parque infantil","area de juegos","play","juegos infantiles","area infantil"],
  "canchas": ["cancha","canchas"],
  "senderos": ["sendero","senderos"],
  "pet_park": ["pet park","pet friendly","area para mascotas","parque para mascotas"],
  "coworking": ["coworking","co-working","business center","sala de estudio"],
  "parqueo_visitas": ["parqueo de visitas","parqueo para visitas","estacionamiento de visitas"],
  "spa_sauna": ["spa","sauna","jacuzzi","yacuzzi"],
  "rooftop": ["rooftop","roof top","terraza en la azotea","azotea"],
  "cine": ["cine","sala de cine","home theater"],
 }}
ETIQUETAS = {"garaje":"Garaje/cochera","terraza_patio_rancho":"Terraza/patio/rancho","jardin":"Jardín/áreas verdes","piscina":"Piscina","bbq":"BBQ/parrilla",
 "cuarto_servicio_lavado":"Cuarto de servicio/lavado","bodega":"Bodega","aire_acondicionado":"Aire acondicionado","seguridad_alarma":"Seguridad (alarma/cámaras)",
 "paneles_solares":"Paneles solares","pozo_cisterna":"Pozo/cisterna","seguridad_24_7":"Seguridad 24/7 / control de acceso","piscina_cond":"Piscina (condominio)",
 "gimnasio":"Gimnasio","casa_club":"Casa club/salón","bbq_cond":"BBQ (condominio)","parque_infantil":"Parque infantil","canchas":"Canchas","senderos":"Senderos",
 "pet_park":"Pet park","coworking":"Coworking","parqueo_visitas":"Parqueo de visitas","spa_sauna":"Spa/sauna","rooftop":"Rooftop","cine":"Cine"}
def norm(s): return unicodedata.normalize("NFD", str(s or "").lower()).encode("ascii","ignore").decode()
COND = re.compile(r"\b(condominio|residencial cerrado|torre|apartamento|apto)\b")
def extraer(p):
    t = norm(" ".join(str(p.get(k) or "") for k in ("title","desc","descripcion","type")))
    out = []
    if p.get("garages"): out.append("garaje")
    escond = bool(COND.search(t))
    for grupo, items in CATALOGO.items():
        if grupo == "Condominio" and not escond: continue
        for k, kws in items.items():
            if k in out: continue
            if any(re.search(r"(?<![a-z])" + re.escape(norm(w)) + r"(?![a-z])", t) for w in kws): out.append(k)
    # sin duplicar piscina/bbq de casa y condominio
    if "piscina_cond" in out and "piscina" in out: out.remove("piscina")
    if "bbq_cond" in out and "bbq" in out: out.remove("bbq")
    return out
