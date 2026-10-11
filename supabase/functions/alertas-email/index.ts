// Función programada (cron diario): compara anuncios publicados con alertas de precio y búsquedas guardadas (Plus)
// y envía un correo con las novedades. Correo vía Resend (RESEND_API_KEY + ALERT_FROM); si no hay clave, solo registra.
// La primera ejecución de cada alerta toma una «línea base» (no envía todo el catálogo).  Llamada: POST con header x-cron-secret.
import { createClient } from "npm:@supabase/supabase-js@2";
const SITE = Deno.env.get("SITE_URL") ?? "https://mapmarketapp.com/";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
type P = { id: string; title: string; type: string; price: number | null; currency: string; province: string; lat: number; lon: number; beds?: number; status?: string; demo?: boolean; precio_flag?: string };
const pip = (x: number, y: number, ring: number[][]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const enZona = (p: P, g: any) => !g || (g.type === "Polygon" && pip(p.lon, p.lat, g.coordinates[0]));
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
async function correo(to: string, asunto: string, items: { p: P; usd: number; baja?: boolean }[], en = false) {
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("ALERT_FROM");
  if (!key || !from) return "sin_proveedor";
  const html = `<div style="font-family:sans-serif;max-width:560px"><h2 style="color:#0f766e">📍 MapMarket</h2><p>${esc(asunto)}</p><ul>${items.slice(0, 20).map(({ p, usd, baja }) => `<li style="margin:8px 0"><a href="${SITE}p/${encodeURIComponent(String(p.id))}.html">${esc(p.title)}</a> — ${baja ? (en ? "⬇️ dropped to " : "⬇️ bajó a ") : ""}$${Math.round(usd).toLocaleString(en ? "en-US" : "es-CR")} · ${esc(p.province)}</li>`).join("")}</ul><p style="font-size:12px;color:#64748b">${en ? `You're receiving this because you turned on alerts on MapMarket. You can turn them off at ${SITE}cuenta.html?lang=en` : `Recibes esto porque activaste alertas en MapMarket. Puedes desactivarlas en ${SITE}cuenta.html`}</p></div>`;
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
    let en = false;
    if (j.uid) { const { data: pf } = await db.from("profiles").select("idioma").eq("id", j.uid).maybeSingle(); en = pf?.idioma === "en"; }
    const asunto = en ? `${nuevos.length} update${nuevos.length === 1 ? "" : "s"} for your alert "${j.nombre}"` : `${nuevos.length} novedad(es) para tu alerta «${j.nombre}»`;
    const st = await correo(j.email, asunto, nuevos, en);
    resumen.estado_correo[st] = (resumen.estado_correo[st] ?? 0) + 1; resumen.items += nuevos.length; if (st === "enviado") resumen.correos++;
  }
  // Respaldo por correo: notificaciones sin leer (>1 h) que no se enviaron por correo
  const { data: pend } = await db.from("notificaciones").select("id,user_id,titulo,cuerpo,url,created_at").eq("leida", false).is("correo_at", null).lt("created_at", new Date(Date.now() - 3600e3).toISOString()).limit(2000);
  const porU = new Map<string, any[]>(); (pend ?? []).forEach((n: any) => { if (!porU.has(n.user_id)) porU.set(n.user_id, []); porU.get(n.user_id)!.push(n); });
  resumen.notif_correo = 0;
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("ALERT_FROM");
  for (const [uid, ns] of porU) {
    const { data: pf } = await db.from("profiles").select("idioma,notif_correo").eq("id", uid).maybeSingle();
    const ids = ns.map((n) => n.id);
    if (pf && pf.notif_correo === false) { await db.from("notificaciones").update({ correo_at: new Date().toISOString() }).in("id", ids); continue; }
    if (!key || !from) { resumen.estado_correo.sin_proveedor = (resumen.estado_correo.sin_proveedor ?? 0) + 1; continue; }
    const { data: u } = await db.auth.admin.getUserById(uid); const to = u?.user?.email; if (!to) continue;
    const en = pf?.idioma === "en";
    const html = `<div style="font-family:sans-serif;max-width:560px"><h2 style="color:#0f766e">📍 MapMarket</h2><p>${en ? "You have unread notifications:" : "Tienes notificaciones sin leer:"}</p><ul>${ns.slice(0, 20).map((n) => `<li style="margin:8px 0"><a href="${SITE}${esc(n.url || "index.html")}">${esc(n.titulo)}</a>${n.cuerpo ? " — " + esc(n.cuerpo) : ""}</li>`).join("")}</ul><p style="font-size:12px;color:#64748b">${en ? `Turn off these emails in ${SITE}cuenta.html?lang=en` : `Desactiva estos correos en ${SITE}cuenta.html`}</p></div>`;
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject: en ? `MapMarket: ${ns.length} unread notification(s)` : `MapMarket: ${ns.length} notificación(es) sin leer`, html }) });
    if (r.ok) { await db.from("notificaciones").update({ correo_at: new Date().toISOString() }).in("id", ids); resumen.notif_correo++; }
  }
  return new Response(JSON.stringify(resumen), { headers: { "Content-Type": "application/json" } });
});
