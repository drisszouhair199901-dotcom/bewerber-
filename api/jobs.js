// Arbeitsagentur: Ausbildungsstellen suchen
const KEY = { "X-API-Key": "jobboerse-jobsuche" };
const UA = { ...KEY, "User-Agent": "Jobsuche/2.9.2 (de.arbeitsagentur.jobboerse; build:1077; iOS 15.1.0) Alamofire/5.4.4", Accept: "application/json" };
const B = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pref = 0; // welche Header-Variante zuletzt funktioniert hat

// Erst die alten Header (liefen vorher), dann mit User-Agent; bei 403/429/5xx mit Pause wiederholen
async function get(u) {
  const V = [KEY, UA]; let r;
  for (let t = 0; t < 3; t++) {
    for (let k = 0; k < V.length; k++) {
      const v = (pref + k) % V.length;
      r = await fetch(u, { headers: V[v] });
      if (r.ok) { pref = v; return r; }
      if (![403, 429, 500, 502, 503].includes(r.status)) return r;
    }
    await sleep(800 * (t + 1));
  }
  return r;
}

module.exports = async (req, res) => {
  if (!(await require("./_lib").need(req, res))) return;
  const { was = "Ausbildung", wo = "", page = "1" } = req.query;
  const u = `${B}/v4/jobs?angebotsart=4&umkreis=50&size=25&page=${encodeURIComponent(page)}&was=${encodeURIComponent(was)}&wo=${encodeURIComponent(wo)}`;
  const r = await get(u);
  if (!r.ok) {
    const body = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
    return res.status(502).json({ error: `Arbeitsagentur ${r.status}${body ? " – " + body : ""}` });
  }
  const d = await r.json();
  const list = d.stellenangebote || [], jobs = [];
  for (let k = 0; k < list.length; k += 5) {
    jobs.push(...await Promise.all(list.slice(k, k + 5).map(async (j) => {
      let site = "";
      try {
        const dr = await get(`${B}/v2/jobdetails/${Buffer.from(j.refnr).toString("base64")}`);
        const dd = await dr.json();
        if (dd.externeUrl) site = new URL(dd.externeUrl).origin;
      } catch {}
      return { refnr: j.refnr, firma: j.arbeitgeber, beruf: j.titel, ort: j.arbeitsort?.ort || "", plz: j.arbeitsort?.plz || "", site };
    })));
  }
  const total = d.maxErgebnisse || jobs.length;
  res.json({ total, pages: Math.ceil(total / 25), page: +page, jobs });
};
