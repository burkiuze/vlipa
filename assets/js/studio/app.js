/* The studio shell: who you are, which company you are in, and which page of
   it you are looking at. Every view renders into #view. */

import { api, can, loadCompany, state } from './api.js';
import { $, clear, dialog, el, field, toast } from './dom.js';
import * as chat from './chat.js';
import * as code from './code.js';
import * as write from './write.js';
import * as tasks from './tasks.js';
import * as tables from './tables.js';
import * as team from './team.js';
import * as meet from './meet.js';
import * as groups from './groups.js';

const PAGES = [
  { id: 'panel',    label: 'Panel',       icon: 'M4 13h7V4H4zM13 20h7v-9h-7zM4 20h7v-5H4zM13 9h7V4h-7z' },

  // Vlipa is three tools rather than one, so the menu folds them under it.
  {
    id: 'chat',
    label: 'Vlipa',
    icon: 'M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2z',
    children: [
      { id: 'chat',  label: 'Vlipa',        hint: 'Ask anything',                icon: 'M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2z' },
      { id: 'code',  label: 'Vlipa Studio', hint: 'Build it, publish it',        icon: 'M9 8l-4 4 4 4M15 8l4 4-4 4' },
      { id: 'write', label: 'Vlipa Write',  hint: 'Documents and reports',       icon: 'M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20zM14 3.5V8h4M9 12h6M9 16h4' },
    ],
  },

  // Groups folds open the same way, but its children are the company's own
  // groups rather than a fixed list.
  { id: 'groups',   label: 'Groups',     icon: 'M7 8h10M7 12h6M4.5 4.5h15v11h-9l-4 3.5v-3.5h-2z', dynamic: true },
  { id: 'tasks',    label: 'Tasks',    icon: 'M5 6h14M5 12h14M5 18h9' },
  { id: 'tables',   label: 'Tables',    icon: 'M4 5h16v14H4zM4 10h16M10 10v9' },
  { id: 'meetings', label: 'Meetings', icon: 'M4 7h11v10H4zM15 11l5-3v8l-5-3z' },
  { id: 'team',     label: 'Team',        icon: 'M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M16 11.5a2.5 2.5 0 1 0 0-5M17 14c2.3.4 4 2.2 4 5' },
  { id: 'settings', label: 'Settings',     icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.2-2-3.4-2.2 1a7.6 7.6 0 0 0-2.6-1.5L14.2 3H9.8l-.4 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.2-1-2 3.4 2 1.2a7.6 7.6 0 0 0 0 3l-2 1.2 2 3.4 2.2-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.4h4.4l.4-2.4a7.6 7.6 0 0 0 2.6-1.5l2.2 1 2-3.4z' },
];

/* ---------- dashboard ---------- */

async function panel() {
  const view = clear($('view'));

  const [taskData, tableData, meetData, groupData] = await Promise.all([
    api(`/api/tasks?companyId=${state.companyId}`).catch(() => ({ tasks: [] })),
    api(`/api/tables?companyId=${state.companyId}`).catch(() => ({ tables: [] })),
    api(`/api/meetings?companyId=${state.companyId}`).catch(() => ({ meetings: [] })),
    api(`/api/groups?companyId=${state.companyId}`).catch(() => ({ groups: [] })),
  ]);

  const list = taskData.tasks || [];
  const mine = list.filter((task) => task.assignee === state.user.id && task.status !== 'done');
  const late = list.filter((task) => task.due && task.status !== 'done' && task.due < new Date().toISOString().slice(0, 10));

  view.appendChild(el('div', { class: 'stats' }, [
    ['Open', list.filter((task) => task.status !== 'done').length, 'tasks'],
    ['Yours', mine.length, 'tasks'],
    ['Late', late.length, 'tasks'],
    ['Groups', (groupData.groups || []).length, 'groups'],
    ['Tables', (tableData.tables || []).length, 'tables'],
    ['Rooms', (meetData.meetings || []).length, 'meetings'],
    ['People', state.members.length, 'team'],
  ].map(([label, value, target]) => el('button', {
    class: 'stat', type: 'button', onclick: () => go(target),
  }, [
    el('b', { text: String(value) }),
    el('span', { text: label }),
  ]))));

  view.appendChild(el('h3', { class: 'sectionhead', text: 'Your work' }));

  view.appendChild(mine.length
    ? el('div', { class: 'cards' }, mine.slice(0, 6).map((task) => el('article', { class: 'card' }, [
        el('h4', { text: task.title }),
        el('p', { class: 'muted', text: task.due ? `Due ${task.due}` : 'No date' }),
      ])))
    : el('p', { class: 'empty', text: 'Nothing is waiting on you.' }));

  view.appendChild(el('h3', { class: 'sectionhead', text: 'Shortcuts' }));
  view.appendChild(el('div', { class: 'spread' }, [
    can('task.own') ? el('button', { class: 'btn btn--ghost', type: 'button', text: '+ New task', onclick: () => { go('tasks'); tasks.open(); } }) : null,
    can('table.manage') ? el('button', { class: 'btn btn--ghost', type: 'button', text: '+ New table', onclick: () => { go('tables'); tables.create(); } }) : null,
    can('meeting.manage') ? el('button', { class: 'btn btn--ghost', type: 'button', text: '+ Meeting room', onclick: () => { go('meetings'); meet.create(); } }) : null,
    can('group.manage') ? el('button', { class: 'btn btn--ghost', type: 'button', text: '+ New group', onclick: () => { go('groups'); groups.create(); } }) : null,
    el('button', { class: 'btn btn--ghost', type: 'button', text: 'Talk to Vlipa', onclick: () => go('chat') }),
  ]));
}

/* ---------- settings ---------- */

async function settings() {
  const view = clear($('view'));

  if (state.storage === 'memory') {
    view.appendChild(el('div', { class: 'panelcard panelcard--warn' }, [
      el('h3', { text: 'Storage is switched off' }),
      state.storageNote ? el('p', { text: state.storageNote }) : null,
      el('p', {}, [el('a', { class: 'ghostlink', href: '/setup', target: '_blank', rel: 'noopener', text: 'Open the setup check →' })]),
      el('p', { class: 'muted', text: 'No database is connected, so accounts, companies and work disappear whenever the server restarts — and signing in may not even hold. Add SUPABASE_URL and SUPABASE_SECRET_KEY from your Supabase project to Vercel, run supabase.sql once in the Supabase SQL editor, then redeploy.' }),
    ]));
  }

  view.appendChild(el('div', { class: 'panelcard' }, [
    el('h3', { text: 'Company' }),
    el('div', { class: 'row2' }, [
      field('Name', el('input', { id: 'coName', value: state.company.name, maxlength: 60, disabled: !can('company.manage') })),
      field('Link name', el('input', { value: state.company.slug, disabled: true }), 'Used in the invite link and meeting rooms.'),
    ]),
    can('company.manage') ? el('button', {
      class: 'btn', type: 'button', text: 'Save',
      onclick: async () => {
        try {
          await api('/api/company', {
            method: 'POST',
            body: { action: 'rename', companyId: state.companyId, name: $('coName').value },
          });

          await loadCompany(state.companyId);
          drawShell();
          toast('Saved.');
        } catch (error) {
          toast(error.message, 'bad');
        }
      },
    }) : el('p', { class: 'muted', text: 'Changing company details is an admin job.' }),
  ]));

  if (can('company.manage')) {
    const list = el('div', { class: 'deptlist', id: 'deptList' });

    const drawDepartments = () => {
      clear(list);

      const names = state.company.departments || [];

      if (!names.length) {
        list.appendChild(el('p', { class: 'muted', text: 'No departments yet. Vlipa hands work out along these lines, so it is worth naming them.' }));
      }

      for (const name of names) {
        list.appendChild(el('span', {}, [
          name,
          el('button', {
            type: 'button', text: '×', title: `Remove ${name}`,
            onclick: () => save(names.filter((other) => other !== name)),
          }),
        ]));
      }
    };

    const save = async (names) => {
      try {
        await api('/api/company', {
          method: 'POST',
          body: { action: 'departments', companyId: state.companyId, departments: names },
        });

        await loadCompany(state.companyId);
        drawDepartments();
        toast('Departments saved.');
      } catch (error) {
        toast(error.message, 'bad');
      }
    };

    const input = el('input', { id: 'deptNew', maxlength: 40, placeholder: 'Public relations' });

    view.appendChild(el('div', { class: 'panelcard' }, [
      el('h3', { text: 'Departments' }),
      el('p', { class: 'muted', text: 'The parts the company is split into. Vlipa splits a goal along them, and each person sits in one on the Team page.' }),
      list,
      el('div', { class: 'spread' }, [
        input,
        el('button', {
          class: 'btn btn--ghost', type: 'button', text: '+ Add',
          onclick: () => {
            const name = input.value.trim();
            if (!name) return;
            input.value = '';
            save([...(state.company.departments || []), name]);
          },
        }),
      ]),
    ]));

    drawDepartments();
  }

  if (can('member.invite')) {
    const origin = window.location.origin;

    view.appendChild(el('div', { class: 'panelcard' }, [
      el('h3', { text: 'Invite link' }),
      el('p', { class: 'muted', text: 'Anyone who has the link can join. While it is closed the link does nothing.' }),

      el('div', { class: 'linkrow' }, [
        el('span', { class: 'linkrow__pre', text: `${origin}/invite/` }),
        el('input', { id: 'coSlug', value: state.company.slug, maxlength: 30 }),
      ]),

      el('div', { class: 'row2' }, [
        field('Link', el('select', { id: 'linkOpen' }, [
          el('option', { value: 'yes', selected: state.company.linkOpen, text: 'Open' }),
          el('option', { value: 'no', selected: !state.company.linkOpen, text: 'Closed' }),
        ])),
        field('Role it grants', el('select', { id: 'linkRole' },
          ['guest', 'member', 'admin']
            .filter((role) => state.role === 'owner' || role !== 'owner')
            .map((role) => el('option', {
              value: role,
              selected: (state.company.linkRole || 'member') === role,
              text: state.roles.find((item) => item.id === role)?.label || role,
            })))),
      ]),

      el('div', { class: 'spread' }, [
        el('button', {
          class: 'btn', type: 'button', text: 'Save link',
          onclick: async () => {
            try {
              await api('/api/company', {
                method: 'POST',
                body: {
                  action: 'link',
                  companyId: state.companyId,
                  slug: $('coSlug').value,
                  open: $('linkOpen').value === 'yes',
                  role: $('linkRole').value,
                },
              });

              await loadCompany(state.companyId);
              drawShell();
              await settings();
              toast('Invite link updated.');
            } catch (error) {
              toast(error.message, 'bad');
            }
          },
        }),
        el('button', {
          class: 'btn btn--ghost', type: 'button', text: 'Copy link',
          onclick: () => {
            navigator.clipboard?.writeText(`${origin}/invite/${state.company.slug}`);
            toast('Link copied.');
          },
        }),
        el('a', {
          class: 'ghostlink', href: `/invite/${state.company.slug}`, target: '_blank', rel: 'noopener',
          text: 'Open link',
        }),
      ]),
    ]));
  }

  view.appendChild(el('div', { class: 'panelcard' }, [
    el('h3', { text: 'Your account' }),
    el('p', { class: 'muted', text: `${state.user.name || 'No name'} · ${state.user.email}` }),
    el('p', { class: 'muted', text: `Your role here: ${state.roles.find((role) => role.id === state.role)?.label || state.role}` }),
  ]));

  view.appendChild(el('div', { class: 'panelcard panelcard--danger' }, [
    el('h3', { text: 'Danger zone' }),
    state.role === 'owner'
      ? el('div', {}, [
          el('p', { class: 'muted', text: 'Deleting the company deletes its tasks, tables and rooms with it. There is no undo.' }),
          el('button', {
            class: 'btn btn--danger', type: 'button', text: 'Delete company',
            onclick: async () => {
              if (!window.confirm(`Delete "${state.company.name}" and everything in it?`)) return;

              try {
                await api(`/api/company?id=${state.companyId}`, { method: 'DELETE' });
                localStorage.removeItem('vlipa.company');
                window.location.reload();
              } catch (error) {
                toast(error.message, 'bad');
              }
            },
          }),
        ])
      : el('div', {}, [
          el('p', { class: 'muted', text: 'If you leave, the work assigned to you stops being yours.' }),
          el('button', {
            class: 'btn btn--danger', type: 'button', text: 'Leave company',
            onclick: async () => {
              if (!window.confirm('Leave this company?')) return;

              try {
                await api('/api/company', { method: 'POST', body: { action: 'leave', companyId: state.companyId } });
                localStorage.removeItem('vlipa.company');
                window.location.reload();
              } catch (error) {
                toast(error.message, 'bad');
              }
            },
          }),
        ]),
  ]));
}

/* ---------- companies ---------- */

function createCompany() {
  dialog({
    title: 'New company',
    confirm: 'Create',
    body: [field('Company name', el('input', { name: 'name', required: true, maxlength: 60, placeholder: 'Acme Software' }),
      'Whoever creates it owns it. Invite the team afterwards.')],
    onConfirm: async (data) => {
      const created = await api('/api/company', { method: 'POST', body: { action: 'create', name: data.get('name') } });

      await loadCompany(created.company.id);
      loadGroupNav();
      drawShell();
      go('team');
      toast('Company created. Now invite your team.');
    },
  });
}

function joinCompany() {
  dialog({
    title: 'Join a company',
    confirm: 'Join',
    body: [field('Invite code', el('input', { name: 'code', required: true, maxlength: 12, placeholder: 'A1B2C3D4' }),
      'Ask the owner or an admin for one.')],
    onConfirm: async (data) => {
      const joined = await api('/api/company', { method: 'POST', body: { action: 'join', code: data.get('code') } });

      await loadCompany(joined.company.id);
      loadGroupNav();
      drawShell();
      go('panel');
      toast(`You joined ${joined.company.name}.`);
    },
  });
}

/* ---------- shell ---------- */

/* The groups the company owner made, kept here so the menu can list them
   without the Groups page being open. */
let navGroups = [];

/* The menu can be folded down to its icons; a fold that is open then has to
   float out beside it rather than become a second column of icons. */
let narrow = false;

const HASH_ICON = 'M10 5.5l-1.5 13M16 5.5l-1.5 13M6 10h12M5.5 14.5h12';

function kidsOf(item) {
  if (!item.dynamic) return item.children || null;
  if (item.id !== 'groups' || !navGroups.length) return null;

  return navGroups.map((group) => ({
    id: `groups?id=${group.id}`,
    page: 'groups',
    arg: group.id,
    label: group.name,
    icon: HASH_ICON,
  }));
}

async function loadGroupNav() {
  if (!state.companyId) {
    navGroups = [];
    return;
  }

  const data = await api(`/api/groups?companyId=${state.companyId}`).catch(() => null);
  if (!data) return;

  navGroups = data.groups || [];
  if (state.user) drawShell();
}

/* The Groups page tells us whenever it adds, renames or removes one, so the
   menu never goes stale. */
groups.watch((list) => {
  navGroups = list;
  if (state.user) drawShell();
});

function drawShell() {
  const picker = clear($('coPicker'));

  if (state.company) {
    picker.appendChild(el('select', {
      class: 'copick',
      onchange: async (event) => {
        if (event.target.value === '__new') return createCompany();
        if (event.target.value === '__join') return joinCompany();

        await loadCompany(event.target.value);
        navGroups = [];
        drawShell();
        loadGroupNav();
        go(page());
      },
    }, [
      ...state.companies.map((company) => el('option', {
        value: company.id, selected: company.id === state.companyId, text: company.name,
      })),
      el('option', { value: '__new', text: '+ New company' }),
      el('option', { value: '__join', text: '+ Join with a code' }),
    ]));

    picker.appendChild(el('span', {
      class: `rolebadge rolebadge--${state.role}`,
      text: state.roles.find((role) => role.id === state.role)?.label || state.role,
    }));
  }

  const nav = clear($('nav'));
  const here = page();

  for (const item of PAGES) {
    const kids = kidsOf(item);
    const ids = kids ? kids.map((child) => child.page || child.id) : [item.id];
    const inHere = ids.includes(here);

    const button = el('button', {
      class: `navitem${kids ? ' navitem--parent' : ''}`,
      type: 'button',
      'data-page': item.id,
      'aria-current': String(kids ? inHere : here === item.id),
      onclick: () => {
        if (!kids) return go(item.id);

        // Closed: open it. Open but you are somewhere else: take you to the
        // first child. Open and you are already inside: fold it away.
        if (openFold !== item.id) {
          openFold = item.id;
          drawShell();
          return;
        }

        if (!inHere) return go(kids[0].id);

        openFold = '';
        drawShell();
      },
    }, [
      el('span', { class: 'navitem__ico', html: `<svg viewBox="0 0 24 24" fill="none"><path d="${item.icon}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>` }),
      el('span', { class: 'navitem__label', text: item.label }),
      kids ? el('span', { class: 'navitem__fold', html: '<svg viewBox="0 0 24 24" fill="none"><path d="M8 10l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' }) : null,
    ]);

    nav.appendChild(button);

    // Wide: the fold stays open on the page you are in. Narrow: it is a
    // flyout, so it opens only when you ask for it.
    if (kids && (openFold === item.id || (inHere && !narrow))) {
      const sub = el('div', { class: 'subnav' }, kids.map((child) => el('button', {
        class: 'subitem',
        type: 'button',
        'data-page': child.id,
        title: child.label,
        'aria-current': String(here === (child.page || child.id) && (!child.arg || child.arg === arg())),
        onclick: () => {
          if (narrow) openFold = '';
          go(child.id);
        },
      }, [
        el('span', { class: 'subitem__ico', html: `<svg viewBox="0 0 24 24" fill="none"><path d="${child.icon}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>` }),
        el('span', { class: 'subitem__text' }, [
          el('b', { text: child.label }),
          child.hint ? el('span', { text: child.hint }) : null,
        ]),
      ])));

      nav.appendChild(sub);

      // A grid container puts an out-of-flow child at its own top corner, so
      // the flyout is told which row it belongs beside.
      if (narrow) sub.style.top = `${button.offsetTop}px`;
    }
  }

  $('who').textContent = state.user ? (state.user.name || state.user.email) : '';
  $('coName2').textContent = state.company ? state.company.name : (state.user ? 'No company' : '');
}

/* The page carries its own watchdog (studio.html). This is how it is called
   off. */
function ready() {
  document.documentElement.dataset.booted = '1';
}

let openFold = '';

function page() {
  return (window.location.hash.replace('#/', '') || 'panel').split('?')[0];
}

/* A page can carry one thing with it — which group you are reading. */
function arg() {
  const query = window.location.hash.split('?')[1] || '';
  return new URLSearchParams(query).get('id') || '';
}

const VIEWS = {
  panel,
  chat: chat.show,
  code: code.show,
  write: write.show,
  groups: groups.show,
  tasks: tasks.show,
  tables: tables.show,
  meetings: meet.show,
  team: team.show,
  settings,
};

async function render() {
  const id = page();

  const child = PAGES.flatMap((entry) => entry.children || []).find((entry) => entry.id === id);
  const item = child || PAGES.find((entry) => entry.id === id) || PAGES[0];
  const only = arg();

  // Leaving a page stops whatever it left running: the group poll, the dark
  // theme Vlipa Studio paints over the view.
  if (item.id !== 'groups') groups.leave();
  if (item.id !== 'code') code.leave();
  if (item.id !== 'tables') tables.leave();

  $('pageTitle').textContent = item.label;

  // Vlipa Studio and Vlipa Write are workbenches: they take the whole area,
  // without a page title above them.
  document.querySelector('.app').classList.toggle('is-full', ['code', 'write', 'groups', 'tables'].includes(item.id));

  // The menu carries the fold, so it is redrawn rather than patched.
  if (state.user) drawShell();

  closeSide();

  if (!state.company && !['chat', 'code'].includes(item.id)) {
    clear($('view')).appendChild(el('div', { class: 'empty empty--big' }, [
      el('h3', { text: 'A company comes first' }),
      el('p', { text: 'Tasks, tables, meetings and your team all belong to a company. Create one, or join with an invite code.' }),
      el('div', { class: 'spread' }, [
        el('button', { class: 'btn', type: 'button', text: 'Create a company', onclick: createCompany }),
        el('button', { class: 'btn btn--ghost', type: 'button', text: 'Join with a code', onclick: joinCompany }),
      ]),
    ]));
    return;
  }

  try {
    await (VIEWS[item.id] || panel)(only);
  } catch (error) {
    clear($('view')).appendChild(el('div', { class: 'empty empty--big' }, [
      el('h3', { text: 'This page did not load' }),
      el('p', { text: error.message }),
    ]));
  }
}

function go(id) {
  if (page() === id) render();
  else window.location.hash = `#/${id}`;
}

function openSide() { $('side').classList.add('is-open'); $('scrim').hidden = false; }
function closeSide() { $('side').classList.remove('is-open'); $('scrim').hidden = true; }

async function boot() {
  // The menu is drawn from the start: whatever the network does, the studio
  // never sits there as an empty white page.
  drawShell();

  // Both of these are wanted, neither depends on the other, and waiting for
  // one before asking for the other is half the time the studio takes to open.
  const saved = localStorage.getItem('vlipa.company');
  const companyHead = api(saved ? `/api/company?id=${encodeURIComponent(saved)}` : '/api/company');
  companyHead.catch(() => {});   // it is retried below if it did not work

  let me;

  try {
    me = await api('/api/auth/me');
  } catch (error) {
    // A refused answer means no session; a broken one means the server is
    // having a problem, and sending the visitor to the login page would only
    // hide it.
    if (error.status === 401 || error.status === 403) {
      window.location.replace('/login');
      return;
    }

    throw error;
  }

  if (!me.user) {
    window.location.replace('/login');
    return;
  }

  state.user = me.user;

  state.storage = me.storage;
  state.storageNote = me.storageNote || '';

  if (me.storage === 'memory') {
    toast('No storage on the server: data will be lost, and staying signed in may fail. See Settings.', 'bad');
  }

  // The company kept in localStorage can be gone by the time we come back:
  // deleted, left, or wiped with a restart when the server has no KV. None of
  // that may stop the studio from opening, so a bad id is dropped and we fall
  // back to whatever the account still has.
  let first;

  try {
    first = await loadCompany(saved || undefined, companyHead);
  } catch {
    localStorage.removeItem('vlipa.company');
    first = await loadCompany().catch(() => ({ companies: [] }));
  }

  if (!state.company && first.companies?.length) {
    await loadCompany(first.companies[0].id).catch(() => {});
  }

  if (!state.company) localStorage.removeItem('vlipa.company');

  drawShell();
  loadGroupNav();

  // The menu can shrink to its icons, which is what you want with an editor
  // open. The choice is remembered.
  const fold = (want) => {
    narrow = want;
    if (narrow) openFold = '';   // a flyout has no business opening by itself
    document.querySelector('.app').classList.toggle('is-narrow', narrow);
    localStorage.setItem('vlipa.narrow', narrow ? '1' : '');
    $('sideFold').setAttribute('aria-label', narrow ? 'Widen the menu' : 'Narrow the menu');
    $('sideFold').setAttribute('title', narrow ? 'Widen the menu' : 'Narrow the menu');
    drawShell();
  };

  fold(localStorage.getItem('vlipa.narrow') === '1');

  // A flyout closes when you go back to the work.
  $('view').addEventListener('mousedown', () => {
    if (!narrow || !openFold) return;
    openFold = '';
    drawShell();
  });

  $('sideFold').addEventListener('click', () => {
    fold(!document.querySelector('.app').classList.contains('is-narrow'));
  });

  $('burger').addEventListener('click', openSide);
  $('scrim').addEventListener('click', closeSide);
  $('newCo').addEventListener('click', createCompany);
  $('joinCo').addEventListener('click', joinCompany);

  $('signOut').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('vlipa.company');
    window.location.assign('/');
  });

  window.addEventListener('hashchange', render);
  await render();
  ready();
}

/* A blank studio is the worst possible failure: it hides whatever went wrong.
   Anything boot cannot recover from is written on the page instead. */
boot().catch((error) => {
  ready();
  clear($('view')).appendChild(el('div', { class: 'empty empty--big' }, [
    el('h3', { text: 'The studio did not open' }),
    el('p', { text: error.message || 'Something went wrong.' }),
    el('p', { class: 'muted', text: error.status ? `The server answered ${error.status}.` : 'No answer from the server.' }),
    el('button', { class: 'btn', type: 'button', text: 'Try again', onclick: () => window.location.reload() }),
  ]));
});
