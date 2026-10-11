// MapMarket · Moderación de imágenes en servidor.
// Usa Sightengine (plan gratuito) si existen los secretos SIGHTENGINE_USER y SIGHTENGINE_SECRET.
// TODO: sin clave no se analiza nada en servidor; las imágenes quedan «sin_revisar» (nunca se bloquea la subida) y el admin las ve en la pestaña Imágenes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!, svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const db = createClient(url, svc);
  const { data: { user } } = await db.auth.getUser(jwt); if (!user) return json({ error: "no autenticado" }, 401);
  const { anuncio } = await req.json().catch(() => ({}));
  const { data: prof } = await db.from("profiles").select("rol").eq("id", user.id).maybeSingle();
  let q = db.from("imagenes_moderacion").select("id,url,score,estado,owner_id").eq("estado", "sin_revisar").limit(20);
  if (anuncio) q = q.eq("anuncio_id", anuncio);
  if (prof?.rol !== "admin") q = q.eq("owner_id", user.id);
  const { data: imgs } = await q;
  const U = Deno.env.get("SIGHTENGINE_USER"), S = Deno.env.get("SIGHTENGINE_SECRET");
  if (!U || !S) return json({ analizadas: 0, nota: "Sin clave de Sightengine: imágenes quedan sin revisar", pendientes: imgs?.length || 0 });
  let n = 0;
  for (const im of imgs || []) {
    try {
      const r = await fetch(`https://api.sightengine.com/1.0/check.json?models=nudity-2.1,gore-2.0,offensive&api_user=${U}&api_secret=${S}&url=${encodeURIComponent(im.url)}`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
      if (r.status !== "success") continue;
      const nd = r.nudity || {}, sexual = Math.max(nd.sexual_activity || 0, nd.sexual_display || 0, nd.erotica || 0), gore = r.gore?.prob || 0, ofe = r.offensive?.prob || 0;
      const servidor = { sexual, sugestivo: nd.suggestive || 0, gore, ofensivo: ofe };
      const marcada = sexual >= 0.5 || gore >= 0.6 || ofe >= 0.7;
      await db.from("imagenes_moderacion").update({ score: { ...(im.score || {}), servidor }, fuente: "sightengine", estado: marcada ? "marcada" : "sin_revisar" }).eq("id", im.id);
      n++;
    } catch (_) { /* servicio caído: se deja sin revisar */ }
  }
  return json({ analizadas: n });
});
