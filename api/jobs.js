// Arbeitsagentur: Ausbildungsstellen suchen (Suche: v6, Details: v4)
const H = { "X-API-Key": "jobboerse-jobsuche", "Accept": "application/json" };
const B = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc";

module.exports = async (req, res) => {
  if (!(await require("./_lib").need(req, res))) return;
  const { was = "Ausbildung", wo = "", page = "1" } = req.query;
  const p = new URLSearchParams({ angebotsart: "4", size: "25", page: String(page), was });
  if (wo.trim()) { p.set("wo", wo.trim()); p.set("umkreis", "50"); }
  const r = await fetch(`${B}/v6/jobs?${p}`, { headers: H });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return res.status(502).json({ error: "Arbeitsagentur " + r.status, detail: t.slice(0, 300) });
  }
  const d = await r.json();
  const list = d.ergebnisliste || d.stellenangebote || [];
  const jobs = await Promise.all(list.map(async (j) => {
    const refnr = j.referenznummer || j.refnr;
    const loc = (j.stellenlokationen && j.stellenlokationen[0] && j.stellenlokationen[0].adresse) || j.arbeitsort || {};
    let site = "";
    try {
      const dr = await fetch(`${B}/v4/jobdetails/${Buffer.from(refnr).toString("base64")}`, { headers: H });
      const dd = await dr.json();
      if (dd.externeUrl) site = new URL(dd.externeUrl).origin;
    } catch {}
    return {
      refnr,
      firma: j.firma || j.arbeitgeber || "",
      beruf: j.stellenangebotsTitel || j.titel || "",
      ort: loc.ort || "",
      plz: loc.plz || "",
      site,
    };
  }));
  res.json({ total: d.maxErgebnisse || jobs.length, jobs });
};
