/* Vlipa speaking.

   POST { text }                    -> mp3 of that text
   POST { message, history, mode }  -> Vlipa answers, and the answer comes back
                                       as mp3 with the text in a header

   Speech recognition happens in the browser with the Web Speech API, so no
   audio is uploaded and nothing is stored. If the voice cannot be reached the
   caller falls back to the browser's own speech synthesis. */

import { callerKey, fail, methodGuard, readBody, sanitizeHistory, withinLimit } from './_lib/http.js';
import { chatCompletion, hasKey, modeFor, textToSpeech } from './_lib/openrouter.js';
import { buildSystemMessage } from './_lib/persona.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  if (!withinLimit(callerKey(req), 12)) {
    return fail(res, 429, 'Biraz yavaş: sesli yanıt dakikada 12 istekle sınırlı.');
  }

  if (!hasKey()) return fail(res, 503, 'Vlipa şu an bağlı değil: sunucuda OPENROUTER_API_KEY tanımlı değil.');

  const body = await readBody(req);
  let reply = '';

  try {
    let text = String(body.text || '').trim();

    if (!text) {
      const message = String(body.message || '').trim();
      if (!message) return fail(res, 400, 'Söyleyecek bir şey yok.');

      const mode = modeFor(body.mode).id;

      reply = await chatCompletion({
        mode,
        messages: [
          { role: 'system', content: buildSystemMessage({ voice: true, mode }) },
          ...sanitizeHistory(body.history),
          { role: 'user', content: message },
        ],
      });

      text = reply;
    }

    if (!text) return fail(res, 502, 'Vlipa boş bir cevap döndürdü.');

    const audio = await textToSpeech(text.slice(0, 1200));

    res.status(200);
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-vlipa-reply', Buffer.from(reply || text, 'utf8').toString('base64'));
    res.setHeader('access-control-expose-headers', 'x-vlipa-reply');
    res.send(audio);
  } catch (error) {
    console.error('[vlipa] voice:', error.detail || error.message);

    // The text answer is worth returning even when the voice fails: the page
    // reads it out with the browser's own voice instead.
    if (reply) return fail(res, 502, 'Ses üretilemedi.', { reply, spoken: false });

    fail(res, error.status || 500, error.message || 'Ses üretilemedi.');
  }
}
