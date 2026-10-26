// Arbeitsagentur: Ausbildungsstellen suchen (nur Vercel)
const KEY = { "X-API-Key": "jobboerse-jobsuche" };
const UA = { ...KEY, "User-Agent": "Jobsuche/2.9.2 (de.arbeitsagentur.jobboerse; build:1077; iOS 15.1.0) Alamofire/5.4.4", Accept: "application/json" };
const B = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let good = null; // zuletzt funktionierende Kombination { ep, hdr }

// Kombinationen: zwei Endpunkte x zwei Header-Varianten, bei 403/429/5xx mit Pause wiederholen
async function search(qs) {
  const eps = ["v4/jobs", "v4/app/jobs"], hs = [KEY, UA];
  const combos = [];
  if (good) combos.push(good);
  for (const ep of eps) for (const hdr of hs) combos.push({ ep, hdr });
  let r;
  for (let t = 0; t < 2; t++) {
    for (const c of combos) {
      r = await fetch(`${B}/${c.ep}?${qs}`, { headers: c.hdr });
      if (r.ok) { good = c; return r; }
      if (![403, 404, 429, 500, 502, 503].includes(r.status)) return r;
    }
    await sleep(1000);
  }
  return r;
}
async function detail(refnr) {
  const u = `${B}/v2/jobdetails/${Buffer.from(refnr).toString("base64")}`;
  for (const h of [good?.hdr || KEY, UA]) {
    const r = await fetch(u, { headers: h });
    if (r.ok) return r.json();
  }
  return {};
}

module.exports = async (req, res) => {
  if (!(await require("./_lib").need(req, res))) return;
  const { was = "Ausbildung", wo = "", page = "1" } = req.query;
  const qs = `angebotsart=4&umkreis=50&size=25&page=${encodeURIComponent(page)}&was=${encodeURIComponent(was)}&wo=${encodeURIComponent(wo)}`;
  const r = await search(qs);
  if (!r.ok) {
    const body = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 120);
    return res.status(502).json({ error: `Arbeitsagentur ${r.status} (${r.headers.get("server") || "?"})${body ? " – " + body : ""}` });
  }
  const d = await r.json();
  const list = d.stellenangebote || [], jobs = [];
  for (let k = 0; k < list.length; k += 5) {
    jobs.push(...await Promise.all(list.slice(k, k + 5).map(async (j) => {
      let site = "";
      try { const dd = await detail(j.refnr); if (dd.externeUrl) site = new URL(dd.externeUrl).origin; } catch {}
      return { refnr: j.refnr, firma: j.arbeitgeber, beruf: j.titel, ort: j.arbeitsort?.ort || "", plz: j.arbeitsort?.plz || "", site };
    })));
  }
  const total = d.maxErgebnisse || jobs.length;
  res.json({ total, pages: Math.ceil(total / 25), page: +page, jobs });
};
