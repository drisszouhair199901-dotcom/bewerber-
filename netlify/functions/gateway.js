// Adapter: führt die Vercel-Funktionen aus /api auf Netlify aus (ohne sie umzuschreiben).
// /api/NAME -> /.netlify/functions/api (siehe netlify.toml), hier wird NAME ausgewählt.
const handlers = {
  auth: require("../../api/auth.js"),
  cron: require("../../api/cron.js"),
  email: require("../../api/email.js"),
  generate: require("../../api/generate.js"),
  jobs: require("../../api/jobs.js"),
  maps: require("../../api/maps.js"),
  portal: require("../../api/portal.js"),
  queue: require("../../api/queue.js"),
  refresh: require("../../api/refresh.js"),
  schedule: require("../../api/schedule.js"),
};

const last = (p) => String(p || "").split("/").filter(Boolean).pop() || "";

exports.handler = async (event) => {
  let name = "";
  try { name = last(new URL(event.rawUrl).pathname); } catch {}
  if (!Object.prototype.hasOwnProperty.call(handlers, name)) name = last(event.path);
  const fn = Object.prototype.hasOwnProperty.call(handlers, name) ? handlers[name] : null;
  const J = { "content-type": "application/json; charset=utf-8" };
  if (!fn) return { statusCode: 404, headers: J, body: JSON.stringify({ error: "unknown endpoint" }) };

  // Request im Vercel-Stil
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) headers[k.toLowerCase()] = v;
  let body = event.body;
  if (body && event.isBase64Encoded) body = Buffer.from(body, "base64").toString("utf8");
  const ct = headers["content-type"] || "";
  if (typeof body === "string" && body) {
    if (/json/i.test(ct)) { try { body = JSON.parse(body); } catch {} }
    else if (/x-www-form-urlencoded/i.test(ct)) body = Object.fromEntries(new URLSearchParams(body));
  } else body = undefined;
  const req = { method: event.httpMethod, headers, query: event.queryStringParameters || {}, body, url: event.rawUrl };

  // Response im Vercel-Stil
  let statusCode = 200, finished = false, done;
  const out = {};
  const wait = new Promise((r) => (done = r));
  const finish = (b) => { if (!finished) { finished = true; done({ statusCode, headers: out, body: b }); } return res; };
  const res = {
    status(c) { statusCode = c; return res; },
    setHeader(k, v) { out[k] = v; return res; },
    json(o) { out["content-type"] = "application/json; charset=utf-8"; return finish(JSON.stringify(o)); },
    send(b) { return typeof b === "object" && b !== null && !Buffer.isBuffer(b) ? res.json(b) : finish(b == null ? "" : String(b)); },
    end(b) { return finish(b == null ? "" : String(b)); },
  };

  try { await fn(req, res); }
  catch (e) { statusCode = 500; out["content-type"] = J["content-type"]; finish(JSON.stringify({ error: String((e && e.message) || e) })); }
  if (!finished) finish("");
  return wait;
};
