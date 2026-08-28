/* Groups: where the team talks.

   One column lists the groups, the other holds the conversation. Messages are
   fetched every few seconds while the page is open. Talking out loud happens
   in Meetings, not here. */

import { api, can, state } from './api.js';
import { $, clear, dialog, el, field, toast, when } from './dom.js';

let groups = [];
let openGroup = null;
let forCompany = '';
let onList = () => {};

/* The menu lists the same groups, so it is told whenever this list changes. */
export function watch(fn) {
  onList = fn;
  onList(groups);
}

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
      // Polling for what has just been said is the one read that must not be
      // answered from a moment ago.
      const data = await api(`/api/groups?companyId=${state.companyId}&id=${openGroup.id}&since=${lastAt}`, { fresh: true });
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

/* The company's common room: everybody in the company writes in it, and it is
   not one person's to close. */
function openToEveryone(group) {
  return Boolean(group?.everyone || group?.name === 'General');
}

function mayPost() {
  return openToEveryone(openGroup) || can('group.post');
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

function draw() {
  const view = clear($('view'));

  if (!groups.length) {
    view.appendChild(el('div', { class: 'workbench workbench--plain' }, [el('div', { class: 'empty empty--big' }, [
      el('h3', { text: 'No groups yet' }),
      el('p', { text: 'A group is where one part of the team talks: a channel of its own, kept for everybody who joins later.' }),
      can('group.manage')
        ? el('button', { class: 'btn', type: 'button', text: 'Create the first group', onclick: create })
        : el('p', { class: 'muted', text: 'Creating one is an admin job.' }),
    ])]));
    return;
  }

  const room = el('section', { class: 'grouproom' });

  if (!openGroup) {
    room.appendChild(el('div', { class: 'empty empty--big' }, [
      el('h3', { text: 'Pick a group' }),
      el('p', { text: 'They are listed under Groups in the menu on the left.' }),
    ]));
  } else {
    room.appendChild(el('header', { class: 'groupbar' }, [
      el('div', { class: 'groupbar__title' }, [
        el('h3', { text: `# ${openGroup.name}` }),
        el('span', { class: 'muted' }, [
          el('span', { id: 'groupCount', text: '' }),
          openToEveryone(openGroup) ? ' · everybody in the company' : '',
          openGroup.createdAt ? ` · opened ${when(openGroup.createdAt)}` : '',
        ]),
      ]),
      can('group.manage')
        ? el('div', { class: 'groupbar__acts' }, [
            el('button', { class: 'chip', type: 'button', text: '+ New group', onclick: create }),
            el('button', { class: 'ghostlink', type: 'button', text: 'Rename', onclick: rename }),
            openToEveryone(openGroup)
              ? null
              : el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Delete', onclick: drop }),
          ])
        : null,
    ]));

    room.appendChild(el('div', { class: 'grouplog', id: 'groupLog' }));

    const input = el('textarea', {
      id: 'groupInput',
      rows: 1,
      disabled: !mayPost(),
      placeholder: mayPost() ? `Write to #${openGroup.name}…` : 'Your role cannot write here.',
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
        disabled: !mayPost(),
        html: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12h13M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        onclick: () => post(input.value),
      }),
    ]));
  }

  // The list of groups lives in the menu on the left, so the room takes the
  // whole workbench rather than repeating it.
  view.appendChild(el('div', { class: 'workbench' }, [room]));

  drawMessages();
  $('groupInput')?.focus();
}

async function load(id) {
  // Nothing carries over from another company: a group you had open there is
  // not a group here, and asking for it is how the page used to come back
  // empty when you switched.
  if (forCompany !== state.companyId) {
    forCompany = state.companyId;
    openGroup = null;
    messages = [];
    lastAt = 0;
    groups = [];
  }

  const wanted = id || openGroup?.id || '';
  const query = new URLSearchParams({ companyId: state.companyId });
  if (wanted) query.set('id', wanted);

  let data;

  try {
    data = await api(`/api/groups?${query}`);
  } catch (error) {
    // The group is gone, or belongs to a company you have left. Show the ones
    // that are here rather than an error page.
    if (error.status !== 404 || !wanted) throw error;

    openGroup = null;
    return load();
  }

  groups = data.groups || [];
  onList(groups);

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

export async function show(id) {
  clear($('view')).appendChild(el('p', { class: 'empty', text: 'Loading groups…' }));
  await load(id || openGroup?.id);
}

export function leave() {
  stopPolling();
}
