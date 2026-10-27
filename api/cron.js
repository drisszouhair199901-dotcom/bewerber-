// Wird alle paar Minuten von einem Cron-Dienst aufgerufen (cron-job.org oder Vercel Cron) und sendet fällige geplante E-Mails.
// Aufruf: https://DEINE-APP.vercel.app/api/cron?key=CRON_SECRET   (oder Header Authorization: Bearer CRON_SECRET)
const L = require("./_lib");
const rng = (t, a) => encodeURIComponent(`'${t}'!${a}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const wrap = (b) => b.replace(/.{1,76}/g, "$&\r\n");
const GURL = "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media";

function mime(to, subject, text, atts) {
  const bd = "bw" + Math.random().toString(36).slice(2);
  const m = [`To: ${to}`, `Subject: =?UTF-8?B?${b64(subject)}?=`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${bd}"`, "",
    `--${bd}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(b64(text))];
  atts.forEach((a) => m.push(`--${bd}`, `Content-Type: ${a.type}; name="${a.name}"`, "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${a.name}"`, "", wrap(a.data)));
  m.push(`--${bd}--`, "");
  return m.join("\r\n");
}
const batchSet = (data) => L.sh("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || (req.query || {}).key;
  if (!secret || given !== secret) return res.status(401).json({ error: "unauthorized" });
  const t0 = Date.now(), MAX = +process.env.CRON_MAX || 6, out = { sent: 0, failed: 0, waiting: 0, notes: [] };
  try {
    const v = (await L.sh(`/values/${rng("Outbox", "A:L")}`)).values || [];
    const due = [];
    v.forEach((r, i) => { if (i > 0 && r[8] === "pending" && Date.parse(r[9]) <= Date.now()) due.push({ row: i + 1, r }); });
    due.sort((x, y) => Date.parse(x.r[9]) - Date.parse(y.r[9]));
    out.waiting = due.length;
    const tokens = {}, files = {};
    const token = async (owner) => {
      if (owner in tokens) return tokens[owner];
      const k = ((await L.sh(`/values/${rng("Konto", "A:C")}`)).values || []).slice(1).reverse().find((r) => (r[0] || "").toLowerCase() === owner);
      let t = null;
      if (k && k[1] && process.env.GOOGLE_CLIENT_ID) {
        const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: k[1], grant_type: "refresh_token" }) });
        const d = await r.json(); t = d.access_token || null; if (!t) out.notes.push("Token: " + (d.error || r.status));
      }
      return (tokens[owner] = t);
    };
    const load = async (ref) => {
      if (ref in files) return files[ref];
      const list = [];
      for (const p of String(ref || "").split(",").filter(Boolean)) {
        const [a, b] = p.split("-"), map = new Map();
        for (const r of (await L.sh(`/values/${rng("Files", `A${a}:E${b}`)}`)).values || []) {
          if (!map.has(r[1])) map.set(r[1], { name: r[1], type: r[2], data: "" });
          map.get(r[1]).data += r[4] || "";
        }
        list.push(...map.values());
      }
      return (files[ref] = list);
    };
    let n = 0;
    for (const { row, r } of due) {
      if (n >= MAX || Date.now() - t0 > 40000) break;
      const owner = (r[0] || "").toLowerCase(), qrow = r[1];
      const tok = await token(owner);
      if (!tok) { await batchSet([{ range: `'Outbox'!K${row}`, values: [["Gmail-Zugriff ungültig: neu anmelden und neu planen"]] }]); continue; }
      await batchSet([{ range: `'Outbox'!I${row}`, values: [["sending"]] }]);   // gegen Doppelversand
      let status = "failed", info = "";
      try {
        const lt = ((await L.sh(`/values/${rng("Letters", `A${r[6]}:C${r[6]}`)}`)).values || [[]])[0].join("");
        const atts = [{ name: r[5] || "Anschreiben.pdf", type: "application/pdf", data: lt }, ...(await load(r[7]))];
        const g = await fetch(GURL, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "message/rfc822" }, body: mime(r[2], r[3], r[4], atts) });
        if (g.ok) { status = "sent"; info = new Date().toISOString(); }
        else if (g.status === 429 || g.status === 403) { status = "pending"; info = "Gmail-Limit, später erneut"; }
        else if (g.status === 401) { status = "pending"; info = "Gmail-Zugriff abgelaufen: neu anmelden und neu planen"; tokens[owner] = null; }
        else info = `Fehler ${g.status}: ` + (await g.text()).replace(/\s+/g, " ").slice(0, 120);
      } catch (e) { info = "Fehler: " + e.message; }
      const data = [{ range: `'Outbox'!I${row}:K${row}`, values: [[status, r[9], info]] }];
      if (qrow && status !== "pending") data.push({ range: `'Queue'!J${qrow}:K${qrow}`, values: [[status, status === "sent" ? new Date(Date.now() + L.TZ * 60000).toISOString() : ""]] });
      await batchSet(data);
      if (status === "sent") out.sent++; else if (status === "failed") out.failed++;
      n++;
      if (status === "pending" && /Limit/.test(info)) break;
      await sleep(6000 + Math.random() * 6000);
    }
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message, ...out }); }
};
