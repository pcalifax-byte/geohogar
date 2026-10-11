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

-- =====================================================================
-- v3 · ONVO Pay (reemplaza a Tilopay). Idempotente.
-- =====================================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onvo_customer_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onvo_subscription_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onvo_plan TEXT;
CREATE INDEX IF NOT EXISTS profiles_onvo_sub_idx ON public.profiles (onvo_subscription_id);
CREATE INDEX IF NOT EXISTS profiles_onvo_cus_idx ON public.profiles (onvo_customer_id);
ALTER TABLE public.pagos_eventos ADD COLUMN IF NOT EXISTS event_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS pagos_eventos_event_key_uq ON public.pagos_eventos (event_key);
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (nombre) ON public.profiles TO authenticated;
NOTIFY pgrst, 'reload schema';
SELECT 'MapMarket v3 (ONVO) listo ✅' AS resultado;

-- =====================================================================
-- v4 · Mensajes entre usuarios + votos 👍/👎. Idempotente.
-- =====================================================================
-- Dueño de un anuncio publicado en MapMarket (anuncios de usuarios/agentes). Anuncios scrapeados no tienen dueño → soporte.
CREATE TABLE IF NOT EXISTS public.anuncios_duenos (
  listing_id TEXT PRIMARY KEY CHECK (char_length(listing_id) <= 64),
  owner_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.conversaciones (
  id BIGSERIAL PRIMARY KEY,
  listing_id TEXT NOT NULL CHECK (char_length(listing_id) <= 64),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,        -- quien inicia
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,                -- NULL = bandeja «MapMarket soporte»
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS conversaciones_uq ON public.conversaciones (listing_id, user_id);
CREATE INDEX IF NOT EXISTS conversaciones_owner_idx ON public.conversaciones (owner_id);
CREATE TABLE IF NOT EXISTS public.mensajes (
  id BIGSERIAL PRIMARY KEY,
  conversacion_id BIGINT NOT NULL REFERENCES public.conversaciones(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  texto TEXT NOT NULL CHECK (char_length(btrim(texto)) BETWEEN 1 AND 1000),
  leido BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mensajes_conv_idx ON public.mensajes (conversacion_id, created_at);
CREATE INDEX IF NOT EXISTS mensajes_sender_time_idx ON public.mensajes (sender_id, created_at);
CREATE TABLE IF NOT EXISTS public.bloqueos (
  blocker_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS public.reportes_usuarios (
  id BIGSERIAL PRIMARY KEY,
  reporter_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  conversacion_id BIGINT REFERENCES public.conversaciones(id) ON DELETE SET NULL,
  motivo TEXT NOT NULL CHECK (char_length(motivo) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.votos (
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL CHECK (char_length(listing_id) <= 64),
  valor SMALLINT NOT NULL CHECK (valor IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS votos_listing_idx ON public.votos (listing_id);

-- ¿Es participante (o admin en la bandeja de soporte)?
CREATE OR REPLACE FUNCTION public.es_participante(conv BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM conversaciones c WHERE c.id = conv AND (
    c.user_id = auth.uid() OR c.owner_id = auth.uid()
    OR (c.owner_id IS NULL AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.rol = 'admin'))));
$$;

-- Iniciar (o retomar) conversación sobre un anuncio
CREATE OR REPLACE FUNCTION public.iniciar_conversacion(listing TEXT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dueno UUID; cid BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF listing IS NULL OR char_length(listing) > 64 THEN RAISE EXCEPTION 'Anuncio inválido'; END IF;
  SELECT owner_id INTO dueno FROM anuncios_duenos WHERE listing_id = listing;
  IF dueno IS NULL THEN SELECT user_id INTO dueno FROM destacadas WHERE property_id = listing; END IF;
  IF dueno = auth.uid() THEN RAISE EXCEPTION 'Este anuncio es tuyo'; END IF;
  INSERT INTO conversaciones (listing_id, user_id, owner_id) VALUES (listing, auth.uid(), dueno)
  ON CONFLICT (listing_id, user_id) DO UPDATE SET last_at = conversaciones.last_at
  RETURNING id INTO cid;
  RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION public.marcar_leidos(conv BIGINT) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INTEGER;
BEGIN
  IF NOT public.es_participante(conv) THEN RAISE EXCEPTION 'Sin acceso'; END IF;
  UPDATE mensajes SET leido = TRUE WHERE conversacion_id = conv AND sender_id <> auth.uid() AND NOT leido;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.no_leidos() RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id
  WHERE m.sender_id <> auth.uid() AND NOT m.leido AND (c.user_id = auth.uid() OR c.owner_id = auth.uid());
$$;

-- Anti-spam y bloqueos: máx. 8 mensajes/minuto y 200/día por usuario; no se puede escribir a quien te bloqueó
CREATE OR REPLACE FUNCTION public.mensajes_guardia() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE otro UUID; c RECORD;
BEGIN
  NEW.sender_id := auth.uid(); NEW.leido := FALSE; NEW.created_at := now(); NEW.texto := btrim(NEW.texto);
  IF (SELECT count(*) FROM mensajes WHERE sender_id = NEW.sender_id AND created_at > now() - interval '1 minute') >= 8 THEN
    RAISE EXCEPTION 'Demasiados mensajes seguidos. Espera un minuto.'; END IF;
  IF (SELECT count(*) FROM mensajes WHERE sender_id = NEW.sender_id AND created_at > now() - interval '1 day') >= 200 THEN
    RAISE EXCEPTION 'Límite diario de mensajes alcanzado.'; END IF;
  SELECT * INTO c FROM conversaciones WHERE id = NEW.conversacion_id;
  otro := CASE WHEN c.user_id = NEW.sender_id THEN c.owner_id ELSE c.user_id END;
  IF otro IS NOT NULL AND EXISTS (SELECT 1 FROM bloqueos WHERE blocker_id = otro AND blocked_id = NEW.sender_id) THEN
    RAISE EXCEPTION 'No puedes enviar mensajes en esta conversación.'; END IF;
  UPDATE conversaciones SET last_at = now() WHERE id = NEW.conversacion_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mensajes_guardia_trg ON public.mensajes;
CREATE TRIGGER mensajes_guardia_trg BEFORE INSERT ON public.mensajes FOR EACH ROW EXECUTE FUNCTION public.mensajes_guardia();

-- Votos agregados
CREATE OR REPLACE FUNCTION public.votos_resumen(ids TEXT[])
RETURNS TABLE (listing_id TEXT, likes BIGINT, dislikes BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.listing_id, count(*) FILTER (WHERE v.valor = 1), count(*) FILTER (WHERE v.valor = -1)
  FROM votos v WHERE v.listing_id = ANY (ids[1:500]) GROUP BY v.listing_id;
$$;
CREATE OR REPLACE FUNCTION public.mas_gustados(n INTEGER DEFAULT 50)
RETURNS TABLE (listing_id TEXT, likes BIGINT, dislikes BIGINT, score BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.listing_id, count(*) FILTER (WHERE v.valor = 1), count(*) FILTER (WHERE v.valor = -1), sum(v.valor)
  FROM votos v GROUP BY v.listing_id HAVING sum(v.valor) > 0 ORDER BY sum(v.valor) DESC, count(*) DESC LIMIT least(greatest(n, 1), 200);
$$;
CREATE OR REPLACE VIEW public.votos_totales WITH (security_invoker = true) AS
  SELECT listing_id, sum(valor) AS score FROM public.votos GROUP BY listing_id;

-- Permisos
ALTER TABLE public.anuncios_duenos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensajes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bloqueos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reportes_usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.anuncios_duenos, public.conversaciones, public.mensajes, public.bloqueos, public.reportes_usuarios, public.votos FROM anon;
GRANT SELECT, INSERT, DELETE ON public.anuncios_duenos TO authenticated;
GRANT SELECT ON public.conversaciones TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.conversaciones FROM authenticated;   -- se crean solo con iniciar_conversacion()
GRANT SELECT, INSERT ON public.mensajes TO authenticated;
REVOKE UPDATE, DELETE ON public.mensajes FROM authenticated;                 -- leído solo vía marcar_leidos()
GRANT USAGE, SELECT ON SEQUENCE public.mensajes_id_seq, public.reportes_usuarios_id_seq TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.bloqueos TO authenticated;
GRANT INSERT ON public.reportes_usuarios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.votos TO authenticated;
GRANT SELECT ON public.votos_totales TO authenticated;
REVOKE ALL ON FUNCTION public.iniciar_conversacion(TEXT), public.marcar_leidos(BIGINT), public.no_leidos(), public.es_participante(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iniciar_conversacion(TEXT), public.marcar_leidos(BIGINT), public.no_leidos(), public.es_participante(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.votos_resumen(TEXT[]), public.mas_gustados(INTEGER) TO anon, authenticated;

DROP POLICY IF EXISTS "duenos lectura" ON public.anuncios_duenos;
CREATE POLICY "duenos lectura" ON public.anuncios_duenos FOR SELECT TO authenticated USING (owner_id = auth.uid());
DROP POLICY IF EXISTS "duenos registrar" ON public.anuncios_duenos;
CREATE POLICY "duenos registrar" ON public.anuncios_duenos FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid() AND listing_id LIKE 'local-%');
DROP POLICY IF EXISTS "duenos borrar" ON public.anuncios_duenos;
CREATE POLICY "duenos borrar" ON public.anuncios_duenos FOR DELETE TO authenticated USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "conversaciones participantes" ON public.conversaciones;
CREATE POLICY "conversaciones participantes" ON public.conversaciones FOR SELECT TO authenticated USING (public.es_participante(id));
DROP POLICY IF EXISTS "mensajes leer" ON public.mensajes;
CREATE POLICY "mensajes leer" ON public.mensajes FOR SELECT TO authenticated USING (public.es_participante(conversacion_id));
DROP POLICY IF EXISTS "mensajes escribir" ON public.mensajes;
CREATE POLICY "mensajes escribir" ON public.mensajes FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid() AND public.es_participante(conversacion_id));

DROP POLICY IF EXISTS "bloqueos propios" ON public.bloqueos;
CREATE POLICY "bloqueos propios" ON public.bloqueos FOR SELECT TO authenticated USING (blocker_id = auth.uid());
DROP POLICY IF EXISTS "bloquear" ON public.bloqueos;
CREATE POLICY "bloquear" ON public.bloqueos FOR INSERT TO authenticated WITH CHECK (blocker_id = auth.uid() AND blocked_id <> auth.uid());
DROP POLICY IF EXISTS "desbloquear" ON public.bloqueos;
CREATE POLICY "desbloquear" ON public.bloqueos FOR DELETE TO authenticated USING (blocker_id = auth.uid());
DROP POLICY IF EXISTS "reportar usuario" ON public.reportes_usuarios;
CREATE POLICY "reportar usuario" ON public.reportes_usuarios FOR INSERT TO authenticated WITH CHECK (reporter_id = auth.uid());

DROP POLICY IF EXISTS "votos propios" ON public.votos;
CREATE POLICY "votos propios" ON public.votos FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "votar" ON public.votos;
CREATE POLICY "votar" ON public.votos FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "cambiar voto" ON public.votos;
CREATE POLICY "cambiar voto" ON public.votos FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "quitar voto" ON public.votos;
CREATE POLICY "quitar voto" ON public.votos FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Realtime para mensajes (respeta RLS)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'mensajes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mensajes;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
SELECT 'MapMarket v4 (mensajes + votos) listo ✅' AS resultado;

-- =====================================================================
-- v5 · Retiro de contenido + límites anti-abuso para inserciones anónimas. Idempotente.
-- =====================================================================
-- Huella del solicitante: usuario o hash (no reversible) de la IP que reporta el gateway de Supabase.
CREATE OR REPLACE FUNCTION public.origen_hash() RETURNS TEXT
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(auth.uid()::text, 'ip:' || md5(COALESCE(
    split_part(COALESCE(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1),
    current_setting('request.headers', true)::json->>'cf-connecting-ip', 'desconocido') || ':mapmarket'));
$$;

CREATE TABLE IF NOT EXISTS public.retiros (
  id BIGSERIAL PRIMARY KEY,
  listing_ref TEXT NOT NULL CHECK (char_length(listing_ref) BETWEEN 1 AND 300),
  nombre TEXT NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 120),
  email TEXT NOT NULL CHECK (char_length(email) <= 200 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  relacion TEXT NOT NULL CHECK (relacion IN ('propietario','anunciante','autor_fotos','portal','otro')),
  motivo TEXT NOT NULL CHECK (char_length(motivo) BETWEEN 1 AND 1500),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','retirado','rechazado','corregido')),
  origen TEXT,
  user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.reportes ADD COLUMN IF NOT EXISTS origen TEXT;
ALTER TABLE public.eventos  ADD COLUMN IF NOT EXISTS origen TEXT;
CREATE INDEX IF NOT EXISTS reportes_origen_idx ON public.reportes (origen, created_at);
CREATE INDEX IF NOT EXISTS eventos_origen_idx  ON public.eventos (origen, created_at);
CREATE INDEX IF NOT EXISTS retiros_origen_idx  ON public.retiros (origen, created_at);
DO $$ BEGIN
  ALTER TABLE public.reportes ADD CONSTRAINT reportes_prop_len CHECK (char_length(property_id) <= 64);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.limite_anon() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o TEXT := public.origen_hash(); n INT;
BEGIN
  NEW.origen := o; NEW.created_at := now();
  IF TG_TABLE_NAME = 'eventos' THEN
    NEW.user_id := auth.uid();
    -- 1 vista/contacto por anuncio y origen cada hora (los repetidos se descartan en silencio)
    IF EXISTS (SELECT 1 FROM eventos WHERE origen = o AND property_id = NEW.property_id AND tipo = NEW.tipo AND created_at > now() - interval '1 hour') THEN RETURN NULL; END IF;
    SELECT count(*) INTO n FROM eventos WHERE origen = o AND created_at > now() - interval '1 day';
    IF n >= 400 THEN RETURN NULL; END IF;
  ELSIF TG_TABLE_NAME = 'reportes' THEN
    NEW.user_id := auth.uid(); NEW.estado := 'nuevo';
    SELECT count(*) INTO n FROM reportes WHERE origen = o AND created_at > now() - interval '1 day';
    IF n >= 15 THEN RAISE EXCEPTION 'Demasiados reportes hoy. Inténtalo mañana.'; END IF;
    IF EXISTS (SELECT 1 FROM reportes WHERE origen = o AND property_id = NEW.property_id AND created_at > now() - interval '1 day') THEN RAISE EXCEPTION 'Ya reportaste este anuncio hoy. ¡Gracias!'; END IF;
  ELSIF TG_TABLE_NAME = 'retiros' THEN
    NEW.user_id := auth.uid(); NEW.estado := 'pendiente';
    SELECT count(*) INTO n FROM retiros WHERE origen = o AND created_at > now() - interval '1 day';
    IF n >= 5 THEN RAISE EXCEPTION 'Demasiadas solicitudes hoy. Escríbenos a pcalifax@gmail.com.'; END IF;
    IF (SELECT count(*) FROM retiros WHERE created_at > now() - interval '1 hour') >= 100 THEN RAISE EXCEPTION 'Demasiadas solicitudes en este momento. Inténtalo más tarde.'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS limite_anon_trg ON public.eventos;
CREATE TRIGGER limite_anon_trg BEFORE INSERT ON public.eventos FOR EACH ROW EXECUTE FUNCTION public.limite_anon();
DROP TRIGGER IF EXISTS limite_anon_trg ON public.reportes;
CREATE TRIGGER limite_anon_trg BEFORE INSERT ON public.reportes FOR EACH ROW EXECUTE FUNCTION public.limite_anon();
DROP TRIGGER IF EXISTS limite_anon_trg ON public.retiros;
CREATE TRIGGER limite_anon_trg BEFORE INSERT ON public.retiros FOR EACH ROW EXECUTE FUNCTION public.limite_anon();
-- Calificaciones: ya es 1 por usuario y agente (PK agente,user_id); además máx. 30 por día
CREATE OR REPLACE FUNCTION public.limite_calif() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT count(*) FROM calificaciones_agente WHERE user_id = auth.uid() AND created_at > now() - interval '1 day') >= 30 THEN RAISE EXCEPTION 'Límite diario de calificaciones.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS limite_calif_trg ON public.calificaciones_agente;
CREATE TRIGGER limite_calif_trg BEFORE INSERT ON public.calificaciones_agente FOR EACH ROW EXECUTE FUNCTION public.limite_calif();

ALTER TABLE public.retiros ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retiros FROM anon, authenticated;
GRANT INSERT (listing_ref, nombre, email, relacion, motivo) ON public.retiros TO anon, authenticated;
GRANT USAGE ON SEQUENCE public.retiros_id_seq TO anon, authenticated;
DROP POLICY IF EXISTS "solicitar retiro" ON public.retiros;
CREATE POLICY "solicitar retiro" ON public.retiros FOR INSERT TO anon, authenticated WITH CHECK (true);
-- Admin: ver y gestionar reportes / retiros
CREATE OR REPLACE FUNCTION public.es_admin() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND rol = 'admin');
$$;
GRANT EXECUTE ON FUNCTION public.es_admin() TO authenticated;
GRANT SELECT, UPDATE (estado) ON public.retiros, public.reportes TO authenticated;
DROP POLICY IF EXISTS "admin retiros" ON public.retiros;
CREATE POLICY "admin retiros" ON public.retiros FOR SELECT TO authenticated USING (public.es_admin());
DROP POLICY IF EXISTS "admin retiros upd" ON public.retiros;
CREATE POLICY "admin retiros upd" ON public.retiros FOR UPDATE TO authenticated USING (public.es_admin()) WITH CHECK (public.es_admin());
DROP POLICY IF EXISTS "admin reportes" ON public.reportes;
CREATE POLICY "admin reportes" ON public.reportes FOR SELECT TO authenticated USING (public.es_admin());
DROP POLICY IF EXISTS "admin reportes upd" ON public.reportes;
CREATE POLICY "admin reportes upd" ON public.reportes FOR UPDATE TO authenticated USING (public.es_admin()) WITH CHECK (public.es_admin());

NOTIFY pgrst, 'reload schema';
SELECT 'MapMarket v5 (retiros + límites) listo ✅' AS resultado;

-- v6 · Suscripción cancelable por el usuario
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suscripcion_cancelada_at TIMESTAMPTZ;
NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- v7 · Anuncios publicados por usuarios (con moderación) + fotos en Storage + panel admin + alertas por correo. Idempotente.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.anuncios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado','vendido','retirado')),
  motivo_rechazo TEXT CHECK (char_length(motivo_rechazo) <= 300),
  titulo TEXT NOT NULL CHECK (char_length(titulo) BETWEEN 5 AND 140),
  tipo TEXT NOT NULL CHECK (char_length(tipo) <= 40),
  provincia TEXT NOT NULL CHECK (provincia IN ('San José','Alajuela','Cartago','Heredia','Guanacaste','Puntarenas','Limón')),
  zona TEXT CHECK (char_length(zona) <= 120),
  precio NUMERIC NOT NULL CHECK (precio > 0 AND precio < 1e12),
  moneda TEXT NOT NULL CHECK (moneda IN ('USD','CRC')),
  habitaciones SMALLINT CHECK (habitaciones BETWEEN 0 AND 50),
  banos NUMERIC CHECK (banos BETWEEN 0 AND 50),
  area NUMERIC CHECK (area BETWEEN 0 AND 1e8),
  descripcion TEXT CHECK (char_length(descripcion) <= 2000),
  amenidades TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(amenidades) <= 40),
  imagenes TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(imagenes) <= 8),
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN 8 AND 11.3),
  lon DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -86 AND -82.5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS anuncios_estado_idx ON public.anuncios (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS anuncios_owner_idx ON public.anuncios (owner_id);
-- Al crear/editar, el dueño no puede auto-aprobarse; máx. 10 anuncios nuevos por día
CREATE OR REPLACE FUNCTION public.anuncios_guardia() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF public.es_admin() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.owner_id := auth.uid(); NEW.estado := 'pendiente'; NEW.motivo_rechazo := NULL; NEW.created_at := now();
    IF (SELECT count(*) FROM anuncios WHERE owner_id = auth.uid() AND created_at > now() - interval '1 day') >= 10 THEN RAISE EXCEPTION 'Máximo 10 anuncios por día.'; END IF;
  ELSE
    NEW.owner_id := OLD.owner_id; NEW.created_at := OLD.created_at;
    -- el dueño puede marcar vendido/retirado; cualquier otra edición vuelve a revisión
    IF NEW.estado = 'retirado' OR (NEW.estado = 'vendido' AND OLD.estado IN ('aprobado','vendido') AND NEW.titulo = OLD.titulo AND NEW.precio = OLD.precio AND NEW.imagenes = OLD.imagenes AND NEW.descripcion IS NOT DISTINCT FROM OLD.descripcion) THEN NULL;
    ELSE NEW.estado := 'pendiente'; NEW.motivo_rechazo := NULL; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS anuncios_guardia_trg ON public.anuncios;
CREATE TRIGGER anuncios_guardia_trg BEFORE INSERT OR UPDATE ON public.anuncios FOR EACH ROW EXECUTE FUNCTION public.anuncios_guardia();
ALTER TABLE public.anuncios ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.anuncios TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.anuncios TO authenticated;
DROP POLICY IF EXISTS "anuncios publicos" ON public.anuncios;
CREATE POLICY "anuncios publicos" ON public.anuncios FOR SELECT TO anon, authenticated USING (estado IN ('aprobado','vendido') OR owner_id = auth.uid() OR public.es_admin());
DROP POLICY IF EXISTS "anuncios crear" ON public.anuncios;
CREATE POLICY "anuncios crear" ON public.anuncios FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS "anuncios editar" ON public.anuncios;
CREATE POLICY "anuncios editar" ON public.anuncios FOR UPDATE TO authenticated USING (owner_id = auth.uid() OR public.es_admin()) WITH CHECK (owner_id = auth.uid() OR public.es_admin());
DROP POLICY IF EXISTS "anuncios borrar" ON public.anuncios;
CREATE POLICY "anuncios borrar" ON public.anuncios FOR DELETE TO authenticated USING (owner_id = auth.uid() OR public.es_admin());

-- Chat: los anuncios de usuarios (id 'u-<uuid>') tienen dueño
CREATE OR REPLACE FUNCTION public.iniciar_conversacion(listing TEXT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dueno UUID; cid BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF listing IS NULL OR char_length(listing) > 64 THEN RAISE EXCEPTION 'Anuncio inválido'; END IF;
  IF listing ~ '^u-[0-9a-f-]{36}$' THEN SELECT owner_id INTO dueno FROM anuncios WHERE id = substr(listing, 3)::uuid AND estado = 'aprobado'; END IF;
  IF dueno IS NULL THEN SELECT owner_id INTO dueno FROM anuncios_duenos WHERE listing_id = listing; END IF;
  IF dueno IS NULL THEN SELECT user_id INTO dueno FROM destacadas WHERE property_id = listing; END IF;
  IF dueno = auth.uid() THEN RAISE EXCEPTION 'Este anuncio es tuyo'; END IF;
  INSERT INTO conversaciones (listing_id, user_id, owner_id) VALUES (listing, auth.uid(), dueno)
  ON CONFLICT (listing_id, user_id) DO UPDATE SET last_at = conversaciones.last_at
  RETURNING id INTO cid;
  RETURN cid;
END $$;

-- Storage: bucket público de fotos; cada usuario solo escribe en su carpeta <uid>/
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('anuncios', 'anuncios', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];
DROP POLICY IF EXISTS "anuncios fotos subir" ON storage.objects;
CREATE POLICY "anuncios fotos subir" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'anuncios' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "anuncios fotos borrar" ON storage.objects;
CREATE POLICY "anuncios fotos borrar" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'anuncios' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.es_admin()));

-- Admin: reportes de usuarios y lectura de bloqueos
GRANT SELECT ON public.reportes_usuarios TO authenticated;
DROP POLICY IF EXISTS "admin reportes usuarios" ON public.reportes_usuarios;
CREATE POLICY "admin reportes usuarios" ON public.reportes_usuarios FOR SELECT TO authenticated USING (public.es_admin());

-- Alertas por correo: registro de envíos (dedupe por alerta+anuncio)
CREATE TABLE IF NOT EXISTS public.alertas_envios (
  alerta_tipo TEXT NOT NULL CHECK (alerta_tipo IN ('precio','busqueda')),
  alerta_id BIGINT NOT NULL,
  item_id TEXT NOT NULL,
  precio NUMERIC,
  enviada_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (alerta_tipo, alerta_id, item_id)
);
ALTER TABLE public.alertas_envios ENABLE ROW LEVEL SECURITY;   -- solo service_role
-- Vista para la función programada (service_role): zonas como GeoJSON
CREATE OR REPLACE VIEW public.alertas_precio_geo WITH (security_invoker = true) AS
  SELECT a.id, a.user_id, a.nombre, a.precio_max_usd, a.tipo, a.provincia, a.activa,
         extensions.ST_AsGeoJSON(a.zona::extensions.geometry)::json AS zona_geojson, u.email
  FROM public.alertas_precio a JOIN auth.users u ON u.id = a.user_id;
REVOKE ALL ON public.alertas_precio_geo FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
SELECT 'MapMarket v7 (anuncios + storage + admin + alertas) listo ✅' AS resultado;

-- v7b · zonas de búsquedas guardadas como GeoJSON (solo service_role)
CREATE OR REPLACE VIEW public.busquedas_geo WITH (security_invoker = true) AS
  SELECT b.id, b.user_id, b.nombre, b.filtros, b.alerta, extensions.ST_AsGeoJSON(b.zona::extensions.geometry)::json AS zona_geojson, u.email
  FROM public.busquedas_guardadas b JOIN auth.users u ON u.id = b.user_id;
REVOKE ALL ON public.busquedas_geo FROM anon, authenticated;
NOTIFY pgrst, 'reload schema';
GRANT EXECUTE ON FUNCTION public.is_plus(UUID) TO service_role;
SELECT 'MapMarket v7b listo ✅' AS resultado;
-- Programación diaria de alertas (ejecutar aparte, con tu CRON_SECRET; no se guarda en el repo):
--   CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net;
--   SELECT cron.schedule('mapmarket-alertas', '0 13 * * *', $$ SELECT net.http_post('https://<ref>.supabase.co/functions/v1/alertas-email', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('x-cron-secret','<CRON_SECRET>','Content-Type','application/json')) $$);

-- =====================================================================
-- v8 · Datos privados (contenido de terceros) visibles SOLO para administradores. Idempotente.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.privado_propiedades (
  id TEXT PRIMARY KEY, fuente TEXT, titulo TEXT, tipo TEXT, precio NUMERIC, moneda TEXT, provincia TEXT,
  lat DOUBLE PRECISION, lon DOUBLE PRECISION, url TEXT, data JSONB NOT NULL, importado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.privado_remates (
  id TEXT PRIMARY KEY, kind TEXT, fuente TEXT, titulo TEXT, provincia TEXT, canton TEXT, fecha DATE,
  lat DOUBLE PRECISION, lon DOUBLE PRECISION, url TEXT, data JSONB NOT NULL, importado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS privado_prop_prov_idx ON public.privado_propiedades (provincia);
CREATE INDEX IF NOT EXISTS privado_rem_fecha_idx ON public.privado_remates (fecha);
ALTER TABLE public.privado_propiedades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privado_remates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.privado_propiedades, public.privado_remates FROM anon, authenticated;
GRANT SELECT ON public.privado_propiedades, public.privado_remates TO authenticated;
DROP POLICY IF EXISTS "solo admin" ON public.privado_propiedades;
CREATE POLICY "solo admin" ON public.privado_propiedades FOR SELECT TO authenticated USING (public.es_admin());
DROP POLICY IF EXISTS "solo admin" ON public.privado_remates;
CREATE POLICY "solo admin" ON public.privado_remates FOR SELECT TO authenticated USING (public.es_admin());
NOTIFY pgrst, 'reload schema';
SELECT 'MapMarket v8 (datos privados admin) listo ✅' AS resultado;

-- =====================================================================
-- v9 · Administración de usuarios, auditoría y matriz de permisos
-- =====================================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plus_origen TEXT;   -- 'onvo' | 'admin' | NULL
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plus_nota TEXT;

CREATE TABLE IF NOT EXISTS public.admin_auditoria (
  id BIGSERIAL PRIMARY KEY,
  admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  objetivo_id UUID,
  accion TEXT NOT NULL,
  detalle JSONB,
  nota TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_auditoria FROM anon, authenticated;
GRANT SELECT ON public.admin_auditoria TO authenticated;
DROP POLICY IF EXISTS "auditoria admin" ON public.admin_auditoria;
CREATE POLICY "auditoria admin" ON public.admin_auditoria FOR SELECT TO authenticated USING (public.es_admin());

CREATE TABLE IF NOT EXISTS public.permisos (
  perfil TEXT NOT NULL CHECK (perfil IN ('gratis','plus','agente','admin')),
  feature TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT FALSE,
  limite INT,                         -- NULL = sin límite (si activo)
  bloqueado BOOLEAN NOT NULL DEFAULT FALSE,   -- no editable desde el panel (seguridad)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (perfil, feature)
);
ALTER TABLE public.permisos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.permisos FROM anon, authenticated;
GRANT SELECT ON public.permisos TO anon, authenticated;
DROP POLICY IF EXISTS "permisos lectura" ON public.permisos;
CREATE POLICY "permisos lectura" ON public.permisos FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.permisos (perfil, feature, activo, limite, bloqueado) VALUES
 ('gratis','favoritos',true,10,false),('plus','favoritos',true,NULL,false),('agente','favoritos',true,10,false),('admin','favoritos',true,NULL,false),
 ('gratis','listas',true,2,false),('plus','listas',true,NULL,false),('agente','listas',true,2,false),('admin','listas',true,NULL,false),
 ('gratis','busquedas_guardadas',false,NULL,false),('plus','busquedas_guardadas',true,NULL,false),('agente','busquedas_guardadas',false,NULL,false),('admin','busquedas_guardadas',true,NULL,false),
 ('gratis','alertas',false,NULL,false),('plus','alertas',true,NULL,false),('agente','alertas',false,NULL,false),('admin','alertas',true,NULL,false),
 ('gratis','exportar_reportes',false,NULL,false),('plus','exportar_reportes',true,NULL,false),('agente','exportar_reportes',false,NULL,false),('admin','exportar_reportes',true,NULL,false),
 ('gratis','filtros_avanzados',false,NULL,false),('plus','filtros_avanzados',true,NULL,false),('agente','filtros_avanzados',false,NULL,false),('admin','filtros_avanzados',true,NULL,false),
 ('gratis','destacar',false,NULL,false),('plus','destacar',false,NULL,false),('agente','destacar',true,NULL,false),('admin','destacar',true,NULL,false),
 ('gratis','capa_privada',false,NULL,true),('plus','capa_privada',false,NULL,true),('agente','capa_privada',false,NULL,true),('admin','capa_privada',true,NULL,true),
 ('gratis','moderacion',false,NULL,true),('plus','moderacion',false,NULL,true),('agente','moderacion',false,NULL,true),('admin','moderacion',true,NULL,true)
ON CONFLICT (perfil, feature) DO NOTHING;

-- Perfiles efectivos de un usuario: plan (gratis|plus) + rol (agente|admin). Se suma lo permitido.
CREATE OR REPLACE FUNCTION public.perfiles_de(uid UUID) RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ARRAY[CASE WHEN public.is_plus(uid) THEN 'plus' ELSE 'gratis' END]
         || CASE WHEN p.rol IN ('agente','admin') THEN ARRAY[p.rol] ELSE ARRAY[]::TEXT[] END
  FROM public.profiles p WHERE p.id = uid;
$$;
CREATE OR REPLACE FUNCTION public.permitido(f TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(bool_or(activo), false) FROM public.permisos WHERE feature = f AND perfil = ANY(COALESCE(public.perfiles_de(auth.uid()), ARRAY['gratis']));
$$;
-- límite efectivo: NULL = ilimitado; -1 = no permitido
CREATE OR REPLACE FUNCTION public.limite_de(f TEXT) RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT COALESCE(bool_or(activo),false) THEN -1 WHEN bool_or(activo AND limite IS NULL) THEN NULL ELSE max(limite) FILTER (WHERE activo) END
  FROM public.permisos WHERE feature = f AND perfil = ANY(COALESCE(public.perfiles_de(auth.uid()), ARRAY['gratis']));
$$;
REVOKE ALL ON FUNCTION public.perfiles_de(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.permitido(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.limite_de(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perfiles_de(UUID), public.permitido(TEXT), public.limite_de(TEXT) TO authenticated;

-- Límites críticos aplicados en el servidor según la matriz
DROP POLICY IF EXISTS "favoritos insertar con límite" ON public.favoritos;
CREATE POLICY "favoritos insertar con límite" ON public.favoritos FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid() AND public.limite_de('favoritos') IS DISTINCT FROM -1 AND (public.limite_de('favoritos') IS NULL
    OR (SELECT count(*) FROM public.favoritos f WHERE f.user_id = auth.uid()) < public.limite_de('favoritos')));
DROP POLICY IF EXISTS "busquedas crear plus" ON public.busquedas_guardadas;
CREATE POLICY "busquedas crear plus" ON public.busquedas_guardadas FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.permitido('busquedas_guardadas'));
DROP POLICY IF EXISTS "busquedas editar" ON public.busquedas_guardadas;
CREATE POLICY "busquedas editar" ON public.busquedas_guardadas FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND public.permitido('busquedas_guardadas'));
DROP POLICY IF EXISTS "alertas precio crear plus" ON public.alertas_precio;
CREATE POLICY "alertas precio crear plus" ON public.alertas_precio FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.permitido('alertas'));

-- Listado de usuarios (solo admin; auth.users no es legible por RLS)
DROP FUNCTION IF EXISTS public.admin_usuarios(TEXT, TEXT, TEXT, INT, INT);
CREATE FUNCTION public.admin_usuarios(q TEXT DEFAULT '', filtro TEXT DEFAULT '', orden TEXT DEFAULT 'created_at', lim INT DEFAULT 50, desde INT DEFAULT 0)
RETURNS TABLE (id UUID, email TEXT, nombre TEXT, rol TEXT, plan TEXT, plus_activo BOOLEAN, plus_until TIMESTAMPTZ, plus_origen TEXT,
  trial_ends_at TIMESTAMPTZ, trial_used BOOLEAN, created_at TIMESTAMPTZ, last_sign_in TIMESTAMPTZ,
  favoritos BIGINT, publicaciones BIGINT, mensajes BIGINT, total BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH b AS (
    SELECT u.id, u.email::TEXT AS email, p.nombre, COALESCE(p.rol,'usuario') AS rol, COALESCE(p.plan,'gratis') AS plan, public.is_plus(u.id) AS plus_activo,
      p.plus_until, p.plus_origen, p.trial_ends_at, COALESCE(p.trial_used,false) AS trial_used, u.created_at, u.last_sign_in_at AS last_sign_in,
      (SELECT count(*) FROM public.favoritos f WHERE f.user_id = u.id) AS favoritos,
      (SELECT count(*) FROM public.anuncios a WHERE a.owner_id = u.id) AS publicaciones,
      (SELECT count(*) FROM public.mensajes m WHERE m.sender_id = u.id) AS mensajes
    FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
    WHERE (COALESCE(q,'') = '' OR u.email ILIKE '%'||q||'%' OR p.nombre ILIKE '%'||q||'%')
  ), f AS (
    SELECT * FROM b WHERE COALESCE(filtro,'') = '' OR (filtro='plus' AND b.plus_activo) OR (filtro='gratis' AND NOT b.plus_activo)
      OR (filtro='prueba' AND b.trial_ends_at > now()) OR (filtro IN ('usuario','agente','admin') AND b.rol = filtro) OR (filtro='plus_admin' AND b.plus_origen='admin')
  )
  SELECT f.*, count(*) OVER () FROM f
  ORDER BY CASE WHEN orden='email' THEN f.email END ASC,
           CASE WHEN orden='last_sign_in' THEN f.last_sign_in END DESC NULLS LAST,
           CASE WHEN orden='plus_until' THEN f.plus_until END DESC NULLS LAST,
           CASE WHEN orden='mensajes' THEN f.mensajes END DESC,
           f.created_at DESC
  LIMIT LEAST(GREATEST(lim,1),200) OFFSET GREATEST(desde,0);
END $$;

-- Otorgar / extender / revocar Plus (hasta NULL = revocar)
CREATE OR REPLACE FUNCTION public.admin_plus(uid UUID, hasta TIMESTAMPTZ, nota TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE antes JSONB;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object('plan',plan,'plus_until',plus_until,'plus_origen',plus_origen) INTO antes FROM profiles WHERE id = uid;
  IF antes IS NULL THEN RAISE EXCEPTION 'Usuario no encontrado'; END IF;
  IF hasta IS NULL THEN
    UPDATE profiles SET plan='gratis', plus_until=now(), plus_origen=NULL, plus_nota=nota, trial_ends_at=LEAST(trial_ends_at, now()) WHERE id = uid;
  ELSE
    IF hasta <= now() THEN RAISE EXCEPTION 'La fecha debe ser futura'; END IF;
    UPDATE profiles SET plan='plus', plus_until=hasta, plus_origen='admin', plus_nota=nota WHERE id = uid;
  END IF;
  INSERT INTO admin_auditoria(admin_id, objetivo_id, accion, detalle, nota)
  VALUES (auth.uid(), uid, CASE WHEN hasta IS NULL THEN 'plus_revocar' ELSE 'plus_otorgar' END, jsonb_build_object('antes',antes,'hasta',hasta), nota);
END $$;

-- Cambiar rol con protecciones
CREATE OR REPLACE FUNCTION public.admin_rol(uid UUID, nuevo TEXT, nota TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE viejo TEXT;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE = '42501'; END IF;
  IF nuevo NOT IN ('usuario','agente','admin') THEN RAISE EXCEPTION 'Rol inválido'; END IF;
  SELECT rol INTO viejo FROM profiles WHERE id = uid FOR UPDATE;
  IF viejo IS NULL THEN RAISE EXCEPTION 'Usuario no encontrado'; END IF;
  IF viejo = 'admin' AND nuevo <> 'admin' THEN
    IF uid = auth.uid() THEN RAISE EXCEPTION 'No puedes quitarte el rol de administrador a ti mismo (pídeselo a otro admin).'; END IF;
    IF (SELECT count(*) FROM profiles WHERE rol = 'admin') <= 1 THEN RAISE EXCEPTION 'No se puede quitar el último administrador.'; END IF;
  END IF;
  UPDATE profiles SET rol = nuevo WHERE id = uid;
  INSERT INTO admin_auditoria(admin_id, objetivo_id, accion, detalle, nota) VALUES (auth.uid(), uid, 'rol', jsonb_build_object('antes',viejo,'despues',nuevo), nota);
END $$;

-- Editar la matriz de permisos
CREATE OR REPLACE FUNCTION public.admin_permiso(p_perfil TEXT, p_feature TEXT, p_activo BOOLEAN, p_limite INT DEFAULT NULL, nota TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE antes JSONB;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE = '42501'; END IF;
  SELECT to_jsonb(x) INTO antes FROM permisos x WHERE perfil = p_perfil AND feature = p_feature;
  IF antes IS NULL THEN RAISE EXCEPTION 'Permiso desconocido'; END IF;
  IF (antes->>'bloqueado')::BOOLEAN THEN RAISE EXCEPTION 'Este permiso está bloqueado por seguridad'; END IF;
  IF p_limite IS NOT NULL AND p_limite < 0 THEN RAISE EXCEPTION 'Límite inválido'; END IF;
  UPDATE permisos SET activo = p_activo, limite = p_limite, updated_at = now() WHERE perfil = p_perfil AND feature = p_feature;
  INSERT INTO admin_auditoria(admin_id, accion, detalle, nota) VALUES (auth.uid(), 'permiso', jsonb_build_object('antes',antes,'activo',p_activo,'limite',p_limite), nota);
END $$;

REVOKE ALL ON FUNCTION public.admin_usuarios(TEXT,TEXT,TEXT,INT,INT), public.admin_plus(UUID,TIMESTAMPTZ,TEXT), public.admin_rol(UUID,TEXT,TEXT), public.admin_permiso(TEXT,TEXT,BOOLEAN,INT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_usuarios(TEXT,TEXT,TEXT,INT,INT), public.admin_plus(UUID,TIMESTAMPTZ,TEXT), public.admin_rol(UUID,TEXT,TEXT), public.admin_permiso(TEXT,TEXT,BOOLEAN,INT,TEXT) TO authenticated;

-- v9b · Gestión de anuncios por admin (estado pausado, acciones masivas, aviso al dueño, auditoría)
ALTER TABLE public.anuncios DROP CONSTRAINT IF EXISTS anuncios_estado_check;
ALTER TABLE public.anuncios ADD CONSTRAINT anuncios_estado_check CHECK (estado IN ('pendiente','aprobado','rechazado','vendido','retirado','pausado'));

CREATE OR REPLACE FUNCTION public.admin_avisar(dueno UUID, anuncio UUID, texto TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid BIGINT;
BEGIN
  INSERT INTO conversaciones(listing_id, user_id, owner_id) VALUES ('u-'||anuncio, dueno, NULL)
  ON CONFLICT (listing_id, user_id) DO UPDATE SET last_at = now() RETURNING id INTO cid;
  INSERT INTO mensajes(conversacion_id, sender_id, texto) VALUES (cid, auth.uid(), left(texto, 1000));
END $$;
REVOKE ALL ON FUNCTION public.admin_avisar(UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;

-- accion: aprobar | rechazar | pausar | reactivar | eliminar | editar (cambios jsonb)
CREATE OR REPLACE FUNCTION public.admin_anuncios(ids UUID[], accion TEXT, motivo TEXT DEFAULT NULL, cambios JSONB DEFAULT NULL) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; n INT := 0; msg TEXT;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE = '42501'; END IF;
  IF accion NOT IN ('aprobar','rechazar','pausar','reactivar','eliminar','editar') THEN RAISE EXCEPTION 'Acción inválida'; END IF;
  IF accion = 'rechazar' AND COALESCE(btrim(motivo),'') = '' THEN RAISE EXCEPTION 'Indica el motivo del rechazo'; END IF;
  FOR a IN SELECT * FROM anuncios WHERE id = ANY(ids) FOR UPDATE LOOP
    IF accion = 'eliminar' THEN
      DELETE FROM votos WHERE listing_id = 'u-'||a.id;
      DELETE FROM favoritos WHERE property_id = 'u-'||a.id;
      DELETE FROM lista_items WHERE property_id = 'u-'||a.id;
      DELETE FROM destacadas WHERE property_id = 'u-'||a.id;
      DELETE FROM anuncios WHERE id = a.id;
      msg := 'Tu anuncio «'||a.titulo||'» fue eliminado por moderación.'||COALESCE(' Motivo: '||NULLIF(btrim(motivo),''),'');
    ELSIF accion = 'editar' THEN
      UPDATE anuncios SET titulo = COALESCE(cambios->>'titulo', titulo), descripcion = COALESCE(cambios->>'descripcion', descripcion),
        precio = COALESCE((cambios->>'precio')::NUMERIC, precio), moneda = COALESCE(cambios->>'moneda', moneda), tipo = COALESCE(cambios->>'tipo', tipo),
        zona = COALESCE(cambios->>'zona', zona), habitaciones = COALESCE((cambios->>'habitaciones')::SMALLINT, habitaciones),
        banos = COALESCE((cambios->>'banos')::NUMERIC, banos), area = COALESCE((cambios->>'area')::NUMERIC, area) WHERE id = a.id;
      msg := 'Un moderador editó tu anuncio «'||a.titulo||'».'||COALESCE(' Nota: '||NULLIF(btrim(motivo),''),'');
    ELSE
      UPDATE anuncios SET estado = CASE accion WHEN 'aprobar' THEN 'aprobado' WHEN 'rechazar' THEN 'rechazado' WHEN 'pausar' THEN 'pausado' ELSE 'aprobado' END,
        motivo_rechazo = CASE WHEN accion = 'rechazar' THEN left(motivo,300) WHEN accion = 'pausar' THEN left(NULLIF(btrim(motivo),''),300) ELSE NULL END WHERE id = a.id;
      msg := 'Tu anuncio «'||a.titulo||'» '||CASE accion WHEN 'aprobar' THEN 'fue aprobado y ya está en el mapa.' WHEN 'rechazar' THEN 'fue rechazado. Motivo: '||motivo
        WHEN 'pausar' THEN 'fue pausado por moderación.'||COALESCE(' Motivo: '||NULLIF(btrim(motivo),''),'') ELSE 'fue reactivado.' END;
    END IF;
    IF a.owner_id <> auth.uid() THEN PERFORM public.admin_avisar(a.owner_id, a.id, msg); END IF;
    INSERT INTO admin_auditoria(admin_id, objetivo_id, accion, detalle, nota)
    VALUES (auth.uid(), a.owner_id, 'anuncio_'||accion, jsonb_build_object('anuncio', a.id, 'titulo', a.titulo, 'estado_antes', a.estado, 'cambios', cambios, 'imagenes', to_jsonb(a.imagenes)), motivo);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.admin_anuncios(UUID[],TEXT,TEXT,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_anuncios(UUID[],TEXT,TEXT,JSONB) TO authenticated;

-- v9c · Moderación de imágenes
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS baneado BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS public.imagenes_moderacion (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL UNIQUE CHECK (char_length(url) <= 600),
  anuncio_id UUID REFERENCES public.anuncios(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'sin_revisar' CHECK (estado IN ('sin_revisar','aprobada','marcada','rechazada')),
  score JSONB,               -- {cliente:{...}, servidor:{...}}
  fuente TEXT,               -- 'nsfwjs-cliente' | 'sightengine' | ...
  reportes INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revisada_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS imgmod_estado_idx ON public.imagenes_moderacion (estado, created_at DESC);
ALTER TABLE public.imagenes_moderacion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.imagenes_moderacion FROM anon, authenticated;
GRANT SELECT ON public.imagenes_moderacion TO authenticated;
DROP POLICY IF EXISTS "imgmod admin o dueno" ON public.imagenes_moderacion;
CREATE POLICY "imgmod admin o dueno" ON public.imagenes_moderacion FOR SELECT TO authenticated USING (public.es_admin() OR owner_id = auth.uid());
-- URLs ocultas al público (marcadas o rechazadas); solo la URL
CREATE OR REPLACE VIEW public.imagenes_ocultas WITH (security_invoker = false) AS
  SELECT url FROM public.imagenes_moderacion WHERE estado IN ('marcada','rechazada');
GRANT SELECT ON public.imagenes_ocultas TO anon, authenticated;

-- El dueño registra sus fotos con el puntaje del análisis en su navegador
CREATE OR REPLACE FUNCTION public.registrar_imagenes(anuncio UUID, items JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM anuncios WHERE id = anuncio AND owner_id = auth.uid()) THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE='42501'; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(items) LOOP
    IF (it->>'url') NOT LIKE '%/storage/v1/object/public/anuncios/'||auth.uid()||'/%' THEN CONTINUE; END IF;
    INSERT INTO imagenes_moderacion(url, anuncio_id, owner_id, estado, score, fuente)
    VALUES (it->>'url', anuncio, auth.uid(), CASE WHEN (it->>'marcar')::BOOLEAN THEN 'marcada' ELSE 'sin_revisar' END, jsonb_build_object('cliente', it->'score'), 'nsfwjs-cliente')
    ON CONFLICT (url) DO NOTHING;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.registrar_imagenes(UUID,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_imagenes(UUID,JSONB) TO authenticated;

-- «Reportar foto» (usuarios con sesión; 3 reportes la ocultan hasta revisión)
CREATE TABLE IF NOT EXISTS public.reportes_fotos (url TEXT NOT NULL, user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, motivo TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (url, user_id));
ALTER TABLE public.reportes_fotos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reportes_fotos FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.reportar_foto(p_url TEXT, p_motivo TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicia sesión para reportar'; END IF;
  IF (SELECT count(*) FROM reportes_fotos WHERE user_id = auth.uid() AND created_at > now() - interval '1 day') >= 20 THEN RAISE EXCEPTION 'Límite diario de reportes alcanzado'; END IF;
  IF p_url NOT LIKE '%/storage/v1/object/public/anuncios/%' THEN RAISE EXCEPTION 'Foto no válida'; END IF;
  INSERT INTO reportes_fotos(url, user_id, motivo) VALUES (p_url, auth.uid(), left(p_motivo, 300)) ON CONFLICT DO NOTHING;
  SELECT count(*) INTO n FROM reportes_fotos WHERE url = p_url;
  INSERT INTO imagenes_moderacion(url, owner_id, estado, reportes, fuente)
  VALUES (p_url, (SELECT owner_id FROM anuncios WHERE p_url = ANY(imagenes) LIMIT 1), 'sin_revisar', n, 'reporte')
  ON CONFLICT (url) DO UPDATE SET reportes = n, estado = CASE WHEN n >= 3 AND imagenes_moderacion.estado <> 'aprobada' THEN 'marcada' ELSE imagenes_moderacion.estado END;
END $$;
REVOKE ALL ON FUNCTION public.reportar_foto(TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reportar_foto(TEXT,TEXT) TO authenticated;

-- Acciones de admin sobre imágenes: aprobar | rechazar | eliminar | banear (al dueño)
CREATE OR REPLACE FUNCTION public.admin_imagenes(ids BIGINT[], accion TEXT, nota TEXT DEFAULT NULL) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; n INT := 0;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE='42501'; END IF;
  IF accion NOT IN ('aprobar','rechazar','eliminar','banear') THEN RAISE EXCEPTION 'Acción inválida'; END IF;
  FOR r IN SELECT * FROM imagenes_moderacion WHERE id = ANY(ids) LOOP
    IF accion = 'aprobar' THEN UPDATE imagenes_moderacion SET estado='aprobada', revisada_at=now() WHERE id = r.id;
    ELSIF accion IN ('rechazar','eliminar') THEN
      UPDATE imagenes_moderacion SET estado='rechazada', revisada_at=now() WHERE id = r.id;
      IF accion = 'eliminar' THEN UPDATE anuncios SET imagenes = array_remove(imagenes, r.url) WHERE r.url = ANY(imagenes); END IF;
    ELSIF accion = 'banear' AND r.owner_id IS NOT NULL THEN
      IF r.owner_id = auth.uid() THEN RAISE EXCEPTION 'No puedes banearte a ti mismo'; END IF;
      UPDATE profiles SET baneado = TRUE WHERE id = r.owner_id;
      UPDATE imagenes_moderacion SET estado='rechazada', revisada_at=now() WHERE id = r.id;
      UPDATE anuncios SET estado='pausado', motivo_rechazo='Cuenta suspendida por moderación' WHERE owner_id = r.owner_id AND estado IN ('aprobado','pendiente');
    END IF;
    INSERT INTO admin_auditoria(admin_id, objetivo_id, accion, detalle, nota) VALUES (auth.uid(), r.owner_id, 'imagen_'||accion, jsonb_build_object('imagen', r.id, 'url', r.url), nota);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.admin_imagenes(BIGINT[],TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_imagenes(BIGINT[],TEXT,TEXT) TO authenticated;

-- Usuarios baneados no pueden publicar ni editar anuncios
CREATE OR REPLACE FUNCTION public.anuncios_baneo() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.es_admin() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND baneado) THEN RAISE EXCEPTION 'Tu cuenta está suspendida para publicar.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS anuncios_baneo_trg ON public.anuncios;
CREATE TRIGGER anuncios_baneo_trg BEFORE INSERT OR UPDATE ON public.anuncios FOR EACH ROW EXECUTE FUNCTION public.anuncios_baneo();
NOTIFY pgrst, 'reload schema';
SELECT 'MapMarket v9 (usuarios, permisos, anuncios admin) listo ✅' AS resultado;

-- =====================================================================
-- v10 · Planes Gratis / Plus / Pro, límites de anuncios activos y destacados Pro
-- =====================================================================
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
UPDATE public.profiles SET plan = 'free' WHERE plan = 'gratis';
ALTER TABLE public.profiles ALTER COLUMN plan SET DEFAULT 'free';
ALTER TABLE public.profiles ADD CONSTRAINT profiles_plan_check CHECK (plan IN ('free','plus','pro','gratis'));  -- 'gratis' = valor antiguo, equivale a free

CREATE OR REPLACE FUNCTION public.is_pro(uid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND plan = 'pro' AND (plus_until IS NULL OR plus_until > now()));
$$;
CREATE OR REPLACE FUNCTION public.is_plus(uid UUID) RETURNS BOOLEAN       -- Plus o Pro (Pro incluye todo Plus) o prueba
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND (
    (plan IN ('plus','pro') AND (plus_until IS NULL OR plus_until > now()))
    OR (trial_ends_at IS NOT NULL AND trial_ends_at > now())));
$$;
CREATE OR REPLACE FUNCTION public.has_pro() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT public.is_pro(auth.uid()); $$;
REVOKE ALL ON FUNCTION public.is_pro(UUID), public.has_pro() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_pro(UUID), public.has_pro() TO authenticated;

ALTER TABLE public.permisos DROP CONSTRAINT IF EXISTS permisos_perfil_check;
ALTER TABLE public.permisos ADD CONSTRAINT permisos_perfil_check CHECK (perfil IN ('gratis','plus','pro','agente','admin'));
-- Pro hereda la configuración de Plus
INSERT INTO public.permisos (perfil, feature, activo, limite, bloqueado)
  SELECT 'pro', feature, activo, limite, bloqueado FROM public.permisos WHERE perfil = 'plus' ON CONFLICT DO NOTHING;
INSERT INTO public.permisos (perfil, feature, activo, limite, bloqueado) VALUES
 ('gratis','anuncios_activos',true,1,false),('plus','anuncios_activos',true,3,false),('pro','anuncios_activos',true,5,false),('agente','anuncios_activos',true,1,false),('admin','anuncios_activos',true,NULL,false)
ON CONFLICT DO NOTHING;
-- Destacar: solo Pro (y admin)
UPDATE public.permisos SET activo = (perfil IN ('pro','admin')), updated_at = now() WHERE feature = 'destacar' AND NOT EXISTS (SELECT 1 FROM public.admin_auditoria WHERE accion = 'permiso' AND detalle->'antes'->>'feature' = 'destacar');

CREATE OR REPLACE FUNCTION public.perfiles_de(uid UUID) RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ARRAY[CASE WHEN public.is_pro(uid) THEN 'pro' WHEN public.is_plus(uid) THEN 'plus' ELSE 'gratis' END]
         || CASE WHEN p.rol IN ('agente','admin') THEN ARRAY[p.rol] ELSE ARRAY[]::TEXT[] END
  FROM public.profiles p WHERE p.id = uid;
$$;

-- Límite de anuncios activos (pendiente + aprobado + pausado) aplicado en el servidor
CREATE OR REPLACE FUNCTION public.anuncios_limite() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lim INT; n INT;
BEGIN
  IF public.es_admin() THEN RETURN NEW; END IF;
  IF NEW.estado NOT IN ('pendiente','aprobado','pausado') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.estado IN ('pendiente','aprobado','pausado') THEN RETURN NEW; END IF;
  lim := public.limite_de('anuncios_activos');
  IF lim IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO n FROM anuncios WHERE owner_id = NEW.owner_id AND estado IN ('pendiente','aprobado','pausado') AND id <> NEW.id;
  IF n >= GREATEST(lim,0) THEN
    RAISE EXCEPTION 'LIMITE_ANUNCIOS: Tu plan permite % anuncio(s) activo(s). Mejora tu plan en planes.html o marca alguno como vendido/retirado.', GREATEST(lim,0);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS anuncios_limite_trg ON public.anuncios;
CREATE TRIGGER anuncios_limite_trg BEFORE INSERT OR UPDATE OF estado ON public.anuncios FOR EACH ROW EXECUTE FUNCTION public.anuncios_limite();

-- Destacados: permiso 'destacar' (Pro/admin); Pro solo sus propios anuncios
DROP POLICY IF EXISTS "destacar agente plus" ON public.destacadas;
CREATE POLICY "destacar agente plus" ON public.destacadas FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid() AND public.permitido('destacar') AND hasta <= now() + interval '31 days'
  AND (public.es_admin() OR EXISTS (SELECT 1 FROM public.anuncios a WHERE 'u-'||a.id = property_id AND a.owner_id = auth.uid()))
  AND (public.es_admin() OR (SELECT count(*) FROM public.destacadas d WHERE d.user_id = auth.uid() AND d.hasta > now()) < 5));
DROP POLICY IF EXISTS "destacar editar" ON public.destacadas;
CREATE POLICY "destacar editar" ON public.destacadas FOR UPDATE TO authenticated USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.permitido('destacar') AND hasta <= now() + interval '31 days');

-- Admin: otorgar Plus o Pro con duración
CREATE OR REPLACE FUNCTION public.admin_plan(uid UUID, nivel TEXT, hasta TIMESTAMPTZ, nota TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE antes JSONB;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE = '42501'; END IF;
  IF nivel NOT IN ('free','plus','pro') THEN RAISE EXCEPTION 'Plan inválido'; END IF;
  SELECT jsonb_build_object('plan',plan,'plus_until',plus_until,'plus_origen',plus_origen) INTO antes FROM profiles WHERE id = uid;
  IF antes IS NULL THEN RAISE EXCEPTION 'Usuario no encontrado'; END IF;
  IF nivel = 'free' OR hasta IS NULL THEN
    UPDATE profiles SET plan='free', plus_until=now(), plus_origen=NULL, plus_nota=nota, trial_ends_at=LEAST(trial_ends_at, now()) WHERE id = uid;
  ELSE
    IF hasta <= now() THEN RAISE EXCEPTION 'La fecha debe ser futura'; END IF;
    UPDATE profiles SET plan=nivel, plus_until=hasta, plus_origen='admin', plus_nota=nota WHERE id = uid;
  END IF;
  INSERT INTO admin_auditoria(admin_id, objetivo_id, accion, detalle, nota)
  VALUES (auth.uid(), uid, CASE WHEN nivel='free' OR hasta IS NULL THEN 'plan_revocar' ELSE 'plan_otorgar' END, jsonb_build_object('antes',antes,'nivel',nivel,'hasta',hasta), nota);
END $$;
CREATE OR REPLACE FUNCTION public.admin_plus(uid UUID, hasta TIMESTAMPTZ, nota TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT public.admin_plan(uid, CASE WHEN hasta IS NULL THEN 'free' ELSE 'plus' END, hasta, nota); $$;
REVOKE ALL ON FUNCTION public.admin_plan(UUID,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_plan(UUID,TEXT,TIMESTAMPTZ,TEXT) TO authenticated;

-- admin_usuarios: exponer el plan real
DROP FUNCTION IF EXISTS public.admin_usuarios(TEXT, TEXT, TEXT, INT, INT);
CREATE FUNCTION public.admin_usuarios(q TEXT DEFAULT '', filtro TEXT DEFAULT '', orden TEXT DEFAULT 'created_at', lim INT DEFAULT 50, desde INT DEFAULT 0)
RETURNS TABLE (id UUID, email TEXT, nombre TEXT, rol TEXT, plan TEXT, plus_activo BOOLEAN, plus_until TIMESTAMPTZ, plus_origen TEXT,
  trial_ends_at TIMESTAMPTZ, trial_used BOOLEAN, created_at TIMESTAMPTZ, last_sign_in TIMESTAMPTZ,
  favoritos BIGINT, publicaciones BIGINT, mensajes BIGINT, total BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH b AS (
    SELECT u.id, u.email::TEXT AS email, p.nombre, COALESCE(p.rol,'usuario') AS rol,
      CASE WHEN public.is_pro(u.id) THEN 'pro' WHEN public.is_plus(u.id) THEN 'plus' ELSE 'free' END AS plan, public.is_plus(u.id) AS plus_activo,
      p.plus_until, p.plus_origen, p.trial_ends_at, COALESCE(p.trial_used,false) AS trial_used, u.created_at, u.last_sign_in_at AS last_sign_in,
      (SELECT count(*) FROM public.favoritos f WHERE f.user_id = u.id) AS favoritos,
      (SELECT count(*) FROM public.anuncios a WHERE a.owner_id = u.id) AS publicaciones,
      (SELECT count(*) FROM public.mensajes m WHERE m.sender_id = u.id) AS mensajes
    FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
    WHERE (COALESCE(q,'') = '' OR u.email ILIKE '%'||q||'%' OR p.nombre ILIKE '%'||q||'%')
  ), f AS (
    SELECT * FROM b WHERE COALESCE(filtro,'') = '' OR (filtro='plus' AND b.plan='plus') OR (filtro='pro' AND b.plan='pro') OR (filtro='gratis' AND b.plan='free')
      OR (filtro='prueba' AND b.trial_ends_at > now()) OR (filtro IN ('usuario','agente','admin') AND b.rol = filtro) OR (filtro='plus_admin' AND b.plus_origen='admin')
  )
  SELECT f.*, count(*) OVER () FROM f
  ORDER BY CASE WHEN orden='email' THEN f.email END ASC,
           CASE WHEN orden='last_sign_in' THEN f.last_sign_in END DESC NULLS LAST,
           CASE WHEN orden='plus_until' THEN f.plus_until END DESC NULLS LAST,
           CASE WHEN orden='mensajes' THEN f.mensajes END DESC,
           f.created_at DESC
  LIMIT LEAST(GREATEST(lim,1),200) OFFSET GREATEST(desde,0);
END $$;
REVOKE ALL ON FUNCTION public.admin_usuarios(TEXT,TEXT,TEXT,INT,INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_usuarios(TEXT,TEXT,TEXT,INT,INT) TO authenticated;

-- valores nuevos en funciones existentes
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, nombre, email, plan)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'nombre', lower(NEW.email), 'free')
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END $$;
NOTIFY pgrst, 'reload schema';
SELECT 'MapMarket v10 (planes Gratis/Plus/Pro) listo ✅' AS resultado;

-- =====================================================================
-- v11 · Contorno del terreno en anuncios + Datos personales del perfil
-- =====================================================================
ALTER TABLE public.anuncios ADD COLUMN IF NOT EXISTS poligono JSONB;          -- GeoJSON Polygon (lon,lat)
ALTER TABLE public.anuncios ADD COLUMN IF NOT EXISTS area_terreno NUMERIC;     -- m² calculados del contorno
ALTER TABLE public.anuncios DROP CONSTRAINT IF EXISTS anuncios_poligono_chk;
ALTER TABLE public.anuncios ADD CONSTRAINT anuncios_poligono_chk CHECK (poligono IS NULL OR (poligono->>'type' = 'Polygon' AND jsonb_typeof(poligono->'coordinates'->0) = 'array' AND jsonb_array_length(poligono->'coordinates'->0) BETWEEN 4 AND 600 AND octet_length(poligono::text) < 40000));
ALTER TABLE public.anuncios DROP CONSTRAINT IF EXISTS anuncios_area_terreno_chk;
ALTER TABLE public.anuncios ADD CONSTRAINT anuncios_area_terreno_chk CHECK (area_terreno IS NULL OR area_terreno BETWEEN 0 AND 1e9);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS apellidos TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS whatsapp BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telefono_publico BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS provincia TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS canton TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS distrito TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS senas TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cedula TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS foto_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS idioma TEXT NOT NULL DEFAULT 'es';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_datos_chk;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_datos_chk CHECK (
  (nombre IS NULL OR char_length(nombre) <= 80) AND (apellidos IS NULL OR char_length(apellidos) <= 100)
  AND (telefono IS NULL OR telefono ~ '^\+506[2-8][0-9]{7}$')
  AND (provincia IS NULL OR provincia IN ('San José','Alajuela','Cartago','Heredia','Guanacaste','Puntarenas','Limón'))
  AND (canton IS NULL OR char_length(canton) <= 60) AND (distrito IS NULL OR char_length(distrito) <= 60) AND (senas IS NULL OR char_length(senas) <= 300)
  AND (cedula IS NULL OR cedula ~ '^[0-9A-Za-z-]{9,20}$')
  AND (foto_url IS NULL OR foto_url LIKE '%/storage/v1/object/public/avatares/%')
  AND idioma IN ('es','en'));
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (nombre, apellidos, telefono, whatsapp, telefono_publico, provincia, canton, distrito, senas, cedula, foto_url, idioma) ON public.profiles TO authenticated;
DROP POLICY IF EXISTS "perfil admin lectura" ON public.profiles;
CREATE POLICY "perfil admin lectura" ON public.profiles FOR SELECT TO authenticated USING (public.es_admin());
DROP POLICY IF EXISTS "perfil admin editar" ON public.profiles;
CREATE POLICY "perfil admin editar" ON public.profiles FOR UPDATE TO authenticated USING (public.es_admin()) WITH CHECK (public.es_admin());

-- Vista pública mínima: solo nombre y foto de agentes/anunciantes; teléfono solo si el dueño lo permite
CREATE OR REPLACE VIEW public.perfiles_publicos WITH (security_invoker = false) AS
  SELECT p.id, p.nombre,
    CASE WHEN p.foto_url IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.imagenes_moderacion m WHERE m.url = p.foto_url AND m.estado IN ('marcada','rechazada')) THEN p.foto_url END AS foto_url,
    CASE WHEN p.telefono_publico THEN p.telefono END AS telefono,
    CASE WHEN p.telefono_publico THEN p.whatsapp ELSE FALSE END AS whatsapp,
    p.rol
  FROM public.profiles p
  WHERE p.rol IN ('agente','admin') OR EXISTS (SELECT 1 FROM public.anuncios a WHERE a.owner_id = p.id AND a.estado IN ('aprobado','vendido'));
REVOKE ALL ON public.perfiles_publicos FROM anon, authenticated;
GRANT SELECT ON public.perfiles_publicos TO anon, authenticated;

-- Foto de perfil: bucket público 'avatares' (carpeta = id del usuario) + cola de moderación
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('avatares','avatares',true,1048576,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 1048576;
DROP POLICY IF EXISTS "avatares subir" ON storage.objects;
CREATE POLICY "avatares subir" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatares' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "avatares borrar" ON storage.objects;
CREATE POLICY "avatares borrar" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'avatares' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.es_admin()));
CREATE OR REPLACE FUNCTION public.registrar_avatar(p_url TEXT, p_score JSONB DEFAULT NULL, p_marcar BOOLEAN DEFAULT FALSE) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_url NOT LIKE '%/storage/v1/object/public/avatares/'||auth.uid()||'/%' THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE='42501'; END IF;
  INSERT INTO imagenes_moderacion(url, owner_id, estado, score, fuente) VALUES (p_url, auth.uid(), CASE WHEN p_marcar THEN 'marcada' ELSE 'sin_revisar' END, jsonb_build_object('cliente', p_score), 'avatar')
  ON CONFLICT (url) DO NOTHING;
  UPDATE profiles SET foto_url = p_url WHERE id = auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.registrar_avatar(TEXT,JSONB,BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_avatar(TEXT,JSONB,BOOLEAN) TO authenticated;

-- Admin: ficha completa de un usuario
CREATE OR REPLACE FUNCTION public.admin_usuario_datos(uid UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT jsonb_build_object('nombre',nombre,'apellidos',apellidos,'telefono',telefono,'whatsapp',whatsapp,'telefono_publico',telefono_publico,'provincia',provincia,'canton',canton,'distrito',distrito,'senas',senas,'cedula',cedula,'foto_url',foto_url,'idioma',idioma,'baneado',baneado) FROM profiles WHERE id = uid);
END $$;
REVOKE ALL ON FUNCTION public.admin_usuario_datos(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_usuario_datos(UUID) TO authenticated;
NOTIFY pgrst, 'reload schema';
SELECT 'MapMarket v11 (contornos + datos personales) listo ✅' AS resultado;

-- ═════════ v12 · Gestión de reportes (agrupados, resolución con nota, bloqueo de dueño) ═════════
ALTER TABLE public.reportes ADD COLUMN IF NOT EXISTS nota_admin TEXT, ADD COLUMN IF NOT EXISTS resuelto_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS resuelto_por UUID;
ALTER TABLE public.retiros ADD COLUMN IF NOT EXISTS nota_admin TEXT, ADD COLUMN IF NOT EXISTS resuelto_at TIMESTAMPTZ;
ALTER TABLE public.reportes_fotos ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'abierto';
CREATE OR REPLACE FUNCTION public.admin_reportes(ids BIGINT[], accion TEXT, nota TEXT DEFAULT NULL) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE='42501'; END IF;
  IF accion NOT IN ('resuelto','descartado','reabrir') THEN RAISE EXCEPTION 'Acción inválida'; END IF;
  UPDATE reportes SET estado = CASE WHEN accion='reabrir' THEN 'nuevo' ELSE accion END, nota_admin = COALESCE(nota, nota_admin),
    resuelto_at = CASE WHEN accion='reabrir' THEN NULL ELSE now() END, resuelto_por = CASE WHEN accion='reabrir' THEN NULL ELSE auth.uid() END
  WHERE id = ANY(ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO admin_auditoria(admin_id, accion, detalle, nota) VALUES (auth.uid(), 'reportes_'||accion, jsonb_build_object('ids', ids), nota);
  RETURN n;
END $$;
CREATE OR REPLACE FUNCTION public.admin_retiros(ids BIGINT[], estado_nuevo TEXT, nota TEXT DEFAULT NULL) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE='42501'; END IF;
  IF estado_nuevo NOT IN ('pendiente','retirado','rechazado','corregido') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
  UPDATE retiros SET estado = estado_nuevo, nota_admin = COALESCE(nota, nota_admin), resuelto_at = CASE WHEN estado_nuevo='pendiente' THEN NULL ELSE now() END WHERE id = ANY(ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO admin_auditoria(admin_id, accion, detalle, nota) VALUES (auth.uid(), 'retiros_'||estado_nuevo, jsonb_build_object('ids', ids), nota);
  RETURN n;
END $$;
CREATE OR REPLACE FUNCTION public.admin_reportes_fotos(urls TEXT[], accion TEXT, nota TEXT DEFAULT NULL) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE='42501'; END IF;
  IF accion NOT IN ('resuelto','descartado','reabrir') THEN RAISE EXCEPTION 'Acción inválida'; END IF;
  UPDATE reportes_fotos SET estado = CASE WHEN accion='reabrir' THEN 'abierto' ELSE accion END WHERE url = ANY(urls);
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO admin_auditoria(admin_id, accion, detalle, nota) VALUES (auth.uid(), 'reportes_fotos_'||accion, jsonb_build_object('urls', urls), nota);
  RETURN n;
END $$;
-- Lista de reportes de fotos agrupados (solo admin)
CREATE OR REPLACE FUNCTION public.admin_lista_reportes_fotos(p_estado TEXT DEFAULT 'abierto') RETURNS TABLE(url TEXT, n BIGINT, motivos TEXT[], ultimo TIMESTAMPTZ, img_id BIGINT, img_estado TEXT, owner_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT r.url, count(*), array_remove(array_agg(DISTINCT r.motivo), NULL), max(r.created_at), m.id, m.estado, m.owner_id
    FROM reportes_fotos r LEFT JOIN imagenes_moderacion m ON m.url = r.url
    WHERE (p_estado = 'todos' OR r.estado = p_estado OR (p_estado='cerrado' AND r.estado <> 'abierto'))
    GROUP BY r.url, m.id, m.estado, m.owner_id ORDER BY count(*) DESC, max(r.created_at) DESC LIMIT 300;
END $$;
CREATE OR REPLACE FUNCTION public.admin_bloquear_dueno(uid UUID, nota TEXT DEFAULT NULL) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE='42501'; END IF;
  IF uid = auth.uid() THEN RAISE EXCEPTION 'No puedes bloquearte a ti mismo'; END IF;
  UPDATE profiles SET baneado = TRUE WHERE id = uid;
  UPDATE anuncios SET estado = 'pausado' WHERE owner_id = uid AND estado IN ('aprobado','pendiente');
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO admin_auditoria(admin_id, objetivo_id, accion, detalle, nota) VALUES (auth.uid(), uid, 'bloquear_dueno', jsonb_build_object('anuncios_pausados', n), nota);
  RETURN n;
END $$;
DO $$ DECLARE f TEXT; BEGIN FOREACH f IN ARRAY ARRAY['admin_reportes(BIGINT[],TEXT,TEXT)','admin_retiros(BIGINT[],TEXT,TEXT)','admin_reportes_fotos(TEXT[],TEXT,TEXT)','admin_lista_reportes_fotos(TEXT)','admin_bloquear_dueno(UUID,TEXT)'] LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION public.'||f||' FROM PUBLIC, anon'; EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||f||' TO authenticated'; END LOOP; END $$;
NOTIFY pgrst, 'reload schema';
SELECT 'MapMarket v12 (reportes) listo ✅' AS resultado;

-- ═════════ v13 · Notificaciones (in-app + push + correo), zonas guardadas, visitas, estadísticas, destacado pagado, métricas ═════════
CREATE TABLE IF NOT EXISTS public.app_config (k TEXT PRIMARY KEY, v TEXT NOT NULL);
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.app_config FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.notificaciones (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL CHECK (char_length(titulo) <= 160),
  cuerpo TEXT CHECK (char_length(cuerpo) <= 500),
  url TEXT CHECK (char_length(url) <= 300),
  datos JSONB,
  leida BOOLEAN NOT NULL DEFAULT FALSE,
  correo_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notif_user_idx ON public.notificaciones (user_id, leida, created_at DESC);
ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notificaciones FROM anon; REVOKE INSERT, DELETE ON public.notificaciones FROM authenticated;
GRANT SELECT, UPDATE (leida) ON public.notificaciones TO authenticated;
DROP POLICY IF EXISTS "notif propias" ON public.notificaciones;
CREATE POLICY "notif propias" ON public.notificaciones FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "notif marcar" ON public.notificaciones;
CREATE POLICY "notif marcar" ON public.notificaciones FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.notificaciones; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.push_subs (
  endpoint TEXT PRIMARY KEY CHECK (char_length(endpoint) <= 600),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL, ua TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.push_subs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subs TO authenticated;
DROP POLICY IF EXISTS "push propias" ON public.push_subs;
CREATE POLICY "push propias" ON public.push_subs FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notif_correo BOOLEAN NOT NULL DEFAULT TRUE;
GRANT UPDATE (notif_correo) ON public.profiles TO authenticated;

-- Crea una notificación y dispara el envío push (pg_net → edge function push-enviar)
CREATE OR REPLACE FUNCTION public.notificar(uid UUID, p_tipo TEXT, p_titulo TEXT, p_cuerpo TEXT DEFAULT NULL, p_url TEXT DEFAULT NULL, p_datos JSONB DEFAULT NULL) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE nid BIGINT; sec TEXT; base TEXT;
BEGIN
  IF uid IS NULL THEN RETURN NULL; END IF;
  -- evita duplicados idénticos en 1 hora
  IF EXISTS (SELECT 1 FROM notificaciones WHERE user_id = uid AND tipo = p_tipo AND titulo = p_titulo AND COALESCE(url,'') = COALESCE(p_url,'') AND created_at > now() - interval '1 hour') THEN RETURN NULL; END IF;
  INSERT INTO notificaciones(user_id, tipo, titulo, cuerpo, url, datos) VALUES (uid, p_tipo, p_titulo, p_cuerpo, p_url, p_datos) RETURNING id INTO nid;
  SELECT v INTO sec FROM app_config WHERE k = 'push_secret'; SELECT v INTO base FROM app_config WHERE k = 'functions_url';
  IF sec IS NOT NULL AND base IS NOT NULL AND EXISTS (SELECT 1 FROM push_subs WHERE user_id = uid) THEN
    BEGIN PERFORM net.http_post(base || '/push-enviar', jsonb_build_object('id', nid), '{}'::jsonb, jsonb_build_object('x-push-secret', sec, 'Content-Type', 'application/json'));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN nid;
END $$;
REVOKE ALL ON FUNCTION public.notificar(UUID,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;

-- Mensaje nuevo → notifica al otro participante
CREATE OR REPLACE FUNCTION public.trg_notif_mensaje() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c RECORD; dest UUID;
BEGIN
  SELECT * INTO c FROM conversaciones WHERE id = NEW.conversacion_id;
  dest := CASE WHEN NEW.sender_id = c.user_id THEN c.owner_id ELSE c.user_id END;
  IF dest IS NOT NULL AND dest <> NEW.sender_id THEN
    PERFORM notificar(dest, 'mensaje', '💬 Nuevo mensaje', left(NEW.texto, 140), 'mensajes.html?c=' || c.id, jsonb_build_object('conv', c.id));
  END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notif_mensaje ON public.mensajes;
CREATE TRIGGER notif_mensaje AFTER INSERT ON public.mensajes FOR EACH ROW EXECUTE FUNCTION public.trg_notif_mensaje();

-- Zonas guardadas: avisar a quien tenga una zona que contiene el anuncio
CREATE OR REPLACE FUNCTION public.notificar_zonas(a public.anuncios, p_tipo TEXT, p_titulo TEXT) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE b RECORD; n INT := 0;
BEGIN
  FOR b IN SELECT DISTINCT ON (user_id) id, user_id, nombre FROM busquedas_guardadas
    WHERE alerta AND zona IS NOT NULL AND user_id <> a.owner_id
      AND extensions.ST_Covers(zona, extensions.ST_SetSRID(extensions.ST_MakePoint(a.lon, a.lat), 4326)::extensions.geography)
  LOOP
    PERFORM notificar(b.user_id, p_tipo, p_titulo, a.titulo || ' · ' || CASE WHEN a.moneda='CRC' THEN '₡' ELSE '$' END || to_char(a.precio, 'FM999G999G999G999'), 'index.html?p=u-' || a.id, jsonb_build_object('zona', b.id, 'zona_nombre', b.nombre, 'anuncio', a.id));
    n := n + 1;
  END LOOP; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.notificar_zonas(public.anuncios,TEXT,TEXT) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.anuncios ADD COLUMN IF NOT EXISTS destacado_until TIMESTAMPTZ;
CREATE OR REPLACE FUNCTION public.trg_notif_anuncio() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NEW.estado = 'aprobado' THEN
      PERFORM notificar(NEW.owner_id, 'anuncio_aprobado', '✅ Tu anuncio fue aprobado', NEW.titulo, 'index.html?p=u-' || NEW.id);
      PERFORM notificar_zonas(NEW, 'zona_nuevo', '🏠 Nueva propiedad en tu zona');
    ELSIF NEW.estado = 'rechazado' THEN
      PERFORM notificar(NEW.owner_id, 'anuncio_rechazado', '⛔ Tu anuncio fue rechazado', NEW.titulo || COALESCE(' · ' || NEW.motivo_rechazo, ''), 'cuenta.html');
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.estado = 'aprobado' THEN
    IF NEW.precio < OLD.precio AND NEW.moneda = OLD.moneda THEN
      PERFORM notificar_zonas(NEW, 'zona_rebaja', '⬇️ Bajó de precio en tu zona');
      INSERT INTO precio_historial_anuncios(anuncio_id, precio, moneda) VALUES (NEW.id, OLD.precio, OLD.moneda) ON CONFLICT DO NOTHING;
    END IF;
    IF NEW.destacado_until IS NOT NULL AND NEW.destacado_until > now() AND (OLD.destacado_until IS NULL OR OLD.destacado_until < now()) THEN
      PERFORM notificar_zonas(NEW, 'zona_destacado', '★ Propiedad destacada en tu zona');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TABLE IF NOT EXISTS public.precio_historial_anuncios (anuncio_id UUID REFERENCES public.anuncios(id) ON DELETE CASCADE, precio NUMERIC NOT NULL, moneda TEXT NOT NULL, hasta TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (anuncio_id, hasta));
ALTER TABLE public.precio_historial_anuncios ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.precio_historial_anuncios TO anon, authenticated;
DROP POLICY IF EXISTS "historial publico" ON public.precio_historial_anuncios;
CREATE POLICY "historial publico" ON public.precio_historial_anuncios FOR SELECT USING (true);
DROP TRIGGER IF EXISTS notif_anuncio ON public.anuncios;
CREATE TRIGGER notif_anuncio AFTER UPDATE ON public.anuncios FOR EACH ROW EXECUTE FUNCTION public.trg_notif_anuncio();
-- destacado manual Pro (tabla destacadas) también avisa a zonas
CREATE OR REPLACE FUNCTION public.trg_notif_destacada() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a anuncios;
BEGIN
  SELECT * INTO a FROM anuncios WHERE 'u-' || id = NEW.property_id AND estado = 'aprobado';
  IF FOUND THEN PERFORM notificar_zonas(a, 'zona_destacado', '★ Propiedad destacada en tu zona'); END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notif_destacada ON public.destacadas;
CREATE TRIGGER notif_destacada AFTER INSERT ON public.destacadas FOR EACH ROW EXECUTE FUNCTION public.trg_notif_destacada();

-- Guardar zona dibujada desde el mapa (GeoJSON Polygon) con alerta
CREATE OR REPLACE FUNCTION public.guardar_zona(p_nombre TEXT, p_geojson JSONB, p_filtros JSONB DEFAULT '{}') RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE nid BIGINT; g extensions.geography;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicia sesión'; END IF;
  IF COALESCE(btrim(p_nombre),'') = '' OR char_length(p_nombre) > 80 THEN RAISE EXCEPTION 'Nombre inválido'; END IF;
  g := extensions.ST_MakeValid(extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geojson::text), 4326))::extensions.geography;
  IF extensions.ST_GeometryType(g::extensions.geometry) <> 'ST_Polygon' THEN g := extensions.ST_ConvexHull(g::extensions.geometry)::extensions.geography; END IF;
  INSERT INTO busquedas_guardadas(user_id, nombre, filtros, zona, alerta) VALUES (auth.uid(), p_nombre, COALESCE(p_filtros,'{}'), g, TRUE) RETURNING id INTO nid;
  RETURN nid;
END $$;
REVOKE ALL ON FUNCTION public.guardar_zona(TEXT,JSONB,JSONB) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.guardar_zona(TEXT,JSONB,JSONB) TO authenticated;

-- Visitas
CREATE TABLE IF NOT EXISTS public.visitas (
  id BIGSERIAL PRIMARY KEY,
  anuncio_id UUID NOT NULL REFERENCES public.anuncios(id) ON DELETE CASCADE,
  solicitante UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inicio TIMESTAMPTZ NOT NULL,
  duracion_min INT NOT NULL DEFAULT 45 CHECK (duracion_min BETWEEN 15 AND 240),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','confirmada','rechazada','cancelada')),
  nota TEXT CHECK (char_length(nota) <= 300),
  recordado BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS visitas_owner_idx ON public.visitas (owner_id, inicio); CREATE INDEX IF NOT EXISTS visitas_sol_idx ON public.visitas (solicitante, inicio);
ALTER TABLE public.visitas ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.visitas FROM anon, authenticated; GRANT SELECT ON public.visitas TO authenticated;
DROP POLICY IF EXISTS "visitas participantes" ON public.visitas;
CREATE POLICY "visitas participantes" ON public.visitas FOR SELECT TO authenticated USING (auth.uid() IN (solicitante, owner_id) OR public.es_admin());
CREATE OR REPLACE FUNCTION public.pedir_visita(p_anuncio UUID, p_inicio TIMESTAMPTZ, p_nota TEXT DEFAULT NULL) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a anuncios; nid BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicia sesión'; END IF;
  SELECT * INTO a FROM anuncios WHERE id = p_anuncio AND estado = 'aprobado'; IF NOT FOUND THEN RAISE EXCEPTION 'Anuncio no disponible'; END IF;
  IF a.owner_id = auth.uid() THEN RAISE EXCEPTION 'Es tu propio anuncio'; END IF;
  IF p_inicio < now() + interval '1 hour' OR p_inicio > now() + interval '60 days' THEN RAISE EXCEPTION 'Elige una fecha entre 1 hora y 60 días desde ahora'; END IF;
  IF (SELECT count(*) FROM visitas WHERE solicitante = auth.uid() AND estado = 'pendiente') >= 5 THEN RAISE EXCEPTION 'Tienes demasiadas solicitudes pendientes'; END IF;
  IF EXISTS (SELECT 1 FROM bloqueos WHERE (blocker_id = a.owner_id AND blocked_id = auth.uid())) THEN RAISE EXCEPTION 'No disponible'; END IF;
  INSERT INTO visitas(anuncio_id, solicitante, owner_id, inicio, nota) VALUES (a.id, auth.uid(), a.owner_id, p_inicio, left(p_nota,300)) RETURNING id INTO nid;
  PERFORM notificar(a.owner_id, 'visita_pedida', '📅 Solicitud de visita', a.titulo || ' · ' || to_char(p_inicio AT TIME ZONE 'America/Costa_Rica', 'DD/MM HH24:MI'), 'cuenta.html#visitas');
  RETURN nid;
END $$;
CREATE OR REPLACE FUNCTION public.responder_visita(p_id BIGINT, p_estado TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v visitas; t TEXT;
BEGIN
  SELECT * INTO v FROM visitas WHERE id = p_id; IF NOT FOUND THEN RAISE EXCEPTION 'No existe'; END IF;
  IF p_estado IN ('confirmada','rechazada') AND v.owner_id <> auth.uid() THEN RAISE EXCEPTION 'permiso denegado'; END IF;
  IF p_estado = 'cancelada' AND auth.uid() NOT IN (v.owner_id, v.solicitante) THEN RAISE EXCEPTION 'permiso denegado'; END IF;
  IF p_estado NOT IN ('confirmada','rechazada','cancelada') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
  UPDATE visitas SET estado = p_estado WHERE id = p_id;
  SELECT titulo INTO t FROM anuncios WHERE id = v.anuncio_id;
  PERFORM notificar(CASE WHEN auth.uid() = v.owner_id THEN v.solicitante ELSE v.owner_id END, 'visita_' || p_estado,
    CASE p_estado WHEN 'confirmada' THEN '✅ Visita confirmada' WHEN 'rechazada' THEN '⛔ Visita rechazada' ELSE '🚫 Visita cancelada' END,
    t || ' · ' || to_char(v.inicio AT TIME ZONE 'America/Costa_Rica', 'DD/MM HH24:MI'), 'cuenta.html#visitas');
END $$;
REVOKE ALL ON FUNCTION public.pedir_visita(UUID,TIMESTAMPTZ,TEXT) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.pedir_visita(UUID,TIMESTAMPTZ,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.responder_visita(BIGINT,TEXT) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.responder_visita(BIGINT,TEXT) TO authenticated;

-- Tareas diarias: recordatorios de visita (24 h antes) y vencimiento de plan/prueba (2 días / 6 h)
CREATE OR REPLACE FUNCTION public.notif_diarias() RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN SELECT v.*, a.titulo FROM visitas v JOIN anuncios a ON a.id = v.anuncio_id WHERE v.estado = 'confirmada' AND NOT v.recordado AND v.inicio BETWEEN now() AND now() + interval '26 hours' LOOP
    PERFORM notificar(r.solicitante, 'visita_recordatorio', '⏰ Recordatorio de visita', r.titulo || ' · ' || to_char(r.inicio AT TIME ZONE 'America/Costa_Rica', 'DD/MM HH24:MI'), 'cuenta.html#visitas');
    PERFORM notificar(r.owner_id, 'visita_recordatorio', '⏰ Recordatorio de visita', r.titulo || ' · ' || to_char(r.inicio AT TIME ZONE 'America/Costa_Rica', 'DD/MM HH24:MI'), 'cuenta.html#visitas');
    UPDATE visitas SET recordado = TRUE WHERE id = r.id; n := n + 1;
  END LOOP;
  FOR r IN SELECT id, plus_until FROM profiles WHERE plus_until BETWEEN now() AND now() + interval '2 days' AND suscripcion_cancelada_at IS NOT NULL OR (plus_origen = 'admin' AND plus_until BETWEEN now() AND now() + interval '2 days') LOOP
    PERFORM notificar(r.id, 'plan_vence', '⏳ Tu plan vence pronto', 'Vence el ' || to_char(r.plus_until AT TIME ZONE 'America/Costa_Rica', 'DD/MM'), 'planes.html'); n := n + 1;
  END LOOP;
  FOR r IN SELECT id, trial_ends_at FROM profiles WHERE trial_ends_at BETWEEN now() AND now() + interval '24 hours' LOOP
    PERFORM notificar(r.id, 'prueba_vence', '⏳ Tu prueba de Plus termina pronto', 'Termina el ' || to_char(r.trial_ends_at AT TIME ZONE 'America/Costa_Rica', 'DD/MM HH24:MI'), 'planes.html'); n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.notif_diarias() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN PERFORM cron.unschedule('mapmarket-notif'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('mapmarket-notif', '0 * * * *', 'SELECT public.notif_diarias()');

-- Estadísticas del dueño (vistas/contactos por día, favoritos)
CREATE OR REPLACE FUNCTION public.mis_estadisticas(dias INT DEFAULT 30) RETURNS TABLE(anuncio_id UUID, titulo TEXT, dia DATE, vistas BIGINT, contactos BIGINT, favoritos BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH mios AS (SELECT id, titulo FROM anuncios WHERE owner_id = auth.uid()),
  d AS (SELECT generate_series((now() - make_interval(days => LEAST(GREATEST(dias,1),90)))::date, now()::date, '1 day')::date AS dia)
  SELECT m.id, m.titulo, d.dia,
    (SELECT count(*) FROM eventos e WHERE e.property_id = 'u-' || m.id AND e.tipo = 'vista' AND e.created_at::date = d.dia),
    (SELECT count(*) FROM eventos e WHERE e.property_id = 'u-' || m.id AND e.tipo = 'contacto' AND e.created_at::date = d.dia),
    (SELECT count(*) FROM favoritos f WHERE f.property_id = 'u-' || m.id AND f.created_at::date <= d.dia)
  FROM mios m CROSS JOIN d ORDER BY m.id, d.dia;
$$;
REVOKE ALL ON FUNCTION public.mis_estadisticas(INT) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.mis_estadisticas(INT) TO authenticated;

-- Pagos de destacado puntual (ONVO one-time)
CREATE TABLE IF NOT EXISTS public.pagos_destacado (
  id BIGSERIAL PRIMARY KEY, anuncio_id UUID NOT NULL REFERENCES public.anuncios(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sesion TEXT UNIQUE, estado TEXT NOT NULL DEFAULT 'iniciado' CHECK (estado IN ('iniciado','pagado','fallido')), dias INT NOT NULL DEFAULT 7, monto NUMERIC, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), pagado_at TIMESTAMPTZ);
ALTER TABLE public.pagos_destacado ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.pagos_destacado FROM anon, authenticated; GRANT SELECT ON public.pagos_destacado TO authenticated;
DROP POLICY IF EXISTS "pagos destacado propios" ON public.pagos_destacado;
CREATE POLICY "pagos destacado propios" ON public.pagos_destacado FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.es_admin());

-- Métricas de administración
CREATE OR REPLACE FUNCTION public.admin_metricas() RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j JSONB;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'permiso denegado' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object(
    'usuarios', (SELECT count(*) FROM auth.users),
    'activos_7d', (SELECT count(*) FROM auth.users WHERE last_sign_in_at > now() - interval '7 days'),
    'activos_30d', (SELECT count(*) FROM auth.users WHERE last_sign_in_at > now() - interval '30 days'),
    'altas_dia', (SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'n', n) ORDER BY d), '[]') FROM (SELECT created_at::date d, count(*) n FROM auth.users WHERE created_at > now() - interval '30 days' GROUP BY 1) s),
    'planes', (SELECT jsonb_object_agg(p, n) FROM (SELECT CASE WHEN plan='pro' AND plus_until > now() THEN 'pro' WHEN plus_until > now() THEN 'plus' WHEN trial_ends_at > now() THEN 'prueba' ELSE 'free' END p, count(*) n FROM profiles GROUP BY 1) s),
    'pagos_onvo', (SELECT count(*) FROM auth.users u JOIN profiles p ON p.id = u.id WHERE p.plus_origen = 'onvo' AND p.plus_until > now()),
    'conversion_pct', (SELECT round(100.0 * count(*) FILTER (WHERE plus_origen = 'onvo') / NULLIF(count(*),0), 2) FROM profiles),
    'mrr_crc', (SELECT COALESCE(sum(CASE WHEN plan='pro' THEN 6990 WHEN plus_until - now() > interval '40 days' THEN 29990/12.0 ELSE 3990 END),0)::int FROM profiles WHERE plus_origen='onvo' AND plus_until > now() AND suscripcion_cancelada_at IS NULL),
    'destacados_pagados_30d', (SELECT COALESCE(sum(monto),0) FROM pagos_destacado WHERE estado='pagado' AND pagado_at > now() - interval '30 days'),
    'pagos_eventos_30d', (SELECT COALESCE(jsonb_object_agg(evento, n), '{}') FROM (SELECT evento, count(*) n FROM pagos_eventos WHERE created_at > now() - interval '30 days' GROUP BY 1) s),
    'anuncios', (SELECT COALESCE(jsonb_object_agg(estado, n), '{}') FROM (SELECT estado, count(*) n FROM anuncios GROUP BY 1) s),
    'reportes_abiertos', (SELECT count(*) FROM reportes WHERE estado = 'nuevo'),
    'retiros_pendientes', (SELECT count(*) FROM retiros WHERE estado = 'pendiente'),
    'imagenes_pendientes', (SELECT count(*) FROM imagenes_moderacion WHERE estado IN ('sin_revisar','marcada')),
    'mensajes_7d', (SELECT count(*) FROM mensajes WHERE created_at > now() - interval '7 days'),
    'visitas_30d', (SELECT count(*) FROM visitas WHERE created_at > now() - interval '30 days'),
    'zonas_guardadas', (SELECT count(*) FROM busquedas_guardadas WHERE zona IS NOT NULL),
    'push_subs', (SELECT count(*) FROM push_subs),
    'vistas_7d', (SELECT count(*) FROM eventos WHERE tipo='vista' AND created_at > now() - interval '7 days')
  ) INTO j; RETURN j;
END $$;
REVOKE ALL ON FUNCTION public.admin_metricas() FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.admin_metricas() TO authenticated;
NOTIFY pgrst, 'reload schema';
SELECT 'MapMarket v13 (notificaciones, zonas, visitas, stats, destacado, métricas) listo ✅' AS resultado;
-- v13b · el destacado pagado solo lo fija el servidor (webhook) o un admin
CREATE OR REPLACE FUNCTION public.anuncios_destacado_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'authenticated' AND NOT public.es_admin() THEN
    IF TG_OP = 'INSERT' THEN NEW.destacado_until := NULL; ELSE NEW.destacado_until := OLD.destacado_until; END IF;
  END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS anuncios_destacado_guard ON public.anuncios;
CREATE TRIGGER anuncios_destacado_guard BEFORE INSERT OR UPDATE ON public.anuncios FOR EACH ROW EXECUTE FUNCTION public.anuncios_destacado_guard();
SELECT 'v13b listo ✅' AS resultado;
-- v13c · el dueño puede pausar su anuncio aprobado y reactivarlo (si lo pausó él, sin cambios de contenido)
CREATE OR REPLACE FUNCTION public.anuncios_guardia() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF public.es_admin() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.owner_id := auth.uid(); NEW.estado := 'pendiente'; NEW.motivo_rechazo := NULL; NEW.created_at := now();
    IF (SELECT count(*) FROM anuncios WHERE owner_id = auth.uid() AND created_at > now() - interval '1 day') >= 10 THEN RAISE EXCEPTION 'Máximo 10 anuncios por día.'; END IF;
  ELSE
    NEW.owner_id := OLD.owner_id; NEW.created_at := OLD.created_at;
    IF NEW.estado = 'retirado' THEN NULL;
    ELSIF (NEW.titulo, NEW.precio, NEW.imagenes, NEW.descripcion, NEW.lat, NEW.lon, NEW.poligono::text, NEW.tipo, NEW.moneda) IS NOT DISTINCT FROM (OLD.titulo, OLD.precio, OLD.imagenes, OLD.descripcion, OLD.lat, OLD.lon, OLD.poligono::text, OLD.tipo, OLD.moneda)
      AND ((NEW.estado = 'vendido' AND OLD.estado IN ('aprobado','vendido'))
        OR (NEW.estado = 'pausado' AND OLD.estado = 'aprobado')
        OR (NEW.estado = 'aprobado' AND OLD.estado = 'pausado' AND OLD.motivo_rechazo IS NULL)
        OR NEW.estado = OLD.estado AND OLD.estado <> 'rechazado' AND (NEW.habitaciones, NEW.banos, NEW.area, NEW.zona, NEW.amenidades) IS NOT DISTINCT FROM (OLD.habitaciones, OLD.banos, OLD.area, OLD.zona, OLD.amenidades)) THEN NULL;
    ELSE NEW.estado := 'pendiente'; NEW.motivo_rechazo := NULL; END IF;
  END IF;
  RETURN NEW;
END $$;
SELECT 'v13c listo ✅' AS resultado;
-- v13d · fecha de venta
ALTER TABLE public.anuncios ADD COLUMN IF NOT EXISTS vendido_at TIMESTAMPTZ;
CREATE OR REPLACE FUNCTION public.anuncios_vendido_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.estado = 'vendido' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'vendido') THEN NEW.vendido_at := COALESCE(NEW.vendido_at, now()); ELSIF NEW.estado <> 'vendido' THEN NEW.vendido_at := NULL; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS anuncios_vendido_at ON public.anuncios;
CREATE TRIGGER anuncios_vendido_at BEFORE INSERT OR UPDATE ON public.anuncios FOR EACH ROW EXECUTE FUNCTION public.anuncios_vendido_at();
SELECT 'v13d listo ✅' AS resultado;
-- v14 · capa Plusvalía / Inversión (por defecto Plus, Pro y Admin)
INSERT INTO public.permisos(perfil,feature,activo,limite,bloqueado) VALUES ('gratis','plusvalia',false,null,false),('plus','plusvalia',true,null,false),('pro','plusvalia',true,null,false),('agente','plusvalia',false,null,false),('admin','plusvalia',true,null,false) ON CONFLICT DO NOTHING;
SELECT 'v14 listo ✅' AS resultado;
-- v15: login obligatorio — anon no puede leer anuncios ni datos de usuarios
alter policy "anuncios publicos" on public.anuncios to authenticated;
alter policy "destacadas publicas" on public.destacadas to authenticated;
alter policy "historial publico" on public.precio_historial_anuncios to authenticated;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('votos_resumen','mas_gustados','mis_estadisticas','iniciar_conversacion','no_leidos','registrar_vista','registrar_evento')
  loop execute format('revoke execute on function %s from anon, public', f.sig); execute format('grant execute on function %s to authenticated', f.sig); end loop; end $$;
select 1;
-- v16: perfil público, conteo real, testimonios
create or replace function public.perfil_publico(p_id uuid) returns json language sql stable security definer set search_path=public as $$
  select json_build_object('id',p.id,'nombre',coalesce(nullif(trim(p.nombre),''),'Anunciante'),'foto_url',pp.foto_url,'rol',p.rol,
    'verificado',(select u.email_confirmed_at is not null from auth.users u where u.id=p.id),'desde',extract(year from p.created_at)::int,
    'activos',(select count(*) from anuncios a where a.owner_id=p.id and a.estado='aprobado'))
  from profiles p join perfiles_publicos pp on pp.id=p.id where p.id=p_id and coalesce(p.baneado,false)=false $$;
revoke execute on function public.perfil_publico(uuid) from anon, public; grant execute on function public.perfil_publico(uuid) to authenticated;
create or replace function public.stats_publicos() returns json language sql stable security definer set search_path=public as $$
  select json_build_object('activos',(select count(*) from anuncios where estado='aprobado')) $$;
grant execute on function public.stats_publicos() to anon, authenticated;
create table if not exists public.testimonios (id bigserial primary key, autor text not null check (length(autor)<=80), texto text not null check (length(texto)<=500), visible boolean not null default true, created_at timestamptz default now());
alter table public.testimonios enable row level security;
drop policy if exists "testimonios ver" on public.testimonios; create policy "testimonios ver" on public.testimonios for select to anon, authenticated using (visible or public.es_admin());
drop policy if exists "testimonios admin" on public.testimonios; create policy "testimonios admin" on public.testimonios for all to authenticated using (public.es_admin()) with check (public.es_admin());
select 1;
-- v17: ocultar anuncios de ejemplo (estáticos) por admin
create table if not exists public.anuncios_ocultos (id text primary key, motivo text, admin_id uuid default auth.uid(), created_at timestamptz default now());
alter table public.anuncios_ocultos enable row level security;
drop policy if exists "ocultos ver" on public.anuncios_ocultos; create policy "ocultos ver" on public.anuncios_ocultos for select to authenticated using (true);
drop policy if exists "ocultos admin" on public.anuncios_ocultos; create policy "ocultos admin" on public.anuncios_ocultos for all to authenticated using (public.es_admin()) with check (public.es_admin());
select 1;
-- v18: WhatsApp por anuncio (visible a usuarios con sesión)
alter table public.anuncios add column if not exists whatsapp text;
do $$ begin if not exists (select 1 from pg_constraint where conname='anuncios_whatsapp_chk') then alter table public.anuncios add constraint anuncios_whatsapp_chk check (whatsapp is null or whatsapp ~ '^\+506[2-8][0-9]{7}$'); end if; end $$;
-- ocultar anuncios de ejemplo (por admin), con auditoría
create or replace function public.admin_ocultar_demo(ids text[], motivo text default null) returns int language plpgsql security definer set search_path=public as $$
declare n int; begin if not public.es_admin() then raise exception 'Solo admin'; end if;
 insert into anuncios_ocultos(id,motivo,admin_id) select unnest(ids), left(motivo,300), auth.uid() on conflict (id) do nothing; get diagnostics n = row_count;
 insert into admin_auditoria(admin_id,accion,detalle,nota) values(auth.uid(),'ocultar_demo',jsonb_build_object('ids',ids),left(motivo,300)); return n; end $$;
revoke execute on function public.admin_ocultar_demo(text[],text) from anon, public; grant execute on function public.admin_ocultar_demo(text[],text) to authenticated;
notify pgrst, 'reload schema';
select 1;
