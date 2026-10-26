// Google Maps (Places API New): Betriebe suchen. Braucht GOOGLE_MAPS_KEY in Vercel.
module.exports = async (req, res) => {
  if (!(await require("./_lib").need(req, res))) return;
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) return res.status(500).json({ error: "GOOGLE_MAPS_KEY fehlt in Vercel" });
  const { was = "", wo = "" } = req.query;
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.displayName,places.websiteUri,places.formattedAddress" },
    body: JSON.stringify({ textQuery: `${was} ${wo}`.trim(), languageCode: "de", pageSize: 20 }),
  });
  const d = await r.json();
  if (!r.ok) return res.status(502).json({ error: d.error?.message || "Maps " + r.status });
  const jobs = (d.places || []).map((p) => {
    let site = ""; try { site = new URL(p.websiteUri).origin; } catch {}
    return { refnr: "", firma: p.displayName?.text || "", beruf: was, plz: "", ort: p.formattedAddress || "", site };
  });
  res.json({ jobs });
};
