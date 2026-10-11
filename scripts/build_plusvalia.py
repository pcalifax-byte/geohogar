"""Genera data/plusvalia.json: cantones (IGN/SNIT, simplificados), densidad de servicios OSM y proyectos públicos citados.
Fuente de límites: IGN · SNIT WFS IGN_5:limitecantonal_5k (versión 20201222), vía github.com/analisis-accion-climatica-adaptacion/mapa-medidas-x-canton-web."""
import json, math, sys
SRC = sys.argv[1]; ROOT = __file__.rsplit('/scripts/', 1)[0]
g = json.load(open(SRC)); POIS = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else json.load(open(ROOT + '/data/capas.json'))['pois']
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
K = ['hospital', 'supermarket', 'mall', 'tren', 'school']
# Proyectos: solo hechos citados. puntos = aporte al componente de infraestructura del cantón.
PROY = [
 {"id": "tibi", "cat": "transporte", "nombre": "Tren Eléctrico de Pasajeros GAM (TIBI): Paraíso–San José–Alajuela", "estado": "financiado, en contratación",
  "hecho": "Ley de financiamiento firmada el 25 may 2026. Diseño/obras desde 2028 y operación completa proyectada para 2031; 51,9 km sobre la vía férrea existente (que será sustituida).",
  "puntos": 50, "cantones_por": "cantones con estaciones de tren actuales (OSM) en la línea Paraíso–San José–Alajuela",
  "fuentes": [["INCOFER: Ley de financiamiento firmada (25 may 2026)", "https://www.incofer.go.cr/ley-de-financiamiento-para-el-tren-electrico-de-pasajeros-ya-esta-firmada/"], ["INCOFER: Tren Eléctrico GAM", "https://www.incofer.go.cr/incofer/proyectos-estrategicos/tren-electrico-gam/"], ["La Nación: cronograma del Tibi", "https://www.nacion.com/el-pais/tren-electrico-proximo-mes-inicia-proceso-clave/AE4DYJOAZJFOHPZCGYROKESWYU/story/"]]},
 {"id": "r32", "cat": "transporte", "nombre": "Ampliación Ruta 32 a 4 carriles (Río Frío–Limón)", "estado": "tronco principal terminado; obras complementarias",
  "hecho": "Tronco principal a cuatro carriles completado; pendientes pasos elevados y puentes peatonales (Conavi relanzó licitaciones). El PND 2027–2030 prevé 10 pasos a desnivel hacia 2030.",
  "puntos": 45, "cantones": ["Pococí", "Guácimo", "Siquirres", "Matina", "Limón"],
  "fuentes": [["La Nación: Conavi relanza concursos en ruta 32", "https://www.nacion.com/el-pais/conavi-vuelve-a-lanzar-concursos-para-4-pasos/H3SQVWVLNBDCJJYVE7SA3D6DPM/story/"], ["El Observador: CGR y pasos a desnivel ruta 32 (11 set 2026)", "https://observador.cr/contraloria-ordena-a-conavi-atender-escenarios-de-riesgo-en-seguridad-vial-en-la-construccion-de-rotondas-sobre-ruta-32/"]]},
 {"id": "circ", "cat": "transporte", "nombre": "Circunvalación Norte (La Uruca–Calle Blancos)", "estado": "inaugurada (oct 2024)",
  "hecho": "Inaugurada en octubre de 2024; obras marginales terminadas en febrero de 2025. El MOPT estudia un cuarto nivel con Ruta 32 (sin fecha).",
  "puntos": 40, "cantones": ["San José", "Tibás", "Goicoechea"],
  "fuentes": [["Teletica (29 jul 2026)", "https://www.teletica.com/nacional/conavi-debera-pagar-casi-7-mil-millones-a-h-solisla-estrella-por-atrasos-en-circunvalacion_414447"], ["El Observador: unidades funcionales y fechas", "https://observador.cr/conavi-compensara-a-h-solis-con-1-6-millones-por-extension-de-plazo-de-circunvalacion-norte/"]]},
 {"id": "hcartago", "cat": "salud", "nombre": "Nuevo Hospital Max Peralta (CCSS), El Guarco", "estado": "planificado con fecha",
  "hecho": "CCSS: primera piedra en junio de 2027 y entrega en el segundo semestre de 2030; 457 camas, inversión de $398 millones.",
  "puntos": 45, "cantones": ["El Guarco"],
  "fuentes": [["El Observador: anuncio de la CCSS", "https://observador.cr/entrega-del-hospital-de-cartago-estara-para-segundo-semestre-de-2030-primera-piedra-se-colocara-en-2027-anuncia-ccss/"], ["CR Hoy: terreno apto en El Guarco", "https://crhoy.com/nacionales/presidenta-de-ccss-cuestiona-a-criticos-del-terreno-para-nuevo-hospital-de-cartago/"]]},
 {"id": "hpunt", "cat": "salud", "nombre": "Nuevo Hospital Monseñor Sanabria (CCSS), Barranca", "estado": "inaugurado (31 ene 2025)",
  "hecho": "Inaugurado el 31 de enero de 2025 en Barranca; 75.000 m², inversión de $225 millones.",
  "puntos": 40, "cantones": ["Puntarenas"],
  "fuentes": [["El Norte Hoy (31 ene 2025)", "https://elnortehoycr.com/2025/01/31/un-sueno-hecho-realidad-puntarenenses-inauguraron-nuevo-hospital/"]]},
 {"id": "sjsr", "cat": "transporte", "nombre": "Corredor San José–San Ramón (Ruta 1) y radial Río Segundo", "estado": "financiado, en licitación",
  "hecho": "Ley con créditos por $770 millones (BCIE y OPEC Fund) firmada el 14 abr 2026; 55,6 km de La Sabana a San Ramón y 4,45 km Río Segundo–Belén. El MOPT prevé adjudicar a inicios de 2027; la vía completa podría operar a finales de 2031.",
  "puntos": 40, "cantones": ["San José", "Belén", "Alajuela", "Grecia", "Naranjo", "Palmares", "San Ramón"],
  "fuentes": [["MOPT: firma de la ley (14 abr 2026)", "https://www.mopt.go.cr/noticias/2026/presidente-firma-ley-para-ampliar-el-corredor-vial-san-jose-san-ramon"], ["La Nación: cartel y cronograma", "https://www.nacion.com/el-pais/cartel-para-ampliacion-de-via-entre-san-jose-y-san/AZHEJANGTJDKZONFFKABYTVFY4/story/"]]},
 {"id": "bl", "cat": "transporte", "nombre": "Ampliación Ruta 1 Barranca–Limonal (4 carriles, 49 km)", "estado": "en construcción",
  "hecho": "MOPT: 20% de avance general al 24 jul 2026; orden de inicio en enero de 2026 con plazo de 24 meses; conclusión prevista para enero de 2028.",
  "puntos": 60, "cantones": ["Puntarenas", "Abangares"],
  "fuentes": [["MOPT: 20% de avance (24 jul 2026)", "https://www.mopt.go.cr/noticias/2026/ampliacion-y-rehabilitacion-de-barranca-limonal-alcanza-un-20-de-avance"], ["Monumental: lista en enero de 2028", "https://www.monumental.co.cr/2026/07/29/ampliacion-de-la-ruta-barranca-limonal-estaria-lista-en-enero-de-2028/"]]},
 {"id": "sancarlos", "cat": "transporte", "nombre": "Nueva carretera a San Carlos (Ruta 35): punta sur y tramo central", "estado": "punta sur en construcción; tramo central por iniciar",
  "hecho": "Punta sur (8,2 km) con 15% de avance. La Contraloría avaló en jun 2026 el contrato con CHEC para el tramo central (29 km, Sifón–La Abundancia); el MOPT prevé iniciar en el primer trimestre de 2027.",
  "puntos": 55, "cantones": ["San Carlos", "San Ramón"],
  "fuentes": [["La Nación: inicio del tramo central", "https://www.nacion.com/el-pais/mopt-anuncia-inicio-de-obras-en-tramo-central-de/E7W2TXS3H5CCFPKS5CJUWUWAR4/story/"], ["La República: aval de la Contraloría (19 jun 2026)", "https://www.larepublica.net/noticia/tramo-central-de-nueva-ruta-a-san-carlos-recibe-aval-de-contraloria-para-que-chec-construya-obra"]]},
 {"id": "aijs", "cat": "transporte", "nombre": "Expansión del Aeropuerto Juan Santamaría", "estado": "en ejecución",
  "hecho": "Programa de expansión de casi $400 millones; primera fase (nueva área de llegadas de 3.800 m²) inaugurada en 2026; parqueo y hotel de 175 habitaciones previstos para 2027.",
  "puntos": 40, "cantones": ["Alajuela"],
  "fuentes": [["CR Hoy: expansión del Juan Santamaría", "https://crhoy.com/nacionales/expansion-del-juan-santamaria-sepulta-proyecto-de-aeropuerto-en-orotina/"], ["El Sol de Occidente: nueva área de llegadas", "https://elsoldeoccidente.com/cantonales/alajuela/orotina-se-perfila-como-terminal-aerea-de-carga-ante-saturacion-logistica/"]]},
 {"id": "liberia", "cat": "transporte", "nombre": "Aeropuerto Daniel Oduber (Liberia): ampliación de plataforma", "estado": "en construcción",
  "hecho": "MOPT: obras iniciadas el 24 jun 2026 (20.000 m², ~₡3.000 millones), en servicio antes de fin de 2026. Plan maestro prevé crecimiento de 4,5% anual de pasajeros hasta 2040.",
  "puntos": 40, "cantones": ["Liberia"],
  "fuentes": [["MOPT: inicio de obras (24 jun 2026)", "https://www.mopt.go.cr/noticias/2026/inician-obras-de-ampliacion-de-la-plataforma-de-estacionamiento-de-aeronaves-en-el"], ["MOPT: licitación (8 ago 2025)", "https://www.mopt.go.cr/noticias/2025/mopt-cumple-con-guanacaste"]]},
 {"id": "caldera", "cat": "transporte", "nombre": "Modernización de Puerto Caldera", "estado": "adjudicado; obras previstas 2027",
  "hecho": "La Contraloría rechazó las apelaciones (jul 2026); INCOP prevé firmar la concesión (30 años, más de $600 millones) en diciembre de 2026 e iniciar obras en el segundo semestre de 2027.",
  "puntos": 40, "cantones": ["Esparza"],
  "fuentes": [["El Observador: obras desde octubre de 2027", "https://observador.cr/tras-aval-de-la-contraloria-obras-para-modernizar-puerto-caldera-arrancarian-en-octubre-de-2027/"], ["Teletica: anuncio del INCOP", "https://www.teletica.com/politica/ampliacion-de-puerto-de-caldera-iniciara-en-un-ano-anuncia-incop_418313"], ["Delfino.cr: Contraloría rechaza apelaciones", "https://delfino.cr/2026/07/contraloria-rechaza-apelaciones-y-despeja-el-camino-para-la-modernizacion-de-puerto-caldera"]]},
 {"id": "hlimon", "cat": "salud", "nombre": "Nuevo Hospital Tony Facio (CCSS), Limón", "estado": "en licitación (sin adjudicar)",
  "hecho": "La primera licitación quedó sin ofertas; la CCSS relanzó un concurso en 2026 y la Contraloría pidió ajustar el pliego. El plan oficial prevé el proyecto aún en desarrollo en 2030.",
  "puntos": 15, "cantones": ["Limón"],
  "fuentes": [["El Observador: nueva licitación", "https://observador.cr/ccss-modifica-cartel-del-hospital-de-limon-tras-fracaso-en-licitacion-nuevo-concurso-saldra-a-finales-de-julio/"], ["Monumental: en desarrollo para 2030", "https://www.monumental.co.cr/2026/08/28/gobierno-proyecta-que-nuevo-hospital-de-limon-aun-este-en-desarrollo-para-el-2030/"]]},
 {"id": "zfcartago", "cat": "empleo", "nombre": "Zona Franca La Lima (Cartago): nuevas empresas", "estado": "en expansión",
  "hecho": "Seis nuevas empresas en 2026 con más de $173 millones de inversión y unos 2.060 empleos.",
  "puntos": 30, "cantones": ["Cartago"],
  "fuentes": [["La Nación: más de 2.000 empleos en zona franca de Cartago", "https://www.nacion.com/economia/mas-de-2000-empleos-seis-nuevas-empresas-llegaran/W2BOR7YYUZFJDMDSVJYPNIKI74/story/"]]},
 {"id": "zfsancarlos", "cat": "empleo", "nombre": "Norte Free Zone Park (Ciudad Quesada)", "estado": "en operación (desde jun 2025)",
  "hecho": "Nueva zona franca en San Carlos que inició operaciones en junio de 2025 con empresas de agronegocios, turismo y tecnología.",
  "puntos": 25, "cantones": ["San Carlos"],
  "fuentes": [["La Nación: nueva zona franca en San Carlos", "https://www.nacion.com/economia/negocios/nueva-zona-franca-abre-en-san-carlos-y-ya-atrae-a/3RQNVHLSGZARNNESRYZ73RN26U/story/"]]},
 {"id": "zfgrecia", "cat": "empleo", "nombre": "Evolution Free Zone (Grecia)", "estado": "en operación y crecimiento",
  "hecho": "Parque de zona franca con empresas de ciencias de la vida y el primer centro del INA dentro de una zona franca.",
  "puntos": 25, "cantones": ["Grecia"],
  "fuentes": [["Periódico Mi Tierra: Evolution Free Zone", "https://periodicomitierra.com/actualidad/evolution-free-zone-es-el-primer-parque-de-zona-franca-en-costa-rica-con-un-centro-del"]]},
 {"id": "zfcoyol", "cat": "empleo", "nombre": "InnovaPark, El Coyol (Alajuela)", "estado": "inaugurado",
  "hecho": "Nuevo parque de zona franca de 63 hectáreas para manufactura y logística en El Coyol.",
  "puntos": 25, "cantones": ["Alajuela"],
  "fuentes": [["El Financiero: InnovaPark suma 63 hectáreas", "https://www.elfinancierocr.com/negocios/el-coyol-suma-63-hectareas-para-manufactura-y/YVEP6Y3FKRC37BI5TDJFEYFLXE/story/"], ["La Nación: Cuestamoras inaugura parque", "https://www.nacion.com/economia/cuestamoras-inaugura-parque-de-zona-franca-de-63/QRP3FHZNGVEENPQVE5R6XTI4KQ/story/"]]},
 {"id": "orotina", "cat": "transporte", "nombre": "Aeropuerto Metropolitano de Orotina", "estado": "descartado (pasajeros); carga en estudio preliminar",
  "hecho": "El Gobierno descartó en 2026 la terminal de pasajeros; el MOPT menciona un plan aún 'prematuro' de terminal de carga. Sin puntos hasta que haya un proyecto con fecha y financiamiento.",
  "puntos": 0, "cantones": ["Orotina"],
  "fuentes": [["Teletica (21 may 2026)", "https://www.teletica.com/nacional/gobierno-descarta-aeropuerto-de-pasajeros-en-orotina-pero-analiza-opcion-de-carga_409227"], ["CR Hoy: rezago de obras viales", "https://crhoy.com/nacionales/rezago-en-obras-viales-acabo-con-atractivo-de-aeropuerto-en-orotina/"]]},

]
TIBI = {"Paraíso", "Cartago", "La Unión", "Curridabat", "Montes de Oca", "San José", "Tibás", "Santo Domingo", "Heredia", "Flores", "San Pablo", "Alajuela", "Goicoechea"}
fs = []
for f in g['features']:
    p = f['properties']; rs = rings(f['geometry'])
    cnt = {k: 0 for k in K}; tren = 0
    for q in POIS:
        if inside(q['lon'], q['lat'], rs): cnt[q['k']] += 1
    fs.append({"type": "Feature", "properties": {"cod": p['cod_canton'], "canton": p['canton'], "provincia": p['provincia'], "km2": p['area'], "poi": cnt}, "geometry": {"type": "MultiPolygon", "coordinates": [[r] for r in rs]}})
names = {f['properties']['canton'] for f in fs}
for pr in PROY:
    if pr['id'] == 'tibi': pr['cantones'] = sorted(f['properties']['canton'] for f in fs if f['properties']['poi']['tren'] and f['properties']['canton'] in TIBI)
    miss = [c for c in pr['cantones'] if c not in names]; assert not miss, miss
# Servicios: densidad ponderada por km² (log), percentil 0–100
W = {'hospital': 3, 'mall': 1, 'supermarket': 1, 'tren': 2, 'school': 0.5}
dens = [(math.log1p(sum(W[k]*f['properties']['poi'][k] for k in K) / max(f['properties']['km2'], 1) * 100), f) for f in fs]
orden = sorted(d for d, _ in dens)
for d, f in dens:
    f['properties']['serv'] = round(100 * sum(1 for x in orden if x < d) / (len(orden) - 1)) if d > 0 else 0
    f['properties']['infra'] = min(100, sum(pr['puntos'] for pr in PROY if f['properties']['canton'] in pr['cantones']))
    f['properties']['proy'] = [pr['id'] for pr in PROY if f['properties']['canton'] in pr['cantones']]
out = {"version": "2026-10-11", "pesos": {"servicios": 0.40, "infraestructura": 0.35, "mercado": 0.25},
 "limites": "IGN · SNIT (límite cantonal 1:5000, versión 2020-12-22; 82 cantones, no incluye Monteverde ni Puerto Jiménez, creados después)",
 "osm": "© colaboradores de OpenStreetMap (ODbL), extracto nacional de Geofabrik del " + __import__("datetime").date.today().isoformat() + ": hospitales, supermercados, centros comerciales, estaciones de tren y centros educativos.",
 "proyectos": PROY, "cantones": {"type": "FeatureCollection", "features": fs}}
s = json.dumps(out, ensure_ascii=False, separators=(',', ':')); open(ROOT + '/data/plusvalia.json', 'w').write(s); print(len(s), 'bytes', len(fs), 'cantones')
for pr in PROY: print(pr['id'], pr['cantones'])
