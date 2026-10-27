// Warteschlange: alle gefundenen Firmen speichern, pro Tag nur N senden, morgen dort weitermachen.
// Speicher: Tab "Queue" im selben Google Sheet wie die Benutzer (kein neuer Dienst nötig).
const L = require("./_lib");
const TAB = "Queue";
const HDR = ["owner", "key", "firma", "beruf", "ort", "plz", "site", "email", "name", "status", "ts"];
const LIMIT = +(process.env.DAILY_LIMIT || 150);
const rng = (a) => encodeURIComponent(`'${TAB}'!${a}`);
const day = () => new Date(Date.now() + L.TZ * 60000).toISOString().slice(0, 10);
const keyOf = (j) => j.email ? "mail:" + String(j.email).trim().toLowerCase() : (String(j.firma || "").trim() + "|" + String(j.ort || "").trim()).toLowerCase();

let ready = false;
async function ensure() {
  if (ready) return;
  const meta = await L.sh("?fields=sheets.properties.title");
  if (!meta.sheets.some((s) => s.properties.title === TAB)) {
    try { await L.sh(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] }) }); } catch {}
    await L.sh(`/values/${rng("A1:K1")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [HDR] }) });
  }
  ready = true;
}
// Zeilen leeren (Zeilennummern bleiben stabil); A:Z, damit auch verschobene Daten verschwinden
async function clearRows(list) {
  const del = [...list].sort((a, b) => a - b);
  if (!del.length) return 0;
  const ranges = []; let s = del[0], p = del[0];
  for (const r of del.slice(1)) { if (r === p + 1) { p = r; continue; } ranges.push(`'${TAB}'!A${s}:Z${p}`); s = p = r; }
  ranges.push(`'${TAB}'!A${s}:Z${p}`);
  for (let i = 0; i < ranges.length; i += 100)
    await L.sh("/values:batchClear", { method: "POST", body: JSON.stringify({ ranges: ranges.slice(i, i + 100) }) });
  return del.length;
}
// "scheduled" und "sent" bleiben erhalten
const clearOpen = (rows) => clearRows(rows.filter((r) => r.status !== "scheduled" && r.status !== "sent").map((r) => r.row));
// Kaputte Zeilen ohne Besitzer (durch fehlerhaftes Anhaengen verschoben) entfernen
async function repair() {
  const v = (await L.sh(`/values/${encodeURIComponent(`'${TAB}'!A:Z`)}`)).values || [];
  const bad = [];
  v.forEach((r, i) => { if (i > 0 && !String(r[0] || "").trim() && r.some((c) => String(c || "").trim())) bad.push(i + 1); });
  return clearRows(bad);
}
// Anhaengen an feste Zeilen (values:append hat die Daten ab Spalte H geschrieben)
async function appendRows(vals) {
  const v = (await L.sh(`/values/${rng("A:K")}`)).values || [];
  const first = Math.max(2, v.length + 1);
  await L.sh(`/values/${rng(`A${first}:K${first + vals.length - 1}`)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: vals }) });
}
async function mine(email) {
  email = String(email || "").trim().toLowerCase();
  const v = (await L.sh(`/values/${rng("A:K")}`)).values || [];
  const out = [];
  v.slice(1).forEach((r, i) => {
    if (String(r[0] || "").trim().toLowerCase() !== email) return;
    const o = { row: i + 2 };
    HDR.forEach((h, k) => (o[h] = r[k] || ""));
    out.push(o);
  });
  return out;
}
const stats = (rows) => {
  const c = { total: rows.length, new: 0, ready: 0, scheduled: 0, sent: 0, noemail: 0, failed: 0, today: 0 };
  const d = day();
  rows.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; if (r.status === "sent" && r.ts.startsWith(d)) c.today++; });
  c.limit = LIMIT; c.left = Math.max(0, LIMIT - c.today);
  return c;
};

module.exports = async (req, res) => {
  const a = await L.need(req, res); if (!a) return;
  try {
    await ensure();
    const me = String(a.u.email || "").trim().toLowerCase(), q = req.query || {}, b = req.body || {};
    const action = q.action || b.action;
    let rows = await mine(me);

    if (action === "stats") return res.json(stats(rows));

    if (action === "debug") {
      const v = (await L.sh(`/values/${rng("A:K")}`)).values || [];
      const meta = await L.sh("?fields=sheets.properties(title,gridProperties)");
      const t = meta.sheets.find((s) => s.properties.title === TAB);
      const owners = {};
      v.slice(1).forEach((r) => { const o = JSON.stringify(String(r[0] || "")); owners[o] = (owners[o] || 0) + 1; });
      return res.json({ me, grid: t && t.properties.gridProperties, rowsReturned: v.length, mine: rows.length, owners: a.admin ? owners : undefined,
        last3: v.slice(-3).map((r) => [r[0], r[1], r[2], r[9]]), stats: stats(rows) });
    }

    if (action === "clear") {
      const cleared = await clearOpen(rows);
      const fixed = await repair();
      return res.json({ cleared, fixed });
    }

    if (action === "add") {
      let cleared = 0;
      if (b.replace) { cleared = await clearOpen(rows); await repair(); rows = rows.filter((r) => r.status === "scheduled" || r.status === "sent"); }
      const have = new Set(rows.map((r) => r.key));
      const haveMail = new Set(rows.filter((r) => r.email).map((r) => r.email.toLowerCase()));
      const add = [];
      for (const j of b.items || []) {
        const mail = String(j.email || "").trim().toLowerCase();
        const k = keyOf({ ...j, email: mail });
        if (!j.firma || have.has(k) || (mail && haveMail.has(mail))) continue;
        have.add(k); if (mail) haveMail.add(mail);
        add.push([me, k, j.firma, j.beruf || "", j.ort || "", j.plz || "", j.site || "", mail, j.name || "", mail ? "ready" : "new", ""]);
      }
      if (add.length) await appendRows(add);
      const total = add.length ? (await mine(me)).length : rows.length;
      return res.json({ added: add.length, skipped: (b.items || []).length - add.length, cleared, total });
    }

    if (action === "next") {
      const st = stats(rows);
      const n = Math.min(+q.n || LIMIT, st.left);
      const ex = new Set(String(q.exclude || "").split(",").map(Number));
      const open = rows.filter((r) => (r.status === "ready" || r.status === "new") && !ex.has(r.row));
      const items = [...open.filter((r) => r.status === "ready"), ...open.filter((r) => r.status === "new")].slice(0, n)
        .map((r) => ({ row: r.row, firma: r.firma, beruf: r.beruf, ort: r.ort, plz: r.plz, site: r.site, email: r.email, name: r.name }));
      return res.json({ items, left: st.left });
    }

    if (action === "mark") {
      const own = new Set(rows.map((r) => r.row));
      const data = [];
      for (const u of b.updates || []) {
        if (!own.has(u.row)) continue;
        const set = { status: u.status };
        if (u.email) set.email = u.email;
        if (u.name) set.name = u.name;
        if (u.status === "sent") set.ts = new Date(Date.now() + L.TZ * 60000).toISOString();
        for (const [k, val] of Object.entries(set))
          data.push({ range: `'${TAB}'!${String.fromCharCode(65 + HDR.indexOf(k))}${u.row}`, values: [[val]] });
      }
      if (data.length) await L.sh("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
      return res.json({ ok: true });
    }
    res.status(400).json({ error: "action fehlt" });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
