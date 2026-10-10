// Utilidades compartidas ONVO Pay (https://docs.onvopay.com)
export const ONVO_API = "https://api.onvopay.com/v1";
export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export async function onvo(method: string, path: string, body?: unknown) {
  const r = await fetch(ONVO_API + path, {
    method,
    headers: { Authorization: `Bearer ${Deno.env.get("ONVO_SECRET_KEY")}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ONVO ${method} ${path} → ${r.status} ${j?.message ?? ""}`);
  return j;
}
export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
