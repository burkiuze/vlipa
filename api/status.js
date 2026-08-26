/* What the studio can offer right now. */

import { json, methodGuard } from './_lib/http.js';
import { MODES, hasKey } from './_lib/openrouter.js';

export default function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  json(res, 200, {
    ok: true,
    ready: hasKey(),
    modes: Object.values(MODES).map(({ id, label, note }) => ({ id, label, note })),
  });
}
