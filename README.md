# vlipa

Static marketing site for vlipa — HTML, CSS and vanilla JS, no build step,
light theme only. Deploys to Netlify as-is.

## Pages

| File | What it is |
| --- | --- |
| `index.html` | Home page: hero, playable studio widget, products, developers, open-source teaser, pricing |
| `open-source.html` | Filterable list of open-source speech projects on GitHub |
| `login.html` | Sign-in page: email, password and a captcha |

## Deploying to Netlify

The repository root is the publish directory, so there is nothing to build.

- **From Git:** New site → pick this repo → the settings in `netlify.toml`
  (publish `.`, no build command, functions in `netlify/functions`) are picked
  up automatically.
- **Drag and drop:** drop the project folder onto the Netlify dashboard.
- **CLI:** `netlify deploy --prod`.

`netlify.toml` also adds clean URLs (`/login`, `/open-source`), basic security
headers and asset caching.

## Audio

The studio widget on the home page really speaks. It uses the **Web Speech API**
(`speechSynthesis`), which is built into the browser:

- voices are whatever the visitor's OS provides, listed live in the chips and
  filtered by the selected language;
- nothing is sent anywhere, no key and no backend are involved;
- if a browser reports no voices (some Linux setups, headless), the widget says
  so instead of pretending.

### Optional: better voices through a Netlify function

`netlify/functions/tts.mjs` proxies OpenAI's speech API. It is **off by
default**. To turn it on:

1. Netlify → Site settings → Environment variables → `OPENAI_API_KEY`.
2. In `index.html`, set `window.VLIPA_REMOTE_TTS = true`.

The page still falls back to browser voices if the function errors.

Two things to be clear about:

- **OpenAI's voices are not open source.** They are a paid, closed API.
  `openai/whisper` is open, but it is speech *recognition*, not synthesis.
  For genuinely open realistic voices, self-host one of the models listed on
  `/open-source` — Kokoro, Chatterbox, F5-TTS and XTTS are the usual picks —
  and point this function at your own server instead.
- **The function endpoint is public.** Anyone who finds the URL can spend your
  API credit. There is a 500-character cap, but put rate limiting or auth in
  front of it before sharing the site widely.

## Structure

```
netlify.toml            publish settings, redirects, headers
netlify/functions/      optional server-side TTS proxy
assets/css/styles.css   tokens, typography, buttons, nav, footer (shared)
assets/css/home.css     home page + open-source list
assets/css/auth.css     sign-in card and captcha
assets/js/home.js       mobile menu, studio tabs, speech playback
assets/js/oss-data.js   the open-source project dataset
assets/js/oss.js        renders and filters that dataset
assets/js/auth.js       form validation, password reveal, captcha
assets/img/             logo mark and favicon
```

## Run locally

```bash
python3 -m http.server 8000     # static pages only
netlify dev                     # if you also want the function
```

## Notes

- Type is Inter (Google Fonts) with a system sans-serif fallback.
- **Sign-in is front-end only.** `assets/js/auth.js` validates the fields,
  checks the captcha, then reports that no backend is connected. Replace the
  `setTimeout` in the submit handler with a real request.
- **The captcha is drawn in the browser**, so the expected answer lives in the
  page: it stops casual scripted submissions, nothing more. Anything serious
  needs a challenge issued and verified server-side.
- Open-source figures in `oss-data.js` come from the GitHub API and are a
  snapshot (2026-08-22), not a live feed. Licences vary — several projects are
  AGPL or research-only.
- Marketing copy and the stats band are placeholders.
