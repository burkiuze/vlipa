/* How the work is actually going: by department, by person, day by day.

   The distribution page answers "who is carrying what" — how much is open on
   each desk right now. This answers the other question, the one you ask at
   the end of a week: how much of it got done, and by whom.

   Everything here is counted from the tasks themselves. Nothing new is
   stored, nothing is tracked, and nobody is scored on anything the board does
   not already show. */

import { api, can, memberName, state } from './api.js';
import { avatar } from './avatar.js';
import { bars, ring, SHADES } from './charts.js';
import { $, clear, el } from './dom.js';

let tasks = [];

/* How far back the table looks. Two weeks fits across a screen and is the
   span anybody actually asks about. */
let span = 14;

const iso = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function lastDays(count) {
  const out = [];
  const day = new Date();

  for (let back = count - 1; back >= 0; back -= 1) {
    const then = new Date(day);
    then.setDate(then.getDate() - back);
    out.push({ date: iso(then), day: then });
  }

  return out;
}

const short = (date) => date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const initial = (date) => date.toLocaleDateString(undefined, { weekday: 'narrow' });

/* A finished task counts on the day it was finished, which is the day it was
   last touched — the board writes updatedAt every time a task moves, and the
   move to done is the last one that happens to it. */
const doneOn = (task) => (task.status === 'done' ? String(task.updatedAt || '').slice(0, 10) : '');

/* What one person, or one department, got through. */
function tally(inside) {
  const done = inside.filter((task) => task.status === 'done').length;
  const late = inside.filter((task) => task.due && task.status !== 'done' && task.due < iso(new Date())).length;

  return {
    total: inside.length,
    done,
    open: inside.length - done,
    late,
    share: inside.length ? Math.round((done / inside.length) * 100) : 0,
  };
}

/* ---------- the strip of days ---------- */

/* One row per person, one square per day, shaded by how much they finished
   that day. Small, dense, and readable across two weeks — which is what a
   week of squares is for. */
function heat(rows, days) {
  const most = Math.max(1, ...rows.flatMap((row) => days.map((day) => row.byDay[day.date] || 0)));

  // The grid needs to know how many days wide it is.
  return el('div', { class: 'heat', style: `--days:${days.length}` }, [
    el('div', { class: 'heat__row heat__row--head' }, [
      el('span', { class: 'heat__name' }),
      ...days.map((day) => el('span', { class: 'heat__label', title: short(day.day), text: initial(day.day) })),
      el('span', { class: 'heat__total', text: 'Done' }),
    ]),

    ...rows.map((row) => el('div', { class: 'heat__row' }, [
      el('span', { class: 'heat__name' }, [
        row.person ? avatar(row.person, 22) : null,
        el('b', { title: row.name, text: row.name }),
      ]),

      ...days.map((day) => {
        const count = row.byDay[day.date] || 0;

        return el('span', {
          class: `heat__cell${count ? ' is-on' : ''}`,
          style: count ? `--weight:${0.22 + (count / most) * 0.78}` : '',
          title: `${short(day.day)} — ${count} done`,
          text: count ? String(count) : '',
        });
      }),

      el('span', { class: 'heat__total', text: String(row.tally.done) }),
    ])),
  ]);
}

/* A bar per department or per person: how much of what they were given is
   finished. The number on the right is the percentage, which is the thing
   being asked for. */
function shareBars(rows) {
  if (!rows.length) return el('p', { class: 'empty', text: 'Nothing to count yet.' });

  return el('div', { class: 'chart chart--share' }, rows.map((row) => el('div', { class: 'share' }, [
    el('span', { class: 'share__name', title: row.name }, [
      row.person ? avatar(row.person, 22) : null,
      el('b', { text: row.name }),
    ]),
    el('div', { class: 'share__track' }, [
      el('div', { class: 'share__fill', style: `width:${row.tally.share}%` }),
    ]),
    el('span', { class: 'share__pct', text: `${row.tally.share}%` }),
    el('span', { class: 'share__note', text: `${row.tally.done}/${row.tally.total}` }),
  ])));
}

/* ---------- who is doing what ---------- */

function byPerson(days) {
  return state.members.map((member) => {
    const inside = tasks.filter((task) => task.assignee === member.userId);
    const byDay = {};

    for (const task of inside) {
      const day = doneOn(task);
      if (day) byDay[day] = (byDay[day] || 0) + 1;
    }

    return {
      id: member.userId,
      person: member,
      name: `${member.name || member.email}${member.userId === state.user.id ? ' (you)' : ''}`,
      byDay,
      tally: tally(inside),
    };
  }).sort((a, b) => b.tally.done - a.tally.done || b.tally.total - a.tally.total);
}

function byDepartment(days) {
  const names = state.company?.departments || [];

  const rows = names.map((name) => {
    const inside = tasks.filter((task) => task.department === name);
    const byDay = {};

    for (const task of inside) {
      const day = doneOn(task);
      if (day) byDay[day] = (byDay[day] || 0) + 1;
    }

    return { id: name, person: null, name, byDay, tally: tally(inside) };
  });

  const loose = tasks.filter((task) => !task.department || !names.includes(task.department));

  if (loose.length) {
    const byDay = {};
    for (const task of loose) {
      const day = doneOn(task);
      if (day) byDay[day] = (byDay[day] || 0) + 1;
    }

    rows.push({ id: '', person: null, name: 'No department', byDay, tally: tally(loose) });
  }

  return rows.filter((row) => row.tally.total).sort((a, b) => b.tally.share - a.tally.share);
}

/* ---------- one person on their own ---------- */

/* Opened from the table: the same numbers for one person, and the work they
   are actually carrying. Nothing here that the board does not already show —
   it is the same tasks, gathered under one name. */
export function person(userId) {
  const member = state.members.find((one) => one.userId === userId);
  const host = clear($('view'));

  if (!member) {
    host.appendChild(el('p', { class: 'empty', text: 'Nobody by that name in this company.' }));
    return;
  }

  const inside = tasks.filter((task) => task.assignee === userId);
  const count = tally(inside);
  const days = lastDays(span);

  host.appendChild(el('div', { class: 'toolbar' }, [
    el('div', { class: 'person' }, [
      avatar(member, 40),
      el('div', {}, [
        el('b', { text: member.name || member.email }),
        el('span', { class: 'muted block', text: `${state.roles.find((role) => role.id === member.role)?.label || member.role}${member.department ? ` · ${member.department}` : ''}` }),
      ]),
    ]),
    el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '← Everybody', onclick: () => show() }),
  ]));

  host.appendChild(el('div', { class: 'stats' }, [
    ['Done', count.done],
    ['Open', count.open],
    ['Late', count.late],
    ['Finished', `${count.share}%`],
  ].map(([label, value]) => el('div', { class: 'stat stat--flat' }, [
    el('b', { text: String(value) }),
    el('span', { text: label }),
  ]))));

  host.appendChild(el('div', { class: 'charts' }, [
    el('section', { class: 'card chart__card chart__card--wide' }, [
      el('h3', { text: `Day by day, the last ${span} days` }),
      heat([{ ...byPerson(days).find((row) => row.id === userId) }], days),
    ]),
  ]));

  const open = inside.filter((task) => task.status !== 'done');

  host.appendChild(el('h3', { class: 'sectionhead' }, ['What they are carrying', el('span', { class: 'count', text: String(open.length) })]));

  host.appendChild(open.length
    ? el('div', { class: 'cards' }, open.map((task) => el('article', { class: 'card' }, [
        el('h4', { text: task.title }),
        el('p', { class: 'muted', text: task.due ? `Due ${task.due}` : 'No date' }),
      ])))
    : el('p', { class: 'empty', text: 'Nothing open.' }));
}

/* ---------- everybody ---------- */

function draw() {
  const host = clear($('view'));
  const days = lastDays(span);
  const people = byPerson(days);
  const departments = byDepartment(days);
  const all = tally(tasks);

  host.appendChild(el('div', { class: 'toolbar' }, [
    el('div', { class: 'tabs tabs--sm' }, [7, 14, 30].map((many) => el('button', {
      type: 'button',
      class: span === many ? 'is-on' : '',
      text: `${many} days`,
      onclick: () => { span = many; draw(); },
    }))),
    el('span', { class: 'muted', text: `${all.done} of ${all.total} finished` }),
  ]));

  host.appendChild(el('div', { class: 'stats' }, [
    ['Finished', `${all.share}%`],
    ['Done', all.done],
    ['Open', all.open],
    ['Late', all.late],
  ].map(([label, value]) => el('div', { class: 'stat stat--flat' }, [
    el('b', { text: String(value) }),
    el('span', { text: label }),
  ]))));

  host.appendChild(el('div', { class: 'charts' }, [
    el('section', { class: 'card chart__card chart__card--wide' }, [
      el('h3', { text: 'Day by day' }),
      el('p', { class: 'muted', text: 'Each square is a day, and how dark it is, is how much that person finished on it.' }),
      people.length ? heat(people, days) : el('p', { class: 'empty', text: 'Nobody here yet.' }),
    ]),

    el('section', { class: 'card chart__card' }, [
      el('h3', { text: 'How much each department finished' }),
      shareBars(departments),
    ]),

    el('section', { class: 'card chart__card' }, [
      el('h3', { text: 'How much each person finished' }),
      shareBars(people),
    ]),
  ]));

  host.appendChild(el('h3', { class: 'sectionhead', text: 'Everybody, one by one' }));

  host.appendChild(el('div', { class: 'tablewrap' }, [
    el('table', { class: 'grid' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Person' }),
        el('th', { text: 'Department' }),
        el('th', { class: 'num', text: 'Given' }),
        el('th', { class: 'num', text: 'Done' }),
        el('th', { class: 'num', text: 'Open' }),
        el('th', { class: 'num', text: 'Late' }),
        el('th', { text: 'Finished' }),
        el('th', { class: 'shrink', text: '' }),
      ])]),
      el('tbody', {}, people.map((row) => el('tr', {}, [
        el('td', {}, [
          el('div', { class: 'person' }, [
            avatar(row.person, 30),
            el('b', { text: row.name }),
          ]),
        ]),
        el('td', { class: 'muted', text: row.person.department || '—' }),
        el('td', { class: 'num', text: String(row.tally.total) }),
        el('td', { class: 'num', text: String(row.tally.done) }),
        el('td', { class: 'num', text: String(row.tally.open) }),
        el('td', { class: `num${row.tally.late ? ' is-late' : ''}`, text: String(row.tally.late) }),
        el('td', {}, [
          el('div', { class: 'share share--tight' }, [
            el('div', { class: 'share__track' }, [el('div', { class: 'share__fill', style: `width:${row.tally.share}%` })]),
            el('span', { class: 'share__pct', text: `${row.tally.share}%` }),
          ]),
        ]),
        el('td', { class: 'shrink' }, [
          el('button', { class: 'ghostlink', type: 'button', text: 'Open', onclick: () => person(row.id) }),
        ]),
      ]))),
    ]),
  ]));
}

async function load() {
  const data = await api(`/api/tasks?companyId=${encodeURIComponent(state.companyId)}`);
  tasks = data.tasks || [];
}

export async function show() {
  const host = clear($('view'));

  if (!can('task.manage')) {
    host.appendChild(el('p', { class: 'empty', text: 'Looking at how everybody is doing is an admin job.' }));
    return;
  }

  host.appendChild(el('p', { class: 'empty', text: 'Counting the work…' }));
  await load();
  draw();
}

/* ---------- departments on their own ---------- */

/* The same counting, one screen up: how much of the work each part of the
   company has finished, without naming anybody. */
export async function departments() {
  const host = clear($('view'));

  host.appendChild(el('p', { class: 'empty', text: 'Counting the work…' }));
  await load();

  const names = state.company?.departments || [];
  const rows = byDepartment(lastDays(span));
  const days = lastDays(span);

  clear(host);

  host.appendChild(el('div', { class: 'toolbar' }, [
    el('h3', { text: `${names.length} ${names.length === 1 ? 'department' : 'departments'}` }),
    can('company.manage')
      ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Edit the list', onclick: () => { window.location.hash = '#/settings'; } })
      : null,
  ]));

  if (!names.length) {
    host.appendChild(el('p', { class: 'empty', text: 'This company has no departments yet. Settings is where they are named.' }));
    return;
  }

  host.appendChild(el('div', { class: 'charts' }, [
    el('section', { class: 'card chart__card' }, [
      el('h3', { text: 'How much each one finished' }),
      shareBars(rows),
    ]),

    el('section', { class: 'card chart__card' }, [
      el('h3', { text: 'Where the work sits' }),
      ring(rows.map((row, index) => ({
        name: row.name,
        colour: SHADES[index % SHADES.length],
        value: row.tally.open,
      })), { middle: 'open' }),
    ]),

    el('section', { class: 'card chart__card chart__card--wide' }, [
      el('h3', { text: 'Day by day' }),
      rows.length ? heat(rows, days) : el('p', { class: 'empty', text: 'Nothing counted yet.' }),
    ]),
  ]));

  host.appendChild(el('h3', { class: 'sectionhead', text: 'Department by department' }));

  host.appendChild(el('div', { class: 'cards' }, names.map((name) => {
    const row = rows.find((one) => one.name === name) || { tally: tally([]) };
    const inside = state.members.filter((member) => member.department === name);

    return el('article', { class: 'card' }, [
      el('h4', { text: name }),
      el('p', { class: 'muted', text: `${inside.length} ${inside.length === 1 ? 'person' : 'people'} · ${row.tally.done} of ${row.tally.total} finished` }),
      el('div', { class: 'share share--tight' }, [
        el('div', { class: 'share__track' }, [el('div', { class: 'share__fill', style: `width:${row.tally.share}%` })]),
        el('span', { class: 'share__pct', text: `${row.tally.share}%` }),
      ]),
      inside.length
        ? el('div', { class: 'facerow' }, inside.slice(0, 8).map((member) => avatar(member, 26)))
        : null,
    ]);
  })));

  // Counted rather than tracked: worth saying once, on the page that counts.
  host.appendChild(el('p', { class: 'footnote', text:
    'Counted from the tasks themselves — what was given out, and what was ticked off. Nothing else is recorded.' }));
}

export function summary() {
  return { done: tasks.filter((task) => task.status === 'done').length };
}
