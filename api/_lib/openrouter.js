/* The one place that talks to OpenRouter. The key never leaves the server.

   Two modes sit behind two models: "fast" answers straight away, "thinking"
   takes the slower reasoning model. Which model is which is configuration, not
   something the assistant is allowed to talk about. */

const BASE_URL = 'https://openrouter.ai/api/v1';
const MAX_TOOL_HOPS = 3;

export const MODES = {
  fast: {
    id: 'fast',
    label: 'Fast',
    note: 'Kısa ve doğrudan cevap.',
    model: () => process.env.CHAT_MODEL_FAST || 'z-ai/glm-5.2:free',
    temperature: 0.7,
    maxTokens: 900,
    tools: true,
  },
  thinking: {
    id: 'thinking',
    label: 'Thinking',
    note: 'Önce düşünür, sonra cevaplar. Daha yavaş.',
    model: () => process.env.CHAT_MODEL_THINKING || 'deepseek/deepseek-r1:free',
    temperature: 0.5,
    maxTokens: 1800,
    tools: false,   // reasoning models handle tool calls unevenly on the free tier
  },
};

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
  const working = [...messages];

  for (let hop = 0; hop <= MAX_TOOL_HOPS; hop += 1) {
    const body = {
      model: settings.model(),
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
      error.status = response.status === 429 ? 429 : 502;
      error.detail = `${response.status} ${detail.slice(0, 300)}`;
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

    return clean(message.content);
  }

  throw new Error('Araç çağrı döngüsü limiti aşıldı.');
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
