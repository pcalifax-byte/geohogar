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
    if (error || !user) return json({ error: "Inicia sesión para suscribirte · Sign in to subscribe" }, 401);
    const { periodo, plan: pl, idioma, anuncio } = await req.json().catch(() => ({}));
    const en = idioma === "en", L = en ? "&lang=en" : "";
    if (periodo === "destacado") {
      const en0 = idioma === "en";
      const price = Deno.env.get("ONVO_PRICE_DESTACADO");
      if (!price) return json({ error: en0 ? "Paid featuring isn't enabled yet." : "El destacado pagado aún no está habilitado." }, 503);
      const { data: a } = await db.from("anuncios").select("id,owner_id,estado").eq("id", anuncio).maybeSingle();
      if (!a || a.owner_id !== user.id || a.estado !== "aprobado") return json({ error: en0 ? "Only your approved listings can be featured." : "Solo puedes destacar tus anuncios aprobados." }, 400);
      const ses = await onvo("POST", "/checkout/sessions/one-time-link", {
        lineItems: [{ priceId: price, quantity: 1 }], customerEmail: user.email,
        redirectUrl: SITE + "index.html?p=u-" + a.id + "&destacado=ok" + (en0 ? "&lang=en" : ""), cancelUrl: SITE + "cuenta.html?pago=cancelado" + (en0 ? "&lang=en" : ""),
        paymentMethodTypes: ["card"], metadata: { supabase_user_id: user.id, email: user.email ?? "", tipo: "destacado", anuncio: a.id, dias: "7", app: "mapmarket" },
      });
      await db.from("pagos_destacado").insert({ anuncio_id: a.id, user_id: user.id, sesion: ses.id, monto: 1990, dias: 7 });
      return json({ url: ses.url, id: ses.id });
    }
    const plan = periodo === "pro" || pl === "pro" ? "pro" : periodo === "anual" ? "anual" : "mensual";
    const session = await onvo("POST", "/checkout/sessions/one-time-link", {
      lineItems: [{ priceId: PRICES[plan], quantity: 1 }],
      customerEmail: user.email,
      redirectUrl: SITE + "cuenta.html?pago=ok" + L,
      cancelUrl: SITE + "planes.html?pago=cancelado" + L,
      paymentMethodTypes: ["card"],
      metadata: { supabase_user_id: user.id, email: user.email ?? "", plan, app: "mapmarket", idioma: en ? "en" : "es" },
    });
    await db.from("pagos_eventos").insert({ proveedor: "onvo", evento: "checkout.created", email: user.email, order_number: session.id, payload: { plan, priceId: PRICES[plan] }, verificado: true });
    return json({ url: session.url, id: session.id });
  } catch (e) {
    console.error(e);
    return json({ error: "No se pudo iniciar el pago · Couldn't start the payment" }, 500);
  }
});
