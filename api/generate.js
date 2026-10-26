// generate.js - النسخة الاحترافية لتوليد رسالة التحفيز والبيانات مستخرجة من الـ CV
const L = require("./_lib");
const hits = {};

const clean = (s) => String(s || "").replace(/[{}]/g, "").trim();

// E-Mail-Text, der mit den Unterlagen verschickt wird (Fallback ohne KI):
function mailText(name, telefon) {
  const n = clean(name) || "{name}", t = clean(telefon);
  return `{anrede}

hiermit bewerbe ich mich mit großer Begeisterung um einen Ausbildungsplatz als {beruf} bei {firma}. Der Beruf entspricht genau meinen Interessen und Stärken, und ich bin sehr motiviert, ihn bei Ihnen von Grund auf zu erlernen.

Anbei erhalten Sie mein Anschreiben, meinen Lebenslauf und meine Zeugnisse mit allen weiteren Details zu meinem Werdegang. Über eine Einladung zu einem persönlichen Gespräch, gern auch online, würde ich mich sehr freuen.

Mit freundlichen Grüßen

${n}${t ? "\nTel.: " + t : ""}
E-Mail: {email}`;
}

const withMailSig = (t, name, telefon) => {
  t = String(t || "").trim();
  if (!/\{anrede\}/.test(t)) return mailText(name, telefon);
  if (!/mit freundlichen gr/i.test(t)) t += "\n\nMit freundlichen Grüßen\n\n{name}\nTel.: {telefon}\nE-Mail: {email}";
  return t;
};

// قالب ثابت احترافي وبدون فراغات عشوائية
function vorlage(beruf, answers) {
  const b = clean(beruf) || "Ausbildung";
  const dot = (x) => (/[.!?]$/.test(x) ? x : x + ".");
  const f = [];
  if (clean(answers.aufenthalt)) f.push(dot(clean(answers.aufenthalt)));
  if (clean(answers.beginn)) f.push(`Mein frühester Ausbildungsbeginn ist ${dot(clean(answers.beginn))}`);
  if (clean(answers.umzug)) f.push(`Zur Umzugsbereitschaft: ${dot(clean(answers.umzug))}`);
  const fakten = f.length ? " " + f.join(" ") : "";
  const extra = clean(answers.sonstiges) ? clean(answers.sonstiges) + "\n\n" : "";

  const text = `{anrede}

mit großer Begeisterung bewerbe ich mich bei {firma} um einen Ausbildungsplatz als {beruf}. Ich möchte einen Beruf erlernen, in dem ich Verantwortung übernehmen, praktisch arbeiten und jeden Tag Neues dazulernen kann. Genau das sehe ich in Ihrem Betrieb, und deshalb möchte ich meine Ausbildung gern bei Ihnen beginnen.

Mir ist bewusst, dass eine Ausbildung in Deutschland ein Neuanfang ist. Ich erwarte nicht, bereits alles zu wissen, sondern bringe eine große Lernbereitschaft mit und freue mich darauf, die Abläufe und Standards Ihres Hauses Schritt für Schritt kennenzulernen. Meinen Werdegang und meine Qualifikationen entnehmen Sie bitte meinem Lebenslauf und meinen Zeugnissen.

${extra}Ich weiß, was in Deutschland auf mich zukommt: Disziplin, Zuverlässigkeit und voller Einsatz. Darauf bin ich gut vorbereitet.${fakten} Über eine Einladung zu einem persönlichen Gespräch oder Online-Interview würde ich mich sehr freuen.`;

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

async function geminiOne(model, docs, prompt) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [...docs.slice(0, 6).map((data) => ({ inline_data: { mime_type: "application/pdf", data } })), { text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192, ...(/^gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: "low" } } : {}) },
    }),
    signal: AbortSignal.timeout(28000),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || "Gemini " + r.status);
  return parse((d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join(""));
}

// Modelle der Reihe nach probieren (GEMINI_MODEL in Vercel hat Vorrang)
async function gemini(docs, prompt) {
  const models = [process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash"].filter(Boolean);
  let last;
  for (const m of [...new Set(models)]) {
    try { return await geminiOne(m, docs, prompt); } catch (e) { last = new Error(`${m}: ${e.message}`); }
  }
  throw last;
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

  const heute = new Date().toLocaleDateString("de-DE");
  const hatZeugnisse = docs.length > 1;
  const prompt = `Du bist ein erfahrener Bewerbungscoach und schreibst ein Anschreiben für eine Ausbildungsbewerbung in Deutschland.
Quellen: die angehängten PDFs (Lebenslauf${hatZeugnisse ? " und Zeugnisse" : ""}) und diese Angaben des Bewerbers: ${JSON.stringify(answers)}.
Ausbildungsberuf: ${beruf}. Heutiges Datum: ${heute}.

Unten steht ein MUSTER-Anschreiben eines anderen Bewerbers (für den Beruf Pflegefachmann). Schreibe das Anschreiben für den aktuellen Bewerber in EXAKT derselben Form:
- genau 4 Absätze nach der Anrede, in derselben Reihenfolge, mit denselben Inhalten und ungefähr derselben Länge pro Absatz wie im Muster,
- gleicher Ton (persönlich, ehrlich, motiviert, höflich), gleiche Tiefe, gleiche Satzlänge,
- dieselben Fragen, die das Muster beantwortet: (1) Wer bin ich (Name, Alter) und was bedeutet mir dieser Beruf, warum will ich ihn lernen? (2) Welche Schulbildung und Sprachkenntnisse habe ich, und wie ehrlich und lernbereit gehe ich die Ausbildung als Neuanfang an? (3) Welche besondere Stärke bringe ich mit, belegt durch ein konkretes Beispiel aus meinem Leben? (4) Weiß ich, was in Deutschland auf mich zukommt, bin ich vorbereitet, und möchte ich mich persönlich oder online vorstellen?

MUSTER (nur Struktur, Länge und Ton übernehmen):
"""
{anrede}

mein Name ist Driss Zouhair, ich bin 21 Jahre alt und bewerbe mich bei {firma} mit großer Begeisterung um einen Ausbildungsplatz als Pflegefachmann. Pflege bedeutet für mich vor allem, Menschen in schwierigen Lebensphasen Sicherheit, Würde und Aufmerksamkeit zu schenken. Ich möchte einen Beruf ausüben, in dem menschliche Nähe und praktische Arbeit direkt zusammenkommen. Für mich ist die Pflege nicht einfach nur ein Beruf, sondern eine zutiefst erfüllende Aufgabe, die mir jeden Tag das Gefühl gibt, etwas wirklich Wichtiges für andere Menschen zu bewirken.

Seit meinem Abitur habe ich zielgerichtet an meiner Weiterentwicklung gearbeitet und das B2-Zertifikat in der deutschen Sprache erfolgreich erworben. Mir ist vollkommen klar, dass eine Ausbildung in Deutschland ein kompletter Neuanfang ist. Ich erwarte keineswegs, bereits alles zu wissen. Im Gegenteil: Ich bringe eine sehr große Lernbereitschaft mit und freue mich darauf, diesen Beruf von Grund auf neu zu erlernen und Ihre Arbeitsabläufe sowie Pflegestandards Schritt für Schritt aufmerksam aufzunehmen.

Eine besondere Stärke bringe ich durch meine mehrjährige Erfahrung als Fußballschiedsrichter mit: Sie hat mich gelehrt, auch unter hohem Druck ruhig zu bleiben, schnelle Entscheidungen zu treffen und stets respektvoll zu kommunizieren. Zudem hilft mir mein Interesse an Psychologiebüchern, Menschen besser zu verstehen.

Ich weiß genau, was in Deutschland auf mich zukommt: Disziplin, frühes Aufstehen und voller Einsatz. Ich bin mental bestens darauf vorbereitet und würde mich sehr freuen, mich Ihnen in einem persönlichen Gespräch oder Online-Interview vorzustellen.

Mit freundlichen Grüßen,
{name}
"""

Regeln:
- Übernimm KEINE Fakten aus dem Muster (Fußballschiedsrichter, Psychologiebücher, B2, Abitur, Name, Alter usw.). Nimm nur Fakten, die im Lebenslauf${hatZeugnisse ? ", in den Zeugnissen" : ""} oder in den Angaben des aktuellen Bewerbers stehen. Erfinde nichts. Fehlt für einen Teil eine Information, formuliere diesen Teil allgemein, ehrlich und ohne konkrete Behauptung.
- Passe Absatz 1 an den Beruf "${beruf}" an: was dieser Beruf für den Bewerber bedeutet, warum er ihn lernen will. Praktika, Kurse oder Nebenjobs, die zum Beruf passen, gehören in Absatz 2 oder 3.
- Alter nur nennen, wenn ein Geburtsdatum im Lebenslauf steht; dann korrekt zum heutigen Datum berechnen.
- Absatz 4 enthält zusätzlich, falls in den Angaben vorhanden und knapp formuliert: Aufenthalt/Visum, frühester Beginn, Umzugsbereitschaft. Sonstige Angaben des Bewerbers einbauen, wenn sie passen.
- Gesamtlänge ca. 260 bis 320 Wörter, kein Markdown, keine Aufzählungen.
- Platzhalter exakt so schreiben: {anrede}, {firma}, {beruf}, {name}. Keine echte Firma nennen. Der Text endet mit "Mit freundlichen Grüßen," und in der nächsten Zeile {name}.

E-Mail-Text (Feld "emailtext"), der zusammen mit den Anhängen verschickt wird: kein Kurztext, sondern eine vollständige, höfliche E-Mail in 3 Absätzen:
1. {anrede}, dann: Bewerbung um einen Ausbildungsplatz als {beruf} bei {firma} mit großer Begeisterung, plus 1 bis 2 Sätze mit den wichtigsten Qualifikationen aus dem Lebenslauf (z.B. Praktika, Kurse, Deutschniveau).
2. Hinweis auf die Anhänge (Anschreiben, Lebenslauf${hatZeugnisse ? ", Zeugnisse und Zertifikate" : ""}) mit den weiteren Details und der Wunsch nach einem persönlichen Gespräch, gern auch online.
3. Mit freundlichen Grüßen, Leerzeile, dann genau diese Zeilen: {name} / Tel.: {telefon} / E-Mail: {email}
Platzhalter exakt: {anrede}, {firma}, {beruf}, {name}, {telefon}, {email}.

Antworte NUR mit JSON: {"name":"","wohnort":"","telefon":"","betreff":"Bewerbung um einen Ausbildungsplatz als ... (m/w/d)","anschreiben":"","emailtext":""}`;

  const E = process.env;
  const engines = [];
  if (E.GEMINI_API_KEY) engines.push(gemini);
  if (E.ANTHROPIC_API_KEY) engines.push(anthropic);
  let kiFehler = engines.length ? "" : "Kein KI-Schlüssel gesetzt (GEMINI_API_KEY fehlt in Vercel)";
  for (const run of engines) {
    try {
      const o = await run(docs, prompt);
      if (!o || !o.anschreiben) throw new Error("KI-Antwort ohne Anschreiben");
      o.anschreiben = withClosing(o.anschreiben);
      o.emailtext = withMailSig(o.emailtext, o.name || answers.name, o.telefon || answers.telefon);
      return res.json(o);
    } catch (e) { kiFehler = String((e && e.message) || e).slice(0, 200); }
  }

  res.json({ ...vorlage(beruf, answers), ki_fehler: kiFehler });
};
