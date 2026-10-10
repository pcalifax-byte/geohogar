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

## 11. Cuentas (Supabase Auth) y GeoHogar Plus
Páginas: `login.html` (iniciar sesión / crear cuenta / enlace mágico / olvidé mi contraseña), `planes.html` (precios y comparación), `cuenta.html` (perfil, plan, favoritos, cerrar sesión, nueva contraseña). Lógica compartida en `js/auth.js`; configuración en `js/config.js`.

**Modo demo:** si `supabaseUrl` o `supabaseAnonKey` están vacíos, todo funciona con `localStorage` y se muestra el aviso «Modo demostración: el inicio de sesión no es real». En demo, «Probar Plus» activa Plus localmente sin cobro.

### Configurar Supabase
1. Crea un proyecto en supabase.com → *Project Settings → API*: copia **Project URL** y **anon public key** a `js/config.js` (la anon key es pública; **nunca** pongas la `service_role` key en el frontend ni en el repo).
2. *SQL Editor*: ejecuta el bloque «Cuentas, plan Plus…» de `schema.sql` (tablas `profiles`, `favoritos`, `busquedas_guardadas`, `alertas`, trigger de perfil y políticas RLS; requiere extensión `postgis`).
3. *Authentication → URL Configuration*: **Site URL** `https://pcalifax-byte.github.io/geohogar/` y en **Redirect URLs** agrega `https://pcalifax-byte.github.io/geohogar/*` (enlace mágico vuelve a `index.html`; recuperación a `cuenta.html#nueva-clave`).
4. *Authentication → Providers → Email*: activa email + contraseña y «Confirm email».
5. *Authentication → Email Templates* (en español), por ejemplo:
   - **Confirmar registro** — Asunto: «Confirma tu cuenta de GeoHogar». Cuerpo: «¡Hola! Confirma tu correo para empezar a guardar propiedades: <a href="{{ .ConfirmationURL }}">Confirmar cuenta</a>».
   - **Magic Link** — Asunto: «Tu enlace para entrar a GeoHogar». Cuerpo: «Toca para entrar (vence en 1 hora): <a href="{{ .ConfirmationURL }}">Entrar a GeoHogar</a>. Si no lo pediste, ignora este correo.»
   - **Reset Password** — Asunto: «Restablece tu contraseña de GeoHogar». Cuerpo: «<a href="{{ .ConfirmationURL }}">Crear una nueva contraseña</a>».
   - Para producción configura SMTP propio (*Project Settings → Auth → SMTP*), p. ej. Resend, SendGrid o Amazon SES.

### Prueba gratis de 2 días (sin tarjeta)
`planes.html`, el modal de mejora en el mapa y `cuenta.html` llaman `Auth.startTrial()` → RPC `start_trial()` (en `schema.sql`): es `SECURITY DEFINER`, solo funciona con sesión iniciada, solo una vez por cuenta (`trial_used`) y fija `trial_ends_at = now() + 2 días`. `is_plus()` / `has_plus()` devuelven verdadero si hay pago vigente **o** prueba vigente, así que las políticas RLS se aplican solas al vencer. El mapa muestra «⏳ X h Plus» en la barra superior, se recarga al vencer y muestra el aviso «Tu prueba terminó». En modo demo se guarda en `localStorage` (`gh_demo_trials`). No se crea la prueba en Tilopay (su `trial_days` exige registrar tarjeta); la prueba es 100 % de GeoHogar.

### Cobro con Tilopay (proveedor principal)
Fuente: documentación pública https://tilopay.com/developers (páginas «Crear plan recurrente», «Suscriptores de un plan», «URL de registro y renovación», «Webhooks», «Autenticación», revisadas el 10 oct 2026; Tilopay las marca como verificadas el 28–29 ago 2026).

**Lo que debes hacer en Tilopay**
1. Crea la cuenta de comercio en tilopay.com y completa la afiliación (KYC, cuenta bancaria). Tilopay no tiene un host de pruebas aparte: usa sus credenciales/modo de prueba según te indiquen.
2. En `admin.tilopay.com/admin/checkout` obtén `apiuser`, `password` y `key`. **Son secretos**: van solo en Supabase (`supabase secrets set`), nunca en `js/config.js` ni en el repo.
3. Crea dos **planes recurrentes** (panel → Recurrentes, o `POST /api/v1/createPlanRepeat`): «GeoHogar Plus mensual» `currency=USD`, `frecuency=3` (mensual), monto 7; «GeoHogar Plus anual» `frecuency=4` (anual), monto 59. `trial=0` (la prueba la da GeoHogar). Configura en ambos:
   - `webhook_subscribe`, `webhook_payment`, `webhook_rejected`, `webhook_unsubscribe`, `webhook_reactive` → `https://<proyecto>.supabase.co/functions/v1/tilopay-webhook?t=<TILOPAY_WEBHOOK_TOKEN>`
   - `thanks_url` (GET) → `https://pcalifax-byte.github.io/geohogar/cuenta.html?pago=ok`
4. Copia la **URL de registro** de cada plan (panel, o `POST /api/v1/recurrentUrl` → `url_register`, con forma `https://app.tilopay.com/admin/recurrent/register/<ID>`) a `js/config.js` → `tilopay.mensualUrl` / `tilopay.anualUrl`. Los botones «Suscribirme» agregan `?email=<correo del usuario>` (parámetro que muestra la documentación de `recurrentUrl`). Tilopay no ofrece un campo de referencia propio en este flujo, así que **el usuario se identifica por su email**: pide usar el mismo correo de la cuenta GeoHogar.
5. Escribe a soporte de Tilopay (`soporte@tilopay.com` / `sac@tilopay.com`) para pedir el algoritmo de `orderHash` (verificación de origen; no es público) y, si usas `processPayment`, la especificación de su webhook.

**Edge Function `tilopay-webhook`** — responde 200 de inmediato (Tilopay reintenta la recurrencia hasta 5 veces si recibe 400/403/404/502/504; las compras únicas no se reintentan) y **verifica contra el API** antes de dar Plus, porque la documentación advierte no tomar decisiones solo con el contenido del webhook:
```ts
// supabase/functions/tilopay-webhook/index.ts   (deploy: supabase functions deploy tilopay-webhook --no-verify-jwt)
import { createClient } from "npm:@supabase/supabase-js@2";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const T = "https://app.tilopay.com/api/v1";
const PLANES: Record<string, number> = { [Deno.env.get("TILOPAY_PLAN_MENSUAL")!]: 31, [Deno.env.get("TILOPAY_PLAN_ANUAL")!]: 366 };

async function token() {           // POST /api/v1/login → access_token (vigencia 24 h)
  const r = await fetch(`${T}/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiuser: Deno.env.get("TILOPAY_APIUSER"), password: Deno.env.get("TILOPAY_PASSWORD") }) });
  return (await r.json()).access_token as string;
}
async function suscriptor(planId: string, email: string) {   // POST /api/v1/getSuscriptorRepeat
  const r = await fetch(`${T}/getSuscriptorRepeat`, { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `bearer ${await token()}` },
    body: JSON.stringify({ key: Deno.env.get("TILOPAY_KEY"), id: planId }) });
  const j = await r.json();
  return (j.suscriptor ?? []).filter((s: any) => s.email?.toLowerCase() === email)
    .sort((a: any, b: any) => (b.create > a.create ? 1 : -1))[0];
}
async function procesar(body: any) {
  const email = String(body.email ?? "").toLowerCase(), planId = String(body.id_plan ?? "");
  if (!email || !(planId in PLANES)) return;
  const s = await suscriptor(planId, email);                       // fuente de verdad
  const activo = s?.status === "Active";
  const fin = s?.expire ? new Date(s.expire + "T23:59:59-06:00") : new Date(Date.now() + PLANES[planId] * 864e5);
  await db.from("pagos_eventos").insert({ evento: body.evento, email, order_number: body.orderNumber ?? null, payload: body, verificado: !!s });
  if (!s) return;
  await db.from("profiles").update(activo ? { plan: "plus", plus_until: fin.toISOString(), tilopay_plan_id: planId }
                                          : { plan: "gratis", plus_until: fin.toISOString() }).eq("email", email);
}
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("t") !== Deno.env.get("TILOPAY_WEBHOOK_TOKEN")) return new Response("ok"); // ignora, sin reintentos
  let body: any = {}; const txt = await req.text();
  try { body = JSON.parse(txt); } catch { body = Object.fromEntries(new URLSearchParams(txt)); }
  // @ts-ignore EdgeRuntime existe en Supabase: procesa después de responder 200
  EdgeRuntime.waitUntil(procesar(body).catch(console.error));
  return new Response("ok", { status: 200 });
});
```
`supabase secrets set TILOPAY_APIUSER=… TILOPAY_PASSWORD=… TILOPAY_KEY=… TILOPAY_PLAN_MENSUAL=<id> TILOPAY_PLAN_ANUAL=<id> TILOPAY_WEBHOOK_TOKEN=<cadena aleatoria larga>`

**Verificado vs supuesto (según la documentación pública):**
- Verificado: host único `app.tilopay.com`; `POST /api/v1/login` (apiuser/password → bearer, 24 h); `createPlanRepeat` (frecuencias 3=mensual, 4=anual, `trial`/`trial_days`, los 5 webhooks y `thanks_url` GET); ejemplos de payload (`webhook_subscribe`: id_plan, email, modality, amount, free_trial, next_payment_date; `webhook_payment`: id_plan, email, amount, auth, orderNumber; `webhook_unsubscribe` incluye expire); `getSuscriptorRepeat` (lista por plan con email, status `Active`/`Delete`, expire); `recurrentUrl` → `url_register`; política de reintentos; formato JSON; `orderHash` no público.
- Supuesto / por confirmar con Tilopay: que la URL de registro acepte `?email=` para precargar el correo; que el webhook **no** indique el tipo de evento (por eso se consulta el estado real del suscriptor en cada aviso); la zona horaria de `expire`; los demás valores de `status` (p. ej. pausado); la forma exacta de las modalidades del plan. Para mayor seguridad, cuando Tilopay te dé el algoritmo de `orderHash`, valídalo en `procesar()`.
- Respaldo diario recomendado: un cron (pg_cron o GitHub Action) que recorra `getSuscriptorRepeat` de ambos planes y sincronice `profiles`, por si se pierde un webhook.

*Alternativa (Stripe):* si algún día usas Stripe, el flujo equivalente es Payment Link + `client_reference_id` + webhook `checkout.session.completed` / `customer.subscription.*` que actualiza `profiles.plan`/`plus_until`; la lógica de Plus y RLS no cambia.

### Qué está bloqueado tras Plus (frontend + RLS)
Plus = pago vigente o prueba vigente. Favoritos > 10 (también limitado por política RLS), búsquedas guardadas/alertas por zona (RLS solo permite insertar a Plus), reporte CSV descargable, filtros avanzados de remates/adjudicados y comparación contra la mediana en la ficha. Todo lo demás sigue gratis. El bloqueo en el frontend es solo UX; la protección real son las políticas RLS y, para reportes de pago, generarlos en el servidor.
