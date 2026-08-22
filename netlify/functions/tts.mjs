/* Optional server-side text-to-speech.
 *
 * The site works without this function: the studio widget falls back to the
 * browser's own voices. Deploy it only if you want higher-quality neural
 * voices and are willing to pay for them.
 *
 * Setup
 *   1. Netlify → Site settings → Environment variables → OPENAI_API_KEY
 *   2. Set window.VLIPA_REMOTE_TTS = true on the page (see index.html)
 *
 * Warning: this endpoint is public. Anyone who finds it can spend your API
 * credit. The character cap below is a floor, not a defence — put Netlify
 * rate limiting or your own auth in front of it before advertising the site.
 *
 * OpenAI's voices are a paid, closed API. They are not open source, and no
 * open-source OpenAI speech-synthesis model exists — openai/whisper is
 * speech recognition. For self-hosted voices, run one of the projects listed
 * on /open-source and point this function at it instead.
 */

const MAX_CHARS = 500;
const VOICE_BY_LANG = { en: 'alloy', tr: 'nova', de: 'onyx', es: 'nova', fr: 'shimmer', ja: 'alloy' };

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Use POST.' }, 405);
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return json({ error: 'No OPENAI_API_KEY set; the page should use browser voices.' }, 501);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }

  const text = String(body.text || '').trim().slice(0, MAX_CHARS);
  if (!text) {
    return json({ error: 'Nothing to read.' }, 400);
  }

  const voice = VOICE_BY_LANG[body.lang] || 'alloy';

  const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, response_format: 'mp3' })
  });

  if (!upstream.ok) {
    return json({ error: `Upstream returned ${upstream.status}.` }, 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }
  });
};

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
