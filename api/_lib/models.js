/* The vlipa model line-up.

   Every model the studio uses is a free model on OpenRouter, presented under a
   vlipa name. The live list is fetched from OpenRouter and filtered down to the
   ones that cost nothing, so the roster follows whatever OpenRouter offers for
   free today; the static list below is only a fallback for when that request
   fails and may be out of date. */

const CATALOGUE_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_MS = 30 * 60 * 1000;

let cache = { at: 0, models: [] };

/* Roles the studio routes to, and what a good model for each looks like.
   `prefer` entries are matched against the model id, best first. */
export const ROLES = {
  'vlipa-code': {
    title: 'vlipa code',
    blurb: 'Writes and fixes code. The default for anything that ends up in a file.',
    prefer: ['coder', 'qwen3', 'deepseek', 'devstral', 'codestral', 'glm', 'kimi'],
    minContext: 32000,
  },
  'vlipa-build': {
    title: 'vlipa build',
    blurb: 'Turns a description of a website into a section-by-section plan.',
    prefer: ['coder', 'qwen3', 'deepseek', 'llama-3.3', 'glm', 'kimi', 'mistral'],
    minContext: 64000,
  },
  'vlipa-think': {
    title: 'vlipa think',
    blurb: 'Slower, step by step. For planning, architecture and analysis.',
    prefer: ['r1', 'reason', 'think', 'deepseek', 'qwq', 'glm'],
    minContext: 32000,
  },
  'vlipa-write': {
    title: 'vlipa write',
    blurb: 'Copy, naming, product text and anything a customer reads.',
    prefer: ['llama-3.3', 'mistral', 'gemma', 'hermes', 'qwen', 'glm'],
    minContext: 16000,
  },
  'vlipa-vision': {
    title: 'vlipa vision',
    blurb: 'Reads screenshots and photographs.',
    prefer: ['vl', 'vision', 'gemma-3', 'llama-3.2', 'pixtral'],
    minContext: 16000,
    needsImages: true,
  },
  'vlipa-fast': {
    title: 'vlipa fast',
    blurb: 'Short answers, quick questions, small edits.',
    prefer: ['flash', 'small', 'mini', 'gemma', 'mistral', 'llama-3.1'],
    minContext: 8000,
  },
};

const FALLBACK = [
  { id: 'deepseek/deepseek-chat-v3-0324:free', context_length: 163840, images: false },
  { id: 'deepseek/deepseek-r1:free', context_length: 163840, images: false },
  { id: 'qwen/qwen3-coder:free', context_length: 262144, images: false },
  { id: 'qwen/qwen-2.5-coder-32b-instruct:free', context_length: 32768, images: false },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', context_length: 65536, images: false },
  { id: 'mistralai/mistral-small-3.2-24b-instruct:free', context_length: 96000, images: false },
  { id: 'google/gemma-3-27b-it:free', context_length: 96000, images: true },
  { id: 'moonshotai/kimi-k2:free', context_length: 65536, images: false },
  { id: 'z-ai/glm-4.5-air:free', context_length: 131072, images: false },
  { id: 'qwen/qwen2.5-vl-72b-instruct:free', context_length: 32768, images: true },
];

function isFree(model) {
  const pricing = model.pricing || {};
  const zero = (value) => value === undefined || Number(value) === 0;
  return model.id.endsWith(':free') || (zero(pricing.prompt) && zero(pricing.completion));
}

function shape(model) {
  const inputs = (model.architecture && model.architecture.input_modalities) || [];
  return {
    id: model.id,
    context_length: model.context_length || model.top_provider?.context_length || 8192,
    images: inputs.includes('image'),
  };
}

export async function freeModels() {
  if (cache.models.length && Date.now() - cache.at < CACHE_MS) return cache.models;

  try {
    const response = await fetch(CATALOGUE_URL, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`catalogue ${response.status}`);

    const data = await response.json();
    const models = (data.data || []).filter(isFree).map(shape);

    if (models.length) {
      cache = { at: Date.now(), models };
      return models;
    }
  } catch (error) {
    console.warn('Could not read the OpenRouter catalogue:', error.message);
  }

  cache = { at: Date.now(), models: FALLBACK };
  return FALLBACK;
}

function score(model, role) {
  const id = model.id.toLowerCase();
  let value = 0;

  role.prefer.forEach((needle, index) => {
    if (id.includes(needle)) value += (role.prefer.length - index) * 100;
  });

  if (role.needsImages && !model.images) value -= 10000;
  if (model.context_length >= role.minContext) value += 60;
  value += Math.min(model.context_length / 4096, 60);

  return value;
}

/* Resolves a vlipa name to the free model that currently fits it best. */
export async function resolve(alias) {
  const role = ROLES[alias] || ROLES['vlipa-fast'];
  const models = await freeModels();

  const ranked = models
    .map((model) => ({ model, value: score(model, role) }))
    .sort((a, b) => b.value - a.value);

  const best = ranked[0] && ranked[0].value > -1000 ? ranked[0].model : models[0];
  return { alias, role, model: best };
}

export async function roster() {
  const out = [];

  for (const alias of Object.keys(ROLES)) {
    const { role, model } = await resolve(alias);
    out.push({
      alias,
      title: role.title,
      blurb: role.blurb,
      context: model ? model.context_length : 0,
      images: Boolean(model && model.images),
    });
  }

  return out;
}
