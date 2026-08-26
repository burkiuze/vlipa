# vlipa

The vlipa site and **vlipa studio**: a workspace where a company runs off this
one deployment — its people, their permissions, the work, the data and the
meetings — with Vlipa, the studio's assistant, alongside it.

Static pages plus serverless functions. No framework, no build step, no
dependencies.

```
index.html               the public site
studio.html              the workspace shell
login.html signup.html   accounts, with a server-issued captcha

api/company.js           companies, members, roles, invitations
api/tasks.js             tasks and who they belong to
api/tables.js            the company's own small database
api/meetings.js          video rooms
api/chat.js              Vlipa
api/status.js            what works right now, and why something does not
api/_lib/                server-only: storage, accounts, captcha, permissions

assets/js/studio/        the workspace: shell, chat, tasks, tables, team, meet
assets/css/              styles for the site, the workspace and the auth pages
dev.js                   local server: node dev.js
```

## Deploying to Vercel

1. Push and import the repository. The root is served statically and `api/`
   becomes functions.
2. Add a **KV store**: Storage → Create → KV (Upstash Redis) → connect it to
   the project. `KV_REST_API_URL` and `KV_REST_API_TOKEN` arrive on their own.
   Without them nothing is kept between requests: accounts, companies and work
   would disappear.
3. Add the environment variables below.
4. Redeploy. Environment variables do not reach a deployment that already
   exists.

| Name | What it is |
| --- | --- |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | **Required.** Storage for accounts, companies, tasks, tables, meetings. |
| `AUTH_SECRET` | **Required.** Signs sessions and captcha tokens. Any long random string. |
| `OPENROUTER_API_KEY` | For Vlipa. Stays on the server; no browser sees it. |
| `CHAT_MODEL_FAST` | The model Vlipa runs on. Default `minimax/minimax-m3:free`. |
| `CHAT_MODEL_THINKING` | A different model for Think mode, if you want one. |
| `CHAT_MODEL_FALLBACKS` | Optional, comma separated. Tried in order if the model above refuses. Empty by default: an unasked-for model is a bill. |
| `MEET_HOST` | Where video rooms live. Default `meet.jit.si`. |
| `PUBLIC_URL` | The address OpenRouter sees as the referer. |

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Running it locally

```bash
AUTH_SECRET=dev OPENROUTER_API_KEY=sk-or-... node dev.js     # localhost:3000
```

Without KV the store falls back to memory, which is fine for a look around and
useless for anything else: it forgets everything when the process stops.

## The workspace

A company is the unit everything hangs off. Tasks, tables and meetings all
belong to one, and every request is checked against the caller's role in that
company before it touches anything.

- **Panel** — what is open, what is late, what is yours, and shortcuts.
- **Vlipa** — the assistant. Fast answers straight away; Think weighs the
  options first. Conversations stay in the browser.
- **Görevler** — a board across four columns, assignment, due dates, filters
  for everything / open / mine.
- **Tablolar** — the company's own tables: name the columns, add rows, export
  CSV. Enough for a customer list or a stock count without a database.
- **Toplantılar** — video rooms, joined in place or in a new tab.
- **Ekip** — who is in, what each may do, invitation codes, role changes.
- **Ayarlar** — rename the company, leave it, or close it down.

### Roles

| Role | What it may do |
| --- | --- |
| **Sahip** | Everything, including deleting the company and handing ownership on. |
| **Yönetici** | The team, tasks, tables, meetings. Cannot touch the owner or delete the company. |
| **Üye** | Takes work, updates their own tasks, writes rows. |
| **Misafir** | Reads. Nothing else. |

Nobody hands out a role above their own, only an owner makes an owner, and the
owner cannot be removed. Handing ownership on steps the old owner down to
Yönetici in the same move.

The interface hides what a role cannot do, but that is a courtesy, not the
rule: `api/_lib/org.js` checks every request and refuses it there.

### Invitations

An invitation is a code, good for a fortnight, carrying the role its maker
chose. Whoever has it opens an account and joins with it. Codes can be revoked
before they are used.

### Meetings

Video and audio run on **Jitsi Meet**: free, no account, and it brings the TURN
servers a serverless deployment cannot. What is stored here is the room list —
who opened it, its name, and a random tail so the address cannot be guessed.
Anyone with the link can walk in, so the link stays inside the team. Point
`MEET_HOST` at your own Jitsi if you run one.

## When Vlipa keeps giving the same answer

That is almost never the model repeating itself. It is the same error text
coming back, usually because the model id no longer exists, the key is refused,
or the free tier is rate limiting.

A failed turn says why underneath the message. `/api/status?models=minimax`
searches OpenRouter's catalogue for a word and lists the exact ids, marking the
free ones; it needs no key, so it answers while everything else is refusing.
`/api/status?probe=1` asks every configured model for one token and reports
what came back.

| What you see | What it means |
| --- | --- |
| 401 | The key is wrong or was revoked. |
| 402 | The OpenRouter account needs credit. |
| 403 / 404 with "data policy" or "no endpoints" | Free models are switched off for the account. OpenRouter → Settings → Privacy, allow the free-model data policy. |
| 404 | That model id no longer exists. |
| 429 | The free tier's quota, counted per account rather than per key, so a new key changes nothing. A momentary one is retried once on its own; a daily one lifts the next day. |

Keys are scrubbed out of anything that travels back to a browser.

## Accounts

- Passwords: PBKDF2-HMAC-SHA256, 210,000 iterations, per-user salt.
- Sessions: a random 32-byte token in an `HttpOnly; SameSite=Lax; Secure`
  cookie. Only its SHA-256 is stored.
- Eight failed attempts lock an account for 15 minutes, and login answers the
  same way for addresses that do not exist.
- The captcha is issued and checked on the server, drawn as stroked polylines
  rather than text so the answer is not sitting in the markup, and the answer
  itself never leaves the server.

Still worth adding before this carries real traffic: email verification and
password reset.

## Limits in place

5 companies per person, 500 tasks and 30 tables per company, 2000 rows per
table, 16 columns per table, 40 meeting rooms, 20 AI messages a minute per
address.
