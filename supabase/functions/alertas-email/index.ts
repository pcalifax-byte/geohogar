// Función programada (cron diario): compara anuncios publicados con alertas de precio y búsquedas guardadas (Plus)
// y envía un correo con las novedades. Correo vía Resend (RESEND_API_KEY + ALERT_FROM); si no hay clave, solo registra.
// La primera ejecución de cada alerta toma una «línea base» (no envía todo el catálogo).  Llamada: POST con header x-cron-secret.
import { createClient } from "npm:@supabase/supabase-js@2";
const SITE = Deno.env.get("SITE_URL") ?? "https://pcalifax-byte.github.io/geohogar/";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
type P = { id: string; title: string; type: string; price: number | null; currency: string; province: string; lat: number; lon: number; beds?: number; status?: string; demo?: boolean; precio_flag?: string };
const pip = (x: number, y: number, ring: number[][]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const enZona = (p: P, g: any) => !g || (g.type === "Polygon" && pip(p.lon, p.lat, g.coordinates[0]));
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
async function correo(to: string, asunto: string, items: { p: P; usd: number; baja?: boolean }[]) {
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("ALERT_FROM");
  if (!key || !from) return "sin_proveedor";
  const html = `<div style="font-family:sans-serif;max-width:560px"><h2 style="color:#0f766e">📍 MapMarket</h2><p>${esc(asunto)}</p><ul>${items.slice(0, 20).map(({ p, usd, baja }) => `<li style="margin:8px 0"><a href="${SITE}p/${encodeURIComponent(String(p.id))}.html">${esc(p.title)}</a> — ${baja ? "⬇️ bajó a " : ""}$${Math.round(usd).toLocaleString("es-CR")} · ${esc(p.province)}</li>`).join("")}</ul><p style="font-size:12px;color:#64748b">Recibes esto porque activaste alertas en MapMarket. Puedes desactivarlas en ${SITE}cuenta.html</p></div>`;
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject: asunto, html }) });
  return r.ok ? "enviado" : "error_" + r.status;
}
Deno.serve(async (req) => {
  const s = Deno.env.get("CRON_SECRET") ?? "";
  if (!s || req.headers.get("x-cron-secret") !== s) return new Response("unauthorized", { status: 401 });
  const fx = await fetch(SITE + "data/tipo_cambio.json").then((r) => r.json()).catch(() => ({ venta: 510 }));
  const tc = fx.referencia || fx.venta || 510;
  const props: P[] = (await fetch(SITE + "data/propiedades.json").then((r) => r.json())).filter((p: P) => !p.demo && p.price && p.precio_flag !== "dudoso" && (p.status ?? "activa") === "activa");
  const { data: us } = await db.from("anuncios").select("id,titulo,tipo,precio,moneda,provincia,lat,lon,habitaciones").eq("estado", "aprobado");
  (us ?? []).forEach((a: any) => props.push({ id: "u-" + a.id, title: a.titulo, type: a.tipo, price: +a.precio, currency: a.moneda, province: a.provincia, lat: a.lat, lon: a.lon, beds: a.habitaciones }));
  const usd = (p: P) => (p.currency === "CRC" ? p.price! / tc : p.price!);
  const isPlus = async (uid: string) => (await db.rpc("is_plus", { uid })).data === true;
  const resumen: any = { alertas: 0, correos: 0, items: 0, estado_correo: {} as Record<string, number> };
  const jobs: { tipo: "precio" | "busqueda"; id: number; uid: string; email: string; nombre: string; match: (p: P) => boolean }[] = [];
  const { data: ap } = await db.from("alertas_precio_geo").select("*").eq("activa", true);
  (ap ?? []).forEach((a: any) => jobs.push({ tipo: "precio", id: a.id, uid: a.user_id, email: a.email, nombre: a.nombre, match: (p) => (!a.precio_max_usd || usd(p) <= +a.precio_max_usd) && (!a.tipo || p.type === a.tipo) && (!a.provincia || p.province === a.provincia) && enZona(p, a.zona_geojson) }));
  const { data: bg } = await db.from("busquedas_geo").select("*").eq("alerta", true);
  (bg ?? []).forEach((b: any) => { const f = b.filtros || {}; jobs.push({ tipo: "busqueda", id: b.id, uid: b.user_id, email: b.email, nombre: b.nombre, match: (p) => (!f.type || p.type === f.type) && (!f.prov || p.province === f.prov) && (!f.max || usd(p) <= +f.max) && (!f.beds || (p.beds ?? 0) >= +f.beds) && enZona(p, b.zona_geojson) }); });
  for (const j of jobs) {
    if (!j.email || !(await isPlus(j.uid))) continue;
    resumen.alertas++;
    const m = props.filter(j.match);
    const { data: prev } = await db.from("alertas_envios").select("item_id,precio").eq("alerta_tipo", j.tipo).eq("alerta_id", j.id);
    const seen = new Map((prev ?? []).map((r: any) => [r.item_id, +r.precio]));
    const base = seen.size === 0;
    const nuevos = m.filter((p) => !seen.has(String(p.id)) || usd(p) < (seen.get(String(p.id))! * 0.97)).map((p) => ({ p, usd: usd(p), baja: seen.has(String(p.id)) }));
    if (nuevos.length) await db.from("alertas_envios").upsert(nuevos.map(({ p, usd }) => ({ alerta_tipo: j.tipo, alerta_id: j.id, item_id: String(p.id), precio: Math.round(usd), enviada_at: new Date().toISOString() })));
    if (base || !nuevos.length) continue;
    const st = await correo(j.email, `${nuevos.length} novedad(es) para tu alerta «${j.nombre}»`, nuevos);
    resumen.estado_correo[st] = (resumen.estado_correo[st] ?? 0) + 1; resumen.items += nuevos.length; if (st === "enviado") resumen.correos++;
  }
  return new Response(JSON.stringify(resumen), { headers: { "Content-Type": "application/json" } });
});
