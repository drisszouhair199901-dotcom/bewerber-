// Arbeitsagentur: Ausbildungsstellen suchen
const H = { "X-API-Key": "jobboerse-jobsuche", "User-Agent": "Jobsuche/2.9.2 (de.arbeitsagentur.jobboerse; build:1077; iOS 15.1.0) Alamofire/5.4.4", Accept: "application/json" };
const B = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// bei 403/429/5xx bis zu 3x mit Pause wiederholen
async function get(u) {
  let r;
  for (let t = 0; t < 3; t++) {
    r = await fetch(u, { headers: H });
    if (r.ok || ![403, 429, 500, 502, 503].includes(r.status)) return r;
    await sleep(700 * (t + 1));
  }
  return r;
}

module.exports = async (req, res) => {
  if (!(await require("./_lib").need(req, res))) return;
  const { was = "Ausbildung", wo = "", page = "1" } = req.query;
  const u = `${B}/v4/jobs?angebotsart=4&umkreis=50&size=25&page=${encodeURIComponent(page)}&was=${encodeURIComponent(was)}&wo=${encodeURIComponent(wo)}`;
  const r = await get(u);
  if (!r.ok) return res.status(502).json({ error: "Arbeitsagentur " + r.status });
  const d = await r.json();
  const list = d.stellenangebote || [], jobs = [];
  // Details in Gruppen von 5, damit die API nicht blockiert
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
