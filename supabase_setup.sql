-- =====================================================================
-- MapMarket · configuración de Supabase (pegar UNA vez en SQL Editor → Run)
-- Idempotente: se puede volver a ejecutar sin errores ni pérdida de datos.
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

-- ---------- Perfiles ----------
CREATE TABLE IF NOT EXISTS public.profiles (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre             TEXT,
  email              TEXT,
  plan               TEXT NOT NULL DEFAULT 'gratis' CHECK (plan IN ('gratis','plus')),
  plus_until         TIMESTAMPTZ,
  trial_started_at   TIMESTAMPTZ,
  trial_ends_at      TIMESTAMPTZ,
  trial_used         BOOLEAN NOT NULL DEFAULT FALSE,
  tilopay_plan_id    TEXT,
  stripe_customer_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS trial_used BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tilopay_plan_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles (lower(email));

-- Trigger: crear perfil al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, nombre, email)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'nombre', lower(NEW.email))
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
-- perfiles para usuarios que ya existían
INSERT INTO public.profiles (id, nombre, email)
SELECT u.id, u.raw_user_meta_data->>'nombre', lower(u.email) FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- ---------- Plus = pago vigente o prueba vigente ----------
CREATE OR REPLACE FUNCTION public.is_plus(uid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND (
    (plan = 'plus' AND (plus_until IS NULL OR plus_until > now()))
    OR (trial_ends_at IS NOT NULL AND trial_ends_at > now())));
$$;
CREATE OR REPLACE FUNCTION public.has_plus() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT public.is_plus(auth.uid()); $$;

-- Prueba gratis 2 días (una vez por cuenta)
CREATE OR REPLACE FUNCTION public.start_trial() RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ends TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  INSERT INTO public.profiles (id) VALUES (auth.uid()) ON CONFLICT DO NOTHING;
  UPDATE public.profiles
     SET trial_used = TRUE, trial_started_at = now(), trial_ends_at = now() + interval '2 days'
   WHERE id = auth.uid() AND trial_used = FALSE
   RETURNING trial_ends_at INTO ends;
  IF ends IS NULL THEN RAISE EXCEPTION 'Ya usaste tu prueba gratis de Plus en esta cuenta.'; END IF;
  RETURN ends;
END $$;
REVOKE ALL ON FUNCTION public.start_trial() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_trial() TO authenticated;
REVOKE ALL ON FUNCTION public.is_plus(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_plus(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_plus() TO authenticated;

-- ---------- Favoritos, búsquedas, alertas ----------
CREATE TABLE IF NOT EXISTS public.favoritos (
  user_id     UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, property_id)
);
CREATE TABLE IF NOT EXISTS public.busquedas_guardadas (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre     TEXT NOT NULL,
  filtros    JSONB NOT NULL DEFAULT '{}',
  zona       extensions.geography(POLYGON, 4326),
  alerta     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS busquedas_user_idx ON public.busquedas_guardadas (user_id);
CREATE INDEX IF NOT EXISTS busquedas_zona_gix ON public.busquedas_guardadas USING GIST (zona);
CREATE TABLE IF NOT EXISTS public.alertas (
  id          BIGSERIAL PRIMARY KEY,
  busqueda_id BIGINT NOT NULL REFERENCES public.busquedas_guardadas(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL,
  item_kind   TEXT NOT NULL CHECK (item_kind IN ('propiedad','remate','adjudicado')),
  enviada_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (busqueda_id, item_id)
);
CREATE INDEX IF NOT EXISTS alertas_user_idx ON public.alertas (user_id);
CREATE TABLE IF NOT EXISTS public.pagos_eventos (
  id BIGSERIAL PRIMARY KEY, proveedor TEXT DEFAULT 'tilopay', evento TEXT, email TEXT,
  order_number TEXT, payload JSONB, verificado BOOLEAN, created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Permisos y RLS ----------
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favoritos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.busquedas_guardadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alertas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos_eventos       ENABLE ROW LEVEL SECURITY;   -- sin políticas: solo service_role

REVOKE ALL ON public.profiles, public.favoritos, public.busquedas_guardadas, public.alertas, public.pagos_eventos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (nombre) ON public.profiles TO authenticated;          -- plan/prueba solo los cambia el backend
GRANT SELECT, INSERT, DELETE ON public.favoritos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.busquedas_guardadas TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.busquedas_guardadas_id_seq TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.alertas FROM authenticated;
GRANT SELECT ON public.alertas TO authenticated;
REVOKE ALL ON public.pagos_eventos FROM authenticated;

DROP POLICY IF EXISTS "perfil propio lectura" ON public.profiles;
CREATE POLICY "perfil propio lectura" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
DROP POLICY IF EXISTS "perfil propio nombre" ON public.profiles;
CREATE POLICY "perfil propio nombre" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "favoritos propios" ON public.favoritos;
CREATE POLICY "favoritos propios" ON public.favoritos FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "favoritos borrar" ON public.favoritos;
CREATE POLICY "favoritos borrar" ON public.favoritos FOR DELETE TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "favoritos insertar con límite" ON public.favoritos;
CREATE POLICY "favoritos insertar con límite" ON public.favoritos FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid() AND (public.has_plus()
    OR (SELECT count(*) FROM public.favoritos f WHERE f.user_id = auth.uid()) < 10));

DROP POLICY IF EXISTS "busquedas propias" ON public.busquedas_guardadas;
CREATE POLICY "busquedas propias" ON public.busquedas_guardadas FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "busquedas borrar" ON public.busquedas_guardadas;
CREATE POLICY "busquedas borrar" ON public.busquedas_guardadas FOR DELETE TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "busquedas editar" ON public.busquedas_guardadas;
CREATE POLICY "busquedas editar" ON public.busquedas_guardadas FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND public.has_plus());
DROP POLICY IF EXISTS "busquedas crear plus" ON public.busquedas_guardadas;
CREATE POLICY "busquedas crear plus" ON public.busquedas_guardadas FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.has_plus());

DROP POLICY IF EXISTS "alertas propias" ON public.alertas;
CREATE POLICY "alertas propias" ON public.alertas FOR SELECT TO authenticated USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
SELECT 'MapMarket listo ✅' AS resultado;

-- =====================================================================
-- v2 · listas, alertas de precio, reportes, eventos, agentes, destacadas
-- (idempotente; se puede ejecutar sobre la versión anterior)
-- =====================================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rol TEXT NOT NULL DEFAULT 'usuario';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_rol_chk') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_rol_chk CHECK (rol IN ('usuario','agente','admin'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.hacerme_agente() RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  INSERT INTO public.profiles (id) VALUES (auth.uid()) ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET rol = 'agente' WHERE id = auth.uid() AND rol = 'usuario';
  RETURN 'agente';
END $$;
REVOKE ALL ON FUNCTION public.hacerme_agente() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hacerme_agente() TO authenticated;

-- Listas de favoritos con nombre (Gratis: 2 listas y 10 propiedades en total; Plus: ilimitado)
CREATE TABLE IF NOT EXISTS public.listas (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.lista_items (
  lista_id BIGINT NOT NULL REFERENCES public.listas(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lista_id, property_id)
);
CREATE INDEX IF NOT EXISTS listas_user_idx ON public.listas (user_id);
CREATE INDEX IF NOT EXISTS lista_items_user_idx ON public.lista_items (user_id);

-- Alertas de precio por provincia o zona dibujada (solo Plus)
CREATE TABLE IF NOT EXISTS public.alertas_precio (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  precio_max_usd NUMERIC,
  tipo TEXT,
  provincia TEXT,
  zona extensions.geography(POLYGON, 4326),
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alertas_precio_zona_gix ON public.alertas_precio USING GIST (zona);

-- Reportes de anuncios (cualquiera puede reportar; solo admin/service_role lee)
CREATE TABLE IF NOT EXISTS public.reportes (
  id BIGSERIAL PRIMARY KEY,
  property_id TEXT NOT NULL,
  motivo TEXT NOT NULL CHECK (motivo IN ('vendida','datos','duplicado','fraude','otro')),
  detalle TEXT CHECK (char_length(detalle) <= 500),
  user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  estado TEXT NOT NULL DEFAULT 'nuevo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Eventos de vistas/contactos (inserción anónima; lectura solo agregada por RPC)
CREATE TABLE IF NOT EXISTS public.eventos (
  id BIGSERIAL PRIMARY KEY,
  property_id TEXT NOT NULL CHECK (char_length(property_id) <= 64),
  tipo TEXT NOT NULL CHECK (tipo IN ('vista','contacto')),
  user_id UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eventos_prop_idx ON public.eventos (property_id, tipo);

CREATE OR REPLACE FUNCTION public.stats_propiedades(ids TEXT[])
RETURNS TABLE (property_id TEXT, vistas BIGINT, contactos BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.property_id, count(*) FILTER (WHERE e.tipo = 'vista'), count(*) FILTER (WHERE e.tipo = 'contacto')
  FROM public.eventos e WHERE e.property_id = ANY (ids[1:200]) GROUP BY e.property_id;
$$;
GRANT EXECUTE ON FUNCTION public.stats_propiedades(TEXT[]) TO anon, authenticated;

-- Calificaciones de agentes (1–5, una por usuario y agente)
CREATE TABLE IF NOT EXISTS public.calificaciones_agente (
  agente TEXT NOT NULL CHECK (char_length(agente) BETWEEN 1 AND 120),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  estrellas SMALLINT NOT NULL CHECK (estrellas BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agente, user_id)
);
CREATE OR REPLACE FUNCTION public.rating_agente(agente TEXT)
RETURNS TABLE (promedio NUMERIC, total BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT round(avg(c.estrellas)::numeric, 2), count(*) FROM public.calificaciones_agente c WHERE c.agente = rating_agente.agente;
$$;
GRANT EXECUTE ON FUNCTION public.rating_agente(TEXT) TO anon, authenticated;

-- Destacadas (agentes con Plus; lectura pública)
CREATE TABLE IF NOT EXISTS public.destacadas (
  property_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  hasta TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permisos
ALTER TABLE public.listas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lista_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alertas_precio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reportes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calificaciones_agente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.destacadas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.listas, public.lista_items, public.alertas_precio, public.calificaciones_agente FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listas, public.lista_items, public.alertas_precio TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calificaciones_agente TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.listas_id_seq, public.alertas_precio_id_seq TO authenticated;
REVOKE ALL ON public.reportes, public.eventos FROM anon, authenticated;
GRANT INSERT ON public.reportes, public.eventos TO anon, authenticated;
GRANT USAGE ON SEQUENCE public.reportes_id_seq, public.eventos_id_seq TO anon, authenticated;
REVOKE ALL ON public.destacadas FROM anon;
GRANT SELECT ON public.destacadas TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.destacadas TO authenticated;

DROP POLICY IF EXISTS "listas propias" ON public.listas;
CREATE POLICY "listas propias" ON public.listas FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "listas crear" ON public.listas;
CREATE POLICY "listas crear" ON public.listas FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND (public.has_plus()
  OR (SELECT count(*) FROM public.listas l WHERE l.user_id = auth.uid()) < 2));
DROP POLICY IF EXISTS "listas editar" ON public.listas;
CREATE POLICY "listas editar" ON public.listas FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "listas borrar" ON public.listas;
CREATE POLICY "listas borrar" ON public.listas FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "items propios" ON public.lista_items;
CREATE POLICY "items propios" ON public.lista_items FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "items crear" ON public.lista_items;
CREATE POLICY "items crear" ON public.lista_items FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.listas l WHERE l.id = lista_id AND l.user_id = auth.uid())
  AND (public.has_plus() OR (SELECT count(*) FROM public.lista_items i WHERE i.user_id = auth.uid()) < 10));
DROP POLICY IF EXISTS "items editar" ON public.lista_items;
CREATE POLICY "items editar" ON public.lista_items FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "items borrar" ON public.lista_items;
CREATE POLICY "items borrar" ON public.lista_items FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "alertas precio propias" ON public.alertas_precio;
CREATE POLICY "alertas precio propias" ON public.alertas_precio FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "alertas precio crear plus" ON public.alertas_precio;
CREATE POLICY "alertas precio crear plus" ON public.alertas_precio FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.has_plus());
DROP POLICY IF EXISTS "alertas precio editar" ON public.alertas_precio;
CREATE POLICY "alertas precio editar" ON public.alertas_precio FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "alertas precio borrar" ON public.alertas_precio;
CREATE POLICY "alertas precio borrar" ON public.alertas_precio FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "reportar" ON public.reportes;
CREATE POLICY "reportar" ON public.reportes FOR INSERT TO anon, authenticated WITH CHECK (user_id IS NULL OR user_id = auth.uid());
DROP POLICY IF EXISTS "registrar evento" ON public.eventos;
CREATE POLICY "registrar evento" ON public.eventos FOR INSERT TO anon, authenticated WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "calificaciones propias" ON public.calificaciones_agente;
CREATE POLICY "calificaciones propias" ON public.calificaciones_agente FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "calificar" ON public.calificaciones_agente;
CREATE POLICY "calificar" ON public.calificaciones_agente FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "recalificar" ON public.calificaciones_agente;
CREATE POLICY "recalificar" ON public.calificaciones_agente FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "destacadas publicas" ON public.destacadas;
CREATE POLICY "destacadas publicas" ON public.destacadas FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "destacar agente plus" ON public.destacadas;
CREATE POLICY "destacar agente plus" ON public.destacadas FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid() AND public.has_plus() AND hasta <= now() + interval '31 days'
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.rol IN ('agente','admin')));
DROP POLICY IF EXISTS "destacar editar" ON public.destacadas;
CREATE POLICY "destacar editar" ON public.destacadas FOR UPDATE TO authenticated USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.has_plus() AND hasta <= now() + interval '31 days');
DROP POLICY IF EXISTS "destacar borrar" ON public.destacadas;
CREATE POLICY "destacar borrar" ON public.destacadas FOR DELETE TO authenticated USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
SELECT 'MapMarket v2 listo ✅' AS resultado;
