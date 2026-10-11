// POST /functions/v1/onvo-webhook  (deploy con --no-verify-jwt; ONVO no envía JWT de Supabase)
// Verificación según docs.onvopay.com/webhooks: ONVO envía el secret del webhook en el header X-Webhook-Secret
// (prefijo webhook_secret_). Además, se vuelve a consultar el objeto en la API antes de dar Plus.
import { createClient } from "npm:@supabase/supabase-js@2";
import { onvo } from "../_shared/onvo.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GRACIA_DIAS = 3;
const addPeriod = (from: Date, plan: string) => {
  const d = new Date(from); plan === "anual" ? d.setUTCFullYear(d.getUTCFullYear() + 1) : d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(d.getUTCDate() + GRACIA_DIAS); return d;
};
function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false; let r = 0; for (let i = 0; i < x.length; i++) r |= x[i] ^ y[i]; return r === 0;
}
async function perfilPor(q: { id?: string; sub?: string; cus?: string; email?: string }) {
  for (const [col, v] of [["id", q.id], ["onvo_subscription_id", q.sub], ["onvo_customer_id", q.cus], ["email", q.email?.toLowerCase()]] as const) {
    if (!v) continue; const { data } = await db.from("profiles").select("id,plus_until,onvo_plan,plus_origen").eq(col, v).maybeSingle(); if (data) return data;
  }
  return null;
}
async function procesar(ev: any) {
  const type: string = ev?.type ?? "", d = ev?.data ?? {};
  const key = `${type}:${d.id ?? d.paymentIntentId ?? ""}:${d.attemptCount ?? ""}`;
  const { error: dup } = await db.from("pagos_eventos").insert({ proveedor: "onvo", evento: type, event_key: key, email: d.customer?.email ?? d.customerEmail ?? null, order_number: d.id ?? null, payload: ev, verificado: true });
  if (dup) { console.log("evento repetido o error de registro", dup.message); if (/duplicate/i.test(dup.message)) return; }

  if (type === "checkout-session.succeeded") {
    const s = await onvo("GET", `/checkout/sessions/${d.id}`);            // confirmar contra la API
    if (s.paymentStatus !== "paid" || s.metadata?.app !== "mapmarket") return;
    const plan = s.metadata?.plan === "anual" ? "anual" : s.metadata?.plan === "pro" ? "pro" : "mensual";
    const p = await perfilPor({ id: s.metadata?.supabase_user_id, email: s.metadata?.email ?? s.customerEmail });
    if (!p) return console.warn("perfil no encontrado", s.id);
    const base = p.plus_until && new Date(p.plus_until) > new Date() ? new Date(p.plus_until) : new Date();
    await db.from("profiles").update({
      plan: plan === "pro" ? "pro" : "plus", plus_until: addPeriod(base, plan).toISOString(), onvo_plan: plan, plus_origen: "onvo",
      onvo_customer_id: s.customerId ?? s.customer?.id ?? null, onvo_subscription_id: s.subscriptionId ?? s.subscription?.id ?? null, suscripcion_cancelada_at: null,
    }).eq("id", p.id);
  } else if (type === "subscription.renewal.succeeded") {
    const subId = d.subscriptionId ?? d.subscription?.id;
    const p = await perfilPor({ sub: subId, cus: d.customerId, email: d.customer?.email });
    if (!p) return console.warn("perfil no encontrado para renovación", subId);
    if (subId) { const sub = await onvo("GET", `/subscriptions/${subId}`); if (sub.status && !["active", "trialing"].includes(sub.status)) return; }
    const base = p.plus_until && new Date(p.plus_until) > new Date() ? new Date(p.plus_until) : new Date();
    await db.from("profiles").update({ plan: p.onvo_plan === "pro" ? "pro" : "plus", plus_until: addPeriod(base, p.onvo_plan ?? "mensual").toISOString() }).eq("id", p.id);
  } else if (type === "subscription.renewal.failed") {
    const p = await perfilPor({ sub: d.subscriptionId, cus: d.customerId, email: d.customer?.email });
    if (!p) return;
    if (p.plus_origen === "admin") return; // Plus otorgado por un admin: ONVO no lo revoca
    // past_due: ONVO reintenta; se conserva Plus hasta plus_until (incluye días de gracia). Cancelado / impago: vuelve a Gratis.
    if (["canceled", "cancelled", "unpaid", "incomplete_expired"].includes(String(d.subscriptionStatus))) {
      await db.from("profiles").update({ plan: "free", plus_until: new Date().toISOString() }).eq("id", p.id);
    }
  }
  // payment-intent.* quedan registrados en pagos_eventos para auditoría.
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const secret = Deno.env.get("ONVO_WEBHOOK_SECRET") ?? "";
  if (!secret || !safeEqual(req.headers.get("X-Webhook-Secret") ?? "", secret)) return new Response("unauthorized", { status: 401 });
  const ev = await req.json().catch(() => null);
  if (!ev) return new Response("bad request", { status: 400 });
  try { await procesar(ev); } catch (e) { console.error(e); return new Response("error", { status: 500 }); } // 5xx → ONVO puede reintentar
  return new Response("ok", { status: 200 });
});
