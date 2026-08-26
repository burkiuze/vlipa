/* The studio shell: who you are, which company you are in, and which page of
   it you are looking at. Every view renders into #view. */

import { api, can, loadCompany, state } from './api.js';
import { $, clear, dialog, el, field, toast } from './dom.js';
import * as chat from './chat.js';
import * as tasks from './tasks.js';
import * as tables from './tables.js';
import * as team from './team.js';
import * as meet from './meet.js';
import * as groups from './groups.js';

const PAGES = [
  { id: 'panel',    label: 'Panel',       icon: 'M4 13h7V4H4zM13 20h7v-9h-7zM4 20h7v-5H4zM13 9h7V4h-7z' },
  { id: 'chat',     label: 'Vlipa',       icon: 'M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2z' },
  { id: 'groups',   label: 'Gruplar',     icon: 'M7 8h10M7 12h6M4.5 4.5h15v11h-9l-4 3.5v-3.5h-2z' },
  { id: 'tasks',    label: 'Görevler',    icon: 'M5 6h14M5 12h14M5 18h9' },
  { id: 'tables',   label: 'Tablolar',    icon: 'M4 5h16v14H4zM4 10h16M10 10v9' },
  { id: 'meetings', label: 'Toplantılar', icon: 'M4 7h11v10H4zM15 11l5-3v8l-5-3z' },
  { id: 'team',     label: 'Ekip',        icon: 'M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M16 11.5a2.5 2.5 0 1 0 0-5M17 14c2.3.4 4 2.2 4 5' },
  { id: 'settings', label: 'Ayarlar',     icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.2-2-3.4-2.2 1a7.6 7.6 0 0 0-2.6-1.5L14.2 3H9.8l-.4 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.2-1-2 3.4 2 1.2a7.6 7.6 0 0 0 0 3l-2 1.2 2 3.4 2.2-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.4h4.4l.4-2.4a7.6 7.6 0 0 0 2.6-1.5l2.2 1 2-3.4z' },
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
    ['Açık görev', list.filter((task) => task.status !== 'done').length, 'tasks'],
    ['Sende', mine.length, 'tasks'],
    ['Geciken', late.length, 'tasks'],
    ['Grup', (groupData.groups || []).length, 'groups'],
    ['Tablo', (tableData.tables || []).length, 'tables'],
    ['Oda', (meetData.meetings || []).length, 'meetings'],
    ['Kişi', state.members.length, 'team'],
  ].map(([label, value, target]) => el('button', {
    class: 'stat', type: 'button', onclick: () => go(target),
  }, [
    el('b', { text: String(value) }),
    el('span', { text: label }),
  ]))));

  view.appendChild(el('h3', { class: 'sectionhead', text: 'Sendeki işler' }));

  view.appendChild(mine.length
    ? el('div', { class: 'cards' }, mine.slice(0, 6).map((task) => el('article', { class: 'card' }, [
        el('h4', { text: task.title }),
        el('p', { class: 'muted', text: task.due ? `Bitiş: ${task.due}` : 'Tarih yok' }),
      ])))
    : el('p', { class: 'empty', text: 'Sende bekleyen bir iş yok.' }));

  view.appendChild(el('h3', { class: 'sectionhead', text: 'Kısayollar' }));
  view.appendChild(el('div', { class: 'spread' }, [
    can('task.own') ? el('button', { class: 'btn btn--ghost', type: 'button', text: '+ Görev aç', onclick: () => { go('tasks'); tasks.open(); } }) : null,
    can('table.manage') ? el('button', { class: 'btn btn--ghost', type: 'button', text: '+ Tablo aç', onclick: () => { go('tables'); tables.create(); } }) : null,
    can('meeting.manage') ? el('button', { class: 'btn btn--ghost', type: 'button', text: '+ Toplantı odası', onclick: () => { go('meetings'); meet.create(); } }) : null,
    can('group.manage') ? el('button', { class: 'btn btn--ghost', type: 'button', text: '+ Grup aç', onclick: () => { go('groups'); groups.create(); } }) : null,
    el('button', { class: 'btn btn--ghost', type: 'button', text: 'Vlipa ile konuş', onclick: () => go('chat') }),
  ]));
}

/* ---------- settings ---------- */

async function settings() {
  const view = clear($('view'));

  view.appendChild(el('div', { class: 'panelcard' }, [
    el('h3', { text: 'Şirket' }),
    el('div', { class: 'row2' }, [
      field('Ad', el('input', { id: 'coName', value: state.company.name, maxlength: 60, disabled: !can('company.manage') })),
      field('Adres adı', el('input', { value: state.company.slug, disabled: true }), 'Toplantı odalarında kullanılır.'),
    ]),
    can('company.manage') ? el('button', {
      class: 'btn', type: 'button', text: 'Kaydet',
      onclick: async () => {
        try {
          await api('/api/company', {
            method: 'POST',
            body: { action: 'rename', companyId: state.companyId, name: $('coName').value },
          });

          await loadCompany(state.companyId);
          drawShell();
          toast('Kaydedildi.');
        } catch (error) {
          toast(error.message, 'bad');
        }
      },
    }) : el('p', { class: 'muted', text: 'Şirket bilgilerini değiştirmek yönetici işi.' }),
  ]));

  if (can('member.invite')) {
    const origin = window.location.origin;

    view.appendChild(el('div', { class: 'panelcard' }, [
      el('h3', { text: 'Davet linki' }),
      el('p', { class: 'muted', text: 'Linki bilen herkes şirkete katılabilir. Kapalıyken link çalışmaz.' }),

      el('div', { class: 'linkrow' }, [
        el('span', { class: 'linkrow__pre', text: `${origin}/invite/` }),
        el('input', { id: 'coSlug', value: state.company.slug, maxlength: 30 }),
      ]),

      el('div', { class: 'row2' }, [
        field('Link açık mı', el('select', { id: 'linkOpen' }, [
          el('option', { value: 'yes', selected: state.company.linkOpen, text: 'Açık' }),
          el('option', { value: 'no', selected: !state.company.linkOpen, text: 'Kapalı' }),
        ])),
        field('Linkle gelenin rolü', el('select', { id: 'linkRole' },
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
          class: 'btn', type: 'button', text: 'Linki kaydet',
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
              toast('Davet linki güncellendi.');
            } catch (error) {
              toast(error.message, 'bad');
            }
          },
        }),
        el('button', {
          class: 'btn btn--ghost', type: 'button', text: 'Linki kopyala',
          onclick: () => {
            navigator.clipboard?.writeText(`${origin}/invite/${state.company.slug}`);
            toast('Link kopyalandı.');
          },
        }),
        el('a', {
          class: 'ghostlink', href: `/invite/${state.company.slug}`, target: '_blank', rel: 'noopener',
          text: 'Linki aç',
        }),
      ]),
    ]));
  }

  view.appendChild(el('div', { class: 'panelcard' }, [
    el('h3', { text: 'Hesabın' }),
    el('p', { class: 'muted', text: `${state.user.name || 'İsimsiz'} · ${state.user.email}` }),
    el('p', { class: 'muted', text: `Bu şirketteki rolün: ${state.roles.find((role) => role.id === state.role)?.label || state.role}` }),
  ]));

  view.appendChild(el('div', { class: 'panelcard panelcard--danger' }, [
    el('h3', { text: 'Tehlikeli bölge' }),
    state.role === 'owner'
      ? el('div', {}, [
          el('p', { class: 'muted', text: 'Şirketi silmek görevleri, tabloları ve odaları da siler. Geri dönüşü yok.' }),
          el('button', {
            class: 'btn btn--danger', type: 'button', text: 'Şirketi sil',
            onclick: async () => {
              if (!window.confirm(`"${state.company.name}" ve içindeki her şey silinsin mi?`)) return;

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
          el('p', { class: 'muted', text: 'Şirketten ayrılırsan görevlerin sende kalmaz.' }),
          el('button', {
            class: 'btn btn--danger', type: 'button', text: 'Şirketten ayrıl',
            onclick: async () => {
              if (!window.confirm('Bu şirketten ayrılmak istediğine emin misin?')) return;

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
    title: 'Yeni şirket',
    confirm: 'Kur',
    body: [field('Şirket adı', el('input', { name: 'name', required: true, maxlength: 60, placeholder: 'Elma Yazılım' }),
      'Kuran kişi sahibi olur; ekibi sonra davet edersin.')],
    onConfirm: async (data) => {
      const created = await api('/api/company', { method: 'POST', body: { action: 'create', name: data.get('name') } });

      await loadCompany(created.company.id);
      drawShell();
      go('team');
      toast('Şirket kuruldu. Şimdi ekibini davet et.');
    },
  });
}

function joinCompany() {
  dialog({
    title: 'Şirkete katıl',
    confirm: 'Katıl',
    body: [field('Davet kodu', el('input', { name: 'code', required: true, maxlength: 12, placeholder: 'A1B2C3D4' }),
      'Kodu şirket sahibinden ya da yöneticisinden al.')],
    onConfirm: async (data) => {
      const joined = await api('/api/company', { method: 'POST', body: { action: 'join', code: data.get('code') } });

      await loadCompany(joined.company.id);
      drawShell();
      go('panel');
      toast(`${joined.company.name} şirketine katıldın.`);
    },
  });
}

/* ---------- shell ---------- */

function drawShell() {
  const picker = clear($('coPicker'));

  if (state.company) {
    picker.appendChild(el('select', {
      class: 'copick',
      onchange: async (event) => {
        if (event.target.value === '__new') return createCompany();
        if (event.target.value === '__join') return joinCompany();

        await loadCompany(event.target.value);
        drawShell();
        go(page());
      },
    }, [
      ...state.companies.map((company) => el('option', {
        value: company.id, selected: company.id === state.companyId, text: company.name,
      })),
      el('option', { value: '__new', text: '+ Yeni şirket kur' }),
      el('option', { value: '__join', text: '+ Davet koduyla katıl' }),
    ]));

    picker.appendChild(el('span', {
      class: `rolebadge rolebadge--${state.role}`,
      text: state.roles.find((role) => role.id === state.role)?.label || state.role,
    }));
  }

  const nav = clear($('nav'));

  for (const item of PAGES) {
    nav.appendChild(el('button', {
      class: 'navitem',
      type: 'button',
      'data-page': item.id,
      'aria-current': String(page() === item.id),
      onclick: () => go(item.id),
    }, [
      el('span', { class: 'navitem__ico', html: `<svg viewBox="0 0 24 24" fill="none"><path d="${item.icon}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>` }),
      item.label,
    ]));
  }

  $('who').textContent = state.user.name || state.user.email;
  $('coName2').textContent = state.company ? state.company.name : 'Şirket yok';
}

function page() {
  return (window.location.hash.replace('#/', '') || 'panel').split('?')[0];
}

const VIEWS = {
  panel,
  chat: chat.show,
  groups: groups.show,
  tasks: tasks.show,
  tables: tables.show,
  meetings: meet.show,
  team: team.show,
  settings,
};

async function render() {
  const id = page();
  const item = PAGES.find((entry) => entry.id === id) || PAGES[0];

  // Leaving the groups page stops its polling and drops out of the voice room.
  if (item.id !== 'groups') groups.leave();

  $('pageTitle').textContent = item.label;
  document.querySelectorAll('.navitem').forEach((button) => {
    button.setAttribute('aria-current', String(button.dataset.page === item.id));
  });

  closeSide();

  if (!state.company && item.id !== 'chat') {
    clear($('view')).appendChild(el('div', { class: 'empty empty--big' }, [
      el('h3', { text: 'Önce bir şirket gerek' }),
      el('p', { text: 'Görevler, tablolar, toplantılar ve ekip bir şirkete bağlı çalışır. Kur ya da davet koduyla katıl.' }),
      el('div', { class: 'spread' }, [
        el('button', { class: 'btn', type: 'button', text: 'Şirket kur', onclick: createCompany }),
        el('button', { class: 'btn btn--ghost', type: 'button', text: 'Davet koduyla katıl', onclick: joinCompany }),
      ]),
    ]));
    return;
  }

  try {
    await (VIEWS[item.id] || panel)();
  } catch (error) {
    clear($('view')).appendChild(el('div', { class: 'empty empty--big' }, [
      el('h3', { text: 'Bu sayfa yüklenemedi' }),
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
  let me;

  try {
    me = await api('/api/auth/me');
  } catch {
    window.location.replace('/login');
    return;
  }

  if (!me.user) {
    window.location.replace('/login');
    return;
  }

  state.user = me.user;

  if (me.storage === 'memory') {
    toast('Sunucuda kalıcı depolama yok: şirket verileri kaybolabilir. .env.example dosyasına bak.', 'bad');
  }

  const saved = localStorage.getItem('vlipa.company');
  const first = await loadCompany(saved || undefined);

  if (!state.company && first.companies?.length) {
    await loadCompany(first.companies[0].id);
  }

  drawShell();

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
}

boot();
