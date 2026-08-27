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
invite.html              vlipa.dev/invite/<name>

api/company.js           companies, members, roles, invitations, the shared link
api/groups.js            groups, their messages and their voice rooms
api/invite.js            the public invite link
api/tasks.js             tasks and who they belong to
api/tables.js            the company's own small database
api/meetings.js          video rooms
api/chat.js              Vlipa
api/status.js            what works right now, and why something does not
api/_lib/                server-only: storage, accounts, captcha, permissions

assets/js/studio/        the workspace: shell, chat, groups, tasks, tables, team, meet
assets/css/              styles for the site, the workspace and the auth pages
dev.js                   local server: node dev.js
```

## Deploying to Vercel

1. Push and import the repository. The root is served statically and `api/`
   becomes functions.
2. Give it a database. **Supabase** is what this is built for: open a project,
   run `supabase.sql` once in its SQL editor, then take *Project Settings →
   API* and set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Without a database
   nothing is kept between requests — accounts, companies and work all
   disappear on the next cold start. (A Vercel KV/Upstash store still works if
   you already have one; Supabase wins when both are set.)
3. Add the environment variables below.
4. Redeploy. Environment variables do not reach a deployment that already
   exists.

| Name | What it is |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | **Required.** Where accounts, companies, tasks, tables and messages live. The *secret* key (`sb_secret_…`, formerly `service_role`) — see below. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | An alternative to Supabase, not an addition. Only read when Supabase is unset. |
| `AUTH_SECRET` | **Required.** Signs sessions and captcha tokens. Any long random string. |
| `OPENROUTER_API_KEY` | For Vlipa. Stays on the server; no browser sees it. |
| `CHAT_MODEL_FAST` | The model Vlipa runs on. Default `minimax/minimax-m3:free`. |
| `CHAT_MODEL_THINKING` | A different model for Think mode, if you want one. |
| `CHAT_MODEL_FALLBACKS` | Optional, comma separated. Tried in order if the model above refuses. Empty by default: an unasked-for model is a bill. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional. Turns on "Continue with Google". Without both, the button never appears. |
| `GROQ_API_KEY`, `GROQ_MODEL` | Optional. Adds Qwen to Vlipa Studio's model picker, running on Groq. |
| `RESEND_API_KEY`, `MAIL_FROM` | Optional. Emails whoever is given a task, from `no-reply@vlipa.dev`. |
| `GOOGLE_REDIRECT_URI` | Only if the callback is not `PUBLIC_URL` + `/api/auth/google-callback`. |
| `MEET_HOST` | Where video rooms live. Default `meet.jit.si`. |
| `PUBLIC_URL` | The address OpenRouter sees as the referer. |

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### When something is not set up

`/setup` answers it in one page: whether storage is really connected, whether
Google is configured and — the part that goes wrong most — the exact redirect
address this deployment sends to Google, ready to copy into the OAuth client.
`/api/status` is the same information as JSON.

## Running it locally

```bash
AUTH_SECRET=dev OPENROUTER_API_KEY=sk-or-... node dev.js     # localhost:3000
```

Without a database the store falls back to memory, which is fine for a look
around and useless for anything else: it forgets everything when the process
stops.

### Which key Supabase needs

The **secret** key, and only that one. This code runs on the server and the
rows it writes include password hashes and live session tokens.

- `sb_secret_…` (or the older `service_role`) → `SUPABASE_SECRET_KEY`. Server
  only. Never in the repository, never with a `NEXT_PUBLIC_` prefix — that
  prefix means "ship this to browsers".
- `sb_publishable_…` / `anon` → not used here at all. It is the browser key: it
  cannot get past row level security, and whatever it *could* reach would be
  reachable by anyone who has it. Setting only that one leaves storage off, and
  the studio says so in Settings and at `/api/status`.

The three tables in `supabase.sql` have row level security on and no policies,
so the secret key (which bypasses RLS) is the only way in. Data is kept as
JSON, one row per record — readable in the table editor, and the same shape the
Redis-flavoured store used before.

## The workspace

The whole interface is in English; Vlipa itself answers in whatever language
you write to it in.

A company is the unit everything hangs off. Tasks, tables and meetings all
belong to one, and every request is checked against the caller's role in that
company before it touches anything.

- **Panel** — what is open, what is late, what is yours, and shortcuts.
- **Vlipa** — three tools under one name in the menu.
  - *Vlipa* asks and answers. Fast replies straight away; Think weighs the
    options first. Conversations stay in the browser.
  - *Vlipa Studio* is a small editor: files on the left, the open one in the
    middle, the assistant on the right. The project lives in the browser and
    travels as a zip — download it, upload one, keep working. Publishing puts it
    at `<name>.vlipa.dev` for seven days, after which it comes down on its own.
    For that address to resolve, the wildcard domain `*.vlipa.dev` has to be on
    the Vercel project; without it the same site is served at `/s/<name>/`.
  - *Vlipa Write* is the same bench with prose instead of code: the document on
    the left, one chat panel on the right, export through the browser's own
    print. Sources are a list you fill in — Vlipa cannot browse, so it cites
    those and nothing else and writes `[source needed]` where a citation would
    have to be invented. It also writes the daily and weekly report from the
    task board rather than from imagination.

  Which model each tool runs on is picked from a short list. The browser only
  ever names a list entry; the server decides what that means, so no request can
  call a model nobody chose.
- **Groups** — the team's own channels. Every company starts with one, and
  each group carries its own conversation and its own **voice room**: one
  button, camera off, everybody in that room hears each other. Messages arrive
  on their own — the page asks for new ones every few seconds while it is open,
  and stops the moment you go elsewhere.
- **Tasks** — a board across four columns, assignment, due dates, filters
  for all / open / mine. Vlipa works here too: **Plan with Vlipa** turns a
  goal into tasks with owners and dates, **Prepare it** writes the steps and
  the things to watch for, **Do it** writes the actual output — the announcement,
  the list, the draft — and leaves `[a blank]` wherever it would have to invent
  a fact.
- **Tables** — the company's own tables: name the columns, add rows, export
  CSV. Enough for a customer list or a stock count without a database. Vlipa
  can propose rows for the columns you defined.
- **Meetings** — video rooms, joined in place or in a new tab.
- **Team** — who is in, what each may do, invitation codes, role changes.
- **Settings** — rename the company, the invitation link, leave it, or close it
  down.

Nothing Vlipa proposes is saved on its own. Every suggestion arrives in a list
you edit and tick: tasks it invented an owner or a date for come back with
those fields empty, because only ids that exist in the team and dates that are
not in the past survive the check on the server.

### Roles

| Role | What it may do |
| --- | --- |
| **Owner** | Everything, including deleting the company and handing ownership on. |
| **Admin** | The team, tasks, tables, meetings. Cannot touch the owner or delete the company. |
| **Member** | Takes work, updates their own tasks, writes rows. |
| **Guest** | Reads. Nothing else. |

Nobody hands out a role above their own, only an owner makes an owner, and the
owner cannot be removed. Handing ownership on steps the old owner down to
admin in the same move.

The interface hides what a role cannot do, but that is a courtesy, not the
rule: `api/_lib/org.js` checks every request and refuses it there.

### Two ways in

**A code**, good for a fortnight, carrying the role its maker chose. Whoever
has it opens an account and joins with it. Codes can be revoked before use.

**A link**, `vlipa.dev/invite/elma`, which is the company's own name in the
address. Settings decides the name, whether the link is open at all, and which
role it grants. Closed is the default, and closing it again shuts the door on
everyone who has not used it yet.

A closed link and a name nobody has taken answer identically from outside, so
the page cannot be used to find out which companies exist. Somebody arriving
without an account is sent to sign up and lands back on the invitation
afterwards.

### Meetings and voice rooms

A meeting is a room with video; a group's voice room is the same thing with the
camera off and a trimmed toolbar. Both run on **Jitsi Meet**: free, no account, and it brings the TURN
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

### Signing in with Google

Optional, and off until it is configured. In Google Cloud → **Google Auth
Platform → Clients → Create client**, application type *Web application*:

| Field | Value |
| --- | --- |
| Authorized JavaScript origins | `https://vlipa.dev` |
| Authorized redirect URIs | `https://vlipa.dev/api/auth/google-callback` |

Put the client id and secret into Vercel's environment variables and redeploy.
They belong nowhere else: not in the repository, not in a `.env` that gets
uploaded, not in a screenshot. A secret that has been shown to anyone is reset
from the same screen it was made on.

What happens on a click: the server parks a random value in a ten-minute
`HttpOnly` cookie and sends the visitor to Google; Google sends them back with
a code; the server swaps that code for an id_token over its own TLS connection,
checks the audience, the issuer, the expiry and that the address is verified,
and only then opens a session. The browser never sees the secret, a mismatched
state is refused, and `?next=` is honoured only when it points at a path on
this site.

An address that already has a password account simply signs in — Google has
already proved the address belongs to them. A new one gets an account with a
random password, so the password form stays shut for it.

Still worth adding before this carries real traffic: email verification and
password reset.

## Limits in place

5 companies per person, 20 groups and 400 messages kept per group, 500 tasks
and 30 tables per company, 2000 rows per table, 16 columns per table, 40
meeting rooms, 30 group messages and 20 AI messages a minute per address.
