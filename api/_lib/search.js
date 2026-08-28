/* Looking something up, for an assistant that otherwise cannot.

   Until now Vlipa answered every question out of what the model already knew,
   and said so when it did not — which is honest and, for a whole class of
   question, useless. "Find me the contact addresses for these companies" came
   back as a list of company names, because that is all a model has without
   something to read.

   This is that something. Tavily returns short, quoted extracts with the URL
   they came from, which is the shape an assistant can actually cite rather
   than launder into a confident-sounding guess.

   Nothing here runs unless TAVILY_API_KEY is set. A deployment without it
   behaves exactly as before: the assistant is never offered the tool, so it
   cannot claim to have looked. */

const ENDPOINT = process.env.TAVILY_BASE_URL || 'https://api.tavily.com/search';

/* Enough to answer with, not enough to bury the model. Five extracts is
   roughly a screen of reading; twenty is a context window spent on one
   question. */
const MAX_RESULTS = 5;
const MAX_CHARS = 700;

/* One search costs money and takes a second, so a single turn does not get to
   run twenty of them. */
const MAX_PER_TURN = 4;

export function searchReady() {
  return Boolean(process.env.TAVILY_API_KEY);
}

export async function webSearch(query, { max = MAX_RESULTS } = {}) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: String(query).slice(0, 400),
      max_results: Math.min(Math.max(1, max), 10),
      search_depth: 'basic',
      include_answer: true,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);

    const error = new Error(response.status === 401
      ? 'The Tavily key is invalid or expired (401).'
      : response.status === 429
        ? 'Tavily is rate-limiting or out of credit (429).'
        : `Tavily answered ${response.status}.`);

    error.status = response.status;
    error.detail = detail;
    throw error;
  }

  const data = await response.json();

  return {
    answer: String(data?.answer || '').slice(0, MAX_CHARS),
    results: (data?.results || []).slice(0, max).map((one) => ({
      title: String(one?.title || '').slice(0, 160),
      url: String(one?.url || '').slice(0, 300),
      content: String(one?.content || '').slice(0, MAX_CHARS),
    })),
  };
}

/* What the model sees. Extracts are handed over as text with their addresses
   attached, so a claim in an answer can be traced to the page it came from —
   and so the model has something to quote instead of something to invent. */
function asText({ answer, results }) {
  if (!results.length) return 'Nothing came back for that. Try different words, or say plainly that you could not find it.';

  const lines = results.map((one, at) => `[${at + 1}] ${one.title}\n${one.url}\n${one.content}`);
  return (answer ? `Summary: ${answer}\n\n` : '') + lines.join('\n\n');
}

export function searchTools() {
  let used = 0;
  const asked = [];

  const definitions = [{
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Look something up on the web and read what comes back. Use this whenever the answer depends on '
        + 'something you cannot know from memory: a current price, an address or contact detail, who runs a '
        + 'company now, what happened recently, or anything the person implies is live. '
        + 'Search in the language the answer is most likely written in, not necessarily the language you are '
        + 'replying in. One focused query beats a broad one; search again with different words if the first '
        + 'set of extracts does not answer it. '
        + 'Only state what the extracts actually say — if they do not contain the answer, say so plainly '
        + 'rather than filling the gap from memory.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to search for, as you would type it into a search box.',
          },
        },
        required: ['query'],
      },
    },
  }];

  async function run(name, args) {
    if (name !== 'web_search') return `There is no tool called ${name}.`;

    const query = String(args?.query || '').trim();
    if (!query) return 'A search needs something to search for.';

    if (used >= MAX_PER_TURN) {
      return `That is ${MAX_PER_TURN} searches for one question, which is the limit. `
        + 'Answer with what you have, and say which part you could not confirm.';
    }

    used += 1;
    asked.push(query);

    try {
      return asText(await webSearch(query));
    } catch (error) {
      // A failed search is a fact the model should work around, not a crash.
      return `The search did not run: ${error.message} Answer from what you know, and say that you could not check.`;
    }
  }

  return { definitions, run, queries: () => [...asked] };
}

/* Several toolsets offered at once — the page guide and the search, say —
   behind one object of the shape chatCompletion expects. */
export function mergeTools(...sets) {
  const live = sets.filter(Boolean);
  if (live.length < 2) return live[0] || null;

  return {
    definitions: live.flatMap((set) => set.definitions),
    run: (name, args) => {
      const owner = live.find((set) => set.definitions.some((one) => one.function.name === name));
      return owner ? owner.run(name, args) : Promise.resolve(`There is no tool called ${name}.`);
    },
  };
}
