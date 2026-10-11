"""Genera data/plusvalia.json: cantones (IGN/SNIT, simplificados), densidad de servicios OSM y proyectos públicos citados.
Fuente de límites: IGN · SNIT WFS IGN_5:limitecantonal_5k (versión 20201222), vía github.com/analisis-accion-climatica-adaptacion/mapa-medidas-x-canton-web."""
import json, math, sys
SRC = sys.argv[1]; ROOT = __file__.rsplit('/scripts/', 1)[0]
g = json.load(open(SRC)); capas = json.load(open(ROOT + '/data/capas.json'))
def dp(pts, eps):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dy) or 1e-12; mi, md = 0, 0
    for i in range(1, len(pts)-1):
        d = abs(dy*pts[i][0] - dx*pts[i][1] + b[0]*a[1] - b[1]*a[0]) / L
        if d > md: mi, md = i, d
    return dp(pts[:mi+1], eps)[:-1] + dp(pts[mi:], eps) if md > eps else [a, b]
def rings(geom):
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    out = []
    for p in polys:
        ring = p[0]; k = max(range(len(ring)), key=lambda i: (ring[i][0]-ring[0][0])**2 + (ring[i][1]-ring[0][1])**2)
        r = dp(ring[:k+1], 0.002)[:-1] + dp(ring[k:], 0.002)
        if len(r) >= 4: out.append([[round(x, 4), round(y, 4)] for x, y in r])
    return out
def inside(x, y, rs):
    c = False
    for r in rs:
        j = len(r)-1
        for i in range(len(r)):
            xi, yi = r[i]; xj, yj = r[j]
            if (yi > y) != (yj > y) and x < (xj-xi)*(y-yi)/(yj-yi)+xi: c = not c
            j = i
    return c
K = ['hospital', 'supermarket', 'mall', 'tren']
# Proyectos: solo hechos citados. puntos = aporte al componente de infraestructura del cantón.
PROY = [
 {"id": "tibi", "nombre": "Tren Eléctrico de Pasajeros GAM (TIBI): Paraíso–San José–Alajuela", "estado": "financiado, en contratación",
  "hecho": "Ley de financiamiento firmada el 25 may 2026. Diseño/obras desde 2028 y operación completa proyectada para 2031; 51,9 km sobre la vía férrea existente (que será sustituida).",
  "puntos": 50, "cantones_por": "cantones con estaciones de tren actuales (OSM) en la línea Paraíso–San José–Alajuela",
  "fuentes": [["INCOFER: Ley de financiamiento firmada (25 may 2026)", "https://www.incofer.go.cr/ley-de-financiamiento-para-el-tren-electrico-de-pasajeros-ya-esta-firmada/"], ["INCOFER: Tren Eléctrico GAM", "https://www.incofer.go.cr/incofer/proyectos-estrategicos/tren-electrico-gam/"], ["La Nación: cronograma del Tibi", "https://www.nacion.com/el-pais/tren-electrico-proximo-mes-inicia-proceso-clave/AE4DYJOAZJFOHPZCGYROKESWYU/story/"]]},
 {"id": "r32", "nombre": "Ampliación Ruta 32 a 4 carriles (Río Frío–Limón)", "estado": "tronco principal terminado; obras complementarias",
  "hecho": "Tronco principal a cuatro carriles completado; pendientes pasos elevados y puentes peatonales (Conavi relanzó licitaciones). El PND 2027–2030 prevé 10 pasos a desnivel hacia 2030.",
  "puntos": 45, "cantones": ["Pococí", "Guácimo", "Siquirres", "Matina", "Limón"],
  "fuentes": [["La Nación: Conavi relanza concursos en ruta 32", "https://www.nacion.com/el-pais/conavi-vuelve-a-lanzar-concursos-para-4-pasos/H3SQVWVLNBDCJJYVE7SA3D6DPM/story/"], ["El Observador: CGR y pasos a desnivel ruta 32 (11 set 2026)", "https://observador.cr/contraloria-ordena-a-conavi-atender-escenarios-de-riesgo-en-seguridad-vial-en-la-construccion-de-rotondas-sobre-ruta-32/"]]},
 {"id": "circ", "nombre": "Circunvalación Norte (La Uruca–Calle Blancos)", "estado": "inaugurada (oct 2024)",
  "hecho": "Inaugurada en octubre de 2024; obras marginales terminadas en febrero de 2025. El MOPT estudia un cuarto nivel con Ruta 32 (sin fecha).",
  "puntos": 40, "cantones": ["San José", "Tibás", "Goicoechea"],
  "fuentes": [["Teletica (29 jul 2026)", "https://www.teletica.com/nacional/conavi-debera-pagar-casi-7-mil-millones-a-h-solisla-estrella-por-atrasos-en-circunvalacion_414447"], ["El Observador: unidades funcionales y fechas", "https://observador.cr/conavi-compensara-a-h-solis-con-1-6-millones-por-extension-de-plazo-de-circunvalacion-norte/"]]},
 {"id": "hcartago", "nombre": "Nuevo Hospital Max Peralta (CCSS), El Guarco", "estado": "planificado con fecha",
  "hecho": "CCSS: primera piedra en junio de 2027 y entrega en el segundo semestre de 2030; 457 camas, inversión de $398 millones.",
  "puntos": 45, "cantones": ["El Guarco"],
  "fuentes": [["El Observador: anuncio de la CCSS", "https://observador.cr/entrega-del-hospital-de-cartago-estara-para-segundo-semestre-de-2030-primera-piedra-se-colocara-en-2027-anuncia-ccss/"], ["CR Hoy: terreno apto en El Guarco", "https://crhoy.com/nacionales/presidenta-de-ccss-cuestiona-a-criticos-del-terreno-para-nuevo-hospital-de-cartago/"]]},
 {"id": "hpunt", "nombre": "Nuevo Hospital Monseñor Sanabria (CCSS), Barranca", "estado": "inaugurado (31 ene 2025)",
  "hecho": "Inaugurado el 31 de enero de 2025 en Barranca; 75.000 m², inversión de $225 millones.",
  "puntos": 40, "cantones": ["Puntarenas"],
  "fuentes": [["El Norte Hoy (31 ene 2025)", "https://elnortehoycr.com/2025/01/31/un-sueno-hecho-realidad-puntarenenses-inauguraron-nuevo-hospital/"]]},
]
TIBI = {"Paraíso", "Cartago", "La Unión", "Curridabat", "Montes de Oca", "San José", "Tibás", "Santo Domingo", "Heredia", "Flores", "San Pablo", "Alajuela", "Goicoechea"}
fs = []
for f in g['features']:
    p = f['properties']; rs = rings(f['geometry'])
    cnt = {k: 0 for k in K}; tren = 0
    for q in capas['pois']:
        if inside(q['lon'], q['lat'], rs): cnt[q['k']] += 1
    fs.append({"type": "Feature", "properties": {"cod": p['cod_canton'], "canton": p['canton'], "provincia": p['provincia'], "km2": p['area'], "poi": cnt}, "geometry": {"type": "MultiPolygon", "coordinates": [[r] for r in rs]}})
names = {f['properties']['canton'] for f in fs}
for pr in PROY:
    if pr['id'] == 'tibi': pr['cantones'] = sorted(f['properties']['canton'] for f in fs if f['properties']['poi']['tren'] and f['properties']['canton'] in TIBI)
    miss = [c for c in pr['cantones'] if c not in names]; assert not miss, miss
# Servicios: densidad ponderada por km² (log), percentil 0–100
W = {'hospital': 3, 'mall': 1, 'supermarket': 1, 'tren': 2}
dens = [(math.log1p(sum(W[k]*f['properties']['poi'][k] for k in K) / max(f['properties']['km2'], 1) * 100), f) for f in fs]
orden = sorted(d for d, _ in dens)
for d, f in dens:
    f['properties']['serv'] = round(100 * sum(1 for x in orden if x < d) / (len(orden) - 1)) if d > 0 else 0
    f['properties']['infra'] = min(100, sum(pr['puntos'] for pr in PROY if f['properties']['canton'] in pr['cantones']))
    f['properties']['proy'] = [pr['id'] for pr in PROY if f['properties']['canton'] in pr['cantones']]
out = {"version": "2026-10-11", "pesos": {"servicios": 0.40, "infraestructura": 0.35, "mercado": 0.25},
 "limites": "IGN · SNIT (límite cantonal 1:5000, versión 2020-12-22; 82 cantones, no incluye Monteverde ni Puerto Jiménez, creados después)",
 "osm": "Puntos de interés de OpenStreetMap ya incluidos en MapMarket (hospitales, supermercados, centros comerciales, estaciones de tren). No incluye escuelas.",
 "proyectos": PROY, "cantones": {"type": "FeatureCollection", "features": fs}}
s = json.dumps(out, ensure_ascii=False, separators=(',', ':')); open(ROOT + '/data/plusvalia.json', 'w').write(s); print(len(s), 'bytes', len(fs), 'cantones')
for pr in PROY: print(pr['id'], pr['cantones'])
