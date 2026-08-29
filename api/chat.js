/* Text conversation with Vlipa.

   The transcript lives in the browser and is sent with each turn, so nothing
   has to be kept between serverless invocations. */

import { projectTools } from './_lib/code-tools.js';
import { guideTools } from './_lib/guide-tools.js';
import { mergeTools, searchReady, searchTools } from './_lib/search.js';
import { callerKey, fail, json, methodGuard, readBody, sanitizeHistory, withinLimit } from './_lib/http.js';
import { alsoTry, chatCompletion, hasKey, modeFor, modelForPick, picksFor } from './_lib/openrouter.js';
import { buildSystemMessage } from './_lib/persona.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;

  // Which models this tool offers, for the picker in the browser.
  if (req.method === 'GET') return json(res, 200, { ok: true, models: await picksFor(req.query?.tool || 'chat') });

  if (!withinLimit(callerKey(req), 20)) {
    return fail(res, 429, 'Slow down: 20 messages a minute.');
  }

  const body = await readBody(req);
  const message = String(body.message || '').trim();

  if (!message) return fail(res, 400, 'Write something first.');
  if (message.length > 4000) return fail(res, 413, 'That message is too long.');
  if (!hasKey()) return fail(res, 503, 'Vlipa is not connected: OPENROUTER_API_KEY is not set on the server.');

  const mode = modeFor(body.mode).id;
  const tool = body.tool === 'code' ? 'code' : 'chat';

  // In the studio the model works on the project rather than talking about
  // it: the browser sends what it has, and gets back what changed.
  const project = tool === 'code' ? projectTools(body.files) : null;

  // Inside the workspace it can also point at a page. On the public site it
  // cannot, because there are no pages of a studio to point at.
  const guide = !project && body.inside === 'studio' ? guideTools() : null;

  // And where a key for it exists, it can look something up rather than
  // answering a question about the live world out of memory. The editor is
  // left out: it is working in a project, not researching one.
  const search = !project && searchReady() ? searchTools() : null;
  const helpers = mergeTools(guide, search);

  try {
    const reply = await chatCompletion({
      mode,
      model: modelForPick(tool, body.model),
      spares: alsoTry(tool, body.model),
      toolset: project || helpers,
      hops: project ? 12 : (helpers ? 6 : undefined),
      maxTokens: project ? 2600 : undefined,
      messages: [
        { role: 'system', content: buildSystemMessage({ mode, tool, inside: body.inside, skills: body.skills, canSearch: Boolean(search) }) },
        ...sanitizeHistory(body.history),
        { role: 'user', content: message },
      ],
    });

    json(res, 200, {
      ok: true,
      reply,
      mode,
      files: project ? project.changes() : undefined,
      route: guide ? guide.route() : undefined,
    });
  } catch (error) {
    console.error('[vlipa] chat:', error.detail || error.message);

    fail(res, error.status || 500, error.message || 'Vlipa cannot answer right now.', {
      reason: error.reason || '',
      tried: error.tried || [],
    });
  }
}
