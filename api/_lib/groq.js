/* Groq, for the one model that runs there.

   Groq speaks the OpenAI chat-completions shape, so this is a thin call rather
   than a second client. The key stays on the server like every other one, and
   nothing here is reachable unless GROQ_API_KEY is set.

   The model id is configurable because provider catalogues move: if Groq
   renames it, GROQ_MODEL changes and nothing else does. */

const BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'qwen/qwen-3.8-27b';

export function groqReady() {
  return Boolean(process.env.GROQ_API_KEY);
}

export function groqModel() {
  return process.env.GROQ_MODEL || DEFAULT_MODEL;
}

export async function groqCompletion({ messages, temperature = 0.6, maxTokens = 1600 }) {
  if (!groqReady()) {
    const error = new Error('Qwen is not connected: GROQ_API_KEY is not set on the server.');
    error.status = 503;
    throw error;
  }

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: groqModel(),
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 400);

    const error = new Error(response.status === 404
      ? `Groq does not know the model "${groqModel()}". Set GROQ_MODEL to the id Groq lists.`
      : `Groq answered ${response.status}.`);

    error.status = response.status;
    error.detail = detail;
    error.reason = detail.slice(0, 200);
    throw error;
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;

  if (!text) {
    const error = new Error('Qwen came back with nothing.');
    error.status = 502;
    throw error;
  }

  // Some reasoning models narrate before answering; the narration is not the
  // answer.
  return String(text).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
