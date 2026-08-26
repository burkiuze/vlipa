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
| `CHAT_MODEL_FAST` | Model behind Fast mode. Default `z-ai/glm-5.2:free`. |
| `CHAT_MODEL_THINKING` | Model behind Thinking mode. Default `deepseek/deepseek-r1:free`. |
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
