// Erstellt aus Lebenslauf + Zeugnissen (PDF) ein Anschreiben mit Platzhaltern.
// Reihenfolge: 1) Gemini (kostenlos, GEMINI_API_KEY)  2) Anthropic (optional, ANTHROPIC_API_KEY)  3) feste Vorlage (immer kostenlos, ohne KI)
const L = require("./_lib");
const hits = {};

const clean = (s) => String(s || "").replace(/[{}]/g, "").trim();

// E-Mail-Text, der mit den Unterlagen verschickt wird: Daten des Bewerbers (Name, Telefon, Beruf), {anrede} füllt die Seite je Firma.
function mailText(name, telefon) {
  const n = clean(name) || "{name}", t = clean(telefon);
  return `{anrede}

anbei erhalten Sie meine Bewerbung um einen Ausbildungsplatz als {beruf} mit Anschreiben und Lebenslauf. Über eine Einladung zu einem persönlichen Gespräch, gern auch online, würde ich mich sehr freuen.

Mit freundlichen Grüßen
${n}${t ? "\nTel.: " + t : ""}`;
}

// Feste Vorlage ohne KI. Nur {anrede}, {firma}, {beruf}, {name} bleiben als Platzhalter.
function vorlage(beruf, answers) {
  const b = clean(beruf) || "Ausbildung";
  const dot = (x) => (/[.!?]$/.test(x) ? x : x + ".");
  const f = [];
  if (clean(answers.aufenthalt)) f.push(dot(clean(answers.aufenthalt)));
  if (clean(answers.beginn)) f.push(`Mein frühester Ausbildungsbeginn ist ${dot(clean(answers.beginn))}`);
  if (clean(answers.umzug)) f.push(`Zur Umzugsbereitschaft: ${dot(clean(answers.umzug))}`);
  const fakten = f.length ? f.join(" ") + "\n\n" : "";
  const extra = clean(answers.sonstiges) ? clean(answers.sonstiges) + "\n\n" : "";
  const text = `{anrede}

mit großem Interesse bewerbe ich mich bei {firma} um einen Ausbildungsplatz als {beruf}.

Ich möchte eine fundierte Ausbildung in diesem Beruf machen und mich langfristig in diesem Bereich weiterentwickeln. Lernbereitschaft, Zuverlässigkeit und Teamarbeit sind mir dabei wichtig. Meine Qualifikationen und Nachweise finden Sie in den Anlagen.

${fakten}${extra}Über die Einladung zu einem persönlichen Gespräch freue ich mich sehr.

Mit freundlichen Grüßen

{name}

Anlagen: Lebenslauf, Zeugnisse`;
  return {
    name: clean(answers.name), wohnort: clean(answers.wohnort), telefon: clean(answers.telefon),
    betreff: `Bewerbung um einen Ausbildungsplatz als ${b} (m/w/d)`,
    anschreiben: text,
    emailtext: mailText(answers.name, answers.telefon),
    vorlage: true,
  };
}

const parse = (t) => JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));

async function gemini(docs, prompt) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [...docs.slice(0, 6).map((data) => ({ inline_data: { mime_type: "application/pdf", data } })), { text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4000 },
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || "Gemini " + r.status);
  return parse((d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join(""));
}

async function anthropic(docs, prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6", max_tokens: 2500,
      messages: [{ role: "user", content: [...docs.slice(0, 6).map((data) => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } })), { type: "text", text: prompt }] }],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || "KI " + r.status);
  return parse(d.content.map((c) => c.text || "").join(""));
}

module.exports = async (req, res) => {
  const a = await L.need(req, res); if (!a) return;
  const k = a.u.email, now = Date.now();
  hits[k] = (hits[k] || []).filter((t) => now - t < 3600e3);
  if (hits[k].length >= 8 && !a.admin) return res.status(429).json({ error: "Limit: 8 Anschreiben pro Stunde" });
  hits[k].push(now);
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

  const E = process.env;
  const engines = [];
  if (E.GEMINI_API_KEY) engines.push(gemini);
  if (E.ANTHROPIC_API_KEY) engines.push(anthropic);
  for (const run of engines) {
    try { const o = await run(docs, prompt); o.emailtext = mailText(o.name || answers.name, o.telefon || answers.telefon); return res.json(o); } catch (e) { /* nächste Möglichkeit */ }
  }
  // Kein Schlüssel oder KI nicht erreichbar / Limit erreicht: kostenlose feste Vorlage
  res.json(vorlage(beruf, answers));
};
