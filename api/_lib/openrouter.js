/* The one place that talks to OpenRouter. The key never leaves the server.

   Two modes sit behind two models: "fast" answers straight away, "thinking"
   takes the slower reasoning model. Which model is which is configuration, not
   something the assistant is allowed to talk about. */

const BASE_URL = 'https://openrouter.ai/api/v1';
const MAX_TOOL_HOPS = 3;

/* Both modes run on the same free model; what changes is how it is asked.
   Fast keeps it short, Think gives it room and tells it to weigh things first.

   Nothing else is ever called on its own: a model that is not configured here
   might not be free on this account, and an unasked-for model is a bill. Extra
   fallbacks are opt-in through CHAT_MODEL_FALLBACKS. */
const DEFAULT_MODEL = 'minimax/minimax-m3:free';

export const MODES = {
  fast: {
    id: 'fast',
    label: 'Fast',
    note: 'Kısa ve doğrudan cevap.',
    model: () => process.env.CHAT_MODEL_FAST || DEFAULT_MODEL,
    temperature: 0.7,
    maxTokens: 900,
    tools: true,
  },
  thinking: {
    id: 'thinking',
    label: 'Thinking',
    note: 'Önce düşünür, sonra cevaplar. Daha yavaş.',
    model: () => process.env.CHAT_MODEL_THINKING || process.env.CHAT_MODEL_FAST || DEFAULT_MODEL,
    temperature: 0.5,
    maxTokens: 1800,
    tools: true,
  },
};

/* The configured model, then whatever CHAT_MODEL_FALLBACKS names, if anything. */
function chainFor(settings) {
  const extra = String(process.env.CHAT_MODEL_FALLBACKS || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  return [...new Set([settings.model(), ...extra].filter(Boolean))];
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

/* Never let a key fragment travel back to a browser in an error message. */
function scrub(text) {
  return String(text || '').replace(/sk-[a-z0-9-]{8,}/gi, 'sk-***');
}

/* Turns an upstream failure into one line a person can act on. */
export function reasonFor(status, detail = '') {
  const text = scrub(detail).toLowerCase();

  if (status === 401) return 'Anahtar geçersiz ya da süresi dolmuş (401).';
  if (status === 402) return 'OpenRouter hesabında kredi gerekiyor (402).';
  if (status === 403 && text.includes('data policy')) {
    return 'OpenRouter gizlilik ayarı engelliyor: ücretsiz modeller için Settings → Privacy altındaki veri politikasını açman gerekiyor (403).';
  }
  if (status === 403) return 'Bu anahtarın bu modele erişimi yok (403).';
  if (status === 404 && text.includes('no endpoints')) {
    return 'Model bulunamadı: bu kimlik OpenRouter\'da artık yok ya da anahtarın erişemiyor (404). Ücretsiz modeller için Settings → Privacy ayarını da kontrol et.';
  }
  if (status === 404) return 'Model bulunamadı (404).';
  if (status === 429) {
    if (text.includes('per day') || text.includes('daily') || text.includes('free-models-per-day')) {
      return 'Ücretsiz modelin günlük hakkı bitti (429). Yarın sıfırlanır; OpenRouter hesabına kredi eklersen günlük hak yükselir.';
    }
    return 'Ücretsiz modelin kotası doldu, biraz bekleyip tekrar dene (429).';
  }
  if (status === 400) return 'İstek reddedildi (400).';
  if (!status) return 'OpenRouter\'a ulaşılamadı.';

  return `OpenRouter ${status} döndü.`;
}

function missingKey() {
  const error = new Error('Vlipa şu an bağlı değil: sunucuda OPENROUTER_API_KEY tanımlı değil.');
  error.status = 503;
  return error;
}

/* How long the upstream says to wait, in whole seconds, when it says anything. */
function retryDelay(response) {
  const after = Number(response.headers.get('retry-after'));
  if (Number.isFinite(after) && after > 0) return Math.min(Math.ceil(after), 120);

  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    const ms = reset > 1e12 ? reset - Date.now() : reset * 1000 - Date.now();
    if (ms > 0) return Math.min(Math.ceil(ms / 1000), 120);
  }

  return 0;
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
      // A free model that is busy this second is often free the next one.
      if (error.status === 429 && (error.retryAfter || 0) <= 5) {
        await new Promise((resolve) => setTimeout(resolve, (error.retryAfter || 2) * 1000));

        try {
          return await runOnce({ model, settings, messages });
        } catch (second) {
          lastError = second;
          console.warn(`[vlipa] ${model} hâlâ yoğun: ${second.detail || second.message}`);
          continue;
        }
      }

      lastError = error;

      // Only step down the chain for problems with this model: a missing id,
      // a model that is gone, or one that is busy right now.
      if (![400, 404, 429, 502, 503].includes(error.status)) throw error;
      console.warn(`[vlipa] ${model} elendi: ${error.detail || error.message}`);
    }
  }

  if (lastError) {
    // Every model in the chain refused: say which one and why, so the reason
    // is visible instead of hiding behind the same sentence every time.
    lastError.tried = chain;
    throw lastError;
  }

  throw new Error('Vlipa şu an yanıt veremiyor.');
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
      const waitFor = retryDelay(response);
      const error = new Error(
        response.status === 429
          ? 'Vlipa şu an çok yoğun. Birkaç saniye sonra tekrar dene.'
          : 'Vlipa şu an yanıt veremiyor. Birazdan tekrar dene.'
      );
      error.status = response.status;
      error.detail = `${model}: ${response.status} ${scrub(detail).slice(0, 300)}`;
      const reason = reasonFor(response.status, detail);

      // A daily cap already says when it lifts; a seconds countdown would
      // contradict it.
      error.reason = waitFor && !reason.includes('günlük')
        ? `${reason} Yaklaşık ${waitFor} saniye sonra tekrar dene.`
        : reason;
      error.retryAfter = waitFor;
      error.model = model;
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

/* Searches OpenRouter's public catalogue. No key needed, so this works even
   when the configured model is refusing: it is how you find the exact id of a
   model, spelling included, without leaving the browser. */
export async function findModels(query) {
  const needle = String(query || '').toLowerCase().trim();

  const response = await fetch(`${BASE_URL}/models`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Katalog okunamadı (${response.status}).`);

  const data = await response.json();

  return (data.data || [])
    .filter((model) => {
      const haystack = `${model.id} ${model.name || ''}`.toLowerCase();
      return !needle || haystack.includes(needle);
    })
    .map((model) => {
      const pricing = model.pricing || {};
      const free = model.id.endsWith(':free') ||
        (Number(pricing.prompt || 0) === 0 && Number(pricing.completion || 0) === 0);

      return { id: model.id, name: model.name, free, context: model.context_length || 0 };
    })
    .sort((a, b) => Number(b.free) - Number(a.free) || a.id.localeCompare(b.id))
    .slice(0, 60);
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

        const raw = response.ok ? '' : await response.text().catch(() => '');
        results.push({
          mode: mode.id,
          model,
          status: response.status,
          ok: response.ok,
          ms: Date.now() - started,
          reason: response.ok ? '' : reasonFor(response.status, raw),
          detail: scrub(raw).slice(0, 200),
        });
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
