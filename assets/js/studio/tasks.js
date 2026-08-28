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

export function open({ due = '' } = {}) {
  dialog({
    title: 'New task',
    body: form({ assignee: state.user.id, due }),
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

/* ---------- the week ---------- */

/* The board is a week rather than a row of statuses. Work has a day it is
   due, everybody already thinks about it that way, and four columns headed
   To do / In progress / In review / Done said less about Thursday than one
   column headed Thursday does.

   Done is not a column any more. A finished task stays on the day it was
   for, and turns green — which is the whole message. */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const iso = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/* Which Monday the given day belongs to. */
function monday(date) {
  const start = new Date(date);
  const back = (start.getDay() + 6) % 7;

  start.setDate(start.getDate() - back);
  start.setHours(0, 0, 0, 0);
  return start;
}

/* Which week is on screen, as an offset in weeks from this one. */
let week = 0;

/* The week, or everything. A task due in three months is real work, and a
   board that only ever shows seven days hides it completely — so there is a
   way to see the lot, grouped by the day each one is for.

   Which one you chose is remembered: somebody who works from the full list
   should not be put back on this week by a reload. */
let mode = localStorage.getItem('vlipa.tasks.view') === 'all' ? 'all' : 'week';

function setMode(want) {
  mode = want;
  try { localStorage.setItem('vlipa.tasks.view', want); } catch { /* private mode */ }
  draw();
}

const weekDays = () => {
  const start = monday(new Date());
  start.setDate(start.getDate() + week * 7);

  return DAYS.map((name, index) => {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    return { name, short: SHORT[index], date: iso(day), day };
  });
};

const monthName = (date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/* A card on the week board: small, because seven of these have to fit across
   a screen. The detail is behind Edit, as it always was. */
function dayCard(task) {
  const done = task.status === 'done';
  const late = task.due && !done && task.due < iso(new Date());
  const mayEdit = can('task.manage') || (can('task.own') && (task.assignee === state.user.id || task.createdBy === state.user.id));

  const node = el('article', {
    class: `daycard${done ? ' daycard--done' : ''}${late ? ' daycard--late' : ''}`,
    draggable: String(mayEdit),
    title: task.detail || task.title,
  }, [
    el('div', { class: 'daycard__top' }, [
      mayEdit
        ? el('button', {
            class: `tick${done ? ' is-on' : ''}`,
            type: 'button',
            title: done ? 'Not done after all' : 'Mark it done',
            text: done ? '✓' : '',
            onclick: () => move(task, done ? 'todo' : 'done'),
          })
        : el('span', { class: `tick${done ? ' is-on' : ''}`, text: done ? '✓' : '' }),
      el('b', { text: task.title }),
    ]),

    el('div', { class: 'daycard__foot' }, [
      task.department ? el('span', { class: 'pill pill--dept', text: task.department }) : null,
      !done && task.status !== 'todo' ? el('span', { class: `pill pill--${task.status}`, text: LABELS[task.status] }) : null,
      el('span', { class: 'who', text: memberName(task.assignee) }),
    ]),

    mayEdit ? el('div', { class: 'daycard__acts' }, [
      el('button', { class: 'ghostlink', type: 'button', text: 'Edit', onclick: () => edit(task) }),
      el('button', { class: 'ghostlink ghostlink--ai', type: 'button', text: '✦ Prepare it', onclick: () => assist(task, 'brief') }),
      el('button', { class: 'ghostlink ghostlink--ai', type: 'button', text: '✦ Do it', onclick: () => assist(task, 'do') }),
      el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Delete', onclick: () => drop(task) }),
      task.output ? el('button', { class: 'ghostlink', type: 'button', text: 'Output', onclick: () => showOutput(task) }) : null,
    ]) : null,
  ]);

  if (mayEdit) {
    node.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', task.id);
      event.dataTransfer.effectAllowed = 'move';
      node.classList.add('is-lifted');
    });

    node.addEventListener('dragend', () => node.classList.remove('is-lifted'));
  }

  return node;
}

/* What Vlipa produced for a task, kept out of the card until it is asked for:
   a card with eight hundred words in it is not a card. */
function showOutput(task) {
  dialog({
    title: task.title,
    confirm: 'Copy',
    body: [
      el('pre', { class: 'aiout__text', text: task.output }),
    ],
    onConfirm: async () => {
      await navigator.clipboard?.writeText(task.output);
      toast('Copied.');
    },
  });
}

/* Moving a task to another day is dragging it there, which is the one thing
   a week board has to be able to do. */
async function moveToDay(id, due) {
  const task = tasks.find((one) => one.id === id);
  if (!task || task.due === due) return;

  try {
    await api('/api/tasks', {
      method: 'POST',
      body: { action: 'update', companyId: state.companyId, id, due },
    });

    await load();
  } catch (error) {
    toast(error.message, 'bad');
  }
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
      can('task.own') ? el('button', { class: 'btn', type: 'button', text: '+ Task', onclick: () => open() }) : null,
    ]),
  ]));

  const days = weekDays();
  const today = iso(new Date());
  const inWeek = shown.filter((task) => days.some((day) => day.date === task.date || day.date === task.due));
  const elsewhere = shown.filter((task) => task.due && !days.some((day) => day.date === task.due));

  const swap = el('div', { class: 'tabs tabs--sm' }, [
    ['week', 'Week'],
    ['all', 'Everything'],
  ].map(([key, label]) => el('button', {
    type: 'button',
    class: mode === key ? 'is-on' : '',
    text: label,
    onclick: () => setMode(key),
  })));

  host.appendChild(el('div', { class: 'weekbar' }, [
    swap,
    mode === 'week' ? el('button', { class: 'chip', type: 'button', text: '‹', title: 'The week before', onclick: () => { week -= 1; draw(); } }) : null,
    mode === 'week' ? el('b', { text: `${monthName(days[0].day)} – ${monthName(days[6].day)}` }) : null,
    mode === 'week' ? el('button', { class: 'chip', type: 'button', text: '›', title: 'The week after', onclick: () => { week += 1; draw(); } }) : null,
    mode === 'week' && week ? el('button', { class: 'chip', type: 'button', text: 'This week', onclick: () => { week = 0; draw(); } }) : null,
    el('span', { class: 'muted', text: `${shown.filter((task) => task.status !== 'done').length} open` }),
  ]));

  // Everything, grouped by the day each one is for. Same cards, no week.
  if (mode === 'all') {
    const dated = shown.filter((task) => task.due).sort((a, b) => a.due.localeCompare(b.due));
    const undated = shown.filter((task) => !task.due);
    const byDay = new Map();

    for (const task of dated) {
      if (!byDay.has(task.due)) byDay.set(task.due, []);
      byDay.get(task.due).push(task);
    }

    for (const [date, inside] of byDay) {
      const day = new Date(`${date}T00:00:00`);

      host.appendChild(el('section', { class: 'nodate' }, [
        el('h3', {}, [
          `${DAYS[(day.getDay() + 6) % 7]}, ${monthName(day)}`,
          el('span', { class: 'count', text: String(inside.length) }),
          date === today ? el('span', { class: 'pill pill--doing', text: 'Today' }) : null,
        ]),
        el('div', { class: 'nodate__cards' }, inside.map(dayCard)),
      ]));
    }

    if (undated.length) {
      host.appendChild(el('section', { class: 'nodate' }, [
        el('h3', {}, ['No date yet', el('span', { class: 'count', text: String(undated.length) })]),
        el('div', { class: 'nodate__cards' }, undated.map(dayCard)),
      ]));
    }

    if (!shown.length) host.appendChild(el('p', { class: 'empty', text: 'No tasks here.' }));
    return;
  }

  const board = el('div', { class: 'week' });

  for (const day of days) {
    const inside = shown.filter((task) => task.due === day.date);

    const column = el('section', {
      class: `weekday${day.date === today ? ' weekday--today' : ''}`,
      ondragover: (event) => { event.preventDefault(); column.classList.add('is-over'); },
      ondragleave: () => column.classList.remove('is-over'),
      ondrop: (event) => {
        event.preventDefault();
        column.classList.remove('is-over');
        moveToDay(event.dataTransfer.getData('text/plain'), day.date);
      },
    }, [
      el('header', { class: 'weekday__head' }, [
        el('div', {}, [
          el('b', { text: day.name }),
          el('span', { class: 'weekday__date', text: monthName(day.day) }),
        ]),
        can('task.own')
          ? el('button', { class: 'weekday__add', type: 'button', title: `A task for ${day.name}`, text: '+', onclick: () => open({ due: day.date }) })
          : null,
      ]),
      ...inside.map(dayCard),
      inside.length ? null : el('p', { class: 'weekday__empty', text: '' }),
    ]);

    board.appendChild(column);
  }

  host.appendChild(board);

  // Anything without a date is not on the week, and would otherwise vanish.
  const loose = shown.filter((task) => !task.due);

  if (loose.length) {
    host.appendChild(el('section', { class: 'nodate' }, [
      el('h3', {}, ['No date yet', el('span', { class: 'count', text: String(loose.length) })]),
      el('div', { class: 'nodate__cards' }, loose.map(dayCard)),
    ]));
  }

  // Dated work outside the week would otherwise be invisible.
  if (elsewhere.length) {
    host.appendChild(el('p', { class: 'footnote' }, [
      `${elsewhere.length} more on other weeks. `,
      el('button', { class: 'ghostlink', type: 'button', text: 'Show everything', onclick: () => setMode('all') }),
    ]));
  }

  if (!shown.length) host.appendChild(el('p', { class: 'empty', text: 'No tasks here.' }));
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
