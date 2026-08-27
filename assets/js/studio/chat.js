/* Chat: talking to Vlipa.

   Conversations live in the browser (localStorage) and travel with every
   request; the server keeps nothing between turns. */

import { api } from './api.js';
import { $, clear, el, when } from './dom.js';

const STORE = 'vlipa.chats';
const CURRENT = 'vlipa.chat';
const AVATAR = 'assets/img/vlipa-ai-96.png';

const chat = {
  chats: [],
  chatId: null,
  mode: 'fast',
  busy: false,
};

/* ---------- storage ---------- */

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function write() {
  try {
    localStorage.setItem(STORE, JSON.stringify(chat.chats.slice(0, 40)));
    if (chat.chatId) localStorage.setItem(CURRENT, chat.chatId);
  } catch { /* private mode, a full quota: the conversation still works */ }
}

function current() {
  return chat.chats.find((item) => item.id === chat.chatId) || null;
}

function titleFrom(messages) {
  const first = messages.find((message) => message.role === 'user');
  if (!first) return 'New chat';
  return first.content.replace(/\s+/g, ' ').trim().slice(0, 40) || 'New chat';
}

function newChat({ draw = true } = {}) {
  const item = {
    id: `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    title: 'New chat',
    updatedAt: Date.now(),
    messages: [],
  };

  chat.chats.unshift(item);
  chat.chatId = item.id;

  write();
  if (draw) render();
  return item;
}

function record(role, content) {
  const item = current() || newChat({ draw: false });

  item.messages.push({ role, content });
  item.messages = item.messages.slice(-40);
  item.title = titleFrom(item.messages);
  item.updatedAt = Date.now();

  chat.chats = [item, ...chat.chats.filter((other) => other.id !== item.id)];
  write();
}

/* ---------- talking ---------- */

async function ask(message) {
  const data = await api('/api/chat', {
    method: 'POST',
    body: { message, history: (current()?.messages || []).slice(-16), mode: chat.mode },
  });

  return data.reply;
}

function turn({ mine, text, node, error }) {
  const log = $('chatLog');
  $('chatWelcome')?.remove();

  const avatar = mine ? el('span') : el('img', { class: 'turn__avatar', src: AVATAR, alt: 'Vlipa', width: 30, height: 30 });
  const body = el('div', { class: 'turn__body' }, node ? [node] : [text || '']);
  const wrap = el('div', { class: `turn${mine ? ' turn--me' : ''}${error ? ' turn--error' : ''}` }, [avatar, body]);

  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;

  return { wrap, body };
}

async function send(text) {
  const input = $('chatInput');
  const message = String(text ?? input.value).trim();
  if (!message || chat.busy) return;

  chat.busy = true;
  input.value = '';
  input.style.height = 'auto';

  turn({ mine: true, text: message });
  const pending = turn({ node: el('span', { class: 'dots' }, [el('i'), el('i'), el('i')]) });

  try {
    const reply = await ask(message);

    record('user', message);
    record('assistant', reply);

    pending.body.textContent = reply;
    drawList();
  } catch (error) {
    pending.wrap.classList.add('turn--error');
    pending.body.textContent = error.message || 'Something went wrong.';

    if (error.reason) pending.body.appendChild(el('div', { class: 'turn__why', text: error.reason }));
    if (error.tried?.length) {
      pending.body.appendChild(el('div', { class: 'turn__why', text: `Models tried: ${error.tried.join(', ')}` }));
    }
  } finally {
    chat.busy = false;
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
    input.focus();
  }
}

/* ---------- drawing ---------- */

function drawList() {
  const list = clear($('chatList'));
  const saved = chat.chats.filter((item) => item.messages.length);

  if (!saved.length) {
    list.appendChild(el('span', { class: 'muted', text: 'No chats yet.' }));
    return;
  }

  for (const item of saved.slice(0, 12)) {
    list.appendChild(el('button', {
      type: 'button',
      class: `chatpill${item.id === chat.chatId ? ' is-on' : ''}`,
      title: `${item.title} · ${when(item.updatedAt)}`,
      onclick: () => { chat.chatId = item.id; write(); render(); },
    }, [
      el('span', { text: item.title }),
      el('span', {
        class: 'chatpill__x',
        role: 'button',
        title: 'Delete',
        text: '×',
        onclick: (event) => {
          event.stopPropagation();
          chat.chats = chat.chats.filter((other) => other.id !== item.id);
          if (chat.chatId === item.id) chat.chatId = chat.chats[0]?.id || null;
          if (!chat.chatId) newChat({ draw: false });
          write();
          render();
        },
      }),
    ]));
  }
}

function render() {
  const view = clear($('view'));

  view.appendChild(el('div', { class: 'chatbar' }, [
    el('div', { class: 'chatpills', id: 'chatList' }),
    el('button', { class: 'btn btn--sm', type: 'button', text: '+ New chat', onclick: () => newChat() }),
  ]));

  const log = el('div', { class: 'chatlog', id: 'chatLog' });
  const item = current();

  if (!item || !item.messages.length) {
    log.appendChild(el('div', { class: 'welcome', id: 'chatWelcome' }, [
      el('img', { class: 'welcome__photo', src: 'assets/img/vlipa-ai-256.png', alt: 'Vlipa', width: 76, height: 76 }),
      el('h2', { text: 'I am Vlipa' }),
      el('p', { text: 'Ask me something. Have me answer straight away, or think it through first.' }),
      el('div', { class: 'starters' }, [
        'Who are you?',
        'Draw up a week of tasks for my company',
        'What columns should a customer table have?',
      ].map((text) => el('button', { type: 'button', text, onclick: () => send(text) }))),
    ]));
  } else {
    for (const message of item.messages) {
      const avatar = message.role === 'user'
        ? el('span')
        : el('img', { class: 'turn__avatar', src: AVATAR, alt: 'Vlipa', width: 30, height: 30 });

      log.appendChild(el('div', { class: `turn${message.role === 'user' ? ' turn--me' : ''}` }, [
        avatar,
        el('div', { class: 'turn__body' }, [message.content]),
      ]));
    }
  }

  view.appendChild(log);

  const input = el('textarea', {
    id: 'chatInput',
    rows: 1,
    placeholder: 'Write something…',
    onkeydown: (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    },
    oninput: (event) => {
      event.target.style.height = 'auto';
      event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`;
    },
  });

  view.appendChild(el('div', { class: 'composer' }, [
    el('div', { class: 'composer__box' }, [
      input,
      el('div', { class: 'composer__row' }, [
        el('div', { class: 'modes' }, [['fast', 'Fast'], ['thinking', 'Think']].map(([mode, label]) =>
          el('button', {
            type: 'button',
            'aria-pressed': String(chat.mode === mode),
            text: label,
            onclick: (event) => {
              chat.mode = mode;
              event.target.parentElement.querySelectorAll('button').forEach((button) => {
                button.setAttribute('aria-pressed', String(button === event.target));
              });
            },
          }))),
        el('span', { class: 'grow' }),
        el('button', {
          class: 'round round--send', type: 'button', title: 'Send',
          html: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12h13M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
          onclick: () => send(),
        }),
      ]),
    ]),
  ]));

  drawList();
  log.scrollTop = log.scrollHeight;
  input.focus();
}

export async function show() {
  if (!chat.chats.length) {
    chat.chats = read();
    chat.chatId = localStorage.getItem(CURRENT);
    if (!current()) chat.chatId = chat.chats.find((item) => item.messages.length)?.id || null;
    if (!chat.chatId) newChat({ draw: false });
  }

  render();
}

export function summary() {
  return { chats: chat.chats.filter((item) => item.messages.length).length };
}
