// Zugangs-Logik: Google Sheet "Email App Users" als Benutzerdatenbank
const crypto = require("crypto");
const E = process.env;
const SHEET_ID = E.SHEET_ID || "1bn6yvwsYHh2UIO_IsCOR8tg7__ScB60x0XBzbagxmdM";
const TAB = E.SHEET_TAB || "Feuille 1";
const ADMIN = (E.ADMIN_EMAIL || "drisszouhair199901@gmail.com").toLowerCase();
const WA = E.WHATSAPP || "212708121922";
const TRIAL_MIN = +(E.TRIAL_MINUTES || 60);
const TZ = +(E.SHEET_TZ_OFFSET_MIN || 60); // Zeitzone für von Hand getippte Daten (Marokko = UTC+1)
const b64u = (b) => Buffer.from(b).toString("base64url");

let gTok = { t: "", exp: 0 };
async function gToken() {
  if (gTok.exp > Date.now() + 60000) return gTok.t;
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const c = b64u(JSON.stringify({ iss: E.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = crypto.sign("RSA-SHA256", Buffer.from(h + "." + c), (E.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n")).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${h}.${c}.${sig}` }) });
  const d = await r.json();
  if (!d.access_token) throw new Error("Google-Auth: " + (d.error_description || d.error));
  gTok = { t: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return gTok.t;
}
async function sh(path, opt = {}) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, { ...opt, headers: { Authorization: "Bearer " + (await gToken()), "Content-Type": "application/json" } });
  const d = await r.json();
  if (!r.ok) throw new Error("Sheets: " + (d.error?.message || r.status));
  return d;
}

let cache = { t: 0, rows: null, H: [] };
async function load(force) {
  if (!force && cache.rows && Date.now() - cache.t < 15000) return cache.rows;
  const v = (await sh(`/values/${encodeURIComponent(`'${TAB}'!A:H`)}`)).values || [];
  const H = (v[0] || []).map((x) => String(x).trim().toLowerCase());
  const g = (r, n) => String(r[H.indexOf(n)] ?? "").trim();
  const rows = v.slice(1).map((r, i) => ({ row: i + 2, email: g(r, "email").toLowerCase(), pw: g(r, "password"), status: g(r, "status").toLowerCase(),
    exp: g(r, "expirydate"), dev: g(r, "deviceid"), role: (g(r, "role") || "USER").toUpperCase() }));
  cache = { t: Date.now(), rows, H };
  return rows;
}
async function setCells(u, obj) {
  const data = Object.entries(obj).map(([k, val]) => ({ range: `'${TAB}'!${String.fromCharCode(65 + cache.H.indexOf(k))}${u.row}`, values: [[val]] }));
  await sh("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
  cache.t = 0;
}
async function addUser(o) {
  const row = cache.H.map((h) => o[h] ?? (h === "created" ? new Date().toISOString() : ""));
  await sh(`/values/${encodeURIComponent(`'${TAB}'!A:H`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ values: [row] }) });
  cache.t = 0;
}

// ExpiryDate: ISO oder "TT/MM/JJJJ HH:MM" (nur Datum = bis 23:59)
function parseExp(s) {
  s = String(s || "").trim(); if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return Date.UTC(+m[3], m[2] - 1, +m[1], +(m[4] ?? 23), +(m[5] ?? 59)) - TZ * 60000;
  const t = Date.parse(s); return isNaN(t) ? null : t;
}
function state(u) {
  if (u.role === "ADMIN" || u.email === ADMIN) return { ok: true, admin: true };
  if (u.status !== "active") return { ok: false, reason: u.status === "pending" ? "pending" : u.status === "expired" ? "expired" : "blocked" };
  const exp = parseExp(u.exp);
  if (exp && exp < Date.now()) return { ok: false, reason: "expired", lazy: true };
  return { ok: true, exp };
}

const hash = (p) => { const s = crypto.randomBytes(12).toString("hex"); return `scrypt$${s}$${crypto.scryptSync(p, s, 32).toString("hex")}`; };
function okPw(p, st) {
  if (!st.startsWith("scrypt$")) return p === st; // alte Klartext-Passwörter weiter erlaubt
  const [, s, h] = st.split("$");
  return crypto.timingSafeEqual(Buffer.from(h, "hex"), crypto.scryptSync(p, s, 32));
}
const mac = (p) => crypto.createHmac("sha256", E.SESSION_SECRET || "").update(p).digest("base64url");
const sign = (email) => { const p = b64u(JSON.stringify({ e: email })); return p + "." + mac(p); };
function unsign(t) {
  const [p, s] = String(t || "").split(".");
  if (!p || !s || !E.SESSION_SECRET) return null;
  const x = mac(p);
  if (x.length !== s.length || !crypto.timingSafeEqual(Buffer.from(x), Buffer.from(s))) return null;
  try { return JSON.parse(Buffer.from(p, "base64url")).e; } catch { return null; }
}

// Prüft Login, Status, Ablaufdatum und Gerät. Sendet bei Fehler selbst die Antwort und gibt null zurück.
async function need(req, res) {
  try {
    const email = unsign((req.headers.authorization || "").replace(/^Bearer /, ""));
    const u = email && (await load()).find((x) => x.email === email);
    if (!u) { res.status(401).json({ reason: "login" }); return null; }
    const s = state(u);
    if (!s.ok) { if (s.lazy) await setCells(u, { status: "expired" }).catch(() => {}); res.status(403).json({ reason: s.reason, wa: WA }); return null; }
    if (!s.admin && u.dev && u.dev !== req.headers["x-device"]) { res.status(403).json({ reason: "device", wa: WA }); return null; }
    return { u, ...s };
  } catch (e) { res.status(500).json({ error: e.message }); return null; }
}
module.exports = { need, load, setCells, addUser, hash, okPw, sign, sh, TZ, ADMIN, WA, TRIAL_MIN };
