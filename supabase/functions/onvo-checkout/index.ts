// POST /functions/v1/onvo-checkout  { periodo: "mensual" | "anual" | "pro" }  (requiere sesión de Supabase: Authorization: Bearer <JWT>)
// Crea una Sesión de Checkout de ONVO (POST /v1/checkout/sessions/one-time-link) con el precio recurrente en CRC.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json, onvo } from "../_shared/onvo.ts";

const SITE = Deno.env.get("SITE_URL") ?? "https://mapmarketapp.com/";
const PRICES: Record<string, string> = {
  mensual: Deno.env.get("ONVO_PRICE_MENSUAL") ?? "cmv2wqq6w20bik36vkrllfl8e", // ₡3.990/mes (modo test)
  anual: Deno.env.get("ONVO_PRICE_ANUAL") ?? "cmv2wqqz91za8k86v0ucnv13w",   // ₡29.990/año (modo test)
  pro: Deno.env.get("ONVO_PRICE_PRO") ?? "cmv35vu3p33sfk76vq89gamth",       // Pro ₡6.990/mes (modo test)
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error } = await db.auth.getUser(jwt);
    if (error || !user) return json({ error: "Inicia sesión para suscribirte" }, 401);
    const { periodo, plan: pl } = await req.json().catch(() => ({}));
    const plan = periodo === "pro" || pl === "pro" ? "pro" : periodo === "anual" ? "anual" : "mensual";
    const session = await onvo("POST", "/checkout/sessions/one-time-link", {
      lineItems: [{ priceId: PRICES[plan], quantity: 1 }],
      customerEmail: user.email,
      redirectUrl: SITE + "cuenta.html?pago=ok",
      cancelUrl: SITE + "planes.html?pago=cancelado",
      paymentMethodTypes: ["card"],
      metadata: { supabase_user_id: user.id, email: user.email ?? "", plan, app: "mapmarket" },
    });
    await db.from("pagos_eventos").insert({ proveedor: "onvo", evento: "checkout.created", email: user.email, order_number: session.id, payload: { plan, priceId: PRICES[plan] }, verificado: true });
    return json({ url: session.url, id: session.id });
  } catch (e) {
    console.error(e);
    return json({ error: "No se pudo iniciar el pago" }, 500);
  }
});
