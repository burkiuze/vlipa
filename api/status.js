/* What the studio can offer right now.

   /api/status                 → is a key set, which modes exist, which model
   /api/status?probe=1         → asks every configured model for one token and
                                 reports what came back
   /api/status?models=minimax  → searches OpenRouter's catalogue for that word
                                 and lists the ids, marking the free ones

   The last two are for the browser: when Vlipa will not answer, they say
   whether the model id is wrong, the key is refused, or the quota is spent. */

import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { json, methodGuard, parseCookies } from './_lib/http.js';
import { googleReady, redirectUri } from './_lib/google.js';
import { MODES, findModels, hasKey, probeModels } from './_lib/openrouter.js';
import { backend, ping, storageNote } from './_lib/store.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  const modes = Object.values(MODES).map(({ id, label, note }) => ({
    id, label, note, model: MODES[id].model(),
  }));

  if (req.query?.models !== undefined) {
    try {
      const found = await findModels(req.query.models);

      return json(res, 200, {
        ok: true,
        query: req.query.models,
        free: found.filter((model) => model.free).map((model) => model.id),
        models: found,
      });
    } catch (error) {
      return json(res, 200, { ok: false, error: error.message });
    }
  }

  if (!req.query?.probe) {
    // Enough to tell, from one address, why the studio is not behaving:
    // whether storage is real, whether the session survived, whether Google is
    // wired up and to exactly which callback address.
    let session = 'yok';

    try {
      session = (await userFromToken(parseCookies(req)[SESSION_COOKIE])) ? 'open' : 'none';
    } catch (error) {
      session = `unreadable: ${error.message}`;
    }

    return json(res, 200, {
      ok: true,
      ready: hasKey(),
      modes,
      // Without a KV store the company side keeps nothing between requests.
      storage: backend,
      storageCheck: await ping(),
      storageNote: storageNote || undefined,
      session,
      google: googleReady() ? { on: true, callback: redirectUri(req) } : { on: false },
    });
  }

  if (!hasKey()) {
    return json(res, 200, {
      ok: true,
      ready: false,
      modes,
      probe: [],
      note: 'OPENROUTER_API_KEY is not set, so no model could be tried.',
    });
  }

  const probe = await probeModels();
  const working = probe.filter((item) => item.ok);

  json(res, 200, {
    ok: true,
    ready: true,
    modes,
    probe,
    note: working.length
      ? `${working.length} model(s) answering: ${working.map((item) => item.model).join(', ')}`
      : 'No model answered. The detail fields below say why.',
  });
}
