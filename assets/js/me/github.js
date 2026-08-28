/* Your repositories, open in the editor.

   Connect once, tick the repositories you want, and their files land in Vlipa
   Studio — the same editor, the same assistant beside it, the same zip button.
   Change what you like, then commit back or take the zip and push nothing at
   all. Nothing here publishes: the only thing that reaches GitHub is a commit
   you wrote a message for and pressed a button to make.

   More than one at a time is allowed, because a change often spans two of
   them. When it does, each repository's files sit under a folder named after
   it, so nothing collides — and a commit goes back to one repository at a
   time, carrying only the files that came from it.

   The token is not here. It lives on the server beside the account; this page
   sends a repository name and gets files. */

import { api } from '../studio/api.js';
import { addBarButton, loadProject, projectFiles, refresh } from '../studio/code.js';
import { $, clear, dialog, el, field, menu, toast, when } from '../studio/dom.js';

const KEY = 'vlipa.me.github';

const gh = {
  connected: false,
  account: null,
  repos: [],
  /* What is currently in the editor: one entry per repository, each with the
     folder its files live under and the paths that came down, so a file
     deleted in the editor is recognised as a deletion. */
  open: [],
  loading: false,
  ready: false,
};

const call = (body) => api('/api/github', { method: 'POST', body });

const shortName = (fullName) => fullName.split('/').pop();

function remember() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ open: gh.open }));
  } catch { /* private mode: the connection still works, it just forgets */ }
}

function recall() {
  try {
    const held = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (Array.isArray(held.open)) gh.open = held.open;
  } catch { /* a broken note is not worth keeping */ }
}

/* What GitHub said on the way back, if it said anything. A failure is kept on
   the page rather than only flashed in a toast: it is nearly always a setting
   to change, and a message that disappears in three seconds is no help. */
let trouble = '';
let offHere = false;

function landing() {
  const query = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const said = query.get('github');
  if (!said) return;

  const lines = {
    connected: ['GitHub connected.', ''],
    cancelled: ['You cancelled that.', 'bad'],
    session: ['That sign-in took too long. Try again.', 'bad'],
    failed: ['GitHub would not complete the sign-in.', 'bad'],
    off: ['GitHub is not switched on for this deployment.', 'bad'],
  };

  const [message, kind] = lines[said] || [];
  if (message) toast(message, kind);

  trouble = kind === 'bad' ? [message, query.get('why')].filter(Boolean).join(' ') : '';
  offHere = said === 'off';

  window.history.replaceState(null, '', '#/github');
}

/* ---------- opening ---------- */

/* One or several repositories, into one project.

   Alone, a repository keeps its own paths — that is what somebody working on
   one thing expects to see. Together, each goes under a folder named after
   it, because two repositories with an index.js would otherwise overwrite
   each other silently. */
async function openRepos(picked) {
  if (!picked.length) return;

  gh.loading = true;
  render();

  const many = picked.length > 1;
  const files = [];
  const open = [];
  const failed = [];
  let left = 0;

  for (const one of picked) {
    try {
      const data = await call({ action: 'open', repo: one.fullName, branch: one.branch });
      const prefix = many ? `${shortName(one.fullName)}/` : '';

      for (const file of data.files) files.push({ path: prefix + file.path, content: file.content });

      open.push({
        fullName: data.repo,
        branch: data.branch,
        prefix,
        paths: data.files.map((file) => file.path),
        openedAt: new Date().toISOString(),
      });

      left += data.skipped.binary + data.skipped.big + data.skipped.extra;
    } catch (error) {
      failed.push(`${one.fullName}: ${error.message}`);
    }
  }

  gh.loading = false;

  if (!files.length) {
    toast(failed[0] || 'There was nothing in that branch this editor can open.', 'bad');
    render();
    return;
  }

  loadProject(files);

  gh.open = open;
  remember();

  for (const line of failed) toast(line, 'bad');

  toast(left
    ? `${files.length} files from ${open.length} repositor${open.length === 1 ? 'y' : 'ies'}, ${left} left behind.`
    : `${files.length} files from ${open.length} repositor${open.length === 1 ? 'y' : 'ies'}.`);

  // Already in the editor: redraw it under them. Anywhere else: go there.
  if (window.location.hash.startsWith('#/code')) refresh();
  else window.location.hash = '#/code';

  render();
}

/* The picker. Tick as many as you like; each row carries its own branch. */
export function pick() {
  if (!gh.connected) {
    window.location.assign('/api/github/start');
    return;
  }

  const chosen = new Map();
  const list = el('div', { class: 'repopick' });

  const draw = () => {
    clear(list);

    if (!gh.repos.length) {
      list.appendChild(el('p', { class: 'muted', text: 'No repositories yet. Choose some for the app on GitHub, then reopen this.' }));
      return;
    }

    for (const repo of gh.repos) {
      const on = chosen.has(repo.fullName);

      const row = el('label', { class: `repopick__row${on ? ' is-on' : ''}` }, [
        el('input', {
          type: 'checkbox',
          checked: on,
          onchange: (event) => {
            if (event.target.checked) chosen.set(repo.fullName, { fullName: repo.fullName, branch: repo.branch });
            else chosen.delete(repo.fullName);
            draw();
          },
        }),
        el('span', { class: 'repopick__text' }, [
          el('b', { text: repo.fullName }),
          el('span', { text: `${repo.private ? 'Private' : 'Public'} · ${repo.branch}` }),
        ]),
      ]);

      list.appendChild(row);
    }
  };

  draw();

  dialog({
    title: 'Open from GitHub',
    confirm: 'Open',
    body: [
      el('p', { class: 'muted', text: 'Tick one, or several. More than one and each goes into a folder named after it, so nothing overwrites anything.' }),
      list,
      el('p', { class: 'muted', text: 'Whatever is in the editor now is replaced.' }),
    ],
    onConfirm: async () => {
      if (!chosen.size) throw new Error('Tick at least one.');
      openRepos([...chosen.values()]);
    },
  });
}

/* ---------- committing ---------- */

/* One repository at a time. Files are matched by the folder they came in
   under, so a project holding three repositories commits three times and
   never sends one repository's file to another. */
function commit(entry) {
  const all = projectFiles();

  const mine = entry.prefix
    ? all.filter((file) => file.path.startsWith(entry.prefix))
      .map((file) => ({ path: file.path.slice(entry.prefix.length), content: file.content }))
    : all;

  if (!mine.length) {
    toast('Nothing in the editor belongs to that repository any more.', 'bad');
    return;
  }

  const here = new Set(mine.map((file) => file.path));
  const gone = entry.paths.filter((path) => !here.has(path));

  const message = el('input', { name: 'message', required: true, maxlength: 200, placeholder: 'What you changed, in one line' });

  dialog({
    title: `Commit to ${entry.fullName}`,
    confirm: 'Commit',
    body: [
      el('p', { class: 'muted', text: `${mine.length} file${mine.length === 1 ? '' : 's'} onto ${entry.branch}${gone.length ? `, and ${gone.length} deleted` : ''}. Anything you did not change is left exactly as it is.` }),
      field('Message', message),
      gone.length
        ? el('p', { class: 'muted', text: `Deleting: ${gone.slice(0, 6).join(', ')}${gone.length > 6 ? ` and ${gone.length - 6} more` : ''}` })
        : null,
    ],
    onConfirm: async () => {
      const data = await call({
        action: 'commit',
        repo: entry.fullName,
        branch: entry.branch,
        message: message.value,
        files: mine,
        deleted: gone,
      });

      entry.paths = mine.map((file) => file.path);
      entry.openedAt = new Date().toISOString();
      remember();

      toast(`Committed ${data.commit.short} to ${entry.fullName}.`);
      render();
    },
  });
}

async function disconnect() {
  if (!window.confirm('Disconnect GitHub? Nothing in your repositories changes.')) return;

  await call({ action: 'disconnect' }).catch((error) => toast(error.message, 'bad'));

  Object.assign(gh, { connected: false, account: null, repos: [], open: [] });
  remember();
  render();
}

/* ---------- the button in the editor ---------- */

/* Vlipa Studio gets one chip in its bar, so a repository can be swapped
   without leaving the editor. It only draws once GitHub is switched on for
   this deployment — an editor is not the place to advertise a feature the
   server cannot do. */
export function studioButton() {
  if (!gh.ready) return null;

  const open = gh.open.length;

  return el('button', {
    class: `chip${open ? ' chip--on' : ''}`,
    type: 'button',
    title: open ? gh.open.map((one) => `${one.fullName} · ${one.branch}`).join('\n') : 'Open a repository',
    onclick: () => (gh.connected ? pick() : window.location.assign('/api/github/start')),
  }, [
    el('span', {
      class: 'chip__ico',
      html: '<svg viewBox="0 0 24 24" fill="none"><path d="M9 19c-4 1.2-4-2.2-5.6-2.7M14.5 21v-3.4a3 3 0 0 0-.8-2.3c2.7-.3 5.5-1.3 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.7 11.7 0 0 0-6.2 0C5.8 2.6 4.8 2.9 4.8 2.9a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 3.4 9.3c0 4.7 2.8 5.7 5.5 6a3 3 0 0 0-.8 2.3V21" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    }),
    el('span', { text: open === 1 ? shortName(gh.open[0].fullName) : open ? `${open} repos` : 'GitHub' }),
  ]);
}

/* Called once as the app starts, so the chip exists before anybody opens the
   editor and the status is known by the time they press it. */
export async function arm() {
  addBarButton(studioButton);
  recall();
  await load({ quiet: true });
}

/* ---------- drawing ---------- */

function repoRow(repo) {
  const open = gh.open.find((one) => one.fullName === repo.fullName);

  return el('div', { class: `histrow${open ? ' is-on' : ''}` }, [
    el('button', {
      class: 'histrow__open',
      type: 'button',
      onclick: () => openRepos([{ fullName: repo.fullName, branch: repo.branch }]),
    }, [
      el('span', {
        class: 'histrow__ico',
        html: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 4.5h9l5 5V19a.5.5 0 0 1-.5.5h-13A.5.5 0 0 1 5 19zM14 4.5V10h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      }),
      el('span', { class: 'histrow__text' }, [
        el('b', { text: repo.fullName }),
        el('span', { text: `${repo.private ? 'Private' : 'Public'} · ${repo.branch}${repo.updatedAt ? ` · ${when(repo.updatedAt)}` : ''}` }),
      ]),
    ]),
    open ? el('span', { class: 'skillnote', text: 'open' }) : null,
  ]);
}

function openCard(entry) {
  return el('section', { class: 'panelcard' }, [
    el('h3', { text: entry.fullName }),
    el('p', {
      class: 'muted',
      text: `Branch ${entry.branch}${entry.openedAt ? ` · opened ${when(entry.openedAt)}` : ''}. ${entry.paths.length} files came down${entry.prefix ? `, under ${entry.prefix}` : ''}.`,
    }),

    el('div', { class: 'spread' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', text: 'Commit changes', onclick: () => commit(entry) }),
      menu({
        label: 'Branch',
        value: entry.branch,
        options: (entry.branches || [entry.branch]).map((name) => ({ id: name, label: name })),
        keepLabel: true,
        onPick: async (name) => {
          if (name === '__more') {
            const data = await call({ action: 'branches', repo: entry.fullName }).catch((error) => {
              toast(error.message, 'bad');
              return null;
            });

            if (!data) return;
            entry.branches = data.branches;
            render();
            return;
          }

          openRepos([{ fullName: entry.fullName, branch: name }]);
        },
      }),
      el('a', { class: 'ghostlink', href: `https://github.com/${entry.fullName}`, target: '_blank', rel: 'noopener', text: 'On GitHub →' }),
    ]),
  ]);
}

function connected(view) {
  view.appendChild(el('div', { class: 'pagehead' }, [
    el('div', {}, [
      el('h2', { text: 'GitHub' }),
      el('p', { class: 'muted', text: `Connected as ${gh.account.login}. Open one repository or several — they land in Vlipa Studio, and there is a GitHub button in its bar to swap them without coming back here.` }),
    ]),
    el('div', { class: 'spread' }, [
      el('button', { class: 'btn', type: 'button', text: 'Open repositories', onclick: pick }),
      el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Disconnect', onclick: disconnect }),
    ]),
  ]));

  if (gh.open.length) {
    view.appendChild(el('h3', { class: 'sectionhead' }, [
      gh.open.length === 1 ? 'Open in the editor' : `${gh.open.length} repositories in the editor`,
      el('a', { class: 'ghostlink', href: '#/code', text: 'Open the editor →' }),
    ]));

    for (const entry of gh.open) view.appendChild(openCard(entry));

    if (gh.open.length > 1) {
      view.appendChild(el('p', { class: 'muted', text: 'Each one commits on its own, and only the files that came in under its folder go with it.' }));
    }
  }

  view.appendChild(el('h3', { class: 'sectionhead' }, [
    'Your repositories',
    el('button', { class: 'ghostlink', type: 'button', text: 'Refresh', onclick: () => load({ fresh: true }).then(render) }),
  ]));

  if (gh.loading) {
    view.appendChild(el('p', { class: 'empty', text: 'Reading…' }));
    return;
  }

  view.appendChild(gh.repos.length
    ? el('div', { class: 'histlist' }, gh.repos.map(repoRow))
    : el('div', { class: 'empty empty--big' }, [
        el('h3', { text: 'No repositories yet' }),
        el('p', { text: 'The app can only see repositories you have given it. Add some on GitHub, then refresh this page.' }),
        el('div', { class: 'spread' }, [
          el('a', { class: 'btn btn--ghost', href: 'https://github.com/settings/installations', target: '_blank', rel: 'noopener', text: 'Choose repositories on GitHub' }),
        ]),
      ]));
}

function offer(view) {
  view.appendChild(el('div', { class: 'pagehead' }, [
    el('div', {}, [
      el('h2', { text: 'GitHub' }),
      el('p', { class: 'muted', text: 'Bring your own code in, work on it with Vlipa, and put it back.' }),
    ]),
  ]));

  if (trouble) {
    view.appendChild(el('div', { class: 'panelcard panelcard--warn' }, [
      el('h3', { text: 'That did not connect' }),
      el('p', { text: trouble }),
      el('p', {
        class: 'muted',
        text: offHere
          ? 'The app credentials are not on the server yet. Set them in the deployment environment and redeploy — /api/status says which of the two is missing.'
          : `The app's Callback URL has to include exactly ${window.location.origin}/api/github/callback — this address, with the www or without it, whichever you are on. GitHub takes more than one, so add both.`,
      }),
    ]));
  }

  view.appendChild(el('section', { class: 'panelcard' }, [
    el('h3', { text: 'Connect your account' }),
    el('p', { class: 'muted', text: 'You choose which repositories vlipa can see — it is not all of them unless you say so. The connection is yours alone, and you can cut it from this page at any time.' }),

    el('ul', { class: 'way__list' }, [
      'Open one repository, or several at once',
      'Change them with Vlipa beside you',
      'Commit back to a branch, with your name on the commit',
      'Or take the zip and push nothing at all',
    ].map((line) => el('li', { text: line }))),

    el('div', { class: 'spread' }, [
      el('a', { class: 'btn', href: '/api/github/start', text: 'Connect GitHub' }),
    ]),
  ]));
}

/* This page's own draw. It checks where the reader is first: opening a
   repository from the editor's bar ends here too, and redrawing the GitHub
   page over the editor they are looking at would take the files away from
   under them. */
function render() {
  if (!$('view') || !window.location.hash.startsWith('#/github')) return;

  const view = clear($('view'));
  if (gh.connected && gh.account) connected(view);
  else offer(view);
}

async function load({ fresh = false, quiet = false } = {}) {
  try {
    const data = await api('/api/github', { method: 'POST', body: { action: 'status', repos: true }, fresh });

    gh.ready = true;
    gh.connected = data.connected;
    gh.account = data.account || null;
    if (data.repos) gh.repos = data.repos;
  } catch (error) {
    // 503 is "not switched on here", which the page says for itself. Anything
    // else is worth telling somebody who opened this page on purpose, and
    // worth swallowing on the start-up check they never asked for.
    gh.ready = error.status !== 503;
    gh.connected = false;

    if (!quiet && error.status && error.status !== 503 && error.status !== 401) toast(error.message, 'bad');
  }
}

export async function show() {
  recall();
  landing();

  render();
  await load();
  render();
}
