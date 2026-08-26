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
    task.output ? el('details', { class: 'task__out' }, [
      el('summary', { text: 'Vlipa\'nın çıktısı' }),
      el('pre', { class: 'aiout__text', text: task.output }),
      el('button', {
        class: 'ghostlink', type: 'button', text: 'Kopyala',
        onclick: () => { navigator.clipboard?.writeText(task.output); toast('Kopyalandı.'); },
      }),
    ]) : null,
    mayEdit ? el('div', { class: 'task__acts' }, [
      ...ORDER.filter((status) => status !== task.status).map((status) => el('button', {
        class: 'ghostlink', type: 'button', text: `→ ${LABELS[status]}`,
        onclick: () => move(task, status),
      })),
      el('button', { class: 'ghostlink', type: 'button', text: 'Düzenle', onclick: () => edit(task) }),
      el('button', { class: 'ghostlink ghostlink--ai', type: 'button', text: '✦ Hazırlat', onclick: () => assist(task, 'brief') }),
      el('button', { class: 'ghostlink ghostlink--ai', type: 'button', text: '✦ Yaptır', onclick: () => assist(task, 'do') }),
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

/* Hedefi anlat, Vlipa görevleri çıkarsın. Hiçbiri sen onaylamadan açılmaz. */
export function planWithAi() {
  const goal = el('textarea', {
    name: 'goal', rows: 4, required: true, maxlength: 1200,
    placeholder: 'Önümüzdeki iki hafta içinde yeni ürün sayfasını yayına alalım: içerik, fotoğraf, fiyatlandırma ve duyuru.',
  });

  const deep = el('select', { name: 'mode' }, [
    el('option', { value: 'fast', text: 'Hızlı' }),
    el('option', { value: 'thinking', text: 'Düşün (daha yavaş, daha derli toplu)' }),
  ]);

  dialog({
    title: 'Vlipa ile plan çıkar',
    confirm: 'Görevleri çıkar',
    body: [
      field('Ne yapmak istiyorsun?', goal, 'Vlipa ekibi ve rollerini görüyor, işi kime vereceğini önerir.'),
      field('Nasıl düşünsün', deep),
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

/* Çıkan görevleri açmadan önce göster: her satır düzenlenebilir ve çıkarılabilir. */
function review(proposed) {
  const rows = proposed.map((task) => {
    const use = el('input', { type: 'checkbox', checked: true, class: 'planrow__use' });
    const title = el('input', { class: 'planrow__title', value: task.title, maxlength: 140 });
    const due = el('input', { class: 'planrow__due', type: 'date', value: task.due || '' });

    const who = el('select', { class: 'planrow__who' }, [
      el('option', { value: '', text: 'Kimse' }),
      ...state.members.map((member) => el('option', {
        value: member.userId,
        selected: task.assignee === member.userId,
        text: member.name || member.email,
      })),
    ]);

    const row = el('div', { class: 'planrow' }, [
      el('label', { class: 'planrow__head' }, [use, title]),
      task.detail ? el('p', { class: 'planrow__detail', text: task.detail }) : null,
      el('div', { class: 'planrow__meta' }, [who, due]),
    ]);

    row.dataset.detail = task.detail || '';
    return row;
  });

  dialog({
    title: `Vlipa ${proposed.length} görev çıkardı`,
    confirm: 'Seçilenleri aç',
    body: [
      el('p', { class: 'muted', text: 'İstediğini düzenle, istemediğinin tikini kaldır. Hiçbiri sen onaylamadan açılmaz.' }),
      el('div', { class: 'planlist' }, rows),
    ],
    onConfirm: async () => {
      const wanted = rows
        .filter((row) => row.querySelector('.planrow__use').checked)
        .map((row) => ({
          title: row.querySelector('.planrow__title').value,
          detail: row.dataset.detail,
          assignee: row.querySelector('.planrow__who').value,
          due: row.querySelector('.planrow__due').value,
          status: 'todo',
        }));

      if (!wanted.length) throw new Error('Hiç görev seçmedin.');

      const made = await api('/api/tasks', {
        method: 'POST',
        body: { action: 'bulk', companyId: state.companyId, tasks: wanted },
      });

      await load();
      toast(`${made.tasks.length} görev açıldı.`);
    },
  });
}

/* Bir görevi Vlipa'ya hazırlat ya da yaptır. */
function assist(task, kind) {
  const busy = el('p', { class: 'muted', text: kind === 'brief' ? 'Vlipa hazırlıyor…' : 'Vlipa yapıyor…' });
  const box = el('div', { class: 'aiout' }, [busy]);

  const close = dialog({
    title: kind === 'brief' ? `Hazırlık: ${task.title}` : `Çıktı: ${task.title}`,
    confirm: 'Göreve ekle',
    body: [box],
    onConfirm: async () => {
      const text = box.dataset.text;
      if (!text) throw new Error('Ortada eklenecek bir şey yok.');

      const patch = kind === 'brief'
        ? { detail: `${task.detail ? `${task.detail}\n\n` : ''}${text}` }
        : { output: text };

      await api('/api/tasks', {
        method: 'POST',
        body: { action: 'update', companyId: state.companyId, id: task.id, ...patch },
      });

      await load();
      toast(kind === 'brief' ? 'Hazırlık göreve eklendi.' : 'Çıktı göreve eklendi.');
    },
  });

  api('/api/assist', {
    method: 'POST',
    body: { action: kind, companyId: state.companyId, taskId: task.id, mode: 'fast' },
  }).then((data) => {
    box.dataset.text = data.text;
    clear(box).appendChild(el('pre', { class: 'aiout__text', text: data.text }));
    box.appendChild(el('button', {
      class: 'ghostlink', type: 'button', text: 'Kopyala',
      onclick: () => { navigator.clipboard?.writeText(data.text); toast('Kopyalandı.'); },
    }));
  }).catch((error) => {
    clear(box).appendChild(el('p', { class: 'error', text: error.message }));
    if (error.reason) box.appendChild(el('p', { class: 'muted', text: error.reason }));
  });

  return close;
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
    el('div', { class: 'spread' }, [
      can('task.own') ? el('button', { class: 'btn btn--ai', type: 'button', text: '✦ Vlipa ile plan çıkar', onclick: planWithAi }) : null,
      can('task.own') ? el('button', { class: 'btn', type: 'button', text: '+ Görev', onclick: open }) : null,
    ]),
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
