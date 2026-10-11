// POST /functions/v1/cuenta  { accion: "pagos" | "cancelar" | "eliminar", confirmar?: "ELIMINAR" }   (requiere sesión)
// - pagos: historial de pagos del usuario (desde pagos_eventos, sin datos de tarjeta)
// - cancelar: cancela la suscripción en ONVO (DELETE /v1/subscriptions/{id}); Plus sigue hasta plus_until
// - eliminar: cancela la suscripción si existe y borra el usuario de Auth (ON DELETE CASCADE borra perfil, favoritos, listas, mensajes, votos…)
import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json, onvo } from "../_shared/onvo.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user }, error } = await db.auth.getUser(jwt);
  if (error || !user) return json({ error: "Inicia sesión" }, 401);
  const { accion, confirmar } = await req.json().catch(() => ({}));
  const { data: p } = await db.from("profiles").select("plan,plus_until,onvo_subscription_id,onvo_plan,suscripcion_cancelada_at").eq("id", user.id).maybeSingle();
  try {
    if (accion === "pagos") {
      const q = () => db.from("pagos_eventos").select("id,evento,created_at,payload,order_number").order("created_at", { ascending: false }).limit(50);
      const [a, b] = await Promise.all([q().eq("email", user.email ?? "-"), q().eq("payload->metadata->>supabase_user_id", user.id)]);
      const seen = new Set(); const data = [...(a.data ?? []), ...(b.data ?? [])].filter((e: any) => !seen.has(e.id) && seen.add(e.id)).sort((x: any, y: any) => y.created_at.localeCompare(x.created_at));
      const items = (data ?? []).filter((e) => /succeeded|failed|checkout\.created|cancel/.test(e.evento ?? "")).map((e: any) => ({
        evento: e.evento, fecha: e.created_at,
        monto: e.payload?.data?.amount ?? e.payload?.data?.amountTotal ?? null, moneda: e.payload?.data?.currency ?? null,
        plan: e.payload?.plan ?? e.payload?.data?.metadata?.plan ?? null, ref: e.order_number,
      }));
      return json({ items, suscripcion: { activa: !!p?.onvo_subscription_id && !p?.suscripcion_cancelada_at, plan: p?.onvo_plan, plus_until: p?.plus_until, cancelada_at: p?.suscripcion_cancelada_at } });
    }
    if (accion === "cancelar" || accion === "eliminar") {
      if (accion === "eliminar" && confirmar !== "ELIMINAR") return json({ error: "Escribe ELIMINAR para confirmar" }, 400);
      if (p?.onvo_subscription_id && !p?.suscripcion_cancelada_at) {
        try { await onvo("DELETE", `/subscriptions/${p.onvo_subscription_id}`); }
        catch (e) { if (accion === "cancelar") throw e; console.warn("no se pudo cancelar en ONVO", e); }
        await db.from("pagos_eventos").insert({ proveedor: "onvo", evento: "subscription.canceled.by_user", email: user.email, order_number: p.onvo_subscription_id, payload: { user: user.id }, verificado: true });
        await db.from("profiles").update({ suscripcion_cancelada_at: new Date().toISOString() }).eq("id", user.id);
      } else if (accion === "cancelar") return json({ error: "No tienes una suscripción activa para cancelar" }, 400);
      if (accion === "cancelar") return json({ ok: true, plus_until: p?.plus_until });
      // Datos personales: el perfil se borra en cascada; aquí se eliminan también las fotos (perfil y anuncios)
      for (const b of ["avatares", "anuncios"]) { try { const { data: fs } = await db.storage.from(b).list(user.id, { limit: 1000 }); if (fs?.length) await db.storage.from(b).remove(fs.map((f) => `${user.id}/${f.name}`)); } catch (_) { /* sin fotos */ } }
      const { error: de } = await db.auth.admin.deleteUser(user.id);
      if (de) throw de;
      return json({ ok: true, eliminado: true });
    }
    return json({ error: "Acción no válida" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: accion === "cancelar" ? "No se pudo cancelar en ONVO. Escríbenos a pcalifax@gmail.com" : "Error" }, 500);
  }
});
