/* One entry point for every conversation in the studio.

   The visitor never picks a model: the router reads the message and hands it
   to the vlipa model built for that kind of work. */

import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { fail, json, methodGuard, parseCookies, readBody } from './_lib/http.js';
import { resolve } from './_lib/models.js';
import { chat } from './_lib/openrouter.js';
import { route } from './_lib/router.js';

const LIMIT_PER_HOUR = 60;
const seen = new Map();

function withinLimit(userId) {
  const now = Date.now();
  const entry = seen.get(userId) || { count: 0, resetAt: now + 3600000 };

  if (entry.resetAt < now) { entry.count = 0; entry.resetAt = now + 3600000; }
  entry.count += 1;
  seen.set(userId, entry);

  return entry.count <= LIMIT_PER_HOUR;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Sign in to use the studio.');
  if (!withinLimit(user.id)) return fail(res, 429, 'That is a lot of messages in one hour. Give it a moment.');

  const body = await readBody(req);
  const messages = Array.isArray(body.messages) ? body.messages.slice(-16) : [];
  if (!messages.length) return fail(res, 400, 'Say something first.');

  const last = messages[messages.length - 1];
  const text = typeof last.content === 'string' ? last.content : '';
  const decision = route(text, { hasImage: Boolean(body.hasImage), intent: body.intent });

  try {
    const { alias, role, model } = await resolve(decision.alias);
    const system = body.system
      ? String(body.system).slice(0, 4000)
      : `You are ${role.title}, part of the vlipa studio. ${role.blurb} ` +
        'Answer in the language the person writes in. Be concrete and brief.';

    const answer = await chat({
      model: model.id,
      messages: [{ role: 'system', content: system }, ...messages],
      temperature: body.temperature ?? 0.7,
      maxTokens: Math.min(Number(body.maxTokens) || 1600, 4000),
    });

    json(res, 200, {
      ok: true,
      text: answer.text,
      routed: { alias, title: role.title, reason: decision.reason },
      usage: answer.usage,
    });
  } catch (error) {
    console.error('chat', error);
    fail(res, error.status || 500, error.message || 'The model did not answer.');
  }
}
