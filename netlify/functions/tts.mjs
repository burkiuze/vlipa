/* Server-side text-to-speech, used by the studio widget's Download button and,
 * optionally, for playback.
 *
 * The site works without this function — the widget plays the browser's own
 * voices. But the Web Speech API renders straight to the audio device and
 * exposes no capture hook, so *saving* audio to a file needs a real audio
 * source. That is what this endpoint provides.
 *
 * It talks to any OpenAI-compatible /v1/audio/speech server, so you can pick:
 *
 *   A. Your own open-source voice (no OpenAI account, no per-word cost).
 *      Run one of the projects listed on /open-source that ships an
 *      OpenAI-compatible API — Kokoro-FastAPI is the usual pick — then set:
 *        TTS_ENDPOINT = https://your-host/v1/audio/speech
 *        TTS_MODEL    = kokoro            (optional)
 *        TTS_VOICE    = af_heart          (optional)
 *        TTS_API_KEY  = ...               (optional, if your server wants one)
 *
 *   B. OpenAI's hosted voices. Paid, closed source, and not the same thing as
 *      openai/whisper (which is speech *recognition*). Set:
 *        OPENAI_API_KEY = sk-...
 *
 * With neither set the endpoint returns 501 and the page keeps using browser
 * voices.
 *
 * Warning: this endpoint is public. Anyone who finds the URL can spend your
 * credit or your GPU time. The character cap below is a floor, not a defence —
 * add Netlify rate limiting or your own auth before sharing the site widely.
 */

const MAX_CHARS = 500;
const OPENAI_VOICE_BY_LANG = {
  en: 'alloy', tr: 'nova', de: 'onyx', es: 'nova', fr: 'shimmer', ja: 'alloy'
};

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Use POST.' }, 405);
  }

  const selfHosted = process.env.TTS_ENDPOINT;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!selfHosted && !openaiKey) {
    return json({
      error: 'No voice backend configured. Set TTS_ENDPOINT for a self-hosted ' +
             'open-source voice, or OPENAI_API_KEY for OpenAI’s hosted voices.'
    }, 501);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }

  const text = String(body.text || '').trim().slice(0, MAX_CHARS);
  if (!text) return json({ error: 'Nothing to read.' }, 400);

  const lang = String(body.lang || 'en').slice(0, 5);

  const endpoint = selfHosted || 'https://api.openai.com/v1/audio/speech';
  const model = selfHosted
    ? (process.env.TTS_MODEL || 'kokoro')
    : 'gpt-4o-mini-tts';
  const voice = selfHosted
    ? (process.env.TTS_VOICE || 'af_heart')
    : (OPENAI_VOICE_BY_LANG[lang] || 'alloy');

  const key = selfHosted ? process.env.TTS_API_KEY : openaiKey;
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, voice, input: text, response_format: 'mp3' })
    });
  } catch {
    return json({ error: 'Could not reach the voice backend.' }, 502);
  }

  if (!upstream.ok) {
    return json({ error: `Voice backend returned ${upstream.status}.` }, 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'audio/mpeg',
      'Cache-Control': 'no-store'
    }
  });
};

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
