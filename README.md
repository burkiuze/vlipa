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
| `CHAT_MODEL_FAST` | First model for Fast mode. Free fallbacks follow it. |
| `CHAT_MODEL_THINKING` | First model for Think mode. Free fallbacks follow it. |
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

Open **`/api/status?probe=1`** in a browser. It asks every configured model for
a single token and reports what came back, model by model, with the upstream
message. Anything that is not `ok: true` is the answer.

Each mode now carries a chain rather than one model: the configured one first,
then free fallbacks. A model that answers 400, 404 or 429 is skipped and the
next one takes the turn, so one retired id no longer takes the studio down.

## The studio

One page, one conversation, nothing above it: the mode switch, the voice call
and the clear button all sit in the composer, next to the box you type in.

- **Fast** answers straight away. **Think** takes the slower reasoning model
  and weighs the options before committing.
- **Voice call** is a conversation, not a toggle. Press it and the line opens:
  Vlipa listens, you stop talking, it answers out loud, then it listens again.
  "Sırayı bana ver" cuts it off mid-sentence and hands the turn back; Esc or
  "Bitir" hangs up. Everything said during the call also lands in the thread.
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

Tool calling runs in Fast mode only. Free reasoning models handle tool calls
unevenly, so Thinking mode answers from the conversation alone.

## Notes

- Free models carry the tightest rate limits on OpenRouter; a busy moment can
  come back as 429, and the studio says so plainly rather than hanging.
- The voice model and the OpenRouter audio endpoint were not reachable from the
  machine this was written on, so the speaking path is built to fall back to
  the browser voice rather than assuming the upstream is there. If your key has
  no access to that model, the fallback is what visitors will hear.
