// Arbeitsagentur: Ausbildungsstellen suchen
const H = { "X-API-Key": "jobboerse-jobsuche" };
const B = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc";

module.exports = async (req, res) => {
  if (!(await require("./_lib").need(req, res))) return;
  const { was = "Ausbildung", wo = "", page = "1" } = req.query;
  const u = `${B}/v4/jobs?angebotsart=4&umkreis=50&size=25&page=${encodeURIComponent(page)}&was=${encodeURIComponent(was)}&wo=${encodeURIComponent(wo)}`;
  const r = await fetch(u, { headers: H });
  if (!r.ok) return res.status(502).json({ error: "Arbeitsagentur " + r.status });
  const d = await r.json();
  const jobs = await Promise.all((d.stellenangebote || []).map(async (j) => {
    let site = "";
    try {
      const dr = await fetch(`${B}/v2/jobdetails/${Buffer.from(j.refnr).toString("base64")}`, { headers: H });
      const dd = await dr.json();
      if (dd.externeUrl) site = new URL(dd.externeUrl).origin;
    } catch {}
    return { refnr: j.refnr, firma: j.arbeitgeber, beruf: j.titel, ort: j.arbeitsort?.ort || "", plz: j.arbeitsort?.plz || "", site };
  }));
  const total = d.maxErgebnisse || jobs.length;
  res.json({ total, pages: Math.ceil(total / 25), page: +page, jobs });
};
