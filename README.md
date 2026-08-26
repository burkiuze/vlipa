# vlipa

The vlipa site and **Vlipa**, the studio's own assistant. Static pages plus a
few serverless functions. No framework, no build step, no dependencies.

```
index.html              the public site
studio.html             the studio: one conversation with Vlipa
api/chat.js             text conversation
api/voice.js            Vlipa speaking (text to speech)
api/status.js           what the studio can offer right now
api/_lib/               server-only: persona, tools, OpenRouter client, helpers
assets/js/studio.js     the studio client (typing, microphone, playback)
assets/css/             styles for the site and the studio
dev.js                  local server: node dev.js
```

## Deploying to Vercel

1. Push and import the repository. Nothing to configure: the root is served
   statically and `api/` becomes functions.
2. Add the environment variables below (Settings → Environment Variables).
3. Redeploy.

| Name | What it is |
| --- | --- |
| `OPENROUTER_API_KEY` | **Required.** Stays on the server; no browser ever sees it. |
| `CHAT_MODEL_FAST` | The model both modes run on. Default `z-ai/glm-5.2:free`. |
| `CHAT_MODEL_THINKING` | A different model for Think mode, if you want one. Falls back to the above. |
| `CHAT_MODEL_FALLBACKS` | Optional, comma separated. Tried in order if the model above refuses. Empty by default: an unasked-for model is a bill. |
| `TTS_MODEL` | Voice. Default `fish-audio/s2.1-pro-free:free`. |
| `PUBLIC_URL` | The address OpenRouter sees as the referer. |

Never commit `.env`. Keys posted to a repository get scraped within minutes,
and a key that has ever been committed stays in the history even after the
file is deleted. Put a spend limit on the key in the OpenRouter dashboard:
free models cost nothing, but a request aimed at a paid model bills you.

## Running it locally

```bash
OPENROUTER_API_KEY=sk-or-... node dev.js     # http://localhost:3000
```

`dev.js` serves the pages and runs the functions the way Vercel does. Without
the key the studio loads, says it is not connected, and every other part of the
page still works.

## When Vlipa keeps giving the same answer

That is almost never the model repeating itself. It is the same error text
coming back every time, usually because the configured model id no longer
exists on OpenRouter, the key has no access to it, or the free tier is rate
limiting.

A failed turn now says why underneath the message: which status came back, what
it means, and which models were tried. `/api/status?probe=1` gives the same
picture for every configured model at once — it asks each one for a single
token and reports what came back. Anything that is not `ok: true` is the answer.

The usual culprits:

| What you see | What it means |
| --- | --- |
| 401 | The key is wrong or was revoked. |
| 402 | The OpenRouter account needs credit. |
| 403 / 404 with "data policy" or "no endpoints" | Free models are switched off for the account. OpenRouter → Settings → Privacy, allow the free-model data policy, then retry. |
| 404 | That model id no longer exists. |
| 429 | The free tier's quota for the moment. |

Keys are scrubbed out of anything that travels back to a browser.

Only the configured model is ever called. Both modes run on
`CHAT_MODEL_FAST` (`z-ai/glm-5.2:free` by default) — what changes between Fast
and Think is how the model is asked, not which model answers. Extra models are
tried only if `CHAT_MODEL_FALLBACKS` names them, because a model nobody asked
for is a model nobody agreed to pay for.

## The studio

One page, one conversation, nothing above it: the mode switch, the voice call
and the clear button all sit in the composer, next to the box you type in.

- **Fast** answers straight away: short, direct, tight token budget. **Think**
  gets twice the room and is told to weigh the options before committing. Same
  free model behind both, asked differently.
- **Voice call** is a conversation, not a toggle. Press it and the line opens:
  Vlipa listens, you stop talking, it answers out loud, then it listens again.
  The microphone stays open the whole time, so **starting to speak takes the
  turn back on its own** — it stops mid-sentence, with no button to press. Esc
  or "Bitir" hangs up, and everything said during the call lands in the thread.
- An open microphone also hears Vlipa through the speakers, so a phrase that
  mostly matches what is being said out loud is treated as echo and ignored,
  along with the first moments of playback and anything a few characters long.
- The microphone next to the box is for dictation instead: it types what you
  say into the composer and sends it.
- **Bars move with the voice.** While Vlipa speaks, the audio is routed through
  an AnalyserNode and the bars follow the actual signal. The browser's own
  voice exposes no signal, so there the bars animate on a timer instead.
- **Conversations are kept**, listed down the left, restored on the next visit.
  They live in this browser's localStorage: not on the server, not in an
  account, and only on the machine they were typed on.
- Speech recognition is the browser's Web Speech API, so no audio is uploaded.
  Replies come back as audio from the server; when that voice is unreachable
  the page reads them out with the browser's own speech synthesis, so speaking
  degrades instead of breaking.
- The transcript lives in the browser and travels with each request, so the
  server keeps nothing between turns and there is nothing to store or leak.
- Rate limits: 20 messages a minute for text, 12 for voice, per address.

### Vlipa's identity

`api/_lib/persona.js` holds the system prompt. It keeps the assistant
introducing itself as Vlipa and refusing to name the model or provider
underneath, in whatever language the visitor writes.

`api/_lib/tools.js` gives it two things it can actually look up: the current
time in İstanbul, and facts about the studio (services, process, principles,
stack). To add a capability, describe it there and handle it in `executeTool`;
the model decides on its own when to call it.

Tool calling runs in both modes.

## Notes

- Free models carry the tightest rate limits on OpenRouter; a busy moment can
  come back as 429, and the studio says so plainly rather than hanging.
- The voice model and the OpenRouter audio endpoint were not reachable from the
  machine this was written on, so the speaking path is built to fall back to
  the browser voice rather than assuming the upstream is there. If your key has
  no access to that model, the fallback is what visitors will hear.
