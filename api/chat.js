/* Text conversation with Vlipa.

   The transcript lives in the browser and is sent with each turn, so nothing
   has to be kept between serverless invocations. */

import { callerKey, fail, json, methodGuard, readBody, sanitizeHistory, withinLimit } from './_lib/http.js';
import { chatCompletion, hasKey, modeFor } from './_lib/openrouter.js';
import { buildSystemMessage } from './_lib/persona.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  if (!withinLimit(callerKey(req), 20)) {
    return fail(res, 429, 'Biraz yavaş: dakikada 20 mesaj sınırı var.');
  }

  const body = await readBody(req);
  const message = String(body.message || '').trim();

  if (!message) return fail(res, 400, 'Önce bir şey yaz.');
  if (message.length > 4000) return fail(res, 413, 'Bu mesaj çok uzun.');
  if (!hasKey()) return fail(res, 503, 'Vlipa şu an bağlı değil: sunucuda OPENROUTER_API_KEY tanımlı değil.');

  const mode = modeFor(body.mode).id;

  try {
    const reply = await chatCompletion({
      mode,
      messages: [
        { role: 'system', content: buildSystemMessage({ mode }) },
        ...sanitizeHistory(body.history),
        { role: 'user', content: message },
      ],
    });

    json(res, 200, { ok: true, reply, mode });
  } catch (error) {
    console.error('[vlipa] chat:', error.detail || error.message);

    fail(res, error.status || 500, error.message || 'Vlipa şu an yanıt veremiyor.', {
      reason: error.reason || '',
      tried: error.tried || [],
    });
  }
}
