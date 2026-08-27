/* Vlipa Write: documents and reports.

   The document on the left, Vlipa on the right, sources underneath it. What
   the panel writes lands in the document only when you put it there.

   About sources: Vlipa cannot browse. It cites what you put in the list and
   nothing else, and writes [source needed] where a citation would have to be
   invented. That is deliberate — a made-up citation is worse than a gap. */

import { api, state } from './api.js';
import { $, clear, el, toast } from './dom.js';

const KEY = 'vlipa.write';

const doc = {
  title: 'Untitled document',
  body: '',
  sources: [],
  model: 'vlipa',
};

let models = [];
let busy = false;
let lastAnswer = '';

function read() {
  try {
    Object.assign(doc, JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch { /* nothing worth keeping */ }

  if (!Array.isArray(doc.sources)) doc.sources = [];
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch { /* private mode */ }
}

function words() {
  const count = doc.body.trim() ? doc.body.trim().split(/\s+/).length : 0;
  return `${count} word${count === 1 ? '' : 's'}`;
}

function refreshMeta() {
  const meta = $('writeMeta');
  if (meta) meta.textContent = `${words()} · ${doc.sources.length} source${doc.sources.length === 1 ? '' : 's'}`;
}

/* ---------- the panel ---------- */

function answerBox() {
  const box = clear($('writeOut'));

  if (busy) {
    box.appendChild(el('p', { class: 'muted', text: 'Vlipa is writing…' }));
    return;
  }

  if (!lastAnswer) {
    box.appendChild(el('p', { class: 'muted', text: 'Ask for a draft, a continuation or today\'s report. Nothing reaches the document until you put it there.' }));
    return;
  }

  box.appendChild(el('div', { class: 'writeout__text', text: lastAnswer }));

  box.appendChild(el('div', { class: 'writeout__acts' }, [
    el('button', {
      class: 'btn btn--sm', type: 'button', text: 'Insert at the end',
      onclick: () => {
        doc.body = `${doc.body.trim()}\n\n${lastAnswer}`.trim();
        $('writeBody').value = doc.body;
        write();
        refreshMeta();
        toast('Added to the document.');
      },
    }),
    el('button', {
      class: 'btn btn--ghost btn--sm', type: 'button', text: 'Replace the document',
      onclick: () => {
        if (doc.body.trim() && !window.confirm('Replace everything in the document?')) return;
        doc.body = lastAnswer;
        $('writeBody').value = doc.body;
        write();
        refreshMeta();
      },
    }),
    el('button', {
      class: 'ghostlink', type: 'button', text: 'Copy',
      onclick: () => { navigator.clipboard?.writeText(lastAnswer); toast('Copied.'); },
    }),
  ]));
}

async function ask(kind) {
  if (busy) return;
  if (!state.company) return toast('Vlipa Write works inside a company.', 'bad');

  busy = true;
  answerBox();

  try {
    const answer = await api('/api/assist', {
      method: 'POST',
      body: {
        action: 'write',
        companyId: state.companyId,
        kind,
        model: doc.model,
        ask: $('writeAsk').value,
        document: doc.body,
        sources: doc.sources,
      },
    });

    lastAnswer = answer.text;
  } catch (error) {
    lastAnswer = '';
    toast(error.message, 'bad');
  } finally {
    busy = false;
    answerBox();
  }
}

/* Today's report, written from the company's own tasks rather than from
   anything the model imagines. */
async function report(period) {
  if (busy) return;
  if (!state.company) return toast('A report needs a company.', 'bad');

  busy = true;
  answerBox();

  try {
    const answer = await api('/api/assist', {
      method: 'POST',
      body: { action: 'report', companyId: state.companyId, model: doc.model, period },
    });

    lastAnswer = `${period === 'today' ? 'Daily report' : 'Report'} — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}\n\n${answer.text}`;
    toast(`${answer.counted} tasks read.`);
  } catch (error) {
    lastAnswer = '';
    toast(error.message, 'bad');
  } finally {
    busy = false;
    answerBox();
  }
}

/* ---------- sources ---------- */

function drawSources() {
  const list = clear($('writeSources'));

  if (!doc.sources.length) {
    list.appendChild(el('p', { class: 'muted', text: 'No sources yet. Vlipa cites only what is here — everything else comes back as [source needed].' }));
    return;
  }

  doc.sources.forEach((source, index) => {
    list.appendChild(el('div', { class: 'source' }, [
      el('span', { class: 'source__n', text: `[${index + 1}]` }),
      el('div', { class: 'source__body' }, [
        el('b', { text: source.title }),
        source.url ? el('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer', text: source.url }) : null,
        source.note ? el('span', { text: source.note }) : null,
      ]),
      el('button', {
        class: 'ghostlink ghostlink--bad', type: 'button', text: '×',
        onclick: () => { doc.sources.splice(index, 1); write(); drawSources(); refreshMeta(); },
      }),
    ]));
  });
}

function addSource() {
  const title = $('srcTitle');
  const url = $('srcUrl');

  if (!title.value.trim()) return toast('A source needs a title.', 'bad');

  doc.sources.push({
    title: title.value.trim().slice(0, 200),
    url: url.value.trim().slice(0, 300),
    note: '',
  });

  title.value = '';
  url.value = '';
  write();
  drawSources();
  refreshMeta();
}

/* ---------- paper ---------- */

/* The document is printed through the browser, which is also how it becomes a
   PDF. Nothing is uploaded to make one. */
function toPaper() {
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
}

function print() {
  if (!doc.body.trim()) return toast('The document is empty.', 'bad');
  toPaper();
  window.print();
}

/* ---------- the page ---------- */

export async function show() {
  read();

  if (!models.length) {
    models = (await api('/api/chat?tool=write').catch(() => ({ models: [] }))).models || [];
  }

  const view = clear($('view'));

  const title = el('input', {
    class: 'writetitle', value: doc.title, maxlength: 120,
    oninput: (event) => { doc.title = event.target.value; write(); },
  });

  const body = el('textarea', {
    id: 'writeBody',
    class: 'writebody',
    placeholder: 'Start writing, or ask Vlipa for a draft on the right.',
    oninput: (event) => { doc.body = event.target.value; write(); refreshMeta(); },
  }, [doc.body]);

  view.appendChild(el('div', { class: 'writewrap' }, [
    el('section', { class: 'writedoc' }, [
      el('div', { class: 'writedoc__head' }, [
        title,
        el('div', { class: 'writedoc__meta' }, [
          el('span', { id: 'writeMeta', text: '' }),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Export PDF', onclick: print }),
        ]),
      ]),
      body,
    ]),

    el('aside', { class: 'writeside' }, [
      el('div', { class: 'writeside__head' }, [
        el('b', { text: 'Vlipa Write' }),
        el('select', {
          class: 'writepick',
          onchange: (event) => { doc.model = event.target.value; write(); },
        }, models.map((model) => el('option', {
          value: model.id, selected: doc.model === model.id, text: model.label,
        }))),
      ]),

      el('textarea', {
        id: 'writeAsk',
        class: 'writeask',
        rows: 3,
        placeholder: 'What should it write? "A one-page summary of this week for the client", "an announcement for the new price list"…',
      }),

      el('div', { class: 'writeacts' }, [
        el('button', { class: 'btn btn--sm', type: 'button', text: 'Draft', onclick: () => ask('draft') }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Continue', onclick: () => ask('continue') }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Improve', onclick: () => ask('improve') }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Outline', onclick: () => ask('outline') }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Shorten', onclick: () => ask('shorten') }),
      ]),

      el('div', { class: 'writereport' }, [
        el('b', { text: 'From the company\'s own work' }),
        el('span', { class: 'muted', text: 'Reads the task board and writes what actually happened. No invented figures.' }),
        el('div', { class: 'spread' }, [
          el('button', { class: 'btn btn--ai btn--sm', type: 'button', text: '✦ Daily report', onclick: () => report('today') }),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'This week', onclick: () => report('this week') }),
        ]),
      ]),

      el('div', { class: 'writeout', id: 'writeOut' }),

      el('div', { class: 'writesources' }, [
        el('b', { text: 'Sources' }),
        el('div', { class: 'sourceform' }, [
          el('input', { id: 'srcTitle', placeholder: 'Title, author, page…', maxlength: 200 }),
          el('input', { id: 'srcUrl', placeholder: 'https://… (optional)', maxlength: 300 }),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Add', onclick: addSource }),
        ]),
        el('div', { id: 'writeSources' }),
      ]),
    ]),
  ]));

  // Where the printed version is built, off screen until it is printed.
  view.appendChild(el('article', { class: 'paper', id: 'paper' }));

  drawSources();
  answerBox();
  refreshMeta();
}
