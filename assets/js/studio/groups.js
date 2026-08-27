/* Groups: where the team talks.

   One column lists the groups, the other holds the conversation. Messages are
   fetched every few seconds while the page is open. Talking out loud happens
   in Meetings, not here. */

import { api, can, state } from './api.js';
import { $, clear, dialog, el, field, toast, when } from './dom.js';

let groups = [];
let openGroup = null;
let messages = [];
let timer = null;
let lastAt = 0;

function stopPolling() {
  clearInterval(timer);
  timer = null;
}

/* Only poll while this page is the one being looked at. */
function startPolling() {
  stopPolling();

  timer = setInterval(async () => {
    if (!openGroup || document.hidden || !document.getElementById('groupLog')) return;

    try {
      const data = await api(`/api/groups?companyId=${state.companyId}&id=${openGroup.id}&since=${lastAt}`);
      if (!data.messages?.length) return;

      messages = messages.concat(data.messages);
      lastAt = Math.max(lastAt, ...data.messages.map((message) => message.at));
      drawMessages();
    } catch { /* a dropped poll is not worth shouting about */ }
  }, 4000);
}

export function create() {
  dialog({
    title: 'New group',
    confirm: 'Create',
    body: [field('Group name', el('input', { name: 'name', required: true, maxlength: 40, placeholder: 'Design' }),
      'A place for one part of the team to talk.')],
    onConfirm: async (data) => {
      const created = await api('/api/groups', {
        method: 'POST',
        body: { action: 'create', companyId: state.companyId, name: data.get('name') },
      });

      await load(created.group.id);
      toast('Group created.');
    },
  });
}

function rename() {
  dialog({
    title: 'Rename group',
    body: [field('Name', el('input', { name: 'name', required: true, maxlength: 40, value: openGroup.name }))],
    onConfirm: async (data) => {
      await api('/api/groups', {
        method: 'POST',
        body: { action: 'rename', companyId: state.companyId, groupId: openGroup.id, name: data.get('name') },
      });

      await load(openGroup.id);
      toast('Renamed.');
    },
  });
}

async function drop() {
  if (!window.confirm(`Delete "${openGroup.name}" and the conversation in it?`)) return;

  try {
    await api('/api/groups', {
      method: 'POST',
      body: { action: 'drop', companyId: state.companyId, groupId: openGroup.id },
    });

    openGroup = null;
    await load();
    toast('Group deleted.');
  } catch (error) {
    toast(error.message, 'bad');
  }
}

async function post(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;

  const input = $('groupInput');
  input.value = '';
  input.style.height = 'auto';

  try {
    const sent = await api('/api/groups', {
      method: 'POST',
      body: { action: 'post', companyId: state.companyId, groupId: openGroup.id, text: trimmed },
    });

    messages.push(sent.message);
    lastAt = Math.max(lastAt, sent.message.at);
    drawMessages();
  } catch (error) {
    toast(error.message, 'bad');
    input.value = trimmed;
  }
}

/* A line above the first message of each day, so a long conversation stays
   readable. */
function dayOf(stamp) {
  const date = new Date(stamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();

  if (sameDay) return 'Today';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

function drawMessages() {
  const log = $('groupLog');
  if (!log) return;

  const count = $('groupCount');
  if (count) count.textContent = `${messages.length} message${messages.length === 1 ? '' : 's'}`;

  const wasAtBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  clear(log);

  if (!messages.length) {
    log.appendChild(el('div', { class: 'grouplog__empty' }, [
      el('b', { text: `# ${openGroup.name}` }),
      el('span', { text: 'Nothing here yet. Write the first message.' }),
    ]));
    return;
  }

  let lastWho = null;
  let lastDay = null;

  for (const message of messages) {
    const day = dayOf(message.at);

    if (day !== lastDay) {
      log.appendChild(el('div', { class: 'daymark' }, [el('span', { text: day })]));
      lastDay = day;
      lastWho = null;
    }

    const mine = message.userId === state.user.id;
    const sameAsBefore = lastWho === message.userId;
    lastWho = message.userId;

    log.appendChild(el('div', { class: `msg${mine ? ' msg--me' : ''}${sameAsBefore ? ' msg--run' : ''}` }, [
      sameAsBefore ? null : el('div', { class: 'msg__who' }, [
        el('b', { text: mine ? 'You' : message.name }),
        el('span', { text: new Date(message.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }),
      ]),
      el('div', { class: 'msg__body', text: message.text }),
    ]));
  }

  if (wasAtBottom) log.scrollTop = log.scrollHeight;
}

function groupList() {
  return el('aside', { class: 'grouprail' }, [
    el('div', { class: 'grouprail__head' }, [
      el('b', { text: 'Groups' }),
      can('group.manage')
        ? el('button', { class: 'ghostlink', type: 'button', text: '+ New', onclick: create })
        : null,
    ]),

    el('div', { class: 'grouprail__list' }, groups.map((group) => el('button', {
      type: 'button',
      class: `grouprail__item${openGroup?.id === group.id ? ' is-on' : ''}`,
      onclick: () => load(group.id),
    }, [
      el('span', { class: 'grouprail__hash', text: '#' }),
      el('span', { class: 'grouprail__name', text: group.name }),
    ]))),
  ]);
}

function draw() {
  const view = clear($('view'));

  if (!groups.length) {
    view.appendChild(el('div', { class: 'empty empty--big' }, [
      el('h3', { text: 'No groups yet' }),
      el('p', { text: 'A group is where one part of the team talks: a channel of its own, kept for everybody who joins later.' }),
      can('group.manage')
        ? el('button', { class: 'btn', type: 'button', text: 'Create the first group', onclick: create })
        : el('p', { class: 'muted', text: 'Creating one is an admin job.' }),
    ]));
    return;
  }

  const room = el('section', { class: 'grouproom' });

  if (!openGroup) {
    room.appendChild(el('p', { class: 'empty', text: 'Pick a group.' }));
  } else {
    room.appendChild(el('header', { class: 'groupbar' }, [
      el('div', { class: 'groupbar__title' }, [
        el('h3', { text: `# ${openGroup.name}` }),
        el('span', { class: 'muted' }, [
          el('span', { id: 'groupCount', text: '' }),
          openGroup.createdAt ? ` · opened ${when(openGroup.createdAt)}` : '',
        ]),
      ]),
      can('group.manage')
        ? el('div', { class: 'groupbar__acts' }, [
            el('button', { class: 'ghostlink', type: 'button', text: 'Rename', onclick: rename }),
            el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Delete', onclick: drop }),
          ])
        : null,
    ]));

    room.appendChild(el('div', { class: 'grouplog', id: 'groupLog' }));

    const input = el('textarea', {
      id: 'groupInput',
      rows: 1,
      disabled: !can('group.post'),
      placeholder: can('group.post') ? `Write to #${openGroup.name}…` : 'You cannot post here.',
      onkeydown: (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          post(event.target.value);
        }
      },
      oninput: (event) => {
        event.target.style.height = 'auto';
        event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`;
      },
    });

    room.appendChild(el('div', { class: 'groupsend' }, [
      input,
      el('button', {
        class: 'round round--send', type: 'button', title: 'Send',
        disabled: !can('group.post'),
        html: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12h13M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        onclick: () => post(input.value),
      }),
    ]));
  }

  view.appendChild(el('div', { class: 'groupwrap' }, [groupList(), room]));

  drawMessages();
  $('groupInput')?.focus();
}

async function load(id) {
  const query = new URLSearchParams({ companyId: state.companyId });
  if (id || openGroup) query.set('id', id || openGroup.id);

  const data = await api(`/api/groups?${query}`);

  groups = data.groups || [];

  if (data.group) {
    openGroup = data.group;
    messages = data.messages || [];
    lastAt = messages.length ? Math.max(...messages.map((message) => message.at)) : 0;
  } else if (!id && groups.length && !openGroup) {
    return load(groups[0].id);
  }

  if (openGroup && !groups.some((group) => group.id === openGroup.id)) openGroup = null;

  draw();
  startPolling();
}

export async function show() {
  clear($('view')).appendChild(el('p', { class: 'empty', text: 'Loading groups…' }));
  await load(openGroup?.id);
}

export function leave() {
  stopPolling();
}
