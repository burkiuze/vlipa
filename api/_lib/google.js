/* Signing in with Google.

   The authorization-code flow, done on the server: the browser never sees the
   client secret, and the code is exchanged for an id_token over a direct TLS
   call to Google. Because that token comes back on a connection we opened to
   Google ourselves, its signature does not need re-checking here — but its
   audience and issuer do.

   Nothing is stored in the repository. Set these in the hosting environment:

     GOOGLE_CLIENT_ID       from Google Cloud → Auth Platform → Clients
     GOOGLE_CLIENT_SECRET   the secret for that client
     GOOGLE_REDIRECT_URI    optional; defaults to <site>/api/auth/google-callback */

import crypto from 'node:crypto';

const AUTH_URL = process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export const CALLBACK_PATH = '/api/auth/google-callback';

export function googleReady() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/* Where this deployment answers, as the browser reached it. */
export function siteOrigin(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const proto = req.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function redirectUri(req) {
  return process.env.GOOGLE_REDIRECT_URI || `${siteOrigin(req)}${CALLBACK_PATH}`;
}

/* Only our own pages are acceptable landing spots, so a crafted link cannot
   bounce someone off the site with a fresh session in hand. */
export function safeNext(value) {
  const next = String(value || '');
  return next.startsWith('/') && !next.startsWith('//') ? next.slice(0, 200) : '/studio';
}

export function authUrl({ req, state }) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });

  return `${AUTH_URL}?${params}`;
}

function decodeIdToken(idToken) {
  const part = String(idToken || '').split('.')[1];
  if (!part) return null;

  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/* Turns the code Google sent back into an account we can trust. */
export async function accountFromCode({ req, code }) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(req),
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // The body can name the client id; the secret is never echoed back.
    console.error('google token exchange failed', response.status, detail.slice(0, 200));
    return { error: 'Google ile giriş tamamlanamadı.' };
  }

  const data = await response.json().catch(() => ({}));
  const claims = decodeIdToken(data.id_token);

  if (!claims) return { error: 'Google beklenen yanıtı vermedi.' };
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) return { error: 'Google yanıtı bu siteye ait değil.' };
  if (!ISSUERS.includes(claims.iss)) return { error: 'Google yanıtı doğrulanamadı.' };
  if (claims.exp && claims.exp * 1000 < Date.now()) return { error: 'Google yanıtının süresi dolmuş.' };

  const email = String(claims.email || '').trim().toLowerCase();
  if (!email) return { error: 'Google hesabında e-posta yok.' };
  if (claims.email_verified === false) return { error: 'Google hesabının e-postası doğrulanmamış.' };

  return { account: { email, name: String(claims.name || '').slice(0, 60) } };
}

export function randomState() {
  return crypto.randomBytes(16).toString('hex');
}

export function sameState(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}
