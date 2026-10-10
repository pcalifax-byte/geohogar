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
