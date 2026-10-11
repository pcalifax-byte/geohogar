// MapMarket · envía Web Push para una notificación (llamada desde la BD con x-push-secret).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const EN: Record<string, string> = {"💬 Nuevo mensaje": "💬 New message", "✅ Tu anuncio fue aprobado": "✅ Your listing was approved", "⛔ Tu anuncio fue rechazado": "⛔ Your listing was rejected", "🏠 Nueva propiedad en tu zona": "🏠 New property in your area", "⬇️ Bajó de precio en tu zona": "⬇️ Price drop in your area", "★ Propiedad destacada en tu zona": "★ Featured property in your area", "📅 Solicitud de visita": "📅 Visit request", "✅ Visita confirmada": "✅ Visit confirmed", "⛔ Visita rechazada": "⛔ Visit declined", "🚫 Visita cancelada": "🚫 Visit canceled", "⏰ Recordatorio de visita": "⏰ Visit reminder", "⏳ Tu plan vence pronto": "⏳ Your plan expires soon", "⏳ Tu prueba de Plus termina pronto": "⏳ Your Plus trial ends soon", "Mi zona": "My area", "Fecha": "Date", "Enviar solicitud": "Send request", "Confirmar": "Confirm", "Rechazar": "Decline", "Cancelar": "Cancel"};
const SECRET = Deno.env.get("PUSH_SECRET") ?? "";
webpush.setVapidDetails("mailto:pcalifax@gmail.com", Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);

Deno.serve(async (req) => {
  if (req.method !== "POST" || !SECRET || req.headers.get("x-push-secret") !== SECRET) return new Response("unauthorized", { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: n } = await db.from("notificaciones").select("*").eq("id", id).maybeSingle();
  if (!n) return new Response(JSON.stringify({ ok: false, error: "no existe" }), { status: 404 });
  const { data: subs } = await db.from("push_subs").select("*").eq("user_id", n.user_id);
  const { data: pf } = await db.from("profiles").select("idioma").eq("id", n.user_id).maybeSingle();
  const payload = JSON.stringify({ id: n.id, tipo: n.tipo, titulo: pf?.idioma === "en" ? (EN[n.titulo] ?? n.titulo) : n.titulo, cuerpo: n.cuerpo, url: n.url, idioma: pf?.idioma ?? "es" });
  let enviados = 0, borrados = 0;
  for (const s of subs ?? []) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 }); enviados++; }
    catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) { await db.from("push_subs").delete().eq("endpoint", s.endpoint); borrados++; } }
  }
  return new Response(JSON.stringify({ ok: true, enviados, borrados }), { headers: { "Content-Type": "application/json" } });
});
