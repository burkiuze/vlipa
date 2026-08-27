/* Vlipa Write: a document, with Vlipa beside it.

   Same shape as Vlipa Studio — the work on the left, one chat panel on the
   right — because it is the same job with prose instead of code. Good for a
   piece of research, for the report a manager wants on Friday, and for the
   ordinary writing everybody has to do.

   About sources: Vlipa cannot browse. It cites what you put in the list and
   nothing else, and writes [source needed] where a citation would have to be
   invented. A made-up reference is worse than a gap. */

import { agentPanel, modelsFor } from './agent.js';
import { api, state } from './api.js';
import { $, clear, dialog, el, field, menu, toast } from './dom.js';

const KEY = 'vlipa.write';

const doc = {
  title: 'Untitled document',
  body: '',
  sources: [],
  model: 'vlipa',
  mode: 'fast',
  turns: [],
};

let models = [];
let busy = false;
let drawTurns = () => {};

function read() {
  try {
    Object.assign(doc, JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch { /* nothing worth keeping */ }

  if (!Array.isArray(doc.sources)) doc.sources = [];
  if (!Array.isArray(doc.turns)) doc.turns = [];
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...doc, turns: doc.turns.slice(-20) }));
  } catch { /* private mode */ }
}

function meta() {
  const node = $('writeMeta');
  if (!node) return;

  const count = doc.body.trim() ? doc.body.trim().split(/\s+/).length : 0;
  node.textContent = `${count} word${count === 1 ? '' : 's'} · ${doc.sources.length} source${doc.sources.length === 1 ? '' : 's'}`;
}

/* ---------- what comes back ---------- */

/* Every answer carries the two things you actually want to do with it. */
function answerBlock(part) {
  return el('figure', { class: 'writeblock' }, [
    el('pre', { class: 'writeblock__text', text: part.body.trim() }),
    el('figcaption', {}, [
      el('button', {
        type: 'button', text: 'Insert',
        onclick: () => {
          doc.body = `${doc.body.trim()}\n\n${part.body.trim()}`.trim();
          $('writeBody').value = doc.body;
          write();
          meta();
          toast('Added to the document.');
        },
      }),
      el('button', {
        type: 'button', text: 'Replace',
        onclick: () => {
          if (doc.body.trim() && !window.confirm('Replace everything in the document?')) return;
          doc.body = part.body.trim();
          $('writeBody').value = doc.body;
          write();
          meta();
        },
      }),
      el('button', {
        type: 'button', text: 'Copy',
        onclick: async (event) => {
          await navigator.clipboard.writeText(part.body.trim()).catch(() => {});
          event.target.textContent = 'Copied';
          setTimeout(() => { event.target.textContent = 'Copy'; }, 1400);
        },
      }),
    ]),
  ]);
}

/* Prose answers get the same buttons as fenced ones, since prose is the point
   here. */
function renderAnswer(part) {
  return answerBlock(part);
}

async function send(question, redraw, { kind = 'draft' } = {}) {
  if (busy) return;
  if (!state.company) return toast('Vlipa Write works inside a company.', 'bad');

  doc.turns.push({ role: 'user', content: question });
  doc.turns.push({ role: 'assistant', content: 'Writing…' });
  busy = true;
  redraw();

  try {
    const answer = await api('/api/assist', {
      method: 'POST',
      body: {
        action: 'write',
        companyId: state.companyId,
        kind,
        model: doc.model,
        mode: doc.mode,
        ask: question,
        document: doc.body,
        sources: doc.sources,
      },
    });

    doc.turns[doc.turns.length - 1] = { role: 'assistant', content: answer.text };
  } catch (error) {
    doc.turns[doc.turns.length - 1] = { role: 'assistant', content: error.message };
  } finally {
    busy = false;
    write();
    redraw();
  }
}

/* The report is written from the task board, not from imagination. */
async function report(period) {
  if (busy) return;
  if (!state.company) return toast('A report needs a company.', 'bad');

  doc.turns.push({ role: 'user', content: period === 'today' ? 'Write today\'s report from the task board.' : 'Write this week\'s report from the task board.' });
  doc.turns.push({ role: 'assistant', content: 'Reading the board…' });
  busy = true;
  drawTurns();

  try {
    const answer = await api('/api/assist', {
      method: 'POST',
      body: { action: 'report', companyId: state.companyId, model: doc.model, mode: doc.mode, period },
    });

    const heading = period === 'today' ? 'Daily report' : 'Weekly report';
    const when = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    doc.turns[doc.turns.length - 1] = { role: 'assistant', content: `${heading} — ${when}\n\n${answer.text}` };
    toast(`${answer.counted} tasks read.`);
  } catch (error) {
    doc.turns[doc.turns.length - 1] = { role: 'assistant', content: error.message };
    toast(error.message, 'bad');
  } finally {
    busy = false;
    write();
    drawTurns();
  }
}

/* ---------- sources ---------- */

function sources() {
  const list = el('div', { class: 'sourcelist' });

  const draw = () => {
    clear(list);

    if (!doc.sources.length) {
      list.appendChild(el('p', { class: 'muted', text: 'Nothing yet. Vlipa cites only what is here; anything else comes back as [source needed].' }));
      return;
    }

    doc.sources.forEach((source, index) => {
      list.appendChild(el('div', { class: 'source' }, [
        el('span', { class: 'source__n', text: `[${index + 1}]` }),
        el('div', { class: 'source__body' }, [
          el('b', { text: source.title }),
          source.url ? el('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer', text: source.url }) : null,
        ]),
        el('button', {
          class: 'ghostlink ghostlink--bad', type: 'button', text: '×',
          onclick: () => { doc.sources.splice(index, 1); write(); draw(); meta(); },
        }),
      ]));
    });
  };

  draw();

  const title = el('input', { placeholder: 'Title, author, page…', maxlength: 200 });
  const url = el('input', { placeholder: 'https://… (optional)', maxlength: 300 });

  dialog({
    title: 'Sources',
    confirm: 'Done',
    body: [
      el('p', { class: 'muted', text: 'What Vlipa is allowed to cite. It has no way to look anything up, so this list is the whole of what it knows.' }),
      field('Source', title),
      field('Link', url),
      el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', text: '+ Add source',
        onclick: () => {
          if (!title.value.trim()) return toast('A source needs a title.', 'bad');

          doc.sources.push({ title: title.value.trim().slice(0, 200), url: url.value.trim().slice(0, 300), note: '' });
          title.value = '';
          url.value = '';
          write();
          draw();
          meta();
        },
      }),
      list,
    ],
    onConfirm: async () => {},
  });
}

/* ---------- paper ---------- */

/* Printed through the browser, which is also how it becomes a PDF. Nothing is
   uploaded to make one. */
function print() {
  if (!doc.body.trim()) return toast('The document is empty.', 'bad');

  const paper = clear($('paper'));

  paper.appendChild(el('h1', { text: doc.title }));
  paper.appendChild(el('p', { class: 'paper__meta', text: `${state.company?.name || 'vlipa'} · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` }));

  for (const block of doc.body.split(/\n{2,}/)) {
    const line = block.trim();
    if (!line) continue;

    // A short line with no full stop reads as a heading.
    const heading = line.length < 80 && !/[.!?:]$/.test(line) && !line.includes('\n');
    paper.appendChild(el(heading ? 'h2' : 'p', { text: line }));
  }

  if (doc.sources.length) {
    paper.appendChild(el('h2', { text: 'Sources' }));

    doc.sources.forEach((source, index) => {
      paper.appendChild(el('p', { class: 'paper__source', text: `[${index + 1}] ${source.title}${source.url ? ` — ${source.url}` : ''}` }));
    });
  }

  window.print();
}

/* ---------- the page ---------- */

export async function show() {
  read();

  if (!models.length) models = await modelsFor('write');
  if (!models.some((model) => model.id === doc.model)) doc.model = models[0]?.id || 'vlipa';

  doc.save = write;

  const view = clear($('view'));

  // The two things that are not chat: what Vlipa may cite, and what kind of
  // writing to ask for. Both sit in the composer row rather than in a panel of
  // their own.
  const kinds = [
    { id: 'draft', label: 'Draft' },
    { id: 'continue', label: 'Continue' },
    { id: 'improve', label: 'Improve' },
    { id: 'outline', label: 'Outline' },
    { id: 'shorten', label: 'Shorten' },
    { id: 'report-today', label: "Today's report" },
    { id: 'report-week', label: "This week's report" },
  ];

  let kind = 'draft';

  const agent = agentPanel({
    id: 'write',
    store: doc,
    models,
    placeholder: 'Ask for a draft, a rewrite, or this week in one page…',
    starters: [
      'A one-page summary of this week for the client',
      'An announcement for the new price list',
      'Turn my notes into something I can send',
    ],
    extras: [
      menu({
        label: 'Draft',
        value: 'draft',
        options: kinds,
        className: 'pick--kind',
        onPick: (picked) => {
          if (!picked.startsWith('report-')) { kind = picked; return; }

          kind = 'draft';
          report(picked === 'report-today' ? 'today' : 'this week');
        },
      }),
      el('button', { class: 'chip', type: 'button', text: 'Sources', onclick: sources }),
    ],
    render: { code: renderAnswer, text: renderAnswer },
    onSend: (question, redraw) => send(question, redraw, { kind }),
  });

  drawTurns = agent.drawTurns;

  const body = el('textarea', {
    id: 'writeBody',
    class: 'writebody',
    placeholder: 'Start writing, or ask Vlipa on the right.',
    oninput: (event) => { doc.body = event.target.value; write(); meta(); },
  }, [doc.body]);

  view.appendChild(el('div', { class: 'workbench' }, [
    el('header', { class: 'codebar' }, [
      el('div', { class: 'codebar__name' }, [
        el('input', {
          class: 'writetitle', value: doc.title, maxlength: 120,
          oninput: (event) => { doc.title = event.target.value; write(); },
        }),
        el('span', { id: 'writeMeta', text: '' }),
      ]),

      el('div', { class: 'codebar__right' }, [
        el('button', { class: 'chip', type: 'button', text: 'Sources', onclick: sources }),
        el('button', { class: 'btn btn--sm', type: 'button', text: 'Export PDF', onclick: print }),
      ]),
    ]),

    el('div', { class: 'codebody codebody--doc' }, [
      el('section', { class: 'writepage' }, [body]),
      agent.panel,
    ]),
  ]));

  view.appendChild(el('article', { class: 'paper', id: 'paper' }));

  agent.drawTurns();
  meta();
}

export function leave() {}
