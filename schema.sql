-- GeoHogar · Esquema PostgreSQL + PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE property_type AS ENUM ('casa','apartamento','lote','casa_playa','comercio','finca','negocio','edificio','oficina');
CREATE TYPE coord_quality AS ENUM ('exacta','aproximada','elegida','demo');
CREATE TYPE currency_code AS ENUM ('USD','CRC');

CREATE TABLE agents (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE,
  whatsapp    TEXT,                 -- formato E.164, ej. +50688887777
  agency      TEXT,
  verified    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE zones (               -- provincias, cantones, zonas de plusvalía, polígonos guardados
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('provincia','canton','distrito','plusvalia','usuario')),
  growth_index NUMERIC(5,2),        -- solo para kind='plusvalia'
  geom        GEOGRAPHY(MULTIPOLYGON,4326) NOT NULL,
  props       JSONB DEFAULT '{}'
);
CREATE INDEX zones_geom_gix ON zones USING GIST (geom);

CREATE TABLE properties (
  id          BIGSERIAL PRIMARY KEY,
  external_id TEXT,                 -- id del portal (ej. Encuentra24)
  source      TEXT NOT NULL DEFAULT 'geohogar',
  source_url  TEXT,
  agent_id    BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT,
  type        property_type NOT NULL,
  operation   TEXT NOT NULL DEFAULT 'venta' CHECK (operation IN ('venta','alquiler')),
  price       NUMERIC(14,2),
  currency    currency_code NOT NULL DEFAULT 'USD',
  price_usd   NUMERIC(14,2),        -- normalizado (job diario con tipo de cambio BCCR)
  bedrooms    SMALLINT,
  bathrooms   NUMERIC(3,1),
  area_m2     NUMERIC(10,2),      -- m² de construcción
  lot_m2      NUMERIC(12,2),      -- m² de terreno
  garages     SMALLINT,
  year_built  SMALLINT,
  agent_name  TEXT,               -- nombre del agente/vendedor tal como aparece en el anuncio
  phone       TEXT,               -- solo si es público en el anuncio
  date_posted DATE,
  province    TEXT,
  canton      TEXT,
  district    TEXT,
  location_text TEXT,
  geom        GEOGRAPHY(POINT,4326) NOT NULL,
  coord_quality coord_quality NOT NULL DEFAULT 'exacta',
  status      TEXT NOT NULL DEFAULT 'activa' CHECK (status IN ('activa','vendida','pausada')),
  is_demo     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source, external_id)
);
CREATE INDEX properties_geom_gix   ON properties USING GIST (geom);
CREATE INDEX properties_geomg_gix  ON properties USING GIST ((geom::geometry));  -- para ST_AsMVT / operaciones geometry
CREATE INDEX properties_filters_ix ON properties (status, type, price_usd, bedrooms);
CREATE INDEX properties_text_trgm  ON properties USING GIN ((title || ' ' || coalesce(location_text,'')) gin_trgm_ops);

CREATE TABLE property_images (
  id          BIGSERIAL PRIMARY KEY,
  property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  position    SMALLINT DEFAULT 0,
  is_placeholder BOOLEAN DEFAULT FALSE
);
CREATE INDEX property_images_pid ON property_images(property_id, position);

CREATE TABLE amenities (
  id   SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE property_amenities (
  property_id BIGINT REFERENCES properties(id) ON DELETE CASCADE,
  amenity_id  INT REFERENCES amenities(id) ON DELETE CASCADE,
  PRIMARY KEY (property_id, amenity_id)
);
INSERT INTO amenities (slug,name) VALUES
 ('piscina','Piscina'),('seguridad','Seguridad 24/7'),('parqueo','Parqueo'),('jardin','Jardín'),('gimnasio','Gimnasio'),
 ('vista_mar','Vista al mar'),('terraza','Terraza'),('juegos','Área de juegos'),('pet','Pet friendly'),('amueblado','Amueblado');

CREATE TABLE pois (                 -- servicios, comercio, transporte (de OpenStreetMap)
  id BIGSERIAL PRIMARY KEY, osm_id TEXT, name TEXT, category TEXT, geom GEOGRAPHY(POINT,4326) NOT NULL);
CREATE INDEX pois_geom_gix ON pois USING GIST (geom);

-- ===================== Consultas espaciales de ejemplo =====================

-- 1) Viewport (bbox): propiedades visibles en el mapa  ($1..$4 = oeste, sur, este, norte)
SELECT id, title, price, currency, ST_Y(geom::geometry) lat, ST_X(geom::geometry) lon
FROM properties
WHERE status='activa'
  AND geom && ST_MakeEnvelope($1,$2,$3,$4,4326)::geography
LIMIT 2000;

-- 2) "Dibujar zona": propiedades dentro del polígono dibujado (GeoJSON del cliente)
SELECT p.*
FROM properties p
WHERE ST_Within(p.geom::geometry,
        ST_SetSRID(ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[-84.20,9.94],[-84.12,9.95],[-84.11,9.91],[-84.18,9.89],[-84.20,9.94]]]}'),4326));

-- 3) Radio: propiedades a menos de 2 km de un punto (ej. Hospital México)
SELECT id, title, ST_Distance(geom, ST_MakePoint(-84.1135,9.9496)::geography) AS metros
FROM properties
WHERE ST_DWithin(geom, ST_MakePoint(-84.1135,9.9496)::geography, 2000)
ORDER BY metros;

-- 4) Propiedades con supermercado a <= 500 m
SELECT DISTINCT p.id, p.title
FROM properties p JOIN pois s ON s.category='supermarket' AND ST_DWithin(p.geom, s.geom, 500);

-- 5) Propiedades dentro de zonas de alta plusvalía
SELECT p.id, p.title, z.name AS zona, z.growth_index
FROM properties p JOIN zones z ON z.kind='plusvalia' AND ST_Intersects(p.geom, z.geom);

-- 6) Conteo por provincia (para clusters a zoom bajo)
SELECT z.name, count(p.*) FROM zones z LEFT JOIN properties p ON ST_Intersects(p.geom,z.geom)
WHERE z.kind='provincia' GROUP BY z.name;

-- 7) Vector tile (MVT) para el tile z/x/y  ($1=z, $2=x, $3=y)
WITH b AS (SELECT ST_TileEnvelope($1,$2,$3) AS env),
mvt AS (
  SELECT ST_AsMVTGeom(ST_Transform(p.geom::geometry,3857), b.env) AS geom, p.id, p.price_usd, p.type
  FROM properties p, b
  WHERE ST_Transform(p.geom::geometry,3857) && b.env AND p.status='activa')
SELECT ST_AsMVT(mvt, 'properties', 4096, 'geom') FROM mvt;

-- ===================== Carga de datos reales (propiedades_reales.csv) =====================
-- Columnas del CSV: id,title,type,price,currency,province,canton,district,beds,baths,garages,area,lot,agent,phone,images,desc,year,date,lat,lon,coord,url,source
CREATE TEMP TABLE staging_props (id TEXT,title TEXT,type TEXT,price NUMERIC,currency TEXT,province TEXT,canton TEXT,district TEXT,
  beds NUMERIC,baths NUMERIC,garages NUMERIC,area NUMERIC,lot NUMERIC,agent TEXT,phone TEXT,images TEXT,descr TEXT,year NUMERIC,date DATE,
  lat DOUBLE PRECISION,lon DOUBLE PRECISION,coord TEXT,url TEXT,source TEXT);
\copy staging_props FROM 'propiedades_reales.csv' WITH (FORMAT csv, HEADER true)

INSERT INTO properties (external_id,source,source_url,title,description,type,price,currency,price_usd,bedrooms,bathrooms,garages,area_m2,lot_m2,
  year_built,agent_name,phone,date_posted,province,canton,district,location_text,geom,coord_quality)
SELECT id,source,url,title,descr,
  CASE type WHEN 'Casa' THEN 'casa' WHEN 'Apartamento' THEN 'apartamento' WHEN 'Lote/Terreno' THEN 'lote' WHEN 'Finca' THEN 'finca' ELSE 'casa' END::property_type,
  price,currency::currency_code,CASE WHEN currency='CRC' THEN round(price/455,2) ELSE price END,
  beds,baths,garages,area,lot,year,agent,phone,date,province,canton,district,concat_ws(', ',district,canton,province),
  ST_MakePoint(lon,lat)::geography,coord::coord_quality
FROM staging_props
ON CONFLICT (source,external_id) DO UPDATE SET price=EXCLUDED.price, updated_at=now();

INSERT INTO property_images (property_id,url,position)
SELECT p.id, img.url, img.ord-1
FROM staging_props s JOIN properties p ON p.source=s.source AND p.external_id=s.id,
     unnest(string_to_array(s.images,'|')) WITH ORDINALITY AS img(url,ord)
WHERE s.images <> '';

-- Ejemplo de seed manual
INSERT INTO properties (external_id,source,title,type,price,currency,price_usd,bedrooms,bathrooms,garages,area_m2,lot_m2,province,canton,district,geom,coord_quality)
VALUES ('demo-1','geohogar','[DEMO] Casa en Escazú','casa',350000,'USD',350000,3,2,2,180,250,'San José','Escazú','San Rafael',
        ST_MakePoint(-84.14,9.918)::geography,'demo');

-- ===================== Cuentas, plan Plus, favoritos, búsquedas y alertas (Supabase) =====================
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre      TEXT,
  plan        TEXT NOT NULL DEFAULT 'gratis' CHECK (plan IN ('gratis','plus')),
  plus_until  TIMESTAMPTZ,
  stripe_customer_id TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
-- crear perfil automáticamente al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN INSERT INTO public.profiles (id, nombre) VALUES (NEW.id, NEW.raw_user_meta_data->>'nombre') ON CONFLICT DO NOTHING; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.is_plus(uid UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = uid AND plan = 'plus' AND (plus_until IS NULL OR plus_until > now())) $$;

CREATE TABLE IF NOT EXISTS public.favoritos (
  user_id     UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,             -- id del JSON (ej. 'anun-54882', '32136583', 'rjcr-2938')
  created_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, property_id)
);
CREATE TABLE IF NOT EXISTS public.busquedas_guardadas (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  filtros     JSONB NOT NULL DEFAULT '{}',
  zona        GEOGRAPHY(POLYGON,4326),   -- polígono dibujado ("Dibujar zona")
  alerta      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS busquedas_zona_gix ON public.busquedas_guardadas USING GIST (zona);
CREATE TABLE IF NOT EXISTS public.alertas (
  id          BIGSERIAL PRIMARY KEY,
  busqueda_id BIGINT NOT NULL REFERENCES public.busquedas_guardadas(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL,             -- propiedad o remate nuevo
  item_kind   TEXT NOT NULL CHECK (item_kind IN ('propiedad','remate','adjudicado')),
  enviada_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (busqueda_id, item_id)
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favoritos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.busquedas_guardadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alertas ENABLE ROW LEVEL SECURITY;

-- profiles: cada usuario ve y edita su nombre; plan/plus_until solo los cambia el backend (service_role / webhook)
CREATE POLICY "perfil propio lectura" ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "perfil propio nombre"  ON public.profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
REVOKE UPDATE (plan, plus_until, stripe_customer_id) ON public.profiles FROM authenticated, anon;

-- favoritos: propios; plan gratis máximo 10
CREATE POLICY "favoritos propios" ON public.favoritos FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "favoritos borrar"  ON public.favoritos FOR DELETE USING (user_id = auth.uid());
CREATE POLICY "favoritos insertar con límite" ON public.favoritos FOR INSERT WITH CHECK (
  user_id = auth.uid() AND (public.is_plus(auth.uid()) OR (SELECT count(*) FROM public.favoritos f WHERE f.user_id = auth.uid()) < 10));

-- búsquedas guardadas: solo Plus puede crear
CREATE POLICY "busquedas propias"    ON public.busquedas_guardadas FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "busquedas borrar"     ON public.busquedas_guardadas FOR DELETE USING (user_id = auth.uid());
CREATE POLICY "busquedas editar"     ON public.busquedas_guardadas FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "busquedas crear plus" ON public.busquedas_guardadas FOR INSERT WITH CHECK (user_id = auth.uid() AND public.is_plus(auth.uid()));

-- alertas: el usuario solo lee las suyas; las inserta el job de alertas (service_role ignora RLS)
CREATE POLICY "alertas propias" ON public.alertas FOR SELECT USING (user_id = auth.uid());

-- Job de alertas (ej. tras update.py): propiedades nuevas dentro de cada zona guardada
-- INSERT INTO alertas (busqueda_id,user_id,item_id,item_kind)
-- SELECT b.id, b.user_id, p.external_id, 'propiedad' FROM busquedas_guardadas b JOIN properties p
--   ON b.alerta AND (b.zona IS NULL OR ST_Within(p.geom::geometry, b.zona::geometry)) AND p.created_at > now() - interval '1 day'
-- ON CONFLICT DO NOTHING;
