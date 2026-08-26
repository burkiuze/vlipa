/* The one place that talks to OpenRouter. The key never leaves the server.

   Two modes sit behind two models: "fast" answers straight away, "thinking"
   takes the slower reasoning model. Which model is which is configuration, not
   something the assistant is allowed to talk about. */

const BASE_URL = 'https://openrouter.ai/api/v1';
const MAX_TOOL_HOPS = 3;

/* Each mode has a chain, not a single model: if the configured one is gone or
   rate limited, the next free model in line answers instead. A model id that
   OpenRouter has retired is otherwise invisible — every message comes back as
   the same error and it reads like the assistant repeating itself. */
export const MODES = {
  fast: {
    id: 'fast',
    label: 'Fast',
    note: 'Kısa ve doğrudan cevap.',
    models: () => [
      process.env.CHAT_MODEL_FAST,
      'z-ai/glm-4.5-air:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'mistralai/mistral-small-3.2-24b-instruct:free',
      'google/gemma-3-27b-it:free',
    ],
    temperature: 0.7,
    maxTokens: 900,
    tools: true,
  },
  thinking: {
    id: 'thinking',
    label: 'Thinking',
    note: 'Önce düşünür, sonra cevaplar. Daha yavaş.',
    models: () => [
      process.env.CHAT_MODEL_THINKING,
      'deepseek/deepseek-r1:free',
      'deepseek/deepseek-chat-v3-0324:free',
      'qwen/qwen3-235b-a22b:free',
      'z-ai/glm-4.5-air:free',
    ],
    temperature: 0.5,
    maxTokens: 1800,
    tools: false,   // reasoning models handle tool calls unevenly on the free tier
  },
};

/* The configured model first, then the fallbacks, with blanks and repeats out. */
function chainFor(settings) {
  return [...new Set(settings.models().filter(Boolean))];
}

export function modeFor(name) {
  return MODES[name] || MODES.fast;
}

export function hasKey() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

function headers() {
  return {
    authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'content-type': 'application/json',
    'HTTP-Referer': process.env.PUBLIC_URL || 'https://vlipa.dev',
    'X-Title': 'Vlipa AI',
  };
}

function missingKey() {
  const error = new Error('Vlipa şu an bağlı değil: sunucuda OPENROUTER_API_KEY tanımlı değil.');
  error.status = 503;
  return error;
}

async function withRetry(run, retries = 2) {
  let last;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }

  throw last;
}

/* Strips the <think>…</think> block reasoning models like to emit. */
function clean(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|[^|]*\|>/g, '')
    .trim();
}

export async function chatCompletion({ messages, mode = 'fast' }) {
  if (!hasKey()) throw missingKey();

  const settings = modeFor(mode);
  const chain = chainFor(settings);
  let lastError = null;

  for (const model of chain) {
    try {
      return await runOnce({ model, settings, messages });
    } catch (error) {
      lastError = error;

      // Only step down the chain for problems with this model: a missing id,
      // a model that is gone, or one that is busy right now.
      if (![400, 404, 429, 502, 503].includes(error.status)) throw error;
      console.warn(`[vlipa] ${model} elendi: ${error.detail || error.message}`);
    }
  }

  throw lastError || new Error('Vlipa şu an yanıt veremiyor.');
}

async function runOnce({ model, settings, messages }) {
  const working = [...messages];

  for (let hop = 0; hop <= MAX_TOOL_HOPS; hop += 1) {
    const body = {
      model,
      messages: working,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
    };

    if (settings.tools) {
      const { toolDefinitions } = await import('./tools.js');
      body.tools = toolDefinitions;
      body.tool_choice = 'auto';
    }

    const response = await withRetry(() => fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    }));

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const error = new Error(
        response.status === 429
          ? 'Vlipa şu an çok yoğun. Birkaç saniye sonra tekrar dene.'
          : 'Vlipa şu an yanıt veremiyor. Birazdan tekrar dene.'
      );
      error.status = response.status;
      error.detail = `${model}: ${response.status} ${detail.slice(0, 300)}`;
      throw error;
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error('Vlipa beklenmeyen bir yanıt döndürdü.');

    const calls = message.tool_calls;

    if (calls && calls.length) {
      const { executeTool } = await import('./tools.js');

      working.push({ role: 'assistant', content: message.content ?? '', tool_calls: calls });

      for (const call of calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch { /* an unparseable argument list is treated as empty */ }

        working.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: await executeTool(call.function.name, args),
        });
      }

      continue;
    }

    const answer = clean(message.content);

    // An empty answer is a failed answer: let the next model in the chain try.
    if (!answer) {
      const error = new Error('Vlipa boş bir cevap döndürdü.');
      error.status = 502;
      error.detail = `${model}: empty completion`;
      throw error;
    }

    return answer;
  }

  throw new Error('Araç çağrı döngüsü limiti aşıldı.');
}

/* Asks each configured model for one token, so a broken model id shows up as
   a plain answer instead of as an assistant that repeats itself. */
export async function probeModels() {
  const results = [];

  for (const mode of Object.values(MODES)) {
    for (const model of chainFor(mode)) {
      const started = Date.now();

      try {
        const response = await fetch(`${BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
        });

        const detail = response.ok ? '' : (await response.text().catch(() => '')).slice(0, 200);
        results.push({ mode: mode.id, model, status: response.status, ok: response.ok, ms: Date.now() - started, detail });
      } catch (error) {
        results.push({ mode: mode.id, model, status: 0, ok: false, ms: Date.now() - started, detail: error.message });
      }
    }
  }

  return results;
}

/* Text to speech. Returns mp3 bytes.

   If the configured voice is unavailable the caller falls back to the voice
   built into the visitor's browser, so speaking never depends on this. */
export async function textToSpeech(text) {
  if (!hasKey()) throw missingKey();

  const response = await withRetry(() => fetch(`${BASE_URL}/audio/speech`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: process.env.TTS_MODEL || 'fish-audio/s2.1-pro-free:free',
      input: text,
      voice: process.env.TTS_VOICE || undefined,
      response_format: 'mp3',
    }),
  }), 1);

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error('Ses üretilemedi.');
    error.status = 502;
    error.detail = `${response.status} ${detail.slice(0, 300)}`;
    throw error;
  }

  return Buffer.from(await response.arrayBuffer());
}
