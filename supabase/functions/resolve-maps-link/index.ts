// Resuelve enlaces cortos de Google Maps (maps.app.goo.gl, goo.gl/maps, g.co/kgs) siguiendo redirecciones
// solo hacia hosts de Google (no es un proxy abierto). Devuelve { lat, lon, url } o { error }.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const START = /^(maps\.app\.goo\.gl|goo\.gl|g\.co)$/i;
const OK = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|(www\.|maps\.)?google\.[a-z.]{2,6}|consent\.google\.[a-z.]{2,6})$/i;
const A = "23456789CFGHJMPQRVWX";
function olcDec(c: string): [number, number] | null { c = c.toUpperCase().replace("+", ""); if (c.length < 8) return null; let la = -90, lo = -180, r = 20;
  for (let i = 0; i < Math.min(c.length, 10); i += 2) { la += A.indexOf(c[i]) * r; lo += A.indexOf(c[i + 1]) * r; if (i < 8) r /= 20 } const sz = c.length >= 10 ? 0.000125 : r * 20 / 2; return [la + sz / 2, lo + sz / 2] }
function olcEnc(la: number, lo: number): string { la = Math.min(89.9999, la) + 90; lo = lo + 180; let s = "", r = 20; for (let i = 0; i < 5; i++) { const a = Math.floor(la / r), b = Math.floor(lo / r); s += A[a] + A[b]; la -= a * r; lo -= b * r; r /= 20; if (i === 3) s += "+" } return s }
function recover(short: string, la: number, lo: number): [number, number] | null { const n = 8 - short.indexOf("+"); if (n <= 0) return olcDec(short); const full = olcEnc(la, lo).slice(0, n) + short.toUpperCase(); const res = olcDec(full); if (!res) return null; const span = Math.pow(20, 2 - n / 2) ;
  if (res[0] - la > span / 2) res[0] -= span; else if (la - res[0] > span / 2) res[0] += span; if (res[1] - lo > span / 2) res[1] -= span; else if (lo - res[1] > span / 2) res[1] += span; return res }
async function geocode(q: string): Promise<[number, number] | null> { q = q.trim(); if (!q) return null;
  try { const r = await fetch("https://photon.komoot.io/api/?limit=1&bbox=-86.1,8.0,-82.5,11.3&q=" + encodeURIComponent(q), { headers: { "User-Agent": "MapMarket/1.0 (pcalifax@gmail.com)" }, signal: AbortSignal.timeout(8000) }); const d = await r.json(); const c = d?.features?.[0]?.geometry?.coordinates; if (c) return [c[1], c[0]] } catch { /* */ }
  try { const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cr&q=" + encodeURIComponent(q), { headers: { "User-Agent": "MapMarket/1.0 (pcalifax@gmail.com)" }, signal: AbortSignal.timeout(8000) }); const d = await r.json(); if (d && d[0]) return [+d[0].lat, +d[0].lon] } catch { /* */ }
  return null }
async function fallback(u: URL): Promise<Response | null> {
  const t = decodeURIComponent((u.pathname.match(/\/maps\/place\/([^/]+)/) || [])[1] || u.searchParams.get("q") || "").replace(/\+/g, " ").trim(); if (!t) return null;
  const pc = t.match(/^([23456789CFGHJMPQRVWX]{4,8})\s([23456789CFGHJMPQRVWX]{2,3})\b\s*(.*)$/i) || t.match(/^([23456789CFGHJMPQRVWX]{4,8})\+([23456789CFGHJMPQRVWX]{2,3})\b\s*(.*)$/i);
  if (pc) { const code = pc[1] + "+" + pc[2]; if (code.indexOf("+") >= 8) { const d = olcDec(code); if (d) return j({ lat: d[0], lon: d[1], url: u.href, via: "pluscode" }) }
    const ref = (await geocode(pc[3].replace(/^[,\s]+/, "").split(",").slice(-2).join(","))) || [9.93, -84.08]; const d = recover(code, ref[0], ref[1]); if (d) return j({ lat: d[0], lon: d[1], url: u.href, via: "pluscode" }) }
  const g = await geocode(t.split(",").slice(-3).join(",")) ; return g ? j({ lat: g[0], lon: g[1], url: u.href, approx: true, via: "geocode" }) : null }
const hits = new Map<string, number[]>();
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
function coords(s: string): [number, number] | null {
  const d = (() => { try { return decodeURIComponent(s) } catch { return s } })();
  const pats = [/\/maps\/(?:search|place|dir\/[^/]*)\/\+?(-?\d+\.\d+),\s*\+?(-?\d+\.\d+)/, /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /[?&](?:q|query|ll|sll|destination|center)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/];
  for (const p of pats) { const m = d.match(p) || s.match(p); if (m) return [+m[1], +m[2]] }
  return null;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "method" }, 405);
  const ip = (req.headers.get("x-forwarded-for") || "?").split(",")[0].trim(), now = Date.now();
  const h = (hits.get(ip) || []).filter((t) => now - t < 60_000); if (h.length >= 15) return j({ error: "rate_limit" }, 429); h.push(now); hits.set(ip, h);
  let url: URL; try { url = new URL(String((await req.json()).url || "").trim().slice(0, 500)) } catch { return j({ error: "url" }, 400) }
  if (url.protocol !== "https:" && url.protocol !== "http:") return j({ error: "url" }, 400);
  if (!START.test(url.hostname) || (url.hostname === "goo.gl" && !url.pathname.startsWith("/maps")) || (url.hostname === "g.co" && !url.pathname.startsWith("/kgs"))) return j({ error: "host" }, 400);
  url.protocol = "https:";
  try {
    for (let i = 0; i < 6; i++) {
      if (!OK.test(url.hostname)) return j({ error: "host" }, 400);
      const c = coords(url.href); if (c) return j({ lat: c[0], lon: c[1], url: url.href });
      const r = await fetch(url.href, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (compatible; MapMarket/1.0)", "Accept-Language": "es" }, signal: AbortSignal.timeout(8000) });
      const loc = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && loc) { await r.body?.cancel(); url = new URL(loc, url); continue }
      const html = (await r.text()).slice(0, 600_000); const mm = html.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/); const c2: [number, number] | null = mm ? [+mm[1], +mm[2]] : null;
      if (c2) return j({ lat: c2[0], lon: c2[1], url: url.href });
      // consent.google.com?continue=<url real>
      const cont = url.searchParams.get("continue"); if (cont) { url = new URL(cont); continue }
      const fb = await fallback(url); if (fb) return fb;
      return j({ error: "no_coords", url: url.href }, 422);
    }
    return j({ error: "redirects" }, 422);
  } catch (e) { return j({ error: "fetch", detail: String(e).slice(0, 100) }, 502) }
});
