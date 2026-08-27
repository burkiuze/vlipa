/* A fresh puzzle for the sign-up and sign-in forms.

   The answer never leaves the server: it goes out as a picture and comes back
   as a signed token, checked when the form is submitted. */

import { issueCaptcha } from './captcha.js';
import { json, methodGuard } from './http.js';

export default function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  const { token, svg } = issueCaptcha();
  json(res, 200, { ok: true, token, svg });
}
