/* What the studio can offer right now.

   /api/status          → is a key set, which modes exist
   /api/status?probe=1  → asks every configured model for one token and
                          reports what came back. Open it in a browser when
                          Vlipa keeps giving the same answer: a retired model
                          id or a rate limit shows up here as plain text. */

import { json, methodGuard } from './_lib/http.js';
import { MODES, hasKey, probeModels } from './_lib/openrouter.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  const modes = Object.values(MODES).map(({ id, label, note }) => ({ id, label, note }));

  if (!req.query?.probe) {
    return json(res, 200, { ok: true, ready: hasKey(), modes });
  }

  if (!hasKey()) {
    return json(res, 200, {
      ok: true,
      ready: false,
      modes,
      probe: [],
      note: 'OPENROUTER_API_KEY tanımlı değil, bu yüzden hiçbir model denenemedi.',
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
      ? `${working.length} model cevap veriyor: ${working.map((item) => item.model).join(', ')}`
      : 'Hiçbir model cevap vermedi. Aşağıdaki detay alanları nedenini söylüyor.',
  });
}
