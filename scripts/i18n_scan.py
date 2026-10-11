#!/usr/bin/env python3
"""Escanea textos visibles en español (HTML + JS) y reporta los que faltan en data/i18n/en.json.
Uso: python3 scripts/i18n_scan.py [--dump]  → imprime faltantes; exit 1 si hay alguno."""
import re, json, sys, glob, html, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = [f for f in glob.glob(ROOT + '/*.html') if not f.endswith('/googleXXXX.html')] + [f for f in glob.glob(ROOT + '/js/*.js') if not f.endswith(('config.js', 'i18n.js'))]
SKIP = re.compile(r'^(https?:|mailto:|tel:|data:|#|\.|/|[\w-]+\.(html|json|js|png|jpg|css)\b)')
ES = re.compile(r'[A-Za-zÁÉÍÓÚÑáéíóúñ¿¡]{2,}')
def norm(s):
    s = html.unescape(re.sub(r'\s+', ' ', s)).strip()
    return s
def candidates(src, is_js):
    out = set()
    # quitar <script src> y estilos
    src = re.sub(r'<style[\s\S]*?</style>', ' ', src)
    # texto entre etiquetas
    for m in re.finditer(r'>([^<>]+)<', src):
        t = m.group(1)
        for part in re.split(r'\$\{[^}]*\}', t):
            out.add(norm(part))
    # atributos visibles
    for m in re.finditer(r'(?:placeholder|title|aria-label|alt|content)="([^"]+)"', src):
        out.add(norm(m.group(1)))
    # literales JS
    for m in re.finditer(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"|`((?:[^`\\]|\\.)*)`", src):
        t = next(g for g in m.groups() if g is not None)
        t = re.sub(r'<[^>]+>', '\n', t)
        for part in re.split(r'\$\{(?:[^{}]|\{[^}]*\})*\}|\n', t):
            out.add(norm(part.replace("\\'", "'")))
    # todas las porciones entre comillas consecutivas (ambas paridades) para no depender del emparejado
    for q in "'\"`":
        for t in src.split(q):
            if len(t) > 400: continue
            t = re.sub(r'<[^>]+>', '\n', t)
            for part in re.split(r'\$\{(?:[^{}]|\{[^}]*\})*\}|\n', t):
                part = norm(part).lstrip('> ').split('<')[0].strip()
                if re.search(r'^[,)+:;.\]}(*/]|\+|\w\(|=|\$\(|\b[pxbuis]\.\w|\]\s*$|/\\b|\[\'|\*/', part): continue
                out.add(part)
    return out
STOP = re.compile(r'(^|\s)(de|la|el|que|y|en|con|del|los|las|para|por|tu|un|una|al|se|no|sin|o|a|más|si|es|lo|le|ya)(\s|$|[.,;:)])', re.I)
CODE = re.compile(r"=>|\bfunction\b|\bconst\b|\blet\b|\.then\(|document\.|\(\)|class=|^\w+\(|rgba?\(|var\(|'\+|\+'|\)\.join|\?\.|\|\||&&|\bthis\.|\bUI\.|\\u|\$\{|==|\breturn\b|\.(map|filter|forEach)\(")
def es_text(s):
    if len(s) < 2 or SKIP.match(s) or not ES.search(s): return False
    if CODE.search(s): return False
    prosa = ' ' in s and STOP.search(s) and not re.search(r'\b(px|bg|text|flex|grid|border|rounded|dark|hidden|w|h|p|m|mt|mb|gap|items|justify)-', s)
    if prosa: return True
    if re.search(r'[{};=]|px\b', s): return False
    if re.fullmatch(r'[\w.-]+', s) and not re.search(r'[áéíóúñ]', s) and (s.islower() and len(s) < 4 or '_' in s or re.search(r'[a-z][A-Z]', s)): return False
    if re.fullmatch(r'[a-z0-9 :_\-/.\[\]&>%!]+', s): return False
    if re.search(r"^[\w]+(,[\w]+)+$|^[A-Z][a-z]+-[A-Z][a-z]+$|^(USD|CRC|NFD|RESUMEN|GAM|SNIT|TBP|IVA|TITA|ONVO|MapMarket|WhatsApp|BBQ)$", s): return False
    if re.fullmatch(r'[\W\d_]*[A-Za-z]{1,3}[\W\d_]*', s): return False
    return True
def data_strings():
    out = {}
    def w(o):
        if isinstance(o, dict): [w(v) for v in o.values()]
        elif isinstance(o, list): [w(v) for v in o]
        elif isinstance(o, str) and ' ' in o and not o.startswith('http') and not re.fullmatch(r'[\d\s.,%-]+', o): out[o] = 'data/tasas.json'
    w(json.load(open(ROOT + '/data/tasas.json', encoding='utf-8')))
    return out
def collect():
    found = dict(data_strings())
    for f in FILES:
        src = open(f, encoding='utf-8').read()
        for s in candidates(src, f.endswith('.js')):
            if es_text(s): found.setdefault(s, os.path.relpath(f, ROOT))
    return found
if __name__ == '__main__':
    found = collect()
    en = json.load(open(ROOT + '/data/i18n/en.json', encoding='utf-8')) if os.path.exists(ROOT + '/data/i18n/en.json') else {}
    ign = set(json.load(open(ROOT + '/data/i18n/ignorar.json', encoding='utf-8'))) if os.path.exists(ROOT + '/data/i18n/ignorar.json') else set()
    miss = {s: f for s, f in found.items() if s not in en and s not in ign}
    fe, fn = json.load(open(ROOT + '/data/faq.json', encoding='utf-8')), json.load(open(ROOT + '/data/faq_en.json', encoding='utf-8'))
    ie = {i['id'] for i in fn['intents'] if not re.search(r'\b(de|la|que|para|con|los|las|el)\b', i['answer'])}
    for i in fe['intents']:
        if i['id'] not in ie: miss['faq:' + i['id']] = 'data/faq_en.json'
    if '--dump' in sys.argv: json.dump(miss, sys.stdout, ensure_ascii=False, indent=0)
    else:
        for s, f in sorted(miss.items(), key=lambda x: x[1]): print(f'{f}\t{s}')
    print(f'\n{len(found)} textos · {len(miss)} sin traducción', file=sys.stderr)
    sys.exit(1 if miss else 0)
