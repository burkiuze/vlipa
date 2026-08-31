/* Vlipa for one person: the shell.

   The business studio is built around a company — you pick one, and every
   page belongs to it. Nothing here does. This is the same assistant with the
   company taken out and the things one person has put in its place: what you
   have taught it, what you have asked it, and how you want it to answer.

   It shares the studio's chrome and stylesheet on purpose. Two apps that look
   like two products is exactly what somebody moving between them does not
   want. */

import { api } from '../studio/api.js';
import { avatar } from '../studio/avatar.js';
import { $, clear, el, toast } from '../studio/dom.js';
import * as code from '../studio/code.js';
import * as chat from './chat.js';
import * as github from './github.js';
import * as history from './history.js';
import * as mail from './mail.js';
import * as skills from './skills.js';
import * as settings from './settings.js';
import { load, me, shell } from './state.js';

const PAGES = [
  { id: 'chat',     label: 'Vlipa',        hint: 'Ask anything',        icon: 'M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2z' },
  { id: 'code',     label: 'Vlipa Studio', hint: 'Build it, publish it', icon: 'M9 8l-4 4 4 4M15 8l4 4-4 4' },
  { id: 'github',   label: 'GitHub',       hint: 'Your own repositories',   icon: 'M9 19c-4 1.2-4-2.2-5.6-2.7M14.5 21v-3.4a3 3 0 0 0-.8-2.3c2.7-.3 5.5-1.3 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.7 11.7 0 0 0-6.2 0C5.8 2.6 4.8 2.9 4.8 2.9a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 3.4 9.3c0 4.7 2.8 5.7 5.5 6a3 3 0 0 0-.8 2.3V21' },
  { id: 'mail',     label: 'Mail',         hint: 'Your mailbox, with Vlipa', icon: 'M4 6.5h16v11H4zM4 7l8 6 8-6' },
  { id: 'skills',   label: 'Skills',       hint: 'What it knows about you', icon: 'M12 4.5l2.1 4.6 5 .6-3.7 3.4 1 4.9L12 15.6l-4.4 2.4 1-4.9L4.9 9.7l5-.6z' },
  { id: 'history',  label: 'History',      hint: 'Everything you asked', icon: 'M12 7v5l3.5 2M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4' },
  { id: 'settings', label: 'Settings',     hint: 'You, and the defaults', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.2-2-3.4-2.2 1a7.6 7.6 0 0 0-2.6-1.5L14.2 3H9.8l-.4 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.2-1-2 3.4 2 1.2a7.6 7.6 0 0 0 0 3l-2 1.2 2 3.4 2.2-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.4h4.4l.4-2.4a7.6 7.6 0 0 0 2.6-1.5l2.2 1 2-3.4z' },
];

const VIEWS = {
  chat: chat.show,
  code: code.show,
  github: github.show,
  mail: mail.show,
  skills: skills.show,
  history: history.show,
  settings: settings.show,
};

let narrow = false;

// Settings changes the name and the face; this is how it says so.
shell.redraw = () => drawShell();

function page() {
  return (window.location.hash.replace('#/', '') || 'chat').split('?')[0];
}

/* One page carries something with it: which conversation History opened. */
function arg() {
  const query = window.location.hash.split('?')[1] || '';
  return new URLSearchParams(query).get('id') || '';
}

function drawShell() {
  const nav = clear($('nav'));
  const here = page();

  for (const item of PAGES) {
    nav.appendChild(el('button', {
      class: 'navitem',
      type: 'button',
      'data-page': item.id,
      title: item.hint,
      'aria-current': String(here === item.id),
      onclick: () => go(item.id),
    }, [
      el('span', { class: 'navitem__ico', html: `<svg viewBox="0 0 24 24" fill="none"><path d="${item.icon}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>` }),
      el('span', { class: 'navitem__label', text: item.label }),
    ]));
  }

  const who = clear($('who'));

  if (me.user) {
    who.appendChild(avatar(me.user, 24));
    who.appendChild(el('span', { class: 'who__name', text: me.user.name || me.user.email }));
  }
}

function go(id) {
  if (page() === id) render();
  else window.location.hash = `#/${id}`;
}

function openSide() { $('side').classList.add('is-open'); $('scrim').hidden = false; }
function closeSide() { $('side').classList.remove('is-open'); $('scrim').hidden = true; }

async function render() {
  const id = page();
  const item = PAGES.find((entry) => entry.id === id) || PAGES[0];

  // Vlipa Studio paints its own dark theme over the view; leaving takes it
  // back off again.
  if (item.id !== 'code') code.leave();

  $('pageTitle').textContent = item.label;

  // Vlipa Studio is a workbench and Mail is a mailbox: both take the whole
  // area, without a title bar above them.
  document.querySelector('.app').classList.toggle('is-full', item.id === 'code' || item.id === 'mail');

  drawShell();
  closeSide();

  try {
    await (VIEWS[item.id] || chat.show)(arg());
  } catch (error) {
    clear($('view')).appendChild(el('div', { class: 'empty empty--big' }, [
      el('h3', { text: 'This page did not load' }),
      el('p', { text: error.message }),
    ]));
  }
}

function ready() {
  document.documentElement.dataset.booted = '1';
}

async function boot() {
  drawShell();

  // Both are wanted and neither depends on the other, so they go together:
  // waiting for the session before asking for the account is the whole of the
  // wait before the first screen.
  const mine = api('/api/me', { method: 'POST', body: { action: 'load' } });
  mine.catch(() => {});

  let session;

  try {
    session = await api('/api/auth/me');
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      window.location.replace('/login?next=/me');
      return;
    }

    throw error;
  }

  if (!session.user) {
    window.location.replace('/login?next=/me');
    return;
  }

  me.user = session.user;

  if (session.storage === 'memory') {
    toast('No storage on the server: your chats and skills will not be kept.', 'bad');
  }

  // A personal account that will not load is not a reason to sit on a blank
  // page — Vlipa still answers, it simply answers without the skills.
  try {
    const data = await mine;

    me.skills = data.skills || [];
    me.settings = data.settings || me.settings;
    me.chats = data.chats || [];
    me.user = data.user || me.user;
  } catch {
    await load().catch(() => toast('Your skills and history did not load.', 'bad'));
  }

  const fold = (want) => {
    narrow = want;
    document.querySelector('.app').classList.toggle('is-narrow', narrow);
    localStorage.setItem('vlipa.me.narrow', narrow ? '1' : '');
    $('sideFold').setAttribute('aria-label', narrow ? 'Widen the menu' : 'Narrow the menu');
    $('sideFold').setAttribute('title', narrow ? 'Widen the menu' : 'Narrow the menu');
    drawShell();
  };

  fold(localStorage.getItem('vlipa.me.narrow') === '1');

  $('sideFold').addEventListener('click', () => fold(!narrow));
  $('burger').addEventListener('click', openSide);
  $('scrim').addEventListener('click', closeSide);

  $('signOut').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.assign('/');
  });

  // The GitHub chip in the editor's bar: registered before the first draw,
  // and its status fetched in the background rather than held in front of it.
  github.arm().catch(() => {});

  window.addEventListener('hashchange', render);
  await render();
  ready();
}

boot().catch((error) => {
  ready();
  clear($('view')).appendChild(el('div', { class: 'empty empty--big' }, [
    el('h3', { text: 'Vlipa did not open' }),
    el('p', { text: error.message || 'Something went wrong.' }),
    el('p', { class: 'muted', text: error.status ? `The server answered ${error.status}.` : 'No answer from the server.' }),
    el('button', { class: 'btn', type: 'button', text: 'Try again', onclick: () => window.location.reload() }),
  ]));
});
