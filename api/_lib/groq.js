/* Groq, for the one model that runs there.

   Groq speaks the OpenAI chat-completions shape, so this is a thin call rather
   than a second client. The key stays on the server like every other one, and
   nothing here is reachable unless GROQ_API_KEY is set.

   Provider catalogues move, and an id that was right last month is a 404 this
   month. So rather than insisting on one, this asks Groq what it actually
   serves and picks the Qwen from that list. GROQ_MODEL still wins if it is
   set: a deployment that wants a particular id keeps it. */

const BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
const FALLBACK_MODEL = 'qwen/qwen3-32b';

/* What Groq said it had, remembered for as long as this instance lives so the
   catalogue is not fetched on every message. */
let known = { at: 0, ids: [] };
let chosen = '';

const CATALOGUE_MS = 30 * 60 * 1000;

export function groqReady() {
  return Boolean(process.env.GROQ_API_KEY);
}

export function groqModel() {
  return process.env.GROQ_MODEL || chosen || FALLBACK_MODEL;
}

async function catalogue() {
  if (known.ids.length && Date.now() - known.at < CATALOGUE_MS) return known.ids;

  try {
    const response = await fetch(`${BASE_URL}/models`, {
      headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    });

    if (!response.ok) return known.ids;

    const data = await response.json();
    const ids = (data?.data || []).map((model) => model?.id).filter((id) => typeof id === 'string');

    known = { at: Date.now(), ids };
  } catch {
    /* the catalogue is a convenience; a failure to read it is not an answer */
  }

  return known.ids;
}

/* The Qwen most likely to be the chat model somebody means. Anything that is
   plainly not one — a guard model, speech, embeddings — is left out, and a
   bigger, instruction-tuned model wins. */
function pickQwen(ids) {
  const candidates = ids.filter((id) => /qwen/i.test(id) && !/guard|whisper|tts|embed|vision|coder-?tiny/i.test(id));
  if (!candidates.length) return '';

  const score = (id) => {
    const billions = Number((id.match(/(\d+(?:\.\d+)?)\s*b\b/i) || [])[1] || 0);
    return billions
      + (/instruct|chat/i.test(id) ? 6 : 0)
      + (/preview|deprecated/i.test(id) ? -20 : 0);
  };

  return [...candidates].sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0];
}

async function call(model, { messages, temperature, maxTokens }) {
  return fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
  });
}

export async function groqCompletion({ messages, temperature = 0.6, maxTokens = 1600 }) {
  if (!groqReady()) {
    const error = new Error('Qwen is not connected: GROQ_API_KEY is not set on the server.');
    error.status = 503;
    throw error;
  }

  let model = groqModel();
  let response = await call(model, { messages, temperature, maxTokens });

  // An id Groq does not serve is worth one look at the list rather than an
  // error telling somebody to go and find the right name themselves.
  if (response.status === 404 && !process.env.GROQ_MODEL) {
    const found = pickQwen(await catalogue());

    if (found && found !== model) {
      chosen = found;
      model = found;
      response = await call(model, { messages, temperature, maxTokens });
    }
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 400);

    let message = `Groq answered ${response.status}.`;

    if (response.status === 404) {
      const offer = pickQwen(await catalogue()) || (await catalogue()).slice(0, 3).join(', ');
      message = offer
        ? `Groq does not serve "${model}". Set GROQ_MODEL to one it lists, for example ${offer}.`
        : `Groq does not serve "${model}", and its model list could not be read. Set GROQ_MODEL to an id from your Groq console.`;
    } else if (response.status === 401) {
      message = 'The Groq key is invalid or expired (401).';
    } else if (response.status === 429) {
      message = 'Qwen is out of quota on Groq for the moment (429). Try again shortly.';
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
    const error = new Error('Qwen came back with nothing.');
    error.status = 502;
    throw error;
  }

  // Some reasoning models narrate before answering; the narration is not the
  // answer.
  return String(text).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
