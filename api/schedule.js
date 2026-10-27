// Geplanter Versand: speichert Unterlagen + E-Mails im Google Sheet. Gesendet wird von cron.js (Server).
const L = require("./_lib");
const TABS = {
  Outbox: ["owner", "qrow", "to", "subject", "body", "letterName", "letterRow", "filesRef", "status", "at", "info", "firma"],
  Letters: ["data1", "data2", "data3"],
  Files: ["owner", "name", "type", "idx", "data"],
  Konto: ["owner", "refresh_token", "updated"],
};
const rng = (t, a) => encodeURIComponent(`'${t}'!${a}`);
const EM = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const chunk = (s, n = 45000) => { const o = []; for (let i = 0; i < s.length; i += n) o.push(s.slice(i, i + n)); return o.length ? o : [""]; };
let ready = false;

async function ensure() {
  if (ready) return;
  const meta = await L.sh("?fields=sheets.properties.title");
  const have = new Set(meta.sheets.map((s) => s.properties.title));
  const need = Object.keys(TABS).filter((t) => !have.has(t));
  if (need.length) {
    try { await L.sh(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: need.map((title) => ({ addSheet: { properties: { title } } })) }) }); } catch {}
    for (const t of need) await L.sh(`/values/${rng(t, "A1")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [TABS[t]] }) });
  }
  ready = true;
}
const append = (tab, values) => L.sh(`/values/${rng(tab, "A:L")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ values }) });
const rowsOf = (r) => {
  const m = /!\$?[A-Z]+(\d+)(?::\$?[A-Z]+(\d+))?/.exec((r.updates && r.updates.updatedRange) || "");
  if (!m) throw new Error("Zeilen nicht erkannt");
  return [+m[1], +(m[2] || m[1])];
};
async function saveToken(owner, rt) {
  const v = (await L.sh(`/values/${rng("Konto", "A:C")}`)).values || [];
  const i = v.findIndex((r, k) => k > 0 && (r[0] || "").toLowerCase() === owner), now = new Date().toISOString();
  if (i < 0) await append("Konto", [[owner, rt, now]]);
  else await L.sh(`/values/${rng("Konto", `B${i + 1}:C${i + 1}`)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [[rt, now]] }) });
}
const hasToken = async (owner) => ((await L.sh(`/values/${rng("Konto", "A:B")}`)).values || []).some((r, k) => k > 0 && (r[0] || "").toLowerCase() === owner && r[1]);
const batchSet = (data) => data.length ? L.sh("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) }) : null;

module.exports = async (req, res) => {
  const a = await L.need(req, res); if (!a) return;
  try {
    await ensure();
    const me = a.u.email, q = req.query || {}, b = req.body || {}, action = q.action || b.action;

    if (action === "files") {                                   // eine Datei (Base64) hochladen
      if (!b.name || !b.data) return res.status(400).json({ error: "Datei fehlt" });
      const rows = chunk(String(b.data)).map((c, k) => [me, b.name, b.type || "application/pdf", k, c]);
      const [s, e] = rowsOf(await append("Files", rows));
      return res.json({ range: `${s}-${e}` });
    }

    if (action === "add") {                                     // E-Mails mit Sendezeit speichern
      const items = b.items || [];
      if (!items.length) return res.status(400).json({ error: "Keine E-Mails" });
      if (b.refresh_token) await saveToken(me, b.refresh_token);
      else if (!(await hasToken(me))) return res.status(400).json({ error: "Gmail-Token fehlt. Neu anmelden." });
      for (const it of items) {
        if (!EM.test(it.to || "") || isNaN(Date.parse(it.at))) return res.status(400).json({ error: "Ungültige E-Mail oder Zeit bei " + (it.firma || "?") });
        if (Date.parse(it.at) > Date.now() + 14 * 86400000) return res.status(400).json({ error: "Sendezeit mehr als 14 Tage in der Zukunft" });
      }
      const letters = items.map((it) => { const c = chunk(String(it.letterB64 || "")); if (c.length > 3) throw new Error("Anschreiben zu groß: " + it.firma); return c; });
      const [ls] = rowsOf(await append("Letters", letters));
      await append("Outbox", items.map((it, k) => [me, it.qrow || "", it.to, it.subject, it.body, it.letterName, ls + k, b.filesRef || "", "pending", it.at, "", it.firma || ""]));
      const qr = items.filter((it) => it.qrow).map((it) => +it.qrow);
      if (qr.length) {
        const own = new Set(((await L.sh(`/values/${rng("Queue", "A:A")}`)).values || []).map((r, i) => ((r[0] || "").toLowerCase() === me ? i + 1 : 0)));
        await batchSet(qr.filter((r) => own.has(r)).map((r) => ({ range: `'Queue'!J${r}`, values: [["scheduled"]] })));
      }
      return res.json({ added: items.length });
    }

    if (action === "list" || action === "cancel") {
      const v = (await L.sh(`/values/${rng("Outbox", "A:L")}`)).values || [];
      const mine = [];
      v.forEach((r, i) => { if (i > 0 && (r[0] || "").toLowerCase() === me) mine.push({ row: i + 1, qrow: r[1], status: r[8], at: r[9], info: r[10] }); });
      if (action === "cancel") {
        const data = [];
        mine.filter((m) => m.status === "pending").forEach((m) => {
          data.push({ range: `'Outbox'!I${m.row}`, values: [["cancelled"]] });
          if (m.qrow) data.push({ range: `'Queue'!J${m.qrow}`, values: [["ready"]] });
        });
        await batchSet(data);
        return res.json({ cancelled: data.filter((d) => d.range.startsWith("'Outbox'")).length });
      }
      const c = (s) => mine.filter((m) => m.status === s);
      const pend = c("pending").sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
      return res.json({ pending: pend.length, sent: c("sent").length, failed: c("failed").length, next: pend[0] ? pend[0].at : null, problem: (pend.find((m) => m.info) || {}).info || "" });
    }
    res.status(400).json({ error: "action fehlt" });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
