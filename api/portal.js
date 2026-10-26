// Azubiyo / Aubi-plus / Ausbildung.de / Azubica: liest schema.org JobPosting-Daten einer Suchseite
const OK = ["azubiyo.de", "aubi-plus.de", "ausbildung.de", "azubica.de"];
module.exports = async (req, res) => {
  if (!(await require("./_lib").need(req, res))) return;
  let u; try { u = new URL(req.query.url); } catch { return res.status(400).json({ error: "Ungültiger Link" }); }
  if (u.protocol !== "https:" || !OK.some((h) => u.hostname === h || u.hostname.endsWith("." + h)))
    return res.status(400).json({ error: "Nur Azubiyo, Aubi-plus, Ausbildung.de, Azubica" });
  const html = await (await fetch(u, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0" } })).text();
  const found = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if ([].concat(n["@type"] || []).includes("JobPosting")) found.push(n);
    Object.values(n).forEach(walk);
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1])); } catch {}
  }
  const jobs = found.map((n) => {
    const org = n.hiringOrganization || {};
    let site = ""; try { const s = new URL(org.sameAs || org.url); if (!OK.some((h) => s.hostname.endsWith(h))) site = s.origin; } catch {}
    const a = [].concat(n.jobLocation || [])[0]?.address || {};
    return { refnr: "", firma: org.name || "", beruf: n.title || "", plz: a.postalCode || "", ort: a.addressLocality || "", site };
  }).filter((j) => j.firma);
  res.json({ jobs, note: jobs.length ? "" : "Keine Daten auf dieser Seite gefunden" });
};
