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
