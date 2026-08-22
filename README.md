# vlipa

Static marketing site for vlipa — HTML, CSS and vanilla JS, no build step,
light theme only. Deploys to Netlify as-is.

## Pages

| File | What it is |
| --- | --- |
| `index.html` | Home page: hero, playable studio widget, products, developers, open-source teaser, pricing |
| `open-source.html` | Filterable list of open-source speech projects on GitHub |
| `login.html` | Sign-in page: email, password and a captcha |
| `signup.html` | Create an account |
| `account.html` | The page behind sign-in |

## Deploying to Netlify

The repository root is the publish directory, so there is nothing to build.

- **From Git:** New site → pick this repo → the settings in `netlify.toml`
  (publish `.`, no build command, functions in `netlify/functions`) are picked
  up automatically.
- **Drag and drop:** drop the project folder onto the Netlify dashboard.
- **CLI:** `netlify deploy --prod`.

`netlify.toml` also adds clean URLs (`/login`, `/open-source`), basic security
headers and asset caching.

## Accounts

Sign-up and sign-in are real. `netlify/functions/auth.mjs` stores accounts in
**Netlify Blobs**, which needs no setup — the store is provisioned with the
site, so a fresh deploy has working accounts with nothing to configure.

```
POST /api/auth/signup   { email, password, name?, remember? }
POST /api/auth/login    { email, password, remember? }
POST /api/auth/logout
GET  /api/auth/me
```

- Passwords are stored as PBKDF2-HMAC-SHA256 (210,000 iterations, per-user
  random salt) — never in the clear, never reversible.
- A session is a random 32-byte token in an `HttpOnly; SameSite=Lax; Secure`
  cookie. Only the SHA-256 of the token is stored, so a dump of the store does
  not hand out live sessions. 30 days with "keep me signed in", 12 hours
  without.
- Login answers "email or password is incorrect" either way and spends the same
  time on unknown addresses, so the endpoint does not reveal who has an account.
- Eight failed attempts lock that account for 15 minutes.
- `/account` bounces signed-out visitors to `/login`; `/login` and `/signup`
  bounce signed-in ones to `/account`.

The logic lives in `netlify/functions/lib/auth-core.mjs` with storage injected,
so it can be exercised without Netlify.

**Still to do before this is a real product:** email verification, password
reset, and a server-issued captcha (see below). Netlify Blobs is fine for this
scale; move to a database when accounts matter.

## Audio

The studio widget on the home page really speaks. It uses the **Web Speech API**
(`speechSynthesis`), which is built into the browser:

- voices are whatever the visitor's device provides — the chips list them live,
  filtered by the selected language, with a `+N more` chip for the rest, and the
  line under the widget shows how many are available;
- nothing is sent anywhere, no key and no backend are involved;
- if a browser reports no voices (some Linux setups, headless), the widget says
  so instead of pretending.

How many voices that is depends entirely on the visitor: Windows and macOS
typically expose several dozen, Chrome adds its own network voices, and a bare
Linux install may have one or none. The site does not ship voices of its own.

### Downloading audio

The Download button saves the text as an MP3 — but only when a voice backend is
configured. The Web Speech API renders straight to the audio device and exposes
no capture hook, so the browser's own voices can play but cannot be recorded.
Without a backend the button explains that instead of failing silently.

`netlify/functions/tts.mjs` talks to any OpenAI-compatible
`/v1/audio/speech` server, so there are two ways to enable it. Set the
environment variables in Netlify → Site settings → Environment variables:

**A. Your own open-source voice — no OpenAI account, no per-word cost.**
Run one of the projects from `/open-source` that ships an OpenAI-compatible API
(Kokoro-FastAPI is the usual pick), then set:

```
TTS_ENDPOINT = https://your-host/v1/audio/speech
TTS_MODEL    = kokoro       # optional
TTS_VOICE    = af_heart     # optional
TTS_API_KEY  = ...          # optional, if your server requires one
```

**B. OpenAI's hosted voices — paid and closed source.**

```
OPENAI_API_KEY = sk-...
```

To route *playback* through the backend too (not just downloads), set
`window.VLIPA_REMOTE_TTS = true` in `index.html`; playback still falls back to
browser voices if the request fails.

Two things to be clear about:

- **OpenAI's voices are not open source.** They are a paid, closed API.
  `openai/whisper` is open, but it is speech *recognition*, not synthesis.
  There is no open-weight OpenAI speech-synthesis model. For genuinely open
  realistic voices, self-host Kokoro, Chatterbox, F5-TTS or XTTS — all listed
  on `/open-source` — and use option A.
- **The function endpoint is public.** Anyone who finds the URL can spend your
  API credit or your GPU time. There is a 500-character cap, but add rate
  limiting or auth before sharing the site widely.

## Structure

```
netlify.toml            publish settings, redirects, headers
netlify/functions/      accounts (auth.mjs) and the optional TTS proxy
assets/css/styles.css   tokens, typography, buttons, nav, footer (shared)
assets/css/home.css     home page + open-source list
assets/css/auth.css     sign-in card and captcha
assets/js/home.js       mobile menu, studio tabs, speech playback, download
assets/js/oss-data.js   the open-source project dataset
assets/js/oss.js        renders and filters that dataset
assets/js/auth.js       sign-in form
assets/js/signup.js     sign-up form
assets/js/account.js    the signed-in page
assets/js/auth-api.js   calls to /api/auth/*
assets/js/captcha.js    the canvas captcha shared by both forms
assets/img/             logo mark and favicon
```

## Run locally

```bash
netlify dev                     # pages + functions + accounts
python3 -m http.server 8000     # static pages only; /api/auth/* will 404
```

## Notes

- Type is Inter (Google Fonts) with a system sans-serif fallback.
- **The captcha is drawn in the browser**, so the expected answer lives in the
  page: it stops casual scripted submissions, nothing more. Anything serious
  needs a challenge issued and verified server-side.
- Open-source figures in `oss-data.js` come from the GitHub API and are a
  snapshot (2026-08-22), not a live feed. Licences vary — several projects are
  AGPL or research-only.
- Marketing copy and the stats band are placeholders.
