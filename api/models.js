import { json, methodGuard } from './_lib/http.js';
import { freeModels, roster } from './_lib/models.js';
import { hasKey } from './_lib/openrouter.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  try {
    const [models, free] = await Promise.all([roster(), freeModels()]);
    json(res, 200, { ok: true, models, freeCount: free.length, ready: hasKey() });
  } catch (error) {
    console.error('models', error);
    json(res, 200, { ok: true, models: [], freeCount: 0, ready: hasKey() });
  }
}
