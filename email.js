// E-Mail von Firmenwebsite holen (Impressum / Kontakt / Startseite)
const GENERIC = /^(info|kontakt|mail|office|post|hr|jobs|job|karriere|bewerbung|bewerbungen|personal|ausbildung|buero|büro|service|verwaltung|praxis|zentrale|team|empfang|sekretariat|contact|kundenservice|vertrieb|webmaster|datenschutz|admin|hallo|anfrage)$/i;
function nameFrom(email) {
  const parts = email.split("@")[0].split(/[._-]/);
  if (parts.length !== 2 || parts.some((x) => !/^[a-zäöüß]{2,}$/i.test(x) || GENERIC.test(x))) return "";
  return parts.map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(" ");
}
module.exports = async (req, res) => {
  if (!(await require("./_lib").need(req, res))) return;
  let base;
  try { base = new URL(req.query.url); } catch { return res.json({ email: "" }); }
  if (!/^https?:$/.test(base.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(base.hostname)) return res.json({ email: "" });
  const re = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  for (const p of ["/impressum", "/kontakt", "/"]) {
    try {
      const r = await fetch(new URL(p, base.origin), { signal: AbortSignal.timeout(5000), headers: { "User-Agent": "Mozilla/5.0" } });
      const t = (await r.text()).replace(/&#64;|\[at\]|\(at\)/gi, "@");
      const found = (t.match(re) || []).filter(e => !/\.(png|jpe?g|svg|gif|webp)$/i.test(e) && !/sentry|example|wixpress/i.test(e));
      const pick = found.find(e => /bewerb|karriere|ausbildung|jobs|personal|hr@/i.test(e)) || found[0];
      if (pick) { const email = pick.toLowerCase(); return res.json({ email, name: nameFrom(email) }); }
    } catch {}
  }
  res.json({ email: "", name: "" });
};
