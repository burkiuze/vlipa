/* Tasks: who is doing what, and where it stands. */

import { api, can, memberName, state } from './api.js';
import { bars, ring, SHADES, strip } from './charts.js';
import { $, clear, dialog, el, field, toast, when } from './dom.js';

const LABELS = { todo: 'To do', doing: 'In progress', review: 'In review', done: 'Done' };
const ORDER = ['todo', 'doing', 'review', 'done'];

let tasks = [];
let filter = 'all';

function form(task = {}) {
  const assignees = state.members.map((member) => el('option', {
    value: member.userId,
    selected: task.assignee === member.userId,
    text: `${member.name || member.email}${member.userId === state.user.id ? ' (you)' : ''}`,
  }));

  return [
    field('Title', el('input', { name: 'title', required: true, maxlength: 140, value: task.title || '' })),
    field('Details', el('textarea', { name: 'detail', rows: 3, maxlength: 2000 }, [task.detail || ''])),
    el('div', { class: 'row2' }, [
      field('Assigned to', el('select', {
        name: 'assignee',
        disabled: !can('task.manage') && task.assignee && task.assignee !== state.user.id,
      }, assignees), can('task.manage') ? '' : 'Assigning work to someone else is an admin job.'),
      field('Status', el('select', { name: 'status' }, ORDER.map((status) => el('option', {
        value: status, selected: (task.status || 'todo') === status, text: LABELS[status],
      })))),
    ]),
    el('div', { class: 'row2' }, [
      field('Due date', el('input', { name: 'due', type: 'date', value: task.due || '' })),
      field('Department', el('select', { name: 'department' }, [
        el('option', { value: '', text: 'None' }),
        ...(state.company?.departments || []).map((name) => el('option', {
          value: name, selected: task.department === name, text: name,
        })),
      ])),
    ]),
  ];
}

function card(task) {
  const late = task.due && task.status !== 'done' && task.due < new Date().toISOString().slice(0, 10);
  const mine = task.assignee === state.user.id || task.createdBy === state.user.id;
  const mayEdit = can('task.manage') || (can('task.own') && mine);

  return el('article', { class: `card task task--${task.status}` }, [
    el('div', { class: 'task__top' }, [
      el('span', { class: `pill pill--${task.status}`, text: LABELS[task.status] }),
      task.department ? el('span', { class: 'pill pill--dept', text: task.department }) : null,
      task.due ? el('span', { class: `task__due${late ? ' is-late' : ''}`, text: task.due }) : null,
    ]),
    el('h4', { text: task.title }),
    task.detail ? el('p', { text: task.detail }) : null,
    el('div', { class: 'task__foot' }, [
      el('span', { class: 'who', text: memberName(task.assignee) }),
      el('span', { class: 'muted', text: when(task.updatedAt) }),
    ]),
    task.output ? el('details', { class: 'task__out' }, [
      el('summary', { text: 'What Vlipa produced' }),
      el('pre', { class: 'aiout__text', text: task.output }),
      el('button', {
        class: 'ghostlink', type: 'button', text: 'Copy',
        onclick: () => { navigator.clipboard?.writeText(task.output); toast('Copied.'); },
      }),
    ]) : null,
    mayEdit ? el('div', { class: 'task__acts' }, [
      ...ORDER.filter((status) => status !== task.status).map((status) => el('button', {
        class: 'ghostlink', type: 'button', text: `→ ${LABELS[status]}`,
        onclick: () => move(task, status),
      })),
      el('button', { class: 'ghostlink', type: 'button', text: 'Edit', onclick: () => edit(task) }),
      el('button', { class: 'ghostlink ghostlink--ai', type: 'button', text: '✦ Prepare it', onclick: () => assist(task, 'brief') }),
      el('button', { class: 'ghostlink ghostlink--ai', type: 'button', text: '✦ Do it', onclick: () => assist(task, 'do') }),
      el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Delete', onclick: () => drop(task) }),
    ]) : null,
  ]);
}

async function move(task, status) {
  try {
    await api('/api/tasks', { method: 'POST', body: { action: 'update', companyId: state.companyId, id: task.id, status } });
    await load();
  } catch (error) {
    toast(error.message, 'bad');
  }
}

async function drop(task) {
  if (!window.confirm(`Delete "${task.title}"?`)) return;

  try {
    await api('/api/tasks', { method: 'POST', body: { action: 'delete', companyId: state.companyId, id: task.id } });
    await load();
    toast('Task deleted.');
  } catch (error) {
    toast(error.message, 'bad');
  }
}

function edit(task) {
  dialog({
    title: 'Edit task',
    body: form(task),
    onConfirm: async (data) => {
      await api('/api/tasks', {
        method: 'POST',
        body: {
          action: 'update',
          companyId: state.companyId,
          id: task.id,
          title: data.get('title'),
          detail: data.get('detail'),
          assignee: data.get('assignee'),
          status: data.get('status'),
          due: data.get('due'),
          department: data.get('department'),
        },
      });

      await load();
      toast('Kaydedildi.');
    },
  });
}

export function open() {
  dialog({
    title: 'New task',
    body: form({ assignee: state.user.id }),
    confirm: 'Create',
    onConfirm: async (data) => {
      await api('/api/tasks', {
        method: 'POST',
        body: {
          action: 'create',
          companyId: state.companyId,
          title: data.get('title'),
          detail: data.get('detail'),
          assignee: data.get('assignee'),
          status: data.get('status'),
          due: data.get('due'),
          department: data.get('department'),
        },
      });

      await load();
      toast('Task created.');
    },
  });
}

/* Describe the goal and Vlipa breaks it into tasks. None are created until
   you say so. */
export function planWithAi() {
  const goal = el('textarea', {
    name: 'goal', rows: 4, required: true, maxlength: 1200,
    placeholder: 'Get the new product page live in the next two weeks: copy, photography, pricing and the announcement.',
  });

  const deep = el('select', { name: 'mode' }, [
    el('option', { value: 'fast', text: 'Fast' }),
    el('option', { value: 'thinking', text: 'Think (slower, more considered)' }),
  ]);

  dialog({
    title: 'Plan it with Vlipa',
    confirm: 'Draw up tasks',
    body: [
      field('What do you want done?', goal, 'Vlipa can see the team and their roles, and suggests who should take what.'),
      field('How it should think', deep),
    ],
    onConfirm: async (data) => {
      const proposed = await api('/api/assist', {
        method: 'POST',
        body: { action: 'plan', companyId: state.companyId, goal: data.get('goal'), mode: data.get('mode') },
      });

      review(proposed.tasks);
    },
  });
}

/* Show what came back before anything is created: every row can be edited
   or dropped. */
function review(proposed) {
  const rows = proposed.map((task) => {
    const use = el('input', { type: 'checkbox', checked: true, class: 'planrow__use' });
    const title = el('input', { class: 'planrow__title', value: task.title, maxlength: 140 });
    const due = el('input', { class: 'planrow__due', type: 'date', value: task.due || '' });

    const dept = el('select', { class: 'planrow__dept' }, [
      el('option', { value: '', text: 'No department' }),
      ...(state.company?.departments || []).map((name) => el('option', {
        value: name, selected: task.department === name, text: name,
      })),
    ]);

    const who = el('select', { class: 'planrow__who' }, [
      el('option', { value: '', text: 'Nobody' }),
      ...state.members.map((member) => el('option', {
        value: member.userId,
        selected: task.assignee === member.userId,
        text: member.name || member.email,
      })),
    ]);

    const row = el('div', { class: 'planrow' }, [
      el('label', { class: 'planrow__head' }, [use, title]),
      task.detail ? el('p', { class: 'planrow__detail', text: task.detail }) : null,
      el('div', { class: 'planrow__meta' }, [dept, who, due]),
    ]);

    row.dataset.detail = task.detail || '';
    return row;
  });

  dialog({
    title: `Vlipa drew up ${proposed.length} tasks`,
    confirm: 'Create the ticked ones',
    body: [
      el('p', { class: 'muted', text: 'Edit what you like, untick what you do not want. Nothing is created until you confirm.' }),
      el('div', { class: 'planlist' }, rows),
    ],
    onConfirm: async () => {
      const wanted = rows
        .filter((row) => row.querySelector('.planrow__use').checked)
        .map((row) => ({
          title: row.querySelector('.planrow__title').value,
          detail: row.dataset.detail,
          assignee: row.querySelector('.planrow__who').value,
          department: row.querySelector('.planrow__dept').value,
          due: row.querySelector('.planrow__due').value,
          status: 'todo',
        }));

      if (!wanted.length) throw new Error('Nothing is ticked.');

      const made = await api('/api/tasks', {
        method: 'POST',
        body: { action: 'bulk', companyId: state.companyId, tasks: wanted },
      });

      await load();
      toast(`${made.tasks.length} tasks created.`);
    },
  });
}

/* Have Vlipa prepare a task, or do it. */
function assist(task, kind) {
  const busy = el('p', { class: 'muted', text: kind === 'brief' ? 'Vlipa is preparing it…' : 'Vlipa is doing it…' });
  const box = el('div', { class: 'aiout' }, [busy]);

  const close = dialog({
    title: kind === 'brief' ? `Preparation: ${task.title}` : `Output: ${task.title}`,
    confirm: 'Add to the task',
    body: [box],
    onConfirm: async () => {
      const text = box.dataset.text;
      if (!text) throw new Error('There is nothing to add yet.');

      const patch = kind === 'brief'
        ? { detail: `${task.detail ? `${task.detail}\n\n` : ''}${text}` }
        : { output: text };

      await api('/api/tasks', {
        method: 'POST',
        body: { action: 'update', companyId: state.companyId, id: task.id, ...patch },
      });

      await load();
      toast(kind === 'brief' ? 'Preparation added to the task.' : 'Output added to the task.');
    },
  });

  api('/api/assist', {
    method: 'POST',
    body: { action: kind, companyId: state.companyId, taskId: task.id, mode: 'fast' },
  }).then((data) => {
    box.dataset.text = data.text;
    clear(box).appendChild(el('pre', { class: 'aiout__text', text: data.text }));
    box.appendChild(el('button', {
      class: 'ghostlink', type: 'button', text: 'Copy',
      onclick: () => { navigator.clipboard?.writeText(data.text); toast('Copied.'); },
    }));
  }).catch((error) => {
    clear(box).appendChild(el('p', { class: 'error', text: error.message }));
    if (error.reason) box.appendChild(el('p', { class: 'muted', text: error.reason }));
  });

  return close;
}

/* ---------- who is carrying what ---------- */

/* The distribution page: the same tasks as the board, counted rather than
   listed. It is for whoever hands the work out, so it is only ever drawn for
   somebody who is allowed to.

   The point of the charts is one glance: is anybody buried, is a department
   empty, is anything late. */

const OPEN = ['todo', 'doing', 'review'];
const STATE_COLOUR = { todo: '#9a9aa6', doing: '#3532f6', review: '#b7791f', done: '#17845a' };

const isLate = (task) => task.due && task.status !== 'done' && task.due < new Date().toISOString().slice(0, 10);

function byPerson(open) {
  return state.members
    .map((member) => {
      const held = open.filter((task) => task.assignee === member.userId);

      return {
        name: `${member.name || member.email}${member.userId === state.user.id ? ' (you)' : ''}`,
        count: held.length,
        warn: held.some(isLate),
        parts: OPEN.map((status) => ({
          label: LABELS[status],
          colour: STATE_COLOUR[status],
          value: held.filter((task) => task.status === status).length,
        })),
      };
    })
    .sort((a, b) => b.count - a.count);
}

function byDepartment(open) {
  const names = state.company?.departments || [];

  const slices = names.map((name, index) => ({
    name,
    colour: SHADES[index % SHADES.length],
    value: open.filter((task) => task.department === name).length,
  }));

  const loose = open.filter((task) => !task.department || !names.includes(task.department)).length;
  if (loose) slices.push({ name: 'No department', colour: '#d7d5ea', value: loose });

  return slices;
}

function drawWorkload() {
  const host = clear($('view'));

  const open = tasks.filter((task) => task.status !== 'done');
  const spare = open.filter((task) => !task.assignee);
  const late = open.filter(isLate);
  const idle = state.members.filter((member) => !open.some((task) => task.assignee === member.userId));

  host.appendChild(el('div', { class: 'toolbar' }, [
    el('div', { class: 'tabs' }, [
      el('button', { type: 'button', class: 'is-on', text: `Open (${open.length})` }),
      el('button', {
        type: 'button', text: `Unassigned (${spare.length})`,
        onclick: () => shareOut('unassigned'),
      }),
      el('button', {
        type: 'button', text: `Late (${late.length})`,
        // The late ones are tasks, not a chart: this hands you to the board.
        onclick: () => { filter = 'open'; window.location.hash = '#/tasks'; },
      }),
    ]),
    el('div', { class: 'spread' }, [
      el('button', {
        class: 'btn btn--ai', type: 'button', text: '✦ Share out the work',
        onclick: () => shareOut('open'),
      }),
      el('button', { class: 'btn btn--ai', type: 'button', text: '✦ Plan with Vlipa', onclick: planWithAi }),
    ]),
  ]));

  if (!open.length) {
    host.appendChild(el('p', { class: 'empty', text: 'Nothing is open. There is nothing to share out.' }));
    return;
  }

  host.appendChild(el('div', { class: 'stats' }, [
    ['Open', open.length],
    ['Unassigned', spare.length],
    ['Late', late.length],
    ['Free people', idle.length],
  ].map(([label, number]) => el('div', { class: 'stat stat--flat' }, [
    el('b', { text: String(number) }),
    el('span', { text: label }),
  ]))));

  host.appendChild(el('div', { class: 'charts' }, [
    el('section', { class: 'card chart__card' }, [
      el('h3', { text: 'Who is carrying what' }),
      el('p', { class: 'muted', text: 'Open tasks per person, by where each one stands.' }),
      bars(byPerson(open), { empty: 'Nobody is in this company yet.' }),
    ]),

    el('section', { class: 'card chart__card' }, [
      el('h3', { text: 'Across the departments' }),
      el('p', { class: 'muted', text: 'Where the open work sits.' }),
      ring(byDepartment(open), { middle: 'open' }),
    ]),

    el('section', { class: 'card chart__card chart__card--wide' }, [
      el('h3', { text: 'Where it all stands' }),
      strip(['todo', 'doing', 'review', 'done'].map((status) => ({
        label: LABELS[status],
        colour: STATE_COLOUR[status],
        value: tasks.filter((task) => task.status === status).length,
      }))),
    ]),
  ]));

  if (spare.length) {
    host.appendChild(el('div', { class: 'card card--nudge' }, [
      el('h4', { text: `${spare.length} tasks have nobody on them` }),
      el('p', { class: 'muted', text: 'Vlipa can look at who is in which department and what they are already carrying, and propose who takes each one. Nothing moves until you say so.' }),
      el('button', { class: 'btn btn--ai', type: 'button', text: '✦ Hand out the unassigned', onclick: () => shareOut('unassigned') }),
    ]));
  }
}

/* Vlipa proposes the split; the table below is what actually happens, and it
   is editable down to the last row before anything is handed over. */
function shareOut(only) {
  const box = el('div', { class: 'aiout' }, [el('p', { class: 'muted', text: 'Vlipa is dividing the work…' })]);
  let rows = [];

  const close = dialog({
    title: only === 'unassigned' ? 'Hand out the unassigned' : 'Share out the open work',
    confirm: 'Hand it over',
    body: [box],
    onConfirm: async () => {
      const moves = rows
        .filter((row) => row.querySelector('.planrow__use').checked)
        .map((row) => ({
          id: row.dataset.id,
          assignee: row.querySelector('.planrow__who').value,
          department: row.querySelector('.planrow__dept').value,
        }))
        .filter((move) => move.assignee || move.department);

      if (!moves.length) throw new Error('Nothing is ticked.');

      const done = await api('/api/tasks', {
        method: 'POST',
        body: { action: 'assign', companyId: state.companyId, moves },
      });

      await load();
      toast(`${done.tasks.length} tasks handed out.`);
    },
  });

  api('/api/assist', {
    method: 'POST',
    body: { action: 'share', companyId: state.companyId, only, mode: 'thinking' },
  }).then((data) => {
    rows = data.moves.map((move) => {
      const use = el('input', { type: 'checkbox', checked: true, class: 'planrow__use' });

      const who = el('select', { class: 'planrow__who' }, [
        el('option', { value: '', text: 'Nobody' }),
        ...state.members.map((member) => el('option', {
          value: member.userId, selected: move.assignee === member.userId, text: member.name || member.email,
        })),
      ]);

      const dept = el('select', { class: 'planrow__dept' }, [
        el('option', { value: '', text: 'No department' }),
        ...(state.company?.departments || []).map((name) => el('option', {
          value: name, selected: move.department === name, text: name,
        })),
      ]);

      const row = el('div', { class: 'planrow' }, [
        el('label', { class: 'planrow__head' }, [use, el('b', { text: move.title })]),
        move.why ? el('p', { class: 'planrow__detail', text: move.why }) : null,
        move.was && move.was !== move.assignee
          ? el('p', { class: 'planrow__detail', text: `Now with ${memberName(move.was)}.` })
          : null,
        el('div', { class: 'planrow__meta' }, [dept, who]),
      ]);

      row.dataset.id = move.id;
      return row;
    });

    clear(box).append(
      el('p', { class: 'muted', text: data.note || 'Edit what you like, untick what you do not want. Nothing moves until you confirm.' }),
      el('div', { class: 'planlist' }, rows),
    );
  }).catch((error) => {
    clear(box).appendChild(el('p', { class: 'error', text: error.message }));
  });

  return close;
}

function draw() {
  const host = clear($('view'));

  const mine = tasks.filter((task) => task.assignee === state.user.id);
  const shown = filter === 'mine' ? mine
    : filter === 'open' ? tasks.filter((task) => task.status !== 'done')
    : filter.startsWith('dept:') ? tasks.filter((task) => task.department === filter.slice(5))
    : tasks;

  host.appendChild(el('div', { class: 'toolbar' }, [
    el('div', { class: 'tabs' }, [
      ['all', `All (${tasks.length})`],
      ['open', `Open (${tasks.filter((task) => task.status !== 'done').length})`],
      ['mine', `Mine (${mine.length})`],
      ...(state.company?.departments || [])
        .map((name) => [`dept:${name}`, `${name} (${tasks.filter((task) => task.department === name).length})`])
        .filter(([, label]) => !label.endsWith('(0)')),
    ].map(([key, label]) => el('button', {
      type: 'button',
      class: filter === key ? 'is-on' : '',
      text: label,
      onclick: () => { filter = key; draw(); },
    }))),
    el('div', { class: 'spread' }, [
      can('task.own') ? el('button', { class: 'btn btn--ai', type: 'button', text: '✦ Plan with Vlipa', onclick: planWithAi }) : null,
      can('task.own') ? el('button', { class: 'btn', type: 'button', text: '+ Task', onclick: open }) : null,
    ]),
  ]));

  if (!shown.length) {
    host.appendChild(el('p', { class: 'empty', text: 'No tasks here.' }));
    return;
  }

  const board = el('div', { class: 'board' });

  for (const status of ORDER) {
    const column = shown.filter((task) => task.status === status);

    board.appendChild(el('section', { class: 'board__col' }, [
      el('h3', {}, [LABELS[status], el('span', { class: 'count', text: String(column.length) })]),
      ...column.map(card),
    ]));
  }

  host.appendChild(board);
}

async function load() {
  const data = await api(`/api/tasks?companyId=${encodeURIComponent(state.companyId)}`);
  tasks = data.tasks || [];
  paint();
}

/* Which of the two the page is on. The board is what everybody sees; the
   distribution is for whoever hands the work out. */
let view = 'board';

const paint = () => (view === 'workload' ? drawWorkload : draw)();

export async function show() {
  view = 'board';
  clear($('view')).appendChild(el('p', { class: 'empty', text: 'Loading tasks…' }));
  await load();
}

export async function workload() {
  view = 'workload';
  clear($('view')).appendChild(el('p', { class: 'empty', text: 'Counting the work…' }));
  await load();
}

export function summary() {
  return { total: tasks.length, open: tasks.filter((task) => task.status !== 'done').length };
}
