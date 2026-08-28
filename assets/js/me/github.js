/* Your repositories, open in the editor.

   Connect once, pick a repository, and its files land in Vlipa Studio — the
   same editor, the same assistant beside it, the same zip button. Change what
   you like, then either commit it back or take the zip and never push at all.
   Nothing here publishes anything: the only thing that reaches GitHub is a
   commit you wrote a message for and pressed a button to make.

   The token is not here. It lives on the server beside the account; this page
   sends a repository name and gets files. */

import { api } from '../studio/api.js';
import { loadProject, projectFiles } from '../studio/code.js';
import { $, clear, dialog, el, field, menu, toast, when } from '../studio/dom.js';

const KEY = 'vlipa.me.github';

const gh = {
  connected: false,
  account: null,
  repos: [],
  repo: '',
  branch: '',
  branches: [],
  /* What came down from the repository, so a file deleted in the editor can
     be recognised as a deletion rather than silently left behind. */
  opened: [],
  openedAt: '',
  loading: false,
};

const call = (body) => api('/api/github', { method: 'POST', body });

function remember() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      repo: gh.repo, branch: gh.branch, opened: gh.opened, openedAt: gh.openedAt,
    }));
  } catch { /* private mode: the connection still works, it just forgets */ }
}

function recall() {
  try {
    Object.assign(gh, JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch { /* a broken note is not worth keeping */ }

  if (!Array.isArray(gh.opened)) gh.opened = [];
}

/* What GitHub said on the way back, if it said anything. */
function landing() {
  const said = new URLSearchParams(window.location.hash.split('?')[1] || '').get('github');
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

  window.history.replaceState(null, '', '#/github');
}

/* ---------- doing things ---------- */

async function openRepo(fullName, branch) {
  gh.loading = true;
  render();

  try {
    const data = await call({ action: 'open', repo: fullName, branch });

    if (!data.files.length) {
      toast('There was nothing in that branch this editor can open.', 'bad');
      return;
    }

    loadProject(data.files);

    gh.repo = data.repo;
    gh.branch = data.branch;
    gh.opened = data.files.map((file) => file.path);
    gh.openedAt = new Date().toISOString();
    remember();

    const left = data.skipped.binary + data.skipped.big + data.skipped.extra;
    toast(left
      ? `${data.files.length} files opened, ${left} left behind.`
      : `${data.files.length} files opened.`);

    window.location.hash = '#/code';
  } catch (error) {
    toast(error.message, 'bad');
  } finally {
    gh.loading = false;
    render();
  }
}

function commit() {
  const files = projectFiles();

  if (!files.length) {
    toast('There is nothing in the editor to commit.', 'bad');
    return;
  }

  const here = new Set(files.map((file) => file.path));
  const gone = gh.opened.filter((path) => !here.has(path));

  const message = el('input', {
    name: 'message',
    required: true,
    maxlength: 200,
    placeholder: 'What you changed, in one line',
  });

  dialog({
    title: `Commit to ${gh.repo}`,
    confirm: 'Commit',
    body: [
      el('p', { class: 'muted', text: `${files.length} file${files.length === 1 ? '' : 's'} onto ${gh.branch}${gone.length ? `, and ${gone.length} deleted` : ''}. Anything you did not change is left exactly as it is.` }),
      field('Message', message),
      gone.length
        ? el('p', { class: 'muted', text: `Deleting: ${gone.slice(0, 6).join(', ')}${gone.length > 6 ? ` and ${gone.length - 6} more` : ''}` })
        : null,
    ],
    onConfirm: async () => {
      const data = await call({
        action: 'commit',
        repo: gh.repo,
        branch: gh.branch,
        message: message.value,
        files,
        deleted: gone,
      });

      gh.opened = files.map((file) => file.path);
      gh.openedAt = new Date().toISOString();
      remember();

      toast(`Committed ${data.commit.short}.`);
      render();
    },
  });
}

async function disconnect() {
  if (!window.confirm('Disconnect GitHub? Nothing in your repositories changes.')) return;

  await call({ action: 'disconnect' }).catch((error) => toast(error.message, 'bad'));

  Object.assign(gh, { connected: false, account: null, repos: [], repo: '', branch: '', branches: [], opened: [] });
  remember();
  render();
}

/* ---------- drawing ---------- */

function repoRow(repo) {
  const open = repo.fullName === gh.repo;

  return el('div', { class: `histrow${open ? ' is-on' : ''}` }, [
    el('button', {
      class: 'histrow__open',
      type: 'button',
      onclick: () => openRepo(repo.fullName, repo.branch),
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

function connected(view) {
  view.appendChild(el('div', { class: 'pagehead' }, [
    el('div', {}, [
      el('h2', { text: 'GitHub' }),
      el('p', { class: 'muted', text: `Connected as ${gh.account.login}. Open a repository and it lands in Vlipa Studio — change it there, then commit it back or just take the zip.` }),
    ]),
    el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Disconnect', onclick: disconnect }),
  ]));

  /* What is open right now, and what to do with it. */
  if (gh.repo) {
    view.appendChild(el('section', { class: 'panelcard' }, [
      el('h3', { text: gh.repo }),
      el('p', { class: 'muted', text: `Branch ${gh.branch}${gh.openedAt ? ` · opened ${when(gh.openedAt)}` : ''}. ${gh.opened.length} files came down.` }),

      el('div', { class: 'spread' }, [
        el('a', { class: 'btn', href: '#/code', text: 'Open the editor' }),
        el('button', { class: 'btn btn--ghost', type: 'button', text: 'Commit changes', onclick: commit }),
        gh.branches.length > 1
          ? menu({
              label: 'Branch',
              value: gh.branch,
              options: gh.branches.map((name) => ({ id: name, label: name })),
              onPick: (name) => openRepo(gh.repo, name),
            })
          : el('button', {
              class: 'ghostlink',
              type: 'button',
              text: 'Other branches',
              onclick: async () => {
                const data = await call({ action: 'branches', repo: gh.repo }).catch((error) => {
                  toast(error.message, 'bad');
                  return null;
                });

                if (!data) return;
                gh.branches = data.branches;
                render();
              },
            }),
        el('a', { class: 'ghostlink', href: `https://github.com/${gh.repo}`, target: '_blank', rel: 'noopener', text: 'On GitHub →' }),
      ]),

      el('p', { class: 'muted', text: 'Committing sends every file in the editor. GitHub keeps whatever is unchanged, so the history shows only what you actually touched.' }),
    ]));
  }

  view.appendChild(el('h3', { class: 'sectionhead' }, [
    'Your repositories',
    el('button', {
      class: 'ghostlink',
      type: 'button',
      text: 'Refresh',
      onclick: () => load({ repos: true, fresh: true }),
    }),
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

  view.appendChild(el('section', { class: 'panelcard' }, [
    el('h3', { text: 'Connect your account' }),
    el('p', { class: 'muted', text: 'You choose which repositories vlipa can see — it is not all of them unless you say so. The connection is yours alone, and you can cut it from this page at any time.' }),

    el('ul', { class: 'way__list' }, [
      'Open a repository and read it in the editor',
      'Change it with Vlipa beside you',
      'Commit back to a branch, with your name on the commit',
      'Or take the zip and push nothing at all',
    ].map((line) => el('li', { text: line }))),

    el('div', { class: 'spread' }, [
      el('a', { class: 'btn', href: '/api/github/start', text: 'Connect GitHub' }),
    ]),
  ]));
}

function render() {
  const view = clear($('view'));
  if (gh.connected && gh.account) connected(view);
  else offer(view);
}

async function load({ repos = false, fresh = false } = {}) {
  if (repos) {
    gh.loading = true;
    render();
  }

  try {
    const data = await api('/api/github', { method: 'POST', body: { action: 'status', repos }, fresh });

    gh.connected = data.connected;
    gh.account = data.account || null;
    if (data.repos) gh.repos = data.repos;
  } catch (error) {
    // 503 is "not switched on here", which the page says for itself.
    if (error.status !== 503) toast(error.message, 'bad');
    gh.connected = false;
  } finally {
    gh.loading = false;
  }
}

export async function show() {
  recall();
  landing();

  render();
  await load({ repos: true });
  render();
}
