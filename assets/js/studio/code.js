/* Vlipa Studio: the code side of the assistant.

   Dark on purpose — this is the panel you keep open next to an editor. A
   question in, an answer out, with whatever code it produced separated from
   the prose so it can be copied without the commentary. */

import { api, state } from './api.js';
import { $, clear, el, toast } from './dom.js';

const KEY = 'vlipa.code';

const store = {
  model: 'vlipa',
  mode: 'fast',
  turns: [],
};

let models = [];
let busy = false;

function read() {
  try {
    Object.assign(store, JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch { /* a broken note is not worth keeping */ }

  if (!Array.isArray(store.turns)) store.turns = [];
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...store, turns: store.turns.slice(-24) }));
  } catch { /* private mode, nothing to do */ }
}

/* Fenced blocks become their own panel; everything else stays prose. */
function parts(text) {
  const out = [];
  const fence = /```([a-zA-Z0-9+#.-]*)\n?([\s\S]*?)```/g;
  let at = 0;
  let found;

  while ((found = fence.exec(text))) {
    if (found.index > at) out.push({ kind: 'text', body: text.slice(at, found.index) });
    out.push({ kind: 'code', lang: found[1] || '', body: found[2].replace(/\n$/, '') });
    at = found.index + found[0].length;
  }

  if (at < text.length) out.push({ kind: 'text', body: text.slice(at) });
  return out.filter((part) => part.body.trim());
}

function codeBlock(part) {
  return el('figure', { class: 'codeblock' }, [
    el('figcaption', {}, [
      el('span', { text: part.lang || 'code' }),
      el('button', {
        class: 'codeblock__copy', type: 'button', text: 'Copy',
        onclick: async (event) => {
          try {
            await navigator.clipboard.writeText(part.body);
            event.target.textContent = 'Copied';
            setTimeout(() => { event.target.textContent = 'Copy'; }, 1400);
          } catch {
            toast('The browser would not let go of the clipboard.', 'bad');
          }
        },
      }),
    ]),
    el('pre', {}, [el('code', { text: part.body })]),
  ]);
}

function drawTurns() {
  const log = $('codeLog');
  if (!log) return;

  clear(log);

  if (!store.turns.length) {
    log.appendChild(el('div', { class: 'codewelcome' }, [
      el('h2', { text: 'Vlipa Studio' }),
      el('p', { text: 'Paste in an error, an unfamiliar file, a function you want rewritten. Code comes back in its own block, ready to copy.' }),
      el('div', { class: 'codestarters' }, [
        'Explain this stack trace and what to change',
        'Write a Postgres query for monthly revenue per customer',
        'Turn this callback code into async/await',
      ].map((text) => el('button', { type: 'button', text, onclick: () => send(text) }))),
    ]));
    return;
  }

  for (const turn of store.turns) {
    if (turn.role === 'user') {
      log.appendChild(el('div', { class: 'codeturn codeturn--me' }, [el('pre', { text: turn.content })]));
      continue;
    }

    log.appendChild(el('div', { class: 'codeturn' },
      parts(turn.content).map((part) => (part.kind === 'code'
        ? codeBlock(part)
        : el('p', { text: part.body.trim() })))));
  }

  log.scrollTop = log.scrollHeight;
}

async function send(text) {
  const input = $('codeInput');
  const question = String(text ?? input?.value ?? '').trim();

  if (!question || busy) return;
  if (input) { input.value = ''; input.style.height = 'auto'; }

  store.turns.push({ role: 'user', content: question });
  store.turns.push({ role: 'assistant', content: '…' });
  busy = true;
  drawTurns();

  try {
    const answer = await api('/api/chat', {
      method: 'POST',
      body: {
        tool: 'code',
        model: store.model,
        mode: store.mode,
        message: question,
        history: store.turns.slice(0, -2).slice(-8),
      },
    });

    store.turns[store.turns.length - 1] = { role: 'assistant', content: answer.reply };
  } catch (error) {
    store.turns[store.turns.length - 1] = {
      role: 'assistant',
      content: `${error.message}${error.reason ? `\n\n${error.reason}` : ''}`,
    };
  } finally {
    busy = false;
    write();
    drawTurns();
  }
}

function bar() {
  return el('header', { class: 'codebar' }, [
    el('div', { class: 'codebar__name' }, [
      el('span', { class: 'codebar__dot' }),
      el('b', { text: 'Vlipa Studio' }),
      el('span', { text: state.company ? state.company.name : 'no company' }),
    ]),

    el('div', { class: 'codebar__right' }, [
      el('select', {
        class: 'codepick',
        onchange: (event) => { store.model = event.target.value; write(); },
      }, models.map((model) => el('option', {
        value: model.id, selected: store.model === model.id, text: model.label,
      }))),

      el('div', { class: 'codemodes' }, [['fast', 'Fast'], ['thinking', 'Think']].map(([mode, label]) => el('button', {
        type: 'button',
        text: label,
        'aria-pressed': String(store.mode === mode),
        onclick: (event) => {
          store.mode = mode;
          write();
          event.target.parentElement.querySelectorAll('button').forEach((button) => {
            button.setAttribute('aria-pressed', String(button === event.target));
          });
        },
      }))),

      el('button', {
        class: 'codebar__clear', type: 'button', text: 'Clear',
        onclick: () => { store.turns = []; write(); drawTurns(); },
      }),
    ]),
  ]);
}

export async function show() {
  read();

  if (!models.length) {
    models = (await api('/api/chat?tool=code').catch(() => ({ models: [] }))).models || [];
  }

  const view = clear($('view'));
  view.classList.add('view--dark');

  const input = el('textarea', {
    id: 'codeInput',
    rows: 1,
    placeholder: 'Ask about code, paste an error, describe what you want built…',
    onkeydown: (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send(); }
    },
    oninput: (event) => {
      event.target.style.height = 'auto';
      event.target.style.height = `${Math.min(event.target.scrollHeight, 200)}px`;
    },
  });

  view.appendChild(el('div', { class: 'codeshell' }, [
    bar(),
    el('div', { class: 'codelog', id: 'codeLog' }),
    el('div', { class: 'codesend' }, [
      input,
      el('div', { class: 'codesend__row' }, [
        el('span', { text: 'Ctrl/⌘ + Enter sends' }),
        el('button', { class: 'btn btn--sm', type: 'button', text: 'Send', onclick: () => send() }),
      ]),
    ]),
  ]));

  drawTurns();
  input.focus();
}

/* The dark theme belongs to this page only. */
export function leave() {
  $('view')?.classList.remove('view--dark');
}
