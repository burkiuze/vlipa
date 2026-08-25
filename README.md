# vlipa

The vlipa site and the free vlipa studio. Static pages plus a handful of
serverless functions. No framework, no build step, no dependencies to install.

```
index.html              the public site
studio.html             the studio (sites, AI builder, AI teams, ask)
login.html signup.html  accounts, with a server-issued captcha
api/                    serverless functions (Vercel)
api/_lib/               server-only code: storage, auth, captcha, routing
assets/css/             styles for the site and for the studio
assets/js/studio/       themes, renderer, ZIP writer, the studio app
middleware.js           <slug>.vlipa.dev -> the published shop
dev.js                  local server: node dev.js
```

## Deploying to Vercel

1. Push this repository and import it in Vercel. There is nothing to configure:
   the root is served statically and `api/` becomes functions.
2. Add the environment variables below (Settings → Environment Variables).
3. Add a KV store: Storage → Create → KV (Upstash Redis). Connecting it to the
   project fills in `KV_REST_API_URL` and `KV_REST_API_TOKEN` on its own.
4. Redeploy.

### Environment variables

| Name | What it is |
| --- | --- |
| `OPENROUTER_API_KEY` | Your OpenRouter key. It stays on the server; the browser never sees it. |
| `AUTH_SECRET` | A long random string. Signs sessions and captcha tokens. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Storage for accounts, sites and teams. Without them everything is kept in memory and lost between requests. |
| `PUBLISH_DOMAIN` | Where published shops live. Default `vlipa.dev`. |
| `PUBLIC_URL` | The address OpenRouter sees as the referer. |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Shop subdomains

`middleware.js` turns `elma.vlipa.dev` into the published shop with that name.
For it to resolve:

1. Add `vlipa.dev` and `*.vlipa.dev` to the project's domains in Vercel.
2. Point the wildcard at Vercel with the CNAME they show you.

Without the wildcard everything still works; the shops are reachable at
`/api/render?slug=elma` instead.

## Running it locally

```bash
node dev.js          # http://localhost:3000
```

`dev.js` serves the pages and runs the functions the same way Vercel does. With
no `OPENROUTER_API_KEY` the AI parts answer with a clear error and the rest of
the studio (themes, editor, uploads, ZIP export) works normally.

## The studio

Free, and free to keep: every model it calls is a free model on OpenRouter.

- **Build with AI** — describe the shop; the brief goes to the model that lays
  out websites and the result opens in the editor.
- **Themes** — ten original themes (skincare, outdoor, coffee, fashion,
  electronics, jewellery, plants, furniture, streetwear, home textiles). They
  are inspired by that family of shops, not copied from any of them.
- **Editor** — add, reorder and remove sections; write the text; upload
  photographs (resized to 1600px and packed into the export).
- **Download** — a real ZIP, written in the browser with no library:
  `index.html`, `styles.css` and your images. The code is the visitor's.
- **Publish** — a free `name.vlipa.dev` address, changeable and removable.
- **AI team** — pick up to four roles (lead, designer, engineer, site builder,
  copywriter, analyst). Each answers with the model that suits it and reads
  what the others said.
- **Ask** — one box; the router decides where it goes.

### The model line-up

Nobody picks a model. `api/_lib/router.js` reads the message and chooses a
vlipa name; `api/_lib/models.js` resolves that name to the free OpenRouter
model that currently fits it best, refreshing the catalogue every 30 minutes.

| vlipa name | Used for |
| --- | --- |
| `vlipa-code` | Code: functions, bugs, refactors. |
| `vlipa-build` | Websites: sections, layout, product text. |
| `vlipa-think` | Planning, architecture, comparisons. |
| `vlipa-write` | Copy: headlines, descriptions, emails. |
| `vlipa-vision` | Screenshots and photographs. |
| `vlipa-fast` | Short questions and small edits. |

Free models carry the tightest rate limits on OpenRouter, so a busy hour can
return 429s. The studio also caps each account at 60 messages an hour.

## Accounts

- Passwords: PBKDF2-HMAC-SHA256, 210,000 iterations, per-user salt.
- Sessions: a random 32-byte token in an `HttpOnly; SameSite=Lax; Secure`
  cookie. Only its SHA-256 is stored.
- Eight failed attempts lock an account for 15 minutes, and login answers the
  same way for unknown addresses.
- The captcha is issued and checked on the server. Its glyphs are drawn as
  stroked polylines rather than text, so the answer is not sitting in the
  markup, and the answer itself never leaves the server: the browser gets an
  SVG and an HMAC token.

Still worth adding before this carries real traffic: email verification and
password reset.

## Limits in place

25 sites and 12 teams per account, 3 MB per site, roughly 900 KB per
photograph, 24 sections per site, 60 AI messages per account per hour.
