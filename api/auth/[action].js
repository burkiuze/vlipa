import {
  SESSION_COOKIE, createUser, endSession, normalizeEmail, publicUser,
  startSession, userForGoogle, userFromToken, validateCredentials, verifyUser,
} from '../_lib/auth.js';
import { verifyCaptcha } from '../_lib/captcha.js';
import { clearCookie, fail, json, parseCookies, readBody, redirect, setCookie } from '../_lib/http.js';
import {
  accountFromCode, authUrl, googleReady, randomState, safeNext, sameState,
} from '../_lib/google.js';
import { remoteStore } from '../_lib/store.js';

const HANDSHAKE_COOKIE = 'vlipa_oauth';
const HANDSHAKE_SECONDS = 600;

export default async function handler(req, res) {
  const action = String(req.query.action || '');

  try {
    if (action === 'me') {
      if (req.method !== 'GET') return fail(res, 405, 'Use GET.');
      const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
      return json(res, 200, { ok: true, user: user || null, storage: remoteStore ? 'kv' : 'memory' });
    }

    // Which ways in this deployment offers. The sign-in page asks before it
    // shows the Google button, so a half-configured deployment shows nothing
    // that cannot work.
    if (action === 'providers') {
      if (req.method !== 'GET') return fail(res, 405, 'Use GET.');
      return json(res, 200, { ok: true, google: googleReady() });
    }

    // Step one: park a random value in a short-lived cookie and hand the
    // visitor to Google. The value coming back must match it, so a link
    // somebody else crafted cannot finish a sign-in here.
    if (action === 'google') {
      if (req.method !== 'GET') return fail(res, 405, 'Use GET.');
      if (!googleReady()) return fail(res, 503, 'Google ile giriş bu kurulumda açık değil.');

      const state = randomState();
      const next = safeNext(req.query?.next);

      setCookie(res, HANDSHAKE_COOKIE, `${state}|${next}`, HANDSHAKE_SECONDS);
      return redirect(res, authUrl({ req, state }));
    }

    // Step two: Google sends the visitor back here with a code.
    if (action === 'google-callback') {
      if (req.method !== 'GET') return fail(res, 405, 'Use GET.');
      if (!googleReady()) return redirect(res, '/login?error=google-kapali');

      const [savedState, savedNext] = String(parseCookies(req)[HANDSHAKE_COOKIE] || '').split('|');
      clearCookie(res, HANDSHAKE_COOKIE);

      if (req.query?.error) return redirect(res, '/login?error=google-iptal');
      if (!sameState(savedState, req.query?.state)) return redirect(res, '/login?error=google-oturum');
      if (!req.query?.code) return redirect(res, '/login?error=google');

      const result = await accountFromCode({ req, code: String(req.query.code) });
      if (result.error) return redirect(res, `/login?error=${encodeURIComponent(result.error)}`);

      const found = await userForGoogle(result.account);
      if (found.error) return redirect(res, `/login?error=${encodeURIComponent(found.error)}`);

      const session = await startSession(found.user.id, true);
      setCookie(res, SESSION_COOKIE, session.token, session.seconds);
      return redirect(res, safeNext(savedNext));
    }

    if (action === 'logout') {
      if (req.method !== 'POST') return fail(res, 405, 'Use POST.');
      await endSession(parseCookies(req)[SESSION_COOKIE]);
      clearCookie(res, SESSION_COOKIE);
      return json(res, 200, { ok: true });
    }

    if (req.method !== 'POST') return fail(res, 405, 'Use POST.');
    const body = await readBody(req);

    if (!verifyCaptcha(body.captchaToken, body.captcha)) {
      return fail(res, 400, 'The security code does not match. Take a new one and try again.',
        { field: 'captcha' });
    }

    const email = normalizeEmail(body.email);
    const password = String(body.password || '');

    if (action === 'signup') {
      const problem = validateCredentials(email, password);
      if (problem) return fail(res, 400, problem);

      const created = await createUser({ email, password, name: body.name });
      if (created.error) return fail(res, 409, created.error);

      const session = await startSession(created.user.id, body.remember !== false);
      setCookie(res, SESSION_COOKIE, session.token, session.seconds);
      return json(res, 201, { ok: true, user: publicUser(created.user) });
    }

    if (action === 'login') {
      if (!email || !password) return fail(res, 400, 'Enter your email and password.');

      const result = await verifyUser(email, password);
      if (result.error) return fail(res, 401, result.error);

      const session = await startSession(result.user.id, body.remember !== false);
      setCookie(res, SESSION_COOKIE, session.token, session.seconds);
      return json(res, 200, { ok: true, user: publicUser(result.user) });
    }

    return fail(res, 404, 'Unknown action.');
  } catch (error) {
    console.error('auth', action, error);
    return fail(res, 500, 'The account service had a problem. Try again.');
  }
}
