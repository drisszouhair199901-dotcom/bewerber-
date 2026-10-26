// Erneuert den Gmail-Zugriff (läuft sonst nach 1 Std. ab). Braucht GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (dieselben wie in Supabase).
const L = require("./_lib");
module.exports = async (req, res) => {
  if (!(await L.need(req, res))) return;
  const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: sec } = process.env, rt = (req.body || {}).refresh_token;
  if (!id || !sec || !rt) return res.status(400).json({ error: "refresh nicht möglich" });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: sec, refresh_token: rt, grant_type: "refresh_token" }) });
  const d = await r.json();
  if (!d.access_token) return res.status(400).json({ error: d.error || "refresh fehlgeschlagen" });
  res.json({ access_token: d.access_token });
};
