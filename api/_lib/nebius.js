/* Nebius Token Factory, for the models that run there.

   It speaks the OpenAI chat-completions shape, so this is a thin call rather
   than a second client. The key stays on the server like every other one, and
   nothing here is reachable unless NEBIUS_API_KEY is set — a deployment
   without it never sees this provider offered, let alone called.

   Model ids in an open catalogue move: a name that was right last month is a
   404 this month, and the exact casing of an id is not something anybody
   should have to guess. So rather than insisting on one, this asks Nebius what
   it actually serves and picks the largest instruction-tuned model from that
   list. NEBIUS_MODEL still wins when it is set. */

const BASE_URL = process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1';
const FALLBACK_MODEL = 'Qwen/Qwen3-235B-A22B-Instruct-2507';

/* The models offered by name in the menu.

   An id is written here as a best guess and a pattern, not as a fact. Nebius
   names things its own way and renames them when a model is revised, so the
   guess is tried first and, if Nebius has never heard of it, the pattern picks
   the right one out of what Nebius says it actually serves. Either way an env
   var wins, so a deployment that knows the exact id is never argued with. */
export const NAMED = {
  deepseek: {
    label: 'DeepSeek V4 Flash',
    env: 'NEBIUS_MODEL_DEEPSEEK',
    guess: 'deepseek-ai/DeepSeek-V4-Flash-0731',
    match: /deepseek.*v4.*flash/i,
  },
  hermes: {
    label: 'Hermes 4 405B',
    env: 'NEBIUS_MODEL_HERMES',
    guess: 'NousResearch/Hermes-4-405B',
    match: /hermes.*4.*405/i,
  },
  // The coding pick moved here. OpenRouter has no free Qwen left at all —
  // qwen/qwen3-coder:free is gone from its catalogue — so the menu entry was
  // an offer that could not be met. Nebius serves the coder on the credit
  // this account already has.
  qwencoder: {
    label: 'Qwen 3 Coder 480B',
    env: 'NEBIUS_MODEL_QWEN',
    guess: 'Qwen/Qwen3-Coder-480B-A35B-Instruct',
    match: /qwen.*coder/i,
  },
};

/* What each name resolved to last time, so the catalogue is consulted once
   rather than on every message. */
const settled = new Map();

/* What Nebius said it had, remembered for as long as this instance lives so
   the catalogue is not fetched on every message. */
let known = { at: 0, ids: [] };
let chosen = '';

const CATALOGUE_MS = 30 * 60 * 1000;

/* The obvious names somebody reaches for, all accepted. A key that is present
   under a spelling the code does not read looks exactly like no key at all —
   the menu is short and nothing says why. */
const key = () => process.env.NEBIUS_API_KEY
  || process.env.NEBIUS_TOKEN
  || process.env.NEBIUS_API_TOKEN
  || process.env.NEBIUS_KEY
  || '';

export function nebiusReady() {
  return Boolean(key());
}

/* The id to show and to try first. Sync on purpose: the model menu is drawn
   before anybody has waited for GitHub, let alone for a catalogue. */
export function nebiusModel(name = '') {
  const named = NAMED[name];
  if (!named) return process.env.NEBIUS_MODEL || chosen || FALLBACK_MODEL;

  return process.env[named.env] || settled.get(name) || named.guess;
}

async function catalogue() {
  if (known.ids.length && Date.now() - known.at < CATALOGUE_MS) return known.ids;

  try {
    const response = await fetch(`${BASE_URL}/models`, {
      headers: { authorization: `Bearer ${key()}` },
    });

    if (!response.ok) return known.ids;

    const data = await response.json();
    const ids = (data?.data || []).map((model) => model?.id).filter((id) => typeof id === 'string');

    known = { at: Date.now(), ids };
  } catch {
    /* the catalogue is a convenience; failing to read it is not an answer */
  }

  return known.ids;
}

/* The model most likely to be the one somebody means for a conversation.
   Anything plainly not that — embeddings, a guard, speech, a vision-only
   head — is left out, and a bigger instruction-tuned model wins. */
function pickChat(ids) {
  const candidates = ids.filter((id) => !/guard|embed|rerank|whisper|tts|moderation|vision-only/i.test(id));
  if (!candidates.length) return '';

  const score = (id) => {
    const billions = Number((id.match(/(\d+(?:\.\d+)?)\s*b\b/i) || [])[1] || 0);
    return billions
      + (/instruct|chat|it\b/i.test(id) ? 12 : 0)
      + (/base|preview|deprecated|draft/i.test(id) ? -30 : 0);
  };

  return [...candidates].sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0];
}

/* The id Nebius will actually accept for a named model: what is configured,
   else what the catalogue offers that matches, else the guess. */
async function resolve(name) {
  const named = NAMED[name];
  if (!named) return nebiusModel();

  const forced = process.env[named.env];
  if (forced) return forced;

  const settledId = settled.get(name);
  if (settledId) return settledId;

  const ids = await catalogue();

  // The guess, if Nebius really serves it. Otherwise the closest thing it does
  // serve — the newest, by the version numbers in the name.
  const found = ids.includes(named.guess)
    ? named.guess
    : [...ids].filter((id) => named.match.test(id)).sort().at(-1);

  if (found) settled.set(name, found);
  return found || named.guess;
}

async function call(model, { messages, temperature, maxTokens }) {
  return fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
  });
}

export async function nebiusCompletion({ messages, temperature = 0.6, maxTokens = 1600, name = '' }) {
  if (!nebiusReady()) {
    const error = new Error('Nebius is not connected: NEBIUS_API_KEY is not set on the server.');
    error.status = 503;
    throw error;
  }

  let model = name ? await resolve(name) : nebiusModel();
  let response = await call(model, { messages, temperature, maxTokens });

  // An id Nebius does not serve is worth one look at the list rather than an
  // error telling somebody to go and find the right name themselves.
  if (response.status === 404 && !process.env.NEBIUS_MODEL && !process.env[NAMED[name]?.env]) {
    const ids = await catalogue();

    const found = name
      ? [...ids].filter((id) => NAMED[name].match.test(id)).sort().at(-1)
      : pickChat(ids);

    if (found && found !== model) {
      if (name) settled.set(name, found);
      else chosen = found;

      model = found;
      response = await call(model, { messages, temperature, maxTokens });
    }
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 400);

    let message = `Nebius answered ${response.status}.`;

    if (response.status === 404) {
      const offer = pickChat(await catalogue()) || (await catalogue()).slice(0, 3).join(', ');
      message = offer
        ? `Nebius does not serve "${model}". Set NEBIUS_MODEL to one it lists, for example ${offer}.`
        : `Nebius does not serve "${model}", and its model list could not be read. Set NEBIUS_MODEL to an id from your Nebius console.`;
    } else if (response.status === 401) {
      message = 'The Nebius key is invalid or expired (401).';
    } else if (response.status === 402) {
      message = 'The Nebius account is out of credit (402).';
    } else if (response.status === 429) {
      message = 'Nebius is rate-limiting for the moment (429). Try again shortly.';
    }

    const error = new Error(message);
    error.status = response.status;
    error.detail = detail;
    error.reason = detail.slice(0, 200);
    throw error;
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;

  if (!text) {
    const error = new Error('Nebius came back with nothing.');
    error.status = 502;
    throw error;
  }

  // Some reasoning models narrate before answering; the narration is not the
  // answer.
  return String(text).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
