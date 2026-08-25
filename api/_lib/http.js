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
