/* Everything you have asked, in one list.

   The list arrives with the account — a title, when it was, how many turns —
   and the transcript itself is only fetched when one is opened. A hundred
   conversations is a list; a hundred transcripts is a download. */

import { $, clear, el, toast, when } from '../studio/dom.js';
import { call, me } from './state.js';

function day(stamp) {
  const date = new Date(stamp);
  const start = new Date();

  start.setHours(0, 0, 0, 0);

  const days = Math.round((start - new Date(date).setHours(0, 0, 0, 0)) / 86400000);

  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  if (days < 30) return 'This month';

  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

async function drop(chat) {
  if (!window.confirm(`Delete "${chat.title}"?`)) return;

  const data = await call({ action: 'chat.drop', id: chat.id }).catch((error) => {
    toast(error.message, 'bad');
    return null;
  });

  if (!data) return;

  me.chats = data.chats || [];
  show();
}

function row(chat) {
  return el('div', { class: 'histrow' }, [
    el('a', { class: 'histrow__open', href: `#/chat?id=${encodeURIComponent(chat.id)}` }, [
      el('span', { class: 'histrow__ico', html: '<svg viewBox="0 0 24 24" fill="none"><path d="M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
      el('span', { class: 'histrow__text' }, [
        el('b', { text: chat.title }),
        el('span', { text: `${chat.turns} message${chat.turns === 1 ? '' : 's'} · ${when(chat.updatedAt)}` }),
      ]),
    ]),
    el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Delete', onclick: () => drop(chat) }),
  ]);
}

export async function show() {
  const view = clear($('view'));

  view.appendChild(el('div', { class: 'pagehead' }, [
    el('div', {}, [
      el('h2', { text: 'History' }),
      el('p', { class: 'muted', text: 'Every conversation on this account, on whichever machine you signed in from.' }),
    ]),
    me.chats.length ? el('a', { class: 'btn btn--ghost', href: '#/chat', text: 'New chat' }) : null,
  ]));

  if (!me.chats.length) {
    view.appendChild(el('div', { class: 'empty empty--big' }, [
      el('h3', { text: 'Nothing here yet' }),
      el('p', { text: 'Conversations appear here as soon as you have one.' }),
      el('div', { class: 'spread' }, [el('a', { class: 'btn', href: '#/chat', text: 'Talk to Vlipa' })]),
    ]));

    return;
  }

  let heading = '';

  const list = el('div', { class: 'histlist' });

  for (const chat of me.chats) {
    const label = day(chat.updatedAt);

    if (label !== heading) {
      heading = label;
      list.appendChild(el('h4', { class: 'histday', text: label }));
    }

    list.appendChild(row(chat));
  }

  view.appendChild(list);
}
