# MapMarket · Guía de backend

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

## 10. Asistente MapMarket (chatbot) y conexión a un LLM
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

## 11. Cuentas (Supabase Auth) y MapMarket Plus
Páginas: `login.html` (iniciar sesión / crear cuenta / enlace mágico / olvidé mi contraseña), `planes.html` (precios y comparación), `cuenta.html` (perfil, plan, favoritos, cerrar sesión, nueva contraseña). Lógica compartida en `js/auth.js`; configuración en `js/config.js`.

**Modo demo:** si `supabaseUrl` o `supabaseAnonKey` están vacíos, todo funciona con `localStorage` y se muestra el aviso «Modo demostración: el inicio de sesión no es real». En demo, «Probar Plus» activa Plus localmente sin cobro.

### Configurar Supabase
1. Crea un proyecto en supabase.com → *Project Settings → API*: copia **Project URL** y **anon public key** a `js/config.js` (la anon key es pública; **nunca** pongas la `service_role` key en el frontend ni en el repo).
2. *SQL Editor*: ejecuta el bloque «Cuentas, plan Plus…» de `schema.sql` (tablas `profiles`, `favoritos`, `busquedas_guardadas`, `alertas`, trigger de perfil y políticas RLS; requiere extensión `postgis`).
3. *Authentication → URL Configuration*: **Site URL** `https://pcalifax-byte.github.io/geohogar/`; **Redirect URLs**: `https://pcalifax-byte.github.io/geohogar/*` (o al menos `…/geohogar/confirmar.html`, `…/login.html`, `…/cuenta.html`, `…/index.html`). Todos los correos (confirmación, enlace mágico, recuperación) vuelven a `confirmar.html`, que maneja `?code=` (PKCE), `#access_token` y errores como `otp_expired` con botón «Reenviar correo». Si la URL de retorno no está permitida, Supabase usa el Site URL (por defecto `http://localhost:3000`) y el enlace «no carga».
4. *Authentication → Providers → Email*: activa email + contraseña y «Confirm email».
5. *Authentication → Email Templates* (en español), por ejemplo:
   - **Confirmar registro** — Asunto: «Confirma tu cuenta de MapMarket». Cuerpo: «¡Hola! Confirma tu correo para empezar a guardar propiedades: <a href="{{ .ConfirmationURL }}">Confirmar cuenta</a>».
   - **Magic Link** — Asunto: «Tu enlace para entrar a MapMarket». Cuerpo: «Toca para entrar (vence en 1 hora): <a href="{{ .ConfirmationURL }}">Entrar a MapMarket</a>. Si no lo pediste, ignora este correo.»
   - **Reset Password** — Asunto: «Restablece tu contraseña de MapMarket». Cuerpo: «<a href="{{ .ConfirmationURL }}">Crear una nueva contraseña</a>».
   - Para producción configura SMTP propio (*Project Settings → Auth → SMTP*), p. ej. Resend, SendGrid o Amazon SES.

### Prueba gratis de 2 días (sin tarjeta)
`planes.html`, el modal de mejora en el mapa y `cuenta.html` llaman `Auth.startTrial()` → RPC `start_trial()` (en `schema.sql`): es `SECURITY DEFINER`, solo funciona con sesión iniciada, solo una vez por cuenta (`trial_used`) y fija `trial_ends_at = now() + 2 días`. `is_plus()` / `has_plus()` devuelven verdadero si hay pago vigente **o** prueba vigente, así que las políticas RLS se aplican solas al vencer. El mapa muestra «⏳ X h Plus» en la barra superior, se recarga al vencer y muestra el aviso «Tu prueba terminó». En modo demo se guarda en `localStorage` (`gh_demo_trials`). No se crea la prueba en Tilopay (su `trial_days` exige registrar tarjeta); la prueba es 100 % de MapMarket.

### Cobro con ONVO Pay (proveedor principal)
> Tilopay fue **reemplazado** por ONVO Pay (oct 2026). La sección anterior de Tilopay se retiró; el diseño (prueba gratis propia, Edge Function, verificación contra la API) se mantiene.

Fuente: https://docs.onvopay.com (Autenticación, Checkout · enlaces de un solo uso, Cargos recurrentes, Webhooks, Pruebas, `openapi.yaml`), revisado el 10 oct 2026.

**Objetos creados en modo TEST** (con la llave `onvo_test_secret_key_…`, vía API):
| Objeto | ID | Detalle |
|---|---|---|
| Producto | `cmv2wqot11z5sk1237kjvzwsk` | MapMarket Plus |
| Precio mensual | `cmv2wqq6w20bik36vkrllfl8e` | CRC 399000 (₡3.990), recurring month ×1 |
| Precio anual | `cmv2wqqz91za8k86v0ucnv13w` | CRC 2999000 (₡29.990), recurring year ×1 (ahorro ~37 %) |
Los montos van en la unidad menor (céntimos). En producción hay que crear los mismos objetos con la llave live y poner los IDs en `ONVO_PRICE_MENSUAL` / `ONVO_PRICE_ANUAL` (secrets) y en `js/config.js`.

**Flujo**
1. `planes.html` → «Suscribirme» → `Auth.subscribe()` llama `supabase.functions.invoke('onvo-checkout', {periodo})` con el JWT del usuario.
2. `supabase/functions/onvo-checkout` valida el usuario y crea `POST /v1/checkout/sessions/one-time-link` con `lineItems:[{priceId}]`, `customerEmail`, `redirectUrl = …/cuenta.html?pago=ok`, `cancelUrl = …/planes.html?pago=cancelado` y `metadata {supabase_user_id, email, plan, app:'mapmarket'}`; devuelve `url` (checkout.onvopay.com) y el navegador redirige. (Probado en modo test: la API acepta el precio recurrente y devuelve la URL; la sesión de prueba se expiró.)
3. `supabase/functions/onvo-webhook` recibe `checkout-session.succeeded`, `subscription.renewal.succeeded`, `subscription.renewal.failed` y `payment-intent.*`:
   - Verifica el header **`X-Webhook-Secret`** (comparación en tiempo constante) contra el secret `ONVO_WEBHOOK_SECRET` — es el mecanismo documentado por ONVO (no hay firma HMAC).
   - Registra cada evento en `pagos_eventos` con `event_key` único (idempotencia).
   - `checkout-session.succeeded`: vuelve a consultar `GET /v1/checkout/sessions/{id}`, exige `paymentStatus='paid'` y `metadata.app='mapmarket'`, y pone `plan='plus'`, `plus_until = ahora (o fin vigente) + 1 mes/1 año + 3 días de gracia`, guarda `onvo_customer_id`/`onvo_subscription_id` si vienen.
   - `subscription.renewal.succeeded`: extiende `plus_until` (consulta `GET /v1/subscriptions/{id}` si viene el id).
   - `subscription.renewal.failed`: con `past_due` se conserva Plus hasta `plus_until` (ONVO reintenta); con `canceled`/`unpaid` vuelve a `gratis`.
   - Supuestos por confirmar en una prueba real: los nombres `subscriptionId` / `customerId` dentro de la sesión pagada y de la renovación (el código prueba varias formas y usa el email como respaldo).

**Despliegue** (requiere `SUPABASE_ACCESS_TOKEN` — token personal de supabase.com/dashboard/account/tokens):
```bash
export SUPABASE_ACCESS_TOKEN=…            # nunca en el repo
cd /workspace/geohogar-repo
supabase link --project-ref cgswjjhvmexeiglzrysv
supabase secrets set ONVO_SECRET_KEY="$ONVO_SECRET_KEY" ONVO_WEBHOOK_SECRET="webhook_secret_…" \
  ONVO_PRICE_MENSUAL=cmv2wqq6w20bik36vkrllfl8e ONVO_PRICE_ANUAL=cmv2wqqz91za8k86v0ucnv13w SITE_URL=https://pcalifax-byte.github.io/geohogar/
supabase functions deploy onvo-checkout
supabase functions deploy onvo-webhook --no-verify-jwt
```
`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya existen dentro de las Edge Functions (no hay que configurarlos).

**En el Dashboard de ONVO** (Desarrolladores → Webhooks; la API pública no ofrece registrar webhooks): URL `https://cgswjjhvmexeiglzrysv.supabase.co/functions/v1/onvo-webhook`, eventos `checkout-session.succeeded`, `subscription.renewal.succeeded`, `subscription.renewal.failed`, `payment-intent.succeeded`, `payment-intent.failed`. Copia el secret (`webhook_secret_…`) a `ONVO_WEBHOOK_SECRET`.

**Tarjetas de prueba** (docs ONVO · Pruebas; cualquier fecha futura y CVV): Visa aprobada `4242424242424242`, Mastercard aprobada `5555555555554444`, Amex aprobada `378282246310005`, Visa declinada `4000000000000002`, 3DS challenge `4000000000003220`, error de procesador `4000000000000119`.


### Qué está bloqueado tras Plus (frontend + RLS)
Plus = pago vigente o prueba vigente. Favoritos > 10 (también limitado por política RLS), búsquedas guardadas/alertas por zona (RLS solo permite insertar a Plus), reporte CSV descargable, filtros avanzados de remates/adjudicados y comparación contra la mediana en la ficha. Todo lo demás sigue gratis. El bloqueo en el frontend es solo UX; la protección real son las políticas RLS y, para reportes de pago, generarlos en el servidor.

## 12. Funciones v2 (js/features.js)
Tarjeta con carrusel grande + pantalla completa, WhatsApp grande, «Compartir por WhatsApp» con enlace profundo `index.html?p=<id>`, «Reportar» (`reportes`), listas con nombre (`listas`, `lista_items`; Gratis 2 listas/10 propiedades, Plus ilimitado), alertas de precio por provincia o zona dibujada (`alertas_precio`, solo Plus), comparador de 2–3 propiedades (distancias a POIs de OSM, minutos aprox. = línea recta × 1,4 a 25–40 km/h; ruta real opcional con el servidor demo público de OSRM, máx. 1 consulta/3 s), datos de zona por provincia/cantón (mediana, promedio, ₡/m², histograma), Modo Agente (`profiles.rol` vía RPC `hacerme_agente()`, contadores en `eventos` leídos con `stats_propiedades()`, calificaciones `calificaciones_agente` + `rating_agente()`, `destacadas` para agentes Plus, 30 días), pines por tipo con leyenda y `guias.html`.
Requiere ejecutar de nuevo `supabase_setup.sql` (sección v2, idempotente). Mientras no exista, todo funciona con `localStorage` (contadores y reportes solo locales).
Job de alertas de precio (ejemplo): `SELECT a.user_id, p.external_id FROM alertas_precio a JOIN properties p ON a.activa AND (a.zona IS NULL OR ST_Within(p.geom::geometry, a.zona::geometry)) AND (a.provincia IS NULL OR p.province = a.provincia) AND (a.tipo IS NULL OR p.type = a.tipo) AND p.price_usd <= a.precio_max_usd AND p.updated_at > now() - interval '1 day';`

## Contenido de terceros, retiro y calidad de datos (v5)
- Cada ficha scrapeada muestra «📰 Contenido de terceros» con la fuente, enlace al original, aviso de verificación y **Solicitar retiro** → `terminos.html?retiro=<id>#retiro`.
- El formulario guarda en `public.retiros` (anon/autenticado puede INSERTAR; solo `rol='admin'` lee/actualiza `estado`). Límite: 5 solicitudes/día por origen (hash de IP o usuario) y 100/hora global. Plazo de respuesta comprometido: 5 días hábiles. Al retirar: borrar el anuncio de `data/propiedades.json` y añadir su id a una lista de exclusión para que `update.py` no lo vuelva a agregar.
- `eventos`: 1 vista/contacto por anuncio y origen por hora y 400/día (exceso descartado). `reportes`: 15/día y 1 por anuncio/día por origen.
- `scripts/clean.py` (llamado desde `update.py`): precio 0 → «Precio a consultar»; USD > 20M → se interpreta como ₡ (`precio_flag=moneda_corregida`); USD < 5 000 o ₡ < 3M → `precio_flag=dudoso` (fuera de medianas/estadísticas); elimina duplicados; desplaza en espiral (~130 m) los puntos apilados con ubicación aproximada (`lat0/lon0` = original); marca `verificacion='sin verificar'` si no se revisó en 14 días.

## v7 · Publicación, moderación, admin, alertas, cuenta
- **Anuncios de usuarios**: «➕ Publicar» guarda local y (si eliges «Publicar en MapMarket» y tienes sesión) sube hasta 6 fotos a Storage `anuncios/<uid>/…` (redimensionadas a 1600 px JPEG en el navegador, sin EXIF/GPS) e inserta en `public.anuncios` con `estado='pendiente'`. Un trigger impide auto-aprobarse; editar vuelve a revisión; máx. 10/día. El mapa carga los `aprobado`/`vendido` (id `u-<uuid>`) y el chat los enruta a su dueño.
- **admin.html** (solo `profiles.rol='admin'`, verificado con `es_admin()` en RLS): Moderación, Reportes (anuncios + usuarios), Retiros, Soporte. Para hacerte admin: `update profiles set rol='admin' where id=(select id from auth.users where email='TU_CORREO');`
- **Retirar un anuncio scrapeado**: añade su id a `scripts/excluidos.json` → `update.py` lo elimina y no vuelve.
- **Función `cuenta`** (JWT): `pagos` (historial), `cancelar` (DELETE /v1/subscriptions/{id} en ONVO; Plus sigue hasta `plus_until`), `eliminar` (cancela y borra el usuario; cascada borra sus datos). Página pública para Google Play: `eliminar-cuenta.html`.
- **Función `alertas-email`** (cron diario 13:00 UTC = 7:00 CR con pg_cron + pg_net, header `x-cron-secret`): alertas de precio y búsquedas guardadas de usuarios Plus; primera corrida = línea base; luego envía nuevos y bajadas de precio ≥3 %. **Correo**: requiere `RESEND_API_KEY` y `ALERT_FROM` (dominio verificado en Resend) como secretos; sin ellos solo registra en `alertas_envios`. El SMTP por defecto de Supabase (pocos correos/hora) no sirve para esto.
- **Historial de precios**: `clean.py` mantiene `precio_hist` (últimos 12 cambios); `update.py` lee el precio actual de Anuntico (JSON-LD). La ficha muestra «⬇️ Bajó X %».
- **Analítica**: no usamos analítica de terceros ni cookies de rastreo. Solo los conteos agregados de `eventos` (vistas/contactos por anuncio, con hash de IP no reversible y límites) que ve el agente en Modo Agente. Si en el futuro se agrega analítica, preferir una sin cookies (p. ej. Plausible/Umami autoalojado) y actualizar `privacidad.html`.
- **SEO**: `scripts/seo.py` genera `p/<id>.html` (Open Graph por anuncio, redirige al mapa) y `sitemap.xml`. Nota: GitHub Pages en `/geohogar/` no permite `robots.txt` en la raíz del dominio; el archivo del repo es informativo — registra el sitemap en Google Search Console.
