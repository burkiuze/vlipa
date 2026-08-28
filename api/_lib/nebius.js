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

/* What Nebius said it had, remembered for as long as this instance lives so
   the catalogue is not fetched on every message. */
let known = { at: 0, ids: [] };
let chosen = '';

const CATALOGUE_MS = 30 * 60 * 1000;

export function nebiusReady() {
  return Boolean(process.env.NEBIUS_API_KEY);
}

export function nebiusModel() {
  return process.env.NEBIUS_MODEL || chosen || FALLBACK_MODEL;
}

async function catalogue() {
  if (known.ids.length && Date.now() - known.at < CATALOGUE_MS) return known.ids;

  try {
    const response = await fetch(`${BASE_URL}/models`, {
      headers: { authorization: `Bearer ${process.env.NEBIUS_API_KEY}` },
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

async function call(model, { messages, temperature, maxTokens }) {
  return fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
  });
}

export async function nebiusCompletion({ messages, temperature = 0.6, maxTokens = 1600 }) {
  if (!nebiusReady()) {
    const error = new Error('Nebius is not connected: NEBIUS_API_KEY is not set on the server.');
    error.status = 503;
    throw error;
  }

  let model = nebiusModel();
  let response = await call(model, { messages, temperature, maxTokens });

  // An id Nebius does not serve is worth one look at the list rather than an
  // error telling somebody to go and find the right name themselves.
  if (response.status === 404 && !process.env.NEBIUS_MODEL) {
    const found = pickChat(await catalogue());

    if (found && found !== model) {
      chosen = found;
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
