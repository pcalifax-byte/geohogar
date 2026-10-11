"""Precios históricos (fuentes oficiales/públicas) -> se agrega a data/plusvalia.json como 'historicos'.
1) ONT / Ministerio de Hacienda: Mapas de Valores de Terrenos por Zonas Homogéneas (PDF públicos por cantón,
   https://www.hacienda.go.cr/docs/<año>_<cantón>_PVTZH.pdf). Se extrae la matriz 'VALOR (₡/m²)' de cada zona
   (U=urbana, R=rural) y se resume por cantón (mediana, p25-p75). Ediciones con matriz escaneada (sin texto) se omiten.
   Uso: python3 scripts/build_precios_historicos.py <carpeta_pdfs>
2) INEC, Estadísticas de la Construcción 2024 (cuadro 3.2): área total con permiso (m²) por provincia 2023-2024.
Son valores fiscales de referencia para impuesto de bienes inmuebles (no precios de venta) y no entran al puntaje."""
import sys, glob, os, json, statistics
sys.path.insert(0, os.path.dirname(__file__)); from ont_parse import parse
src = sys.argv[1]; ont = {}
for pdf in sorted(glob.glob(os.path.join(src, '*_PVTZH.pdf'))):
    y, c, _ = os.path.basename(pdf).split('_'); r = parse(pdf)
    U = [v for k, v in r if '-U' in k and 0 < v < 5_000_000]; R = [v for k, v in r if '-R' in k and 0 < v < 5_000_000]
    if len(U) < 3: continue
    um = statistics.median(U); rm = statistics.median(R) if R else None
    if rm and rm > um: rm = None  # extracción dudosa
    q = statistics.quantiles(U, n=4)
    ont.setdefault(c, []).append({'anio': int(y), 'zonas': len(r), 'u_med': int(um), 'u_p25': int(q[0]), 'u_p75': int(q[2]), 'r_med': int(rm) if rm else None,
                                  'url': f'https://www.hacienda.go.cr/docs/{y}_{c}_PVTZH.pdf'})
for c in ont:
    e = sorted(ont[c], key=lambda x: x['anio']); ont[c] = {'ediciones': e}
    if len(e) > 1 and e[-1]['anio'] > e[0]['anio']:
        a, b = e[0], e[-1]; ont[c]['var_anual'] = round(((b['u_med'] / a['u_med']) ** (1 / (b['anio'] - a['anio'])) - 1) * 100, 1)
inec = {'San José': [722494, 687227], 'Alajuela': [839005, 824806], 'Cartago': [321220, 455972], 'Heredia': [372173, 377135],
        'Guanacaste': [749135, 644837], 'Puntarenas': [508953, 504268], 'Limón': [179105, 190409]}
H = {'ont': ont, 'inec_permisos_m2': {'anios': [2023, 2024], 'provincias': inec,
     'fuente': ['INEC, Estadísticas de la Construcción 2024 (cuadro 3.2)', 'https://admin.inec.cr/sites/default/files/2025-11/reestconstruccion2024.pdf']},
     'fuente_ont': ['Ministerio de Hacienda – Órgano de Normalización Técnica (ONT): Mapas de Valores de Terrenos por Zonas Homogéneas', 'https://www.hacienda.go.cr/']}
p = 'data/plusvalia.json'; d = json.load(open(p)); d['historicos'] = H
json.dump(d, open(p, 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(ont), 'cantones con valores ONT;', sum('var_anual' in v for v in ont.values()), 'con tendencia')
