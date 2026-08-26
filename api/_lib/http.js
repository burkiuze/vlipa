/* Small helpers shared by the API routes. */

export function json(res, status, body) {
  res.status(status);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.send(JSON.stringify(body));
}

export function fail(res, status, message, extra = {}) {
  json(res, status, { ok: false, error: message, ...extra });
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }

  return out;
}

export function setCookie(res, name, value, maxAgeSeconds) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (process.env.NODE_ENV !== 'development') bits.push('Secure');
  res.setHeader('set-cookie', bits.join('; '));
}

export function clearCookie(res, name) {
  setCookie(res, name, '', 0);
}

export function methodGuard(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader('allow', allowed.join(', '));
  fail(res, 405, `Method ${req.method} not allowed.`);
  return false;
}

/* Best-effort rate limit. Serverless instances come and go, so this slows a
   single noisy visitor down rather than enforcing a hard quota. */
const hits = new Map();

export function withinLimit(key, perMinute = 20) {
  const now = Date.now();
  const entry = hits.get(key) || { count: 0, resetAt: now + 60000 };

  if (entry.resetAt < now) { entry.count = 0; entry.resetAt = now + 60000; }
  entry.count += 1;
  hits.set(key, entry);

  if (hits.size > 5000) hits.clear();
  return entry.count <= perMinute;
}

export function callerKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return String(forwarded ? String(forwarded).split(',')[0] : req.socket?.remoteAddress || 'anon').trim();
}

/* Trims the history the browser sends to something the model can hold. */
export function sanitizeHistory(history, limit = 16) {
  if (!Array.isArray(history)) return [];

  return history
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant'))
    .slice(-limit)
    .map((item) => ({ role: item.role, content: String(item.content || '').slice(0, 4000) }));
}
