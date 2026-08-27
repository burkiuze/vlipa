/* Meetings: the company's video rooms.

   Video and audio run on Jitsi Meet: free, no account, and it brings the TURN
   servers a serverless deployment cannot. What is kept here is the room list:
   who opened it, what it is called, who is joining. */

import { api, can, state } from './api.js';
import { $, clear, dialog, el, field, toast, when } from './dom.js';

let meetings = [];
let host = 'meet.jit.si';
let joined = null;

function link(meeting) {
  return `https://${host}/${meeting.room}`;
}

export function create() {
  dialog({
    title: 'New meeting room',
    confirm: 'Open',
    body: [
      field('Room name', el('input', { name: 'title', required: true, maxlength: 80, placeholder: 'Monday stand-up' }),
        'A random tail is added to the address so nobody can guess their way in.'),
    ],
    onConfirm: async (data) => {
      await api('/api/meetings', {
        method: 'POST',
        body: { action: 'create', companyId: state.companyId, title: data.get('title') },
      });

      await load();
      toast('Room opened.');
    },
  });
}

async function close(meeting) {
  if (!window.confirm(`Close the room "${meeting.title}"?`)) return;

  try {
    await api('/api/meetings', { method: 'POST', body: { action: 'close', companyId: state.companyId, id: meeting.id } });
    if (joined?.id === meeting.id) joined = null;
    await load();
  } catch (error) {
    toast(error.message, 'bad');
  }
}

function draw() {
  const view = clear($('view'));

  view.appendChild(el('div', { class: 'toolbar' }, [
    el('h3', { text: `${meetings.length} oda` }),
    can('meeting.manage') ? el('button', { class: 'btn', type: 'button', text: '+ New room', onclick: create }) : null,
  ]));

  if (joined) {
    view.appendChild(el('div', { class: 'meetstage' }, [
      el('div', { class: 'meetstage__bar' }, [
        el('b', { text: joined.title }),
        el('div', { class: 'spread' }, [
          el('a', { class: 'ghostlink', href: link(joined), target: '_blank', rel: 'noopener', text: 'Open in a new tab' }),
          el('button', { class: 'ghostlink', type: 'button', text: 'Close', onclick: () => { joined = null; draw(); } }),
        ]),
      ]),
      el('iframe', {
        class: 'meetstage__frame',
        src: `${link(joined)}#userInfo.displayName="${encodeURIComponent(state.user.name || state.user.email)}"`,
        allow: 'camera; microphone; fullscreen; display-capture; autoplay',
        title: joined.title,
      }),
    ]));
  }

  if (!meetings.length) {
    view.appendChild(el('p', { class: 'empty', text: 'No rooms yet. Open one, share the address with the team, turn your camera on.' }));
    return;
  }

  view.appendChild(el('div', { class: 'cards' }, meetings.map((meeting) => el('article', { class: 'card' }, [
    el('h4', { text: meeting.title }),
    el('p', { class: 'muted', text: `Opened by ${meeting.createdByName || 'someone'} · ${when(meeting.createdAt)}` }),
    el('div', { class: 'spread' }, [
      el('button', {
        class: 'btn btn--sm', type: 'button', text: 'Join',
        onclick: () => { joined = meeting; draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
      }),
      el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', text: 'Copy link',
        onclick: () => { navigator.clipboard?.writeText(link(meeting)); toast('Link copied.'); },
      }),
      can('meeting.manage') ? el('button', {
        class: 'ghostlink ghostlink--bad', type: 'button', text: 'Close', onclick: () => close(meeting),
      }) : null,
    ]),
  ]))));

  view.appendChild(el('p', { class: 'footnote', text:
    'Video calls run on Jitsi Meet. Anyone with the room address can walk in, so keep the link inside the team.' }));
}

async function load() {
  const data = await api(`/api/meetings?companyId=${encodeURIComponent(state.companyId)}`);

  meetings = data.meetings || [];
  host = data.host || host;

  draw();
}

export async function show() {
  clear($('view')).appendChild(el('p', { class: 'empty', text: 'Loading rooms…' }));
  await load();
}

export function summary() {
  return { meetings: meetings.length };
}
