/* The one place that talks to OpenRouter. The key never leaves the server.

   Two modes sit behind two models: "fast" answers straight away, "thinking"
   takes the slower reasoning model. Which model is which is configuration, not
   something the assistant is allowed to talk about. */

import { groqCompletion, groqModel, groqReady } from './groq.js';
import { NAMED as NEBIUS_NAMED, nebiusCompletion, nebiusModel, nebiusReady } from './nebius.js';
import { cleanReply } from './reply.js';

/* Configurable so a gateway (or a test stub) can stand in front of it. */
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
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
    note: 'Answers straight away.',
    model: () => process.env.CHAT_MODEL_FAST || DEFAULT_MODEL,
    temperature: 0.7,
    maxTokens: 900,
    tools: true,
  },
  thinking: {
    id: 'thinking',
    label: 'Thinking',
    note: 'Thinks first, then answers. Slower.',
    model: () => process.env.CHAT_MODEL_THINKING || process.env.CHAT_MODEL_FAST || DEFAULT_MODEL,
    temperature: 0.5,
    maxTokens: 1800,
    tools: true,
  },
};

/* The models a person may pick from the interface, by short name. The browser
   never names a model id: it sends one of these keys and the server decides
   what that means. Anything not on this list cannot be called at all, so no
   request can put an unasked-for model on the bill.

   Every one of these is a free tier on OpenRouter. If an id ever moves or
   disappears, /api/status?models=<word> says so and only this list changes. */
export const PICKS = {
  vlipa:     { id: 'vlipa',     label: 'Vlipa',      model: () => process.env.CHAT_MODEL_FAST || DEFAULT_MODEL },
  // The coding pick has moved twice, for the same reason each time: it needs
  // a home that will actually answer. Groq's free tier is eight thousand
  // tokens a minute, which is a paragraph rather than a file. OpenRouter's
  // free Qwen coder was the answer until OpenRouter stopped carrying any free
  // Qwen at all — the id 404s, and a menu entry that cannot answer is worse
  // than no entry. It runs on the Nebius credit now.
  qwen:      { id: 'qwen',      label: NEBIUS_NAMED.qwencoder.label, nebius: 'qwencoder', model: () => nebiusModel('qwencoder') },
  glm:       { id: 'glm',       label: 'GLM 5.2',    model: () => process.env.CHAT_MODEL_GLM || 'z-ai/glm-5.2:free' },
  gemma:     { id: 'gemma',     label: 'Gemma 4',    model: () => process.env.CHAT_MODEL_GEMMA || 'google/gemma-4-31b-it:free' },
  nemotron:  { id: 'nemotron',  label: 'Nemotron',   model: () => process.env.CHAT_MODEL_NEMOTRON || 'nvidia/nemotron-3.5-lightning:free' },
  // These two run on Nebius, a second account with its own credit, so they sit
  // outside the free-tier queue and only appear where a key for it exists.
  // Which exact id each one means is Nebius's own catalogue question, answered
  // in nebius.js.
  deepseek:  { id: 'deepseek',  label: NEBIUS_NAMED.deepseek.label, nebius: 'deepseek', model: () => nebiusModel('deepseek') },
  hermes:    { id: 'hermes',    label: NEBIUS_NAMED.hermes.label,   nebius: 'hermes',   model: () => nebiusModel('hermes') },
};

/* Which picks each tool offers. Write stays on the two that hold a long
   document together; Vlipa itself is MiniMax M3 on its free tier, which is
   what DEFAULT_MODEL above names. */
export const PICKS_FOR = {
  chat:  ['vlipa', 'deepseek', 'hermes', 'glm', 'gemma', 'nemotron'],
  code:  ['vlipa', 'deepseek', 'qwen', 'hermes', 'glm', 'gemma', 'nemotron'],
  write: ['vlipa', 'deepseek', 'gemma'],
  // Mail is short, and it is somebody's own words going out under their own
  // address: the picks are the ones that keep a tone rather than the ones
  // that write the most.
  mail:  ['vlipa', 'deepseek', 'glm', 'gemma'],
};

/* What OpenRouter is serving right now.

   Free model ids come and go: qwen/qwen3-coder:free was in the menu for weeks
   after OpenRouter stopped carrying it, and picking it 404'd. A menu entry
   that cannot answer is worse than no entry, so the catalogue is read and the
   picks are checked against it.

   Read once every half hour and kept for the life of the instance. A
   catalogue that cannot be read fails open — every pick is offered — because
   hiding the whole menu over a network hiccup is the worse mistake. */
const CATALOGUE_MS = 30 * 60 * 1000;
let served = { at: 0, ids: null };

async function servedIds() {
  if (served.ids && Date.now() - served.at < CATALOGUE_MS) return served.ids;

  try {
    const response = await fetch(`${BASE_URL}/models`, { headers: { accept: 'application/json' } });
    if (!response.ok) return served.ids;

    const data = await response.json();
    const ids = new Set((data.data || []).map((model) => model?.id).filter(Boolean));

    if (ids.size) served = { at: Date.now(), ids };
  } catch {
    /* the catalogue is a convenience; failing to read it is not an answer */
  }

  return served.ids;
}

/* A pick appears when whatever runs it is configured, and — for the ones on
   OpenRouter — when OpenRouter still has it. */
export async function picksFor(tool) {
  const ids = await servedIds();

  return (PICKS_FOR[tool] || PICKS_FOR.chat)
    .filter((key) => {
      const pick = PICKS[key];

      if (pick.groq) return groqReady();
      if (pick.nebius) return nebiusReady();

      // Fails open: no catalogue means no opinion, not a hidden model.
      return !ids || ids.has(pick.model());
    })
    .map((key) => ({
      id: key,
      label: PICKS[key].label,
      model: PICKS[key].groq ? groqModel() : PICKS[key].model(),
    }));
}

/* Which of the configured OpenRouter models the catalogue no longer carries,
   for whoever is wondering why the menu got shorter. */
export async function goneModels() {
  const ids = await servedIds();
  if (!ids) return [];

  return [...new Set(Object.values(PICKS))]
    .filter((pick) => !pick.groq && !pick.nebius && !ids.has(pick.model()))
    .map((pick) => ({ pick: pick.id, model: pick.model() }));
}

/* A pick only counts when the tool offers it; anything else falls back to
   Vlipa's own model rather than being called. */
export function modelForPick(tool, pick) {
  const allowed = PICKS_FOR[tool] || PICKS_FOR.chat;
  let key = allowed.includes(pick) ? pick : 'vlipa';
  if (PICKS[key].groq && !groqReady()) key = 'vlipa';
  if (PICKS[key].nebius && !nebiusReady()) key = 'vlipa';

  if (PICKS[key].groq) return 'groq';
  if (PICKS[key].nebius) return `nebius:${PICKS[key].nebius}`;

  return PICKS[key].model();
}

/* Free models run out of quota for minutes at a time, and "try again later"
   is not an answer. When the chosen one is busy the others this same tool
   offers are tried — models the person can already pick from the menu, never
   anything outside it. Groq is left out of the queue: it is a different
   account with its own limits. */
export function alsoTry(tool, pick) {
  const allowed = PICKS_FOR[tool] || PICKS_FOR.chat;

  return allowed
    .filter((key) => key !== pick && !PICKS[key].groq && !PICKS[key].nebius)
    .map((key) => PICKS[key].model())
    .filter(Boolean);
}

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

  if (status === 401) return 'The key is invalid or expired (401).';
  if (status === 402) return 'The OpenRouter account needs credit (402).';
  if (status === 403 && text.includes('data policy')) {
    return 'An OpenRouter privacy setting is blocking this: free models need the data policy enabled under Settings → Privacy (403).';
  }
  if (status === 403) return 'This key has no access to this model (403).';
  if (status === 404 && text.includes('no endpoints')) {
    return 'Model not found: that id is gone from OpenRouter, or your key cannot reach it (404). For free models, check Settings → Privacy as well.';
  }
  if (status === 404) return 'Model not found (404).';
  if (status === 429) {
    if (text.includes('per day') || text.includes('daily') || text.includes('free-models-per-day')) {
      return 'The free model\'s daily allowance is spent (429). It resets tomorrow; adding credit to the OpenRouter account raises it.';
    }

    // A big request on a free model hits a per-minute token ceiling, and the
    // provider says so in its own words — an organisation id and a pair of
    // numbers, which is not something to hand a person who asked for a car
    // game. What they can actually do is ask for less, or pick a model that
    // is not on the free tier.
    if (text.includes('tokens per minute') || text.includes('tpm') || text.includes('rate limit')) {
      return 'That was too much for a free model in one go: it has a per-minute token limit and this request went over it. '
        + 'Ask for it in smaller pieces, or pick one of the models that is not on the free tier.';
    }

    return 'The free model is out of quota for now — wait a moment and try again (429).';
  }
  if (status === 400) return 'The request was refused (400).';
  if (!status) return 'OpenRouter could not be reached.';

  return `OpenRouter answered ${status}.`;
}

function missingKey() {
  const error = new Error('Vlipa is not connected: OPENROUTER_API_KEY is not set on the server.');
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

/* `toolset` lets a caller bring its own tools — Vlipa Studio hands over the
   project the browser is holding, so the model can read and edit files rather
   than reciting them into the conversation. */
export async function chatCompletion({ messages, mode = 'fast', json = false, maxTokens, model, spares = [], toolset = null, hops }) {
  const settings = modeFor(mode);

  // Two picks run somewhere else entirely. Groq is here to answer and takes no
  // tools; Nebius takes the caller's, because in the studio it is the model
  // somebody chose to work on their own files with, and a model told about
  // read_file without being given it narrates the call instead of making it.
  if (model === 'groq') {
    return groqCompletion({
      messages,
      temperature: settings.temperature,
      maxTokens: maxTokens || settings.maxTokens,
    });
  }

  if (String(model).startsWith('nebius')) {
    return nebiusCompletion({
      messages,
      name: String(model).split(':')[1] || '',
      temperature: settings.temperature,
      maxTokens: maxTokens || settings.maxTokens,
      toolset,
      hops,
    });
  }

  if (!hasKey()) throw missingKey();

  // The picked model first, then whatever else this tool already offers, so a
  // model that is busy this minute does not become a dead end. Nothing outside
  // the menu is ever called.
  const chain = model ? [...new Set([model, ...spares])] : chainFor(settings);
  let lastError = null;

  for (const model of chain) {
    try {
      return await runOnce({ model, settings, messages, json, maxTokens, toolset, hops });
    } catch (error) {
      // A free model that is busy this second is often free the next one.
      if (error.status === 429 && (error.retryAfter || 0) <= 5) {
        await new Promise((resolve) => setTimeout(resolve, (error.retryAfter || 2) * 1000));

        try {
          return await runOnce({ model, settings, messages, json, maxTokens, toolset, hops });
        } catch (second) {
          lastError = second;
          console.warn(`[vlipa] ${model} still busy: ${second.detail || second.message}`);
          continue;
        }
      }

      lastError = error;

      // Only step down the chain for problems with this model: a missing id,
      // a model that is gone, or one that is busy right now.
      if (![400, 404, 429, 502, 503].includes(error.status)) throw error;
      console.warn(`[vlipa] ${model} dropped: ${error.detail || error.message}`);
    }
  }

  if (lastError) {
    // Every model in the chain refused: say which one and why, so the reason
    // is visible instead of hiding behind the same sentence every time.
    lastError.tried = chain;
    throw lastError;
  }

  throw new Error('Vlipa cannot answer right now.');
}

async function runOnce({ model, settings, messages, json = false, maxTokens, toolset = null, hops }) {
  const working = [...messages];

  // Working on a project takes more turns than answering a question: reading
  // a file, changing it, checking another one.
  const limit = Number.isInteger(hops) ? hops : MAX_TOOL_HOPS;

  for (let hop = 0; hop <= limit; hop += 1) {
    const body = {
      model,
      messages: working,
      temperature: json ? 0.4 : settings.temperature,
      max_tokens: maxTokens || settings.maxTokens,
    };

    // Asking for JSON turns tools off: one shape of answer at a time.
    if (json) body.response_format = { type: 'json_object' };

    if (toolset && !json) {
      body.tools = toolset.definitions;
      body.tool_choice = 'auto';
    } else if (settings.tools && !json) {
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
          ? 'Vlipa is very busy. Try again in a few seconds.'
          : 'Vlipa cannot answer right now. Try again shortly.'
      );
      error.status = response.status;
      error.detail = `${model}: ${response.status} ${scrub(detail).slice(0, 300)}`;
      const reason = reasonFor(response.status, detail);

      // A daily cap already says when it lifts; a seconds countdown would
      // contradict it.
      error.reason = waitFor && !reason.includes('daily')
        ? `${reason} Try again in about ${waitFor} seconds.`
        : reason;
      error.retryAfter = waitFor;
      error.model = model;
      throw error;
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error('Vlipa returned something unexpected.');

    const calls = message.tool_calls;

    if (calls && calls.length) {
      const executeTool = toolset
        ? toolset.run
        : (await import('./tools.js')).executeTool;

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

    const answer = cleanReply(message.content);

    // An empty answer is a failed answer: let the next model in the chain try.
    if (!answer) {
      const error = new Error('Vlipa came back with nothing.');
      error.status = 502;
      error.detail = `${model}: empty completion`;
      throw error;
    }

    return answer;
  }

  throw new Error('The tool loop ran too long.');
}

/* Searches OpenRouter's public catalogue. No key needed, so this works even
   when the configured model is refusing: it is how you find the exact id of a
   model, spelling included, without leaving the browser. */
export async function findModels(query) {
  const needle = String(query || '').toLowerCase().trim();

  const response = await fetch(`${BASE_URL}/models`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`The catalogue could not be read (${response.status}).`);

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
