/* Text conversation with Vlipa.

   The transcript lives in the browser and is sent with each turn, so nothing
   has to be kept between serverless invocations. */

import { callerKey, fail, json, methodGuard, readBody, sanitizeHistory, withinLimit } from './_lib/http.js';
import { chatCompletion, hasKey, modeFor } from './_lib/openrouter.js';
import { buildSystemMessage } from './_lib/persona.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  if (!withinLimit(callerKey(req), 20)) {
    return fail(res, 429, 'Slow down: 20 messages a minute.');
  }

  const body = await readBody(req);
  const message = String(body.message || '').trim();

  if (!message) return fail(res, 400, 'Write something first.');
  if (message.length > 4000) return fail(res, 413, 'That message is too long.');
  if (!hasKey()) return fail(res, 503, 'Vlipa is not connected: OPENROUTER_API_KEY is not set on the server.');

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

    fail(res, error.status || 500, error.message || 'Vlipa cannot answer right now.', {
      reason: error.reason || '',
      tried: error.tried || [],
    });
  }
}
