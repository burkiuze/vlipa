/* The panel Vlipa lives in, on the right of Studio and Write.

   One conversation, one box to type in, and a single row of controls under it:
   which model, how it should think, and whatever the page it sits in wants to
   add. Nothing else — the work is on the left. */

import { api } from './api.js';
import { $, clear, el, menu } from './dom.js';

export function parts(text) {
  const out = [];
  const fence = /```([a-zA-Z0-9+#./_-]*)\n?([\s\S]*?)```/g;
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

export async function modelsFor(tool) {
  const answer = await api(`/api/chat?tool=${tool}`).catch(() => ({ models: [] }));
  return answer.models || [];
}

/* `store` is the page's own state: it holds model, mode and turns, and the
   page decides where that is kept. */
export function agentPanel({ id, store, models, placeholder, starters = [], extras = [], onSend, render }) {
  const logId = `${id}Log`;

  const drawTurns = () => {
    const log = $(logId);
    if (!log) return;

    clear(log);

    if (!store.turns.length) {
      log.appendChild(el('div', { class: 'agentwelcome' }, [
        el('div', { class: 'agentstarters' }, starters.map((text) => el('button', {
          type: 'button', text, onclick: () => submit(text),
        }))),
      ]));
      return;
    }

    for (const turn of store.turns) {
      if (turn.role === 'user') {
        log.appendChild(el('div', { class: 'agentturn agentturn--me' }, [el('p', { text: turn.content })]));
        continue;
      }

      log.appendChild(el('div', { class: 'agentturn' },
        parts(turn.content).map((part) => (part.kind === 'code'
          ? render.code(part)
          : (render.text || ((prose) => el('p', { text: prose.body.trim() })))(part)))));
    }

    log.scrollTop = log.scrollHeight;
  };

  const submit = (text) => {
    const input = $(`${id}Ask`);
    const question = String(text ?? input?.value ?? '').trim();
    if (!question) return;

    if (input) { input.value = ''; input.style.height = 'auto'; }
    onSend(question, drawTurns);
  };

  const ask = el('textarea', {
    id: `${id}Ask`,
    rows: 2,
    placeholder,
    onkeydown: (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); }
    },
    oninput: (event) => {
      event.target.style.height = 'auto';
      event.target.style.height = `${Math.min(event.target.scrollHeight, 170)}px`;
    },
  });

  const panel = el('aside', { class: 'agent' }, [
    el('div', { class: 'agentlog', id: logId }),

    el('div', { class: 'agentsend' }, [
      el('div', { class: 'agentbox' }, [
        ask,
        el('div', { class: 'agentrow' }, [
          ...extras,

          menu({
            label: 'Model',
            value: store.model,
            options: models.map((model) => ({ id: model.id, label: model.label })),
            onPick: (picked) => { store.model = picked; store.save?.(); },
          }),

          el('div', { class: 'agentmodes' }, [['fast', 'Fast'], ['thinking', 'Think']].map(([mode, label]) => el('button', {
            type: 'button',
            text: label,
            'aria-pressed': String(store.mode === mode),
            onclick: (event) => {
              store.mode = mode;
              store.save?.();
              event.target.parentElement.querySelectorAll('button').forEach((button) => {
                button.setAttribute('aria-pressed', String(button === event.target));
              });
            },
          }))),

          el('span', { class: 'grow' }),

          el('button', {
            class: 'round round--send', type: 'button', title: 'Send',
            html: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12h13M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            onclick: () => submit(),
          }),
        ]),
      ]),
    ]),
  ]);

  return { panel, drawTurns, submit };
}
