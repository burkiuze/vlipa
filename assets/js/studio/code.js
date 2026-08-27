/* Vlipa Studio: a small editor with the assistant beside it.

   Files on the left, the one you are editing in the middle, Vlipa on the
   right. The project lives in this browser — nothing is kept on the server
   until you publish it — and it travels as a zip.

   Publishing puts the files at <name>.vlipa.dev for a week, then they go. */

import { agentPanel, modelsFor, parts } from './agent.js';
import { api } from './api.js';
import { $, clear, dialog, el, field, toast } from './dom.js';

const KEY = 'vlipa.code';

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

  if (!Array.isArray(project.files)) project.files = [];
  if (!Array.isArray(project.turns)) project.turns = [];
  if (!project.files.some((file) => file.path === project.active)) project.active = project.files[0]?.path || '';
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...project, turns: project.turns.slice(-20) }));
  } catch { /* private mode, or a project too big to remember */ }
}

function current() {
  return project.files.find((file) => file.path === project.active) || project.files[0] || null;
}

function languageOf(path) {
  const extension = String(path).split('.').pop().toLowerCase();
  return { js: 'JS', mjs: 'JS', ts: 'TS', jsx: 'JSX', tsx: 'TSX', html: 'HTML', htm: 'HTML', css: 'CSS', json: 'JSON', md: 'MD', py: 'PY', sql: 'SQL' }[extension] || 'TXT';
}

/* ---------- the file rail ---------- */

function drawFiles() {
  const rail = clear($('codeFiles'));

  if (!project.files.length) {
    rail.appendChild(el('p', { class: 'filerail__empty', text: 'No files yet. Ask Vlipa for what you want and they appear here.' }));
    return;
  }

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
  if (!file) return;
  if (!window.confirm(`Delete ${file.path}?`)) return;

  project.files = project.files.filter((other) => other.path !== file.path);
  project.active = project.files[0]?.path || '';
  write();
  drawFiles();
  drawEditor();
  drawBar();
}

/* ---------- the editor ---------- */

function drawEditor() {
  const host = clear($('codeEditor'));
  const file = current();

  // A new project has no files at all. Rather than an empty grey box, say
  // where the files come from: you ask, and Vlipa writes them here.
  if (!file) {
    host.appendChild(el('div', { class: 'codeblank' }, [
      el('h3', { text: 'Nothing open yet' }),
      el('p', { text: 'Tell Vlipa on the right what you want to build. It writes the files and they appear here, ready to edit.' }),
      el('div', { class: 'spread' }, [
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '+ New file', onclick: newFile }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Upload .zip', onclick: upload }),
      ]),
    ]));
    return;
  }

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

/* Where a block goes when it only names a language. Vlipa is asked to name
   the path, but models do what they do, and a page belongs in a file either
   way — this is an editor, not a transcript. */
const BY_LANGUAGE = {
  html: 'index.html', htm: 'index.html', xhtml: 'index.html',
  css: 'styles.css', scss: 'styles.scss',
  js: 'app.js', javascript: 'app.js', mjs: 'app.js', jsx: 'App.jsx',
  ts: 'app.ts', typescript: 'app.ts', tsx: 'App.tsx',
  json: 'data.json', md: 'README.md', markdown: 'README.md',
  py: 'main.py', python: 'main.py', svg: 'image.svg', sql: 'schema.sql',
  txt: 'notes.txt', xml: 'data.xml', yml: 'config.yml', yaml: 'config.yml',
};

/* Blocks that are a shell command or a fragment are not files, whatever else
   they contain. */
const NOT_A_FILE = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'terminal', 'diff', 'patch', 'text', 'output', 'log']);

/* An info string like `index.html` or `src/app.js` names a file outright. A
   bare language is guessed at: into the open file when the kind matches,
   otherwise into the usual name for it. */
function pathOf(part) {
  const raw = String(part.lang || '').trim().replace(/^\.?\//, '');
  const body = String(part.body || '');

  if (raw.includes('/') || (raw.includes('.') && !/^\.[a-z0-9]+$/i.test(raw))) {
    return { path: raw, guessed: false };
  }

  const word = raw.replace(/^\./, '').toLowerCase();
  if (NOT_A_FILE.has(word)) return { path: '', guessed: false };

  // No info string at all: markup is still a page.
  const language = word || (looksLikeMarkup(body) ? 'html' : '');
  const usual = BY_LANGUAGE[language];
  if (!usual) return { path: '', guessed: false };

  // A single line is a snippet about a file, not the file.
  if (body.trim().split('\n').length < 2 && !looksLikeMarkup(body)) return { path: '', guessed: false };

  const open = current();
  const sameKind = open && open.path.split('.').pop().toLowerCase() === usual.split('.').pop().toLowerCase();

  return { path: sameKind ? open.path : usual, guessed: true };
}

function looksLikeMarkup(text) {
  const head = String(text || '').trimStart().slice(0, 400).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html') || /^<(section|div|main|body|head|article|nav|header|h1|ul|ol|table|form|svg)[\s>]/.test(head);
}

/* Files the assistant produced are written as they arrive: that is the whole
   point of an editor with an assistant in it. */
function applyFiles(text) {
  const written = [];
  const blocks = parts(text).filter((part) => part.kind === 'code');

  // A model that forgets the fences altogether still wrote a page, and it
  // belongs in the project rather than in the conversation.
  const all = blocks.length ? blocks : (looksLikeMarkup(text) ? [{ kind: 'code', lang: '', body: text.trim() }] : []);

  for (const part of all) {
    const { path } = pathOf(part);
    if (!path) continue;

    const existing = project.files.find((file) => file.path === path);
    if (existing) existing.text = part.body;
    else project.files.push({ path, text: part.body });

    written.push(path);
  }

  if (!written.length) return written;

  project.active = written.includes('index.html') ? 'index.html' : written[0];
  write();
  drawFiles();
  drawEditor();
  drawBar();

  return written;
}

function codeBlock(part) {
  const { path } = pathOf(part);

  if (path) {
    return el('figure', { class: 'codeblock codeblock--file' }, [
      el('figcaption', {}, [
        el('span', { class: 'codeblock__path', text: path }),
        el('div', { class: 'codeblock__acts' }, [
          el('span', { class: 'codeblock__done', text: 'written' }),
          el('button', {
            type: 'button', text: 'Open',
            onclick: () => { project.active = path; write(); drawFiles(); drawEditor(); },
          }),
        ]),
      ]),
      el('pre', {}, [el('code', { text: part.body })]),
    ]);
  }

  return el('figure', { class: 'codeblock' }, [
    el('figcaption', {}, [
      el('span', { text: part.lang || 'code' }),
      el('div', { class: 'codeblock__acts' }, [
        el('button', {
          type: 'button', text: 'Into this file',
          onclick: () => {
            const file = current();
            if (!file) return toast('There is no file open yet.', 'bad');
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
        message: (file
          ? [
              `Open file: ${file.path}`,
              `Project files: ${project.files.map((entry) => entry.path).join(', ')}`,
              '',
              '--- the open file ---',
              file.text.slice(0, 6000),
              '--- end ---',
              '',
              question,
            ]
          : ['The project is empty. Write the files it needs.', '', question]
        ).join('\n'),
        history: project.turns.slice(0, -2).slice(-6),
      },
    });

    const reply = String(answer.reply || '');
    const written = applyFiles(reply);

    // A reply that was all file and no fence is shown as the file it became,
    // so the conversation stays a conversation.
    project.turns[project.turns.length - 1] = {
      role: 'assistant',
      content: (written.length && !reply.includes('```'))
        ? `Wrote ${written.join(', ')}.\n\n\`\`\`${written[0]}\n${reply.trim()}\n\`\`\``
        : reply,
    };

    if (written.length) toast(`${written.join(', ')} written.`);
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
    const made = await api('/api/studio', { method: 'POST', body: { action: 'zip', files: project.files } });

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

      const read = await api('/api/studio', { method: 'POST', body: { action: 'unzip', zip: btoa(binary) } });

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
      const answer = await api('/api/studio', {
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
    await api('/api/studio', { method: 'POST', body: { action: 'drop', name: project.site } });
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
