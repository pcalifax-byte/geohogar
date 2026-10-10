# GeoHogar · Guía de backend

El frontend (`index.html`) ya separa el acceso a datos en el módulo **`DataService`**. Hoy lee datos embebidos y `localStorage`; para usar una API real basta con definir `CONFIG.apiBase` y ajustar `getProperties()` / `addProperty()`. El resto (`MapController`, `Filters`, `Layers`, `UI`) no cambia.

## 1. Base de datos
1. PostgreSQL 15+ con PostGIS 3.3+ (`CREATE EXTENSION postgis`).
2. Ejecuta `schema.sql` (tablas `properties`, `zones`, `agents`, `property_images`, `amenities`, `pois` + índices GIST).
3. Importa los datos: `propiedades.json` → `properties` (`geom = ST_MakePoint(lon, lat)::geography`), `poi.json` → `pois`.
4. `schema.json` describe el formato de intercambio (GeoJSON Feature) que deben devolver/recibir los endpoints.

## 2. Endpoints de la API
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/properties?bbox=oeste,sur,este,norte&type=&min=&max=&beds=&amenity=&q=&limit=` | Propiedades del viewport (FeatureCollection) |
| POST | `/properties/within` | Body: GeoJSON `Polygon` dibujado → propiedades dentro (`ST_Within`) |
| GET | `/properties/near?lat=&lon=&radius=2000` | Propiedades en un radio (`ST_DWithin`) |
| GET | `/properties/:id` | Ficha completa (imágenes, amenidades, agente) |
| POST | `/properties` | Publicar (auth requerida, validar con `schema.json`) |
| GET | `/clusters?bbox=&zoom=` | Clusters precalculados en servidor |
| GET | `/tiles/properties/{z}/{x}/{y}.mvt` | Vector tiles (`ST_AsMVT`) |
| GET | `/layers/pois?bbox=&category=` · `/layers/zones?kind=plusvalia` | Capas informativas |

## 3. Node.js (Express + pg)
```js
import express from 'express'; import pg from 'pg';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = express(); app.use(express.json());

app.get('/properties', async (req, res) => {
  const [w, s, e, n] = String(req.query.bbox).split(',').map(Number);
  const { rows } = await db.query(`
    SELECT json_build_object('type','FeatureCollection','features',coalesce(json_agg(json_build_object(
      'type','Feature','id',id,'geometry',ST_AsGeoJSON(geom)::json,
      'properties',json_build_object('title',title,'type',type,'price',price,'currency',currency,'bedrooms',bedrooms))),'[]')) fc
    FROM (SELECT * FROM properties WHERE status='activa'
          AND geom && ST_MakeEnvelope($1,$2,$3,$4,4326)::geography
          AND ($5::numeric IS NULL OR price_usd <= $5) LIMIT 2000) t`,
    [w, s, e, n, req.query.max ?? null]);
  res.set('Cache-Control', 'public, max-age=60').json(rows[0].fc);
});

app.post('/properties/within', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id,title,price,currency,ST_Y(geom::geometry) lat,ST_X(geom::geometry) lon FROM properties
     WHERE ST_Within(geom::geometry, ST_SetSRID(ST_GeomFromGeoJSON($1),4326))`, [JSON.stringify(req.body)]);
  res.json(rows);
});
app.listen(3000);
```

## 4. Python (FastAPI + asyncpg)
```python
from fastapi import FastAPI, Body
import asyncpg, json, os
app = FastAPI()
@app.on_event("startup")
async def start(): app.state.db = await asyncpg.create_pool(os.environ["DATABASE_URL"])

@app.get("/properties")
async def by_bbox(bbox: str, max: float | None = None, limit: int = 2000):
    w, s, e, n = map(float, bbox.split(","))
    rows = await app.state.db.fetch("""
      SELECT id,title,type,price,currency,ST_Y(geom::geometry) lat,ST_X(geom::geometry) lon
      FROM properties WHERE status='activa'
        AND geom && ST_MakeEnvelope($1,$2,$3,$4,4326)::geography
        AND ($5::numeric IS NULL OR price_usd <= $5) LIMIT $6""", w, s, e, n, max, limit)
    return [dict(r) for r in rows]

@app.post("/properties/within")
async def within(polygon: dict = Body(...)):
    rows = await app.state.db.fetch("""SELECT id,title,price,currency FROM properties
      WHERE ST_Within(geom::geometry, ST_SetSRID(ST_GeomFromGeoJSON($1),4326))""", json.dumps(polygon))
    return [dict(r) for r in rows]
```

## 5. Supabase
- Supabase ya trae PostGIS: activa la extensión en *Database → Extensions* y ejecuta `schema.sql` en el SQL Editor.
- Crea funciones RPC para las consultas espaciales:
```sql
create or replace function properties_in_bbox(w float, s float, e float, n float)
returns setof properties language sql stable as $$
  select * from properties where geom && st_makeenvelope(w,s,e,n,4326)::geography and status='activa' limit 2000 $$;
create or replace function properties_within(poly json)
returns setof properties language sql stable as $$
  select * from properties where st_within(geom::geometry, st_setsrid(st_geomfromgeojson(poly::text),4326)) $$;
```
- En el frontend:
```js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
DataService.getProperties = async ({ bbox }) => (await sb.rpc('properties_in_bbox', { w:bbox[0], s:bbox[1], e:bbox[2], n:bbox[3] })).data;
DataService.addProperty  = async p => (await sb.from('properties').insert(p).select()).data[0];
```
- Activa **Row Level Security**: lectura pública de `status='activa'`; inserción/edición solo para `auth.uid()` dueño/agente. Las fotos van a *Supabase Storage* y su URL a `property_images`.

## 6. Rendimiento del mapa a escala
1. **Carga por viewport (bbox):** pide datos en `moveend` con *debounce* (300 ms) y solo del bbox visible (+10% de margen). Cancela peticiones viejas con `AbortController`.
2. **Clustering en servidor:** con >10k puntos no mandes todo al cliente. Opciones: `supercluster` en Node (índice en memoria, `getClusters(bbox, zoom)`), o SQL con `ST_SnapToGrid`/`ST_ClusterKMeans` por nivel de zoom; a zoom bajo devuelve conteos por provincia/cantón.
3. **Vector tiles:** sirve `ST_AsMVT` (ver `schema.sql`, consulta 7) desde un endpoint o usa **Martin** / **pg_tileserv** apuntando a la tabla; los filtros pueden ir como parámetros de función.
4. **MapLibre GL JS:** para decenas de miles de puntos cambia Leaflet por MapLibre (renderizado WebGL, capas `circle`/`symbol` con clustering nativo de fuentes GeoJSON y estilos vector para claro/oscuro).
5. **Caché:** `Cache-Control` + CDN para tiles (inmutables por versión), Redis para respuestas bbox/cluster frecuentes (clave = bbox redondeado + zoom + filtros), y vistas materializadas para conteos y `price_usd`.
6. **Índices:** GIST en `geom`, compuesto en filtros (`status,type,price_usd,bedrooms`), trigram para búsqueda de texto. Revisa con `EXPLAIN ANALYZE`.
7. **Cliente:** `preferCanvas`, `chunkedLoading` de markercluster, imágenes perezosas (`loading="lazy"`) y paginación de la lista.

## 7. Datos reales incluidos
- `propiedades_reales.csv` / `.json`: anuncios de Anuntico (precio, ubicación provincia/cantón/distrito, cuartos, baños, garajes, m² construcción/terreno, agente, fotos, descripción, URL). Cárgalos con el bloque `\copy` + `INSERT … SELECT` al final de `schema.sql` (las fotos van separadas por `|` a `property_images`).
- Nuevas columnas en `properties`: `garages`, `lot_m2`, `year_built`, `agent_name`, `phone`, `date_posted`.
- Las coordenadas de Anuntico son **aproximadas** (centro del distrito vía Nominatim); márcalas `coord_quality='aproximada'`.
- Fotos: hoy se enlazan directo al CDN del portal (hotlink). En producción pide permiso o almacena las tuyas en Storage.

## 8. Notas de datos
- Tipo de cambio: el frontend usa un valor **fijo aproximado (1 USD = 455 CRC, referencia BCCR 10 oct 2026 aportada por el usuario)**. En producción, calcula `price_usd` con un job diario usando el tipo de cambio del BCCR.
- Plusvalía: la capa es una coropleta de **mediana de precio pedido de casas por provincia** (Anuntico, oct 2026) sobre límites de geoBoundaries (ADM1). Las zonas de crecimiento resaltadas son referenciales. Guárdalas en `zones` (`kind='provincia'` con `props->>'median_crc'`, `kind='plusvalia'`).
- Las 40 propiedades `is_demo=true` son ficticias y no deben publicarse en producción.

## 9. Datos en `data/` y actualización diaria
El frontend ya no trae datos embebidos: `index.html` carga por `fetch` los archivos de `data/`:

| Archivo | Contenido |
|---|---|
| `propiedades.json` | Anuncios (reales + demo) con `status` (activa/vendida/retirada), `status_fecha` y `amenidades` |
| `tipo_cambio.json` | Compra/venta BCCR y fecha |
| `tasas.json` | TBP (BCCR) y tasas hipotecarias por banco (`verificado`, `fuente`, `estado_verificacion`) |
| `mercado.json` | Medianas de precio pedido por tipo y por provincia (Anuntico) |
| `capas.json` | Límites de provincias, coropleta y puntos de interés |
| `faq.json` | Base de conocimiento del Asistente |
| `meta.json` | `last_updated` (badge «Actualizado») |

Actualización: `python3 scripts/update.py` (ver docstring). Hace commit + push **solo si cambió algo en `data/`** y deja un resumen en `scripts/last_run.json`. Para programarlo (cron diario 6:00 CR = 12:00 UTC):
```
0 12 * * * cd /workspace/geohogar-repo && git pull -q && python3 scripts/update.py >> scripts/update.log 2>&1
```
Para leer la tasa de un banco automáticamente, agrega en `tasas.json` → `bancos[i]` los campos `url_tasas` (página pública) y `patron` (regex con un grupo numérico, ej. `"vivienda[^%]{0,80}?(\\d{1,2}[.,]\\d{1,2})\\s?%"`). Si no se puede leer, se conserva el dato anterior.

Amenidades: `scripts/amenidades.py` (catálogo casa/condominio, sinónimos, sin acentos). El mismo extractor se aplica a anuncios nuevos.

## 10. Asistente GeoHogar (chatbot) y conexión a un LLM
Hoy funciona 100% en el navegador: intenciones por palabras clave (sin acentos, tolerancia a errores de 1 letra) sobre `data/faq.json` y un parser de búsqueda (tipo, provincia/cantón, habitaciones, precio mín/máx en $ o ₡, «millones», «mil», amenidades) que aplica filtros al mapa.

Para conectar un LLM define `CONFIG.chatApi` (URL). El frontend envía:
```json
POST {chatApi}  {"message":"texto del usuario","filters":{...estado actual...},"selected":"id-propiedad-o-null"}
```
y espera `{"reply":"texto", "filters":{"type":"Casa","prov":"Heredia","beds":3,"max":200000,"amen":["piscina"]}}` (ambos opcionales). Si falla, usa el motor local. Ejemplo FastAPI:
```python
@app.post("/chat")
async def chat(body: dict):
    # llama a tu LLM con un prompt de sistema + faq.json + herramientas (búsqueda en PostGIS)
    return {"reply": "Encontré 12 casas en Heredia…", "filters": {"type": "Casa", "prov": "Heredia"}}
```
Mantén la clave del LLM en el servidor, nunca en el frontend. `CONFIG.whatsappSoporte` define el número de soporte (vacío = WhatsApp sin número).
