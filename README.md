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

The studio widget on the home page has a model picker. Every option works
without an account, a key, or anything to install.

**System voices (default).** The Web Speech API, built into the browser.
Instant and offline; the chips list the voices the visitor's device actually
has, filtered by language, with `+N more` for the rest. Browser speech renders
straight to the sound card and exposes no capture hook, so this option cannot
produce a file.

**Kokoro-82M (Apache-2.0).** Picked from the same list and then it just works:
`kokoro-js` and ONNX Runtime load into the tab (WebGPU where available, WASM
otherwise), about 80 MB of weights download once and the browser caches them.
Its voices appear as chips. Output is a WAV, so Download works.

**MMS-TTS (Meta, CC-BY-NC 4.0).** One model per language — English, Turkish,
German, Spanish, French, Japanese — about 40 MB each, also generated in the tab
through transformers.js. Changing the language loads that language's model.
**CC-BY-NC means non-commercial use only**, which is why the licence is shown
next to it in the widget.

**My own server (advanced).** Still there for whoever wants it: the address of
any OpenAI-compatible `/v1/audio/speech` endpoint, kept in `localStorage`, with
requests going straight from the visitor's browser to that server (so it needs
permissive CORS).

If a model cannot be fetched — a blocked CDN, no network — the widget says so
and drops back to system voices rather than sitting broken.

Generated audio is encoded to WAV in `assets/js/studio.js` (`encodeWav`), so
Download needs no extra dependency.

### The optional Netlify function

`netlify/functions/tts.mjs` does the same job server-side, for one shared voice
rather than a per-visitor download. Set either:

```
TTS_ENDPOINT = https://your-host/v1/audio/speech    # your open-source voice
TTS_MODEL    = kokoro       # optional
TTS_VOICE    = af_heart     # optional
TTS_API_KEY  = ...          # optional
```

or, for OpenAI's hosted voices (paid, closed source):

```
OPENAI_API_KEY = sk-...
```

With neither set it returns 501 and the page carries on with the models above.
The endpoint is public, so put rate limiting in front of it before sharing the
site widely.

**On OpenAI:** its voices are a paid, closed API. `openai/whisper` is open but
it is speech *recognition*, not synthesis; there is no open-weight OpenAI
speech-synthesis model. The open realistic voices are the ones in the picker
and on `/open-source`.

## Structure

```
netlify.toml            publish settings, redirects, headers
netlify/functions/      accounts (auth.mjs) and the optional TTS proxy
assets/css/styles.css   tokens, typography, buttons, nav, footer (shared)
assets/css/home.css     home page + open-source list
assets/css/auth.css     sign-in card and captcha
assets/js/home.js       sticky nav and the mobile menu
assets/js/studio.js     the studio widget: three engines, playback, download
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
