/* vlipa — account logic.
 *
 * Storage is injected so this file stays testable: `stores` is
 * { users, sessions }, each an object with getJSON / setJSON / delete.
 * netlify/functions/auth.mjs wires those to Netlify Blobs.
 *
 * Passwords are stored as PBKDF2-HMAC-SHA256 derivations with a random salt.
 * Sessions are random tokens; only their SHA-256 hash is stored, so a leak of
 * the store does not hand out live sessions.
 */

const ITERATIONS = 210000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;

const SESSION_COOKIE = 'vlipa_session';
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;       // 30 days when "remember me"
const SESSION_TTL_SHORT = 12 * 60 * 60 * 1000;      // 12 hours otherwise

const MAX_EMAIL = 254;
const MAX_PASSWORD = 200;
const MAX_NAME = 60;
const MIN_PASSWORD = 8;

const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

/* ---------- helpers ---------- */

const encoder = new TextEncoder();

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function tokenFromBytes(bytes) {
  return btoa(String.fromCharCode.apply(null, Array.from(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function derive(password, saltHex, iterations) {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    KEY_BYTES * 8
  );
  return bytesToHex(new Uint8Array(bits));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

/* constant-time comparison of two hex strings */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function normaliseEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function userKey(email) {
  return 'user_' + encodeURIComponent(email);
}

function json(payload, status, extraHeaders) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
  return new Response(JSON.stringify(payload), { status, headers });
}

function cookie(token, maxAgeSeconds, secure) {
  const parts = [
    SESSION_COOKIE + '=' + token,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + maxAgeSeconds
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  const match = header.split(';').map((part) => part.trim())
    .find((part) => part.indexOf(name + '=') === 0);
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function isSecure(request) {
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

function publicUser(user) {
  return { email: user.email, name: user.name || '', createdAt: user.createdAt };
}

/* ---------- validation ---------- */

function validate(email, password, name) {
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return 'Enter a valid email address.';
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return 'Password must be at least ' + MIN_PASSWORD + ' characters.';
  }
  if (password.length > MAX_PASSWORD) {
    return 'That password is too long.';
  }
  if (name && name.length > MAX_NAME) {
    return 'That name is too long.';
  }
  return null;
}

/* ---------- sessions ---------- */

async function createSession(stores, email, remember) {
  const token = tokenFromBytes(randomBytes(TOKEN_BYTES));
  const ttl = remember ? SESSION_TTL : SESSION_TTL_SHORT;
  await stores.sessions.setJSON(await sha256Hex(token), {
    email,
    expiresAt: Date.now() + ttl
  });
  return { token, maxAge: Math.floor(ttl / 1000) };
}

async function readSession(stores, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const key = await sha256Hex(token);
  const session = await stores.sessions.getJSON(key);
  if (!session) return null;

  if (!session.expiresAt || session.expiresAt < Date.now()) {
    await stores.sessions.delete(key);
    return null;
  }

  return { key, email: session.email };
}

/* ---------- actions ---------- */

async function signup(request, stores, body) {
  const email = normaliseEmail(body.email);
  const password = String(body.password || '');
  const name = String(body.name || '').trim();

  const problem = validate(email, password, name);
  if (problem) return json({ error: problem }, 400);

  const existing = await stores.users.getJSON(userKey(email));
  if (existing) {
    return json({ error: 'An account with that email already exists.' }, 409);
  }

  const salt = bytesToHex(randomBytes(SALT_BYTES));
  const user = {
    email,
    name,
    salt,
    iterations: ITERATIONS,
    hash: await derive(password, salt, ITERATIONS),
    createdAt: new Date().toISOString(),
    failedCount: 0,
    lockedUntil: 0
  };

  await stores.users.setJSON(userKey(email), user);

  const session = await createSession(stores, email, Boolean(body.remember));
  return json({ user: publicUser(user) }, 201, {
    'Set-Cookie': cookie(session.token, session.maxAge, isSecure(request))
  });
}

async function login(request, stores, body) {
  const email = normaliseEmail(body.email);
  const password = String(body.password || '');

  if (!email || !password) {
    return json({ error: 'Enter your email and password.' }, 400);
  }

  const user = await stores.users.getJSON(userKey(email));

  if (!user) {
    // same shape and cost as a wrong password, so the response does not
    // reveal whether the address is registered
    await derive(password, bytesToHex(randomBytes(SALT_BYTES)), ITERATIONS);
    return json({ error: 'Email or password is incorrect.' }, 401);
  }

  if (user.lockedUntil && user.lockedUntil > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    return json({ error: 'Too many attempts. Try again in ' + minutes + ' minute(s).' }, 429);
  }

  const attempt = await derive(password, user.salt, user.iterations || ITERATIONS);

  if (!timingSafeEqual(attempt, user.hash)) {
    user.failedCount = (user.failedCount || 0) + 1;
    if (user.failedCount >= MAX_ATTEMPTS) {
      user.lockedUntil = Date.now() + LOCKOUT_MS;
      user.failedCount = 0;
    }
    await stores.users.setJSON(userKey(email), user);
    return json({ error: 'Email or password is incorrect.' }, 401);
  }

  if (user.failedCount || user.lockedUntil) {
    user.failedCount = 0;
    user.lockedUntil = 0;
    await stores.users.setJSON(userKey(email), user);
  }

  const session = await createSession(stores, email, Boolean(body.remember));
  return json({ user: publicUser(user) }, 200, {
    'Set-Cookie': cookie(session.token, session.maxAge, isSecure(request))
  });
}

async function logout(request, stores) {
  const session = await readSession(stores, request);
  if (session) await stores.sessions.delete(session.key);

  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': cookie('', 0, isSecure(request)) }
  });
}

async function me(request, stores) {
  const session = await readSession(stores, request);
  if (!session) return json({ error: 'Not signed in.' }, 401);

  const user = await stores.users.getJSON(userKey(session.email));
  if (!user) return json({ error: 'Not signed in.' }, 401);

  return json({ user: publicUser(user) }, 200);
}

/* ---------- entry point ---------- */

export async function handleAuth(request, stores) {
  const action = new URL(request.url).pathname.split('/').filter(Boolean).pop();

  if (action === 'me') {
    if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
    return me(request, stores);
  }

  if (request.method !== 'POST') {
    return json({ error: 'Use POST.' }, 405);
  }

  if (action === 'logout') return logout(request, stores);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }

  if (action === 'signup') return signup(request, stores, body);
  if (action === 'login') return login(request, stores, body);

  return json({ error: 'Unknown action.' }, 404);
}

export const config = { ITERATIONS, SESSION_COOKIE, MIN_PASSWORD, MAX_ATTEMPTS };
