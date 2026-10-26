// GET: Status prüfen (Token). POST: Konto erstellen (1 Std. gratis) oder anmelden.
const L = require("./_lib");
module.exports = async (req, res) => {
  try {
    if (req.method === "GET") { const a = await L.need(req, res); if (a) res.json({ ok: true, exp: a.exp || null, admin: !!a.admin }); return; }
    const { action, email = "", password = "", device = "" } = req.body || {};
    const em = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em) || String(password).length < 6 || String(device).length < 8)
      return res.status(400).json({ error: "Ungültige Eingabe (Passwort mindestens 6 Zeichen)" });
    const rows = await L.load(true), u = rows.find((x) => x.email === em);
    if (action === "register") {
      if (u || em === L.ADMIN) return res.status(409).json({ error: "Diese E-Mail ist schon registriert. Bitte anmelden." });
      const used = rows.some((x) => x.dev === device && x.role !== "ADMIN"); // pro Gerät nur eine Gratis-Stunde
      await L.addUser({ email: em, password: L.hash(password), status: used ? "pending" : "active",
        expirydate: used ? "" : new Date(Date.now() + L.TRIAL_MIN * 60000).toISOString(), deviceid: device, role: "USER" });
      return res.json({ token: L.sign(em), trialUsed: used });
    }
    if (!u || !L.okPw(String(password), u.pw)) return res.status(401).json({ error: "E-Mail oder Passwort falsch" });
    if (!u.dev && u.role !== "ADMIN") await L.setCells(u, { deviceid: device });
    res.json({ token: L.sign(em) });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
