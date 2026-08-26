import {
  SESSION_COOKIE, createUser, endSession, normalizeEmail, publicUser,
  startSession, userFromToken, validateCredentials, verifyUser,
} from '../_lib/auth.js';
import { verifyCaptcha } from '../_lib/captcha.js';
import { clearCookie, fail, json, parseCookies, readBody, setCookie } from '../_lib/http.js';
import { remoteStore } from '../_lib/store.js';

export default async function handler(req, res) {
  const action = String(req.query.action || '');

  try {
    if (action === 'me') {
      if (req.method !== 'GET') return fail(res, 405, 'Use GET.');
      const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
      return json(res, 200, { ok: true, user: user || null, storage: remoteStore ? 'kv' : 'memory' });
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
