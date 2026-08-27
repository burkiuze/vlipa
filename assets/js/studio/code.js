/* Vlipa Studio: a small editor with the assistant beside it.

   Files on the left, the one you are editing in the middle, Vlipa on the
   right. The project lives in this browser — nothing is kept on the server
   until you publish it — and it travels as a zip.

   Publishing puts the files at <name>.vlipa.dev for a week, then they go. */

import { agentPanel, modelsFor } from './agent.js';
import { api } from './api.js';
import { $, clear, dialog, el, field, toast } from './dom.js';

const KEY = 'vlipa.code';

const START = [
  {
    path: 'index.html',
    text: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>New site</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main>
    <h1>Hello</h1>
    <p>Ask Vlipa on the right to build this into something.</p>
  </main>
  <script src="script.js"></script>
</body>
</html>
`,
  },
  {
    path: 'styles.css',
    text: `body {
  margin: 0;
  font: 16px/1.6 -apple-system, Segoe UI, Roboto, sans-serif;
  color: #14142b;
}

main { max-width: 42rem; margin: 12vh auto; padding: 0 24px; }
h1 { font-size: 2.2rem; letter-spacing: -.02em; }
`,
  },
  {
    path: 'script.js',
    text: `document.addEventListener('DOMContentLoaded', () => {
  console.log('ready');
});
`,
  },
];

const project = {
  files: [],
  active: 'index.html',
  model: 'vlipa',
  mode: 'fast',
  turns: [],
  site: '',
};

let models = [];
let busy = false;
let drawTurns = () => {};

function read() {
  try {
    Object.assign(project, JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch { /* a broken note is not worth keeping */ }

  if (!Array.isArray(project.files) || !project.files.length) project.files = START.map((file) => ({ ...file }));
  if (!Array.isArray(project.turns)) project.turns = [];
  if (!project.files.some((file) => file.path === project.active)) project.active = project.files[0].path;
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...project, turns: project.turns.slice(-20) }));
  } catch { /* private mode, or a project too big to remember */ }
}

function current() {
  return project.files.find((file) => file.path === project.active) || project.files[0];
}

function languageOf(path) {
  const extension = String(path).split('.').pop().toLowerCase();
  return { js: 'JS', mjs: 'JS', ts: 'TS', jsx: 'JSX', tsx: 'TSX', html: 'HTML', htm: 'HTML', css: 'CSS', json: 'JSON', md: 'MD', py: 'PY', sql: 'SQL' }[extension] || 'TXT';
}

/* ---------- the file rail ---------- */

function drawFiles() {
  const rail = clear($('codeFiles'));

  for (const file of [...project.files].sort((a, b) => a.path.localeCompare(b.path))) {
    rail.appendChild(el('button', {
      type: 'button',
      class: `filerow${file.path === project.active ? ' is-on' : ''}`,
      title: file.path,
      onclick: () => { project.active = file.path; write(); drawEditor(); drawFiles(); },
    }, [
      el('span', { class: 'filerow__kind', text: languageOf(file.path) }),
      el('span', { class: 'filerow__name', text: file.path }),
    ]));
  }
}

function newFile() {
  dialog({
    title: 'New file',
    confirm: 'Create',
    body: [field('Path', el('input', { name: 'path', required: true, maxlength: 200, placeholder: 'src/app.js' }),
      'Folders are part of the name: src/app.js makes the folder too.')],
    onConfirm: async (data) => {
      const path = String(data.get('path')).replace(/^\/+/, '').trim();
      if (!path) throw new Error('A file needs a name.');
      if (project.files.some((file) => file.path === path)) throw new Error('There is already a file by that name.');

      project.files.push({ path, text: '' });
      project.active = path;
      write();
      drawFiles();
      drawEditor();
      drawBar();
    },
  });
}

function dropFile() {
  const file = current();
  if (project.files.length === 1) return toast('A project keeps at least one file.', 'bad');
  if (!window.confirm(`Delete ${file.path}?`)) return;

  project.files = project.files.filter((other) => other.path !== file.path);
  project.active = project.files[0].path;
  write();
  drawFiles();
  drawEditor();
  drawBar();
}

/* ---------- the editor ---------- */

function drawEditor() {
  const host = clear($('codeEditor'));
  const file = current();

  const gutter = el('div', { class: 'gutter', id: 'codeGutter' });

  const area = el('textarea', {
    class: 'editor',
    id: 'codeArea',
    spellcheck: 'false',
    value: file.text,
    oninput: (event) => {
      file.text = event.target.value;
      write();
      numbers();
    },
    onscroll: (event) => { gutter.scrollTop = event.target.scrollTop; },
    onkeydown: (event) => {
      // Tab belongs in the file, not on the next control.
      if (event.key !== 'Tab') return;
      event.preventDefault();

      const at = event.target.selectionStart;
      const end = event.target.selectionEnd;
      event.target.value = `${event.target.value.slice(0, at)}  ${event.target.value.slice(end)}`;
      event.target.selectionStart = event.target.selectionEnd = at + 2;
      file.text = event.target.value;
      write();
      numbers();
    },
  });

  const numbers = () => {
    const lines = file.text.split('\n').length;
    clear(gutter);
    for (let line = 1; line <= lines; line += 1) gutter.appendChild(el('span', { text: String(line) }));
  };

  host.appendChild(el('div', { class: 'editorhead' }, [
    el('span', { class: 'editorhead__kind', text: languageOf(file.path) }),
    el('b', { text: file.path }),
    el('span', { class: 'grow' }),
    el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Delete file', onclick: dropFile }),
  ]));

  host.appendChild(el('div', { class: 'editorwrap' }, [gutter, area]));
  numbers();
}

/* ---------- the assistant ---------- */

function codeBlock(part) {
  return el('figure', { class: 'codeblock' }, [
    el('figcaption', {}, [
      el('span', { text: part.lang || 'code' }),
      el('div', { class: 'codeblock__acts' }, [
        el('button', {
          type: 'button', text: 'Into this file',
          onclick: () => {
            const file = current();
            file.text = part.body;
            write();
            drawEditor();
            toast(`${file.path} replaced.`);
          },
        }),
        el('button', {
          type: 'button', text: 'Copy',
          onclick: async (event) => {
            await navigator.clipboard.writeText(part.body).catch(() => {});
            event.target.textContent = 'Copied';
            setTimeout(() => { event.target.textContent = 'Copy'; }, 1400);
          },
        }),
      ]),
    ]),
    el('pre', {}, [el('code', { text: part.body })]),
  ]);
}

async function send(question, redraw) {
  if (busy) return;

  const file = current();

  project.turns.push({ role: 'user', content: question });
  project.turns.push({ role: 'assistant', content: 'Thinking…' });
  busy = true;
  redraw();

  try {
    const answer = await api('/api/chat', {
      method: 'POST',
      body: {
        tool: 'code',
        model: project.model,
        mode: project.mode,
        message: [
          `Open file: ${file.path}`,
          `Project files: ${project.files.map((entry) => entry.path).join(', ')}`,
          '',
          '--- the open file ---',
          file.text.slice(0, 6000),
          '--- end ---',
          '',
          question,
        ].join('\n'),
        history: project.turns.slice(0, -2).slice(-6),
      },
    });

    project.turns[project.turns.length - 1] = { role: 'assistant', content: answer.reply };
  } catch (error) {
    project.turns[project.turns.length - 1] = {
      role: 'assistant',
      content: `${error.message}${error.reason ? `\n\n${error.reason}` : ''}`,
    };
  } finally {
    busy = false;
    write();
    redraw();
  }
}

/* ---------- the archive ---------- */

async function download() {
  try {
    const made = await api('/api/files', { method: 'POST', body: { action: 'zip', files: project.files } });

    const bytes = Uint8Array.from(atob(made.zip), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));

    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.site || 'vlipa-project'}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast(`${made.count} files packed.`);
  } catch (error) {
    toast(error.message, 'bad');
  }
}

function upload() {
  const picker = el('input', { type: 'file', accept: '.zip,application/zip' });

  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file) return;

    if (file.size > 3_000_000) return toast('That archive is bigger than 3 MB.', 'bad');

    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (const byte of buffer) binary += String.fromCharCode(byte);

      const read = await api('/api/files', { method: 'POST', body: { action: 'unzip', zip: btoa(binary) } });

      if (!window.confirm(`Replace the project with ${read.files.length} files from ${file.name}?`)) return;

      project.files = read.files;
      project.active = read.files.some((entry) => entry.path === 'index.html') ? 'index.html' : read.files[0].path;
      write();
      drawFiles();
      drawEditor();
      drawBar();
      toast(`${read.files.length} files opened.`);
    } catch (error) {
      toast(error.message, 'bad');
    }
  });

  picker.click();
}

/* ---------- publishing ---------- */

function publish() {
  const name = el('input', {
    name: 'name', required: true, maxlength: 30,
    value: project.site,
    placeholder: 'my-site',
  });

  dialog({
    title: 'Publish this project',
    confirm: 'Publish',
    body: [
      field('Address', name, 'It goes live at this name under vlipa.dev.'),
      el('p', { class: 'muted', text: 'The site stays up for seven days and then comes down on its own. It needs an index.html at the top level. Anyone with the address can see it, so do not publish anything private.' }),
    ],
    onConfirm: async (data) => {
      const answer = await api('/api/publish', {
        method: 'POST',
        body: { action: 'put', name: data.get('name'), files: project.files },
      });

      project.site = answer.name;
      write();
      drawBar();

      dialog({
        title: 'It is live',
        confirm: 'Done',
        body: [
          el('p', {}, [
            el('a', { class: 'ghostlink', href: answer.url, target: '_blank', rel: 'noopener', text: answer.url }),
          ]),
          el('p', { class: 'muted', text: `${answer.files} files. It comes down on ${new Date(answer.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} unless you publish again.` }),
        ],
        onConfirm: async () => {},
      });
    },
  });
}

async function unpublish() {
  if (!project.site) return;
  if (!window.confirm(`Take ${project.site} down now?`)) return;

  try {
    await api('/api/publish', { method: 'POST', body: { action: 'drop', name: project.site } });
    project.site = '';
    write();
    drawBar();
    toast('Taken down.');
  } catch (error) {
    toast(error.message, 'bad');
  }
}

/* ---------- chrome ---------- */

function drawBar() {
  const bar = clear($('codeBar'));

  bar.appendChild(el('div', { class: 'codebar__name' }, [
    el('b', { text: 'Vlipa Studio' }),
    el('span', { text: `${project.files.length} files` }),
    project.site ? el('a', {
      class: 'sitechip', href: `/s/${project.site}/`, target: '_blank', rel: 'noopener',
      text: `${project.site}.vlipa.dev`,
    }) : null,
  ]));

  bar.appendChild(el('div', { class: 'codebar__right' }, [
    el('button', { class: 'chip', type: 'button', text: '+ File', onclick: newFile }),
    el('button', { class: 'chip', type: 'button', text: 'Upload .zip', onclick: upload }),
    el('button', { class: 'chip', type: 'button', text: 'Download .zip', onclick: download }),
    project.site ? el('button', { class: 'chip chip--bad', type: 'button', text: 'Unpublish', onclick: unpublish }) : null,
    el('button', { class: 'btn btn--sm', type: 'button', text: project.site ? 'Publish again' : 'Publish', onclick: publish }),
  ]));
}

export async function show() {
  read();

  if (!models.length) models = await modelsFor('code');
  if (!models.some((model) => model.id === project.model)) project.model = models[0]?.id || 'vlipa';

  project.save = write;

  const view = clear($('view'));

  const agent = agentPanel({
    id: 'code',
    store: project,
    models,
    placeholder: 'Ask anything, or describe the change you want…',
    starters: [
      'Make this a landing page for a coffee shop',
      'Add a contact form that validates the email',
      'Explain what this file does, line by line',
    ],
    render: { code: codeBlock },
    onSend: send,
  });

  drawTurns = agent.drawTurns;

  view.appendChild(el('div', { class: 'workbench' }, [
    el('header', { class: 'codebar', id: 'codeBar' }),

    el('div', { class: 'codebody' }, [
      el('aside', { class: 'filerail' }, [
        el('div', { class: 'filerail__head' }, [
          el('span', { text: 'Files' }),
          el('button', { class: 'ghostlink', type: 'button', text: '+', title: 'New file', onclick: newFile }),
        ]),
        el('div', { class: 'filerail__list', id: 'codeFiles' }),
      ]),

      el('section', { class: 'codemain', id: 'codeEditor' }),
      agent.panel,
    ]),
  ]));

  drawBar();
  drawFiles();
  drawEditor();
  agent.drawTurns();
}

export function leave() {}
