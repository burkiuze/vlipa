/* The one place that talks to OpenRouter. The key never leaves the server. */

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export function hasKey() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export async function chat({ model, messages, temperature = 0.7, maxTokens = 2000, json = false }) {
  if (!hasKey()) {
    const error = new Error('OPENROUTER_API_KEY is not set on the server.');
    error.status = 503;
    throw error;
  }

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (json) body.response_format = { type: 'json_object' };

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'content-type': 'application/json',
      'HTTP-Referer': process.env.PUBLIC_URL || 'https://vlipa.dev',
      'X-Title': 'vlipa studio',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.error?.message || `Upstream error ${response.status}.`;
    const error = new Error(message);
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }

  return {
    text: data.choices?.[0]?.message?.content || '',
    usage: data.usage || null,
  };
}
