// generate.js - النسخة الاحترافية لتوليد رسالة التحفيز والبيانات مستخرجة من الـ CV
const L = require("./_lib");
const hits = {};

const clean = (s) => String(s || "").replace(/[{}]/g, "").trim();

// E-Mail-Text, der mit den Unterlagen verschickt wird:
function mailText(name, telefon) {
  const n = clean(name) || "{name}", t = clean(telefon);
  return `{anrede}

anbei erhalten Sie meine Bewerbung um einen Ausbildungsplatz als {beruf} mit Anschreiben und Lebenslauf. Über eine Einladung zu einem persönlichen Gespräch, gern auch online, würde ich mich sehr freuen.

Mit freundlichen Grüßen
${n}${t ? "\nTel.: " + t : ""}`;
}

// قالب ثابت احترافي وبدون فراغات عشوائية
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

mit großem Interesse habe ich Ihre Stellenausschreibung für die Ausbildung als {beruf} bei {firma} gelesen. Da ich hochmotiviert bin und gerne im Team arbeite, möchte ich mich Ihnen hiermit vorstellen.

In meinem beigefügten Lebenslauf und meinen Zeugnissen finden Sie detaillierte Nachweise über meine Qualifikationen und Vorkenntnisse. ${fakten}${extra}Ich bin mir der Herausforderungen einer Ausbildung in Deutschland bewusst und bringe die nötige Disziplin, Zuverlässigkeit sowie eine hohe Lernbereitschaft mit, um mich schnell in Ihr Team zu integrieren.

Über eine Einladung zu einem persönlichen Gespräch, gerne auch online, würde ich mich sehr freuen.`;

  return {
    name: clean(answers.name), wohnort: clean(answers.wohnort), telefon: clean(answers.telefon),
    betreff: `Bewerbung um einen Ausbildungsplatz als ${b} (m/w/d)`,
    anschreiben: withClosing(text),
    emailtext: mailText(answers.name, answers.telefon),
    vorlage: true,
  };
}

const withClosing = (t) => { t = String(t || "").trim(); return /mit freundlichen gr/i.test(t) ? t : t + "\n\nMit freundlichen Grüßen\n{name}"; };

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

  const prompt = `Du bist ein erfahrener Bewerbungscoach und schreibst ein überzeugendes, persönliches Anschreiben für eine Ausbildungsbewerbung in Deutschland.
Quellen: die angehängten PDFs (Lebenslauf und Zeugnisse) und diese Angaben des Bewerbers: ${JSON.stringify(answers)}.
Ausbildungsberuf: ${beruf}.

Aufbau (5 Absätze, Ich-Form, jeweils durch eine Leerzeile getrennt):
1. Anrede-Zeile {anrede}, danach Einstieg: Wer ich bin (Wohnort/Herkunft nur wenn im Lebenslauf) und warum ich genau diesen Beruf ({beruf}) bei {firma} lernen möchte. Konkret und glaubwürdig, keine leeren Floskeln.
2. Schulbildung, Sprachkenntnisse (Deutschniveau und Zertifikat, falls vorhanden) und Lernbereitschaft; ehrlich sagen, dass die Ausbildung ein Neuanfang ist.
3. Praktische Erfahrungen aus dem Lebenslauf (Praktika, Kurse, Nebenjobs, Ehrenamt) mit klarem Bezug zum Beruf.
4. Persönliche Stärken, belegt durch konkrete Beispiele aus dem Lebenslauf (z.B. Hobbys, Ehrenamt, Verantwortung). Nur wenn solche Angaben vorhanden sind.
5. Rahmenbedingungen aus den Angaben (Aufenthalt/Visum, frühester Beginn, Umzugsbereitschaft), soweit vorhanden, und der Wunsch nach einem persönlichen Gespräch oder Online-Interview.

Regeln:
- Nur Fakten aus den Unterlagen und Angaben verwenden. Nichts erfinden. Fehlt etwas, lass den Teil einfach weg.
- Natürlicher, freundlicher, professioneller Ton. Keine Aufzählungen, kein Markdown, keine Wiederholungen.
- Länge: 220 bis 300 Wörter, damit alles auf eine Seite passt.
- Platzhalter genau so schreiben: {anrede}, {firma}, {beruf}. Sie werden später für jede Firma ersetzt. Keine echte Firma nennen.
- Das Alter nicht angeben.
- Beende den Text mit "Mit freundlichen Grüßen" und in der nächsten Zeile {name}.
Antworte NUR mit JSON: {"name":"","wohnort":"","telefon":"","betreff":"Bewerbung um einen Ausbildungsplatz als ... (m/w/d)","anschreiben":"","emailtext":"kurzer E-Mail-Text mit {anrede} und {name}"}`;

  const E = process.env;
  const engines = [];
  if (E.GEMINI_API_KEY) engines.push(gemini);
  if (E.ANTHROPIC_API_KEY) engines.push(anthropic);
  for (const run of engines) {
    try { const o = await run(docs, prompt); o.anschreiben = withClosing(o.anschreiben); o.emailtext = mailText(o.name || answers.name, o.telefon || answers.telefon); return res.json(o); } catch (e) { /* Fallback */ }
  }
  
  res.json(vorlage(beruf, answers));
};
