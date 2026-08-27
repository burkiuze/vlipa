import { issueCaptcha } from './_lib/captcha.js';
import { json, methodGuard } from './_lib/http.js';

export default function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;
  const { token, svg } = issueCaptcha();
  json(res, 200, { ok: true, token, svg });
}
