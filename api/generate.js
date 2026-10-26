// Erstellt aus Lebenslauf + Zeugnissen (PDF) ein Anschreiben mit Platzhaltern. Braucht ANTHROPIC_API_KEY.
const L = require("./_lib");
const hits = {};
module.exports = async (req, res) => {
  const a = await L.need(req, res); if (!a) return;
  const k = a.u.email, now = Date.now();
  hits[k] = (hits[k] || []).filter((t) => now - t < 3600e3);
  if (hits[k].length >= 8 && !a.admin) return res.status(429).json({ error: "Limit: 8 Anschreiben pro Stunde" });
  hits[k].push(now);
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY fehlt in Vercel" });
  const { docs = [], beruf = "", answers = {} } = req.body || {};
  if (!docs.length) return res.status(400).json({ error: "Lebenslauf fehlt" });
  const prompt = `Du schreibst ein Anschreiben für eine Ausbildungsbewerbung in Deutschland.
Quellen: die angehängten PDFs (das erste ist der Lebenslauf, die weiteren sind Zeugnisse) und diese Angaben des Bewerbers: ${JSON.stringify(answers)}.
Ausbildungsberuf: ${beruf}.
Regeln:
- Nur Fakten aus den Unterlagen und Angaben verwenden. Nichts erfinden. Fehlt eine Information, lass sie weg.
- Beantworte die Fragen, die deutsche Betriebe typischerweise haben: Warum dieser Beruf? Motivation, Schulabschluss und Qualifikationen, Deutschniveau, Stärken und Erfahrungen (auch Praktika, Ehrenamt, Hobbys), Aufenthalts-/Arbeitserlaubnis bzw. Visum, frühester Beginn, Umzugsbereitschaft.
- Über die Firma nichts erfinden. Der Firmenname steht nur als {firma}.
- Platzhalter genau so verwenden: {anrede} (erste Zeile), {firma}, {beruf}, {name}.
- 250 bis 350 Wörter, klare, korrekte, einfache Sprache.
- Ende: "Mit freundlichen Grüßen\\n\\n{name}\\n\\nAnlagen: Lebenslauf, Zeugnisse".
Antworte NUR mit JSON: {"name":"","wohnort":"","telefon":"","betreff":"Bewerbung um einen Ausbildungsplatz als ... (m/w/d)","anschreiben":"","emailtext":"kurzer E-Mail-Text mit {anrede} und {name}"}`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6", max_tokens: 2500,
        messages: [{ role: "user", content: [...docs.slice(0, 6).map((data) => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } })), { type: "text", text: prompt }] }] }) });
    const d = await r.json();
    if (!r.ok) return res.status(502).json({ error: d.error?.message || "KI " + r.status });
    const t = d.content.map((c) => c.text || "").join("");
    res.json(JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)));
  } catch (e) { res.status(500).json({ error: "Antwort nicht lesbar, bitte nochmal versuchen" }); }
};
