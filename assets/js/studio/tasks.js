/* Görevler: kim neyi yapıyor, nerede duruyor. */

import { api, can, memberName, state } from './api.js';
import { $, clear, dialog, el, field, toast, when } from './dom.js';

const LABELS = { todo: 'Yapılacak', doing: 'Devam ediyor', review: 'Kontrolde', done: 'Bitti' };
const ORDER = ['todo', 'doing', 'review', 'done'];

let tasks = [];
let filter = 'all';

function form(task = {}) {
  const assignees = state.members.map((member) => el('option', {
    value: member.userId,
    selected: task.assignee === member.userId,
    text: `${member.name || member.email}${member.userId === state.user.id ? ' (sen)' : ''}`,
  }));

  return [
    field('Başlık', el('input', { name: 'title', required: true, maxlength: 140, value: task.title || '' })),
    field('Ayrıntı', el('textarea', { name: 'detail', rows: 3, maxlength: 2000 }, [task.detail || ''])),
    el('div', { class: 'row2' }, [
      field('Kim yapacak', el('select', {
        name: 'assignee',
        disabled: !can('task.manage') && task.assignee && task.assignee !== state.user.id,
      }, assignees), can('task.manage') ? '' : 'Başkasına atamak yönetici işi.'),
      field('Durum', el('select', { name: 'status' }, ORDER.map((status) => el('option', {
        value: status, selected: (task.status || 'todo') === status, text: LABELS[status],
      })))),
    ]),
    field('Bitiş tarihi', el('input', { name: 'due', type: 'date', value: task.due || '' })),
  ];
}

function card(task) {
  const late = task.due && task.status !== 'done' && task.due < new Date().toISOString().slice(0, 10);
  const mine = task.assignee === state.user.id || task.createdBy === state.user.id;
  const mayEdit = can('task.manage') || (can('task.own') && mine);

  return el('article', { class: `card task task--${task.status}` }, [
    el('div', { class: 'task__top' }, [
      el('span', { class: `pill pill--${task.status}`, text: LABELS[task.status] }),
      task.due ? el('span', { class: `task__due${late ? ' is-late' : ''}`, text: task.due }) : null,
    ]),
    el('h4', { text: task.title }),
    task.detail ? el('p', { text: task.detail }) : null,
    el('div', { class: 'task__foot' }, [
      el('span', { class: 'who', text: memberName(task.assignee) }),
      el('span', { class: 'muted', text: when(task.updatedAt) }),
    ]),
    mayEdit ? el('div', { class: 'task__acts' }, [
      ...ORDER.filter((status) => status !== task.status).map((status) => el('button', {
        class: 'ghostlink', type: 'button', text: `→ ${LABELS[status]}`,
        onclick: () => move(task, status),
      })),
      el('button', { class: 'ghostlink', type: 'button', text: 'Düzenle', onclick: () => edit(task) }),
      el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Sil', onclick: () => drop(task) }),
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
  if (!window.confirm(`"${task.title}" silinsin mi?`)) return;

  try {
    await api('/api/tasks', { method: 'POST', body: { action: 'delete', companyId: state.companyId, id: task.id } });
    await load();
    toast('Görev silindi.');
  } catch (error) {
    toast(error.message, 'bad');
  }
}

function edit(task) {
  dialog({
    title: 'Görevi düzenle',
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
        },
      });

      await load();
      toast('Kaydedildi.');
    },
  });
}

export function open() {
  dialog({
    title: 'Yeni görev',
    body: form({ assignee: state.user.id }),
    confirm: 'Oluştur',
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
        },
      });

      await load();
      toast('Görev açıldı.');
    },
  });
}

function draw() {
  const host = clear($('view'));

  const mine = tasks.filter((task) => task.assignee === state.user.id);
  const shown = filter === 'mine' ? mine
    : filter === 'open' ? tasks.filter((task) => task.status !== 'done')
    : tasks;

  host.appendChild(el('div', { class: 'toolbar' }, [
    el('div', { class: 'tabs' }, [
      ['all', `Hepsi (${tasks.length})`],
      ['open', `Açık (${tasks.filter((task) => task.status !== 'done').length})`],
      ['mine', `Bende (${mine.length})`],
    ].map(([key, label]) => el('button', {
      type: 'button',
      class: filter === key ? 'is-on' : '',
      text: label,
      onclick: () => { filter = key; draw(); },
    }))),
    can('task.own') ? el('button', { class: 'btn', type: 'button', text: '+ Görev', onclick: open }) : null,
  ]));

  if (!shown.length) {
    host.appendChild(el('p', { class: 'empty', text: 'Burada görev yok.' }));
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
  draw();
}

export async function show() {
  clear($('view')).appendChild(el('p', { class: 'empty', text: 'Görevler yükleniyor…' }));
  await load();
}

export function summary() {
  return { total: tasks.length, open: tasks.filter((task) => task.status !== 'done').length };
}
