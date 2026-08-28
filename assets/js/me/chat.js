/* Vlipa, on your own account.

   The business studio keeps its conversations in the browser, which is right
   there: the work is the company's and the transcript is a convenience. Here
   the conversation is the whole thing somebody has, so it is kept on the
   account instead — open the same account on another machine and yesterday's
   thread is still there.

   What is different from the studio's chat, besides that: the skills go with
   every question, and there is no workspace to be pointed at, so Vlipa
   answers rather than offering to open a page. */

import { api } from '../studio/api.js';
import { $, clear, el, prose, toast } from '../studio/dom.js';
import { call, liveSkills, me } from './state.js';

const AVATAR = 'assets/img/vlipa-ai-96.png';

const open = {
  id: '',
  title: 'New chat',
  messages: [],
  busy: false,
};

export function reset() {
  open.id = '';
  open.title = 'New chat';
  open.messages = [];
}

/* Coming in from History: the transcript is fetched, then the page is drawn
   around it. */
export async function openChat(chatId) {
  const data = await call({ action: 'chat.open', id: chatId });

  open.id = data.chat.id;
  open.title = data.chat.title;
  open.messages = data.chat.messages || [];
  open.busy = false;
}

function titleFrom(messages) {
  const first = messages.find((message) => message.role === 'user');
  return first ? first.content.replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat' : 'New chat';
}

/* Keeping the thread. A failed save must not eat the answer on screen, so it
   is reported and the conversation carries on in the page. */
async function keep() {
  if (!open.messages.length) return;

  open.title = titleFrom(open.messages);

  try {
    const data = await call({
      action: 'chat.save',
      chat: { id: open.id || undefined, title: open.title, tool: 'chat', messages: open.messages },
    });

    if (data.chat) {
      open.id = data.chat.id;

      const already = me.chats.find((one) => one.id === open.id);
      const row = { id: open.id, title: open.title, tool: 'chat', turns: open.messages.length, updatedAt: data.chat.updatedAt };

      me.chats = [row, ...me.chats.filter((one) => one.id !== open.id)];
      if (!already) me.chats = me.chats.slice(0, 200);
    }
  } catch (error) {
    toast(`This chat was not saved: ${error.message}`, 'bad');
  }
}

function turn({ mine, text, node, error }) {
  const log = $('meLog');
  $('meWelcome')?.remove();

  const face = mine ? el('span') : el('img', { class: 'turn__avatar', src: AVATAR, alt: 'Vlipa', width: 30, height: 30 });
  const body = el('div', { class: 'turn__body' }, node ? [node] : [text || '']);
  const wrap = el('div', { class: `turn${mine ? ' turn--me' : ''}${error ? ' turn--error' : ''}` }, [face, body]);

  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;

  return { wrap, body };
}

async function send(text) {
  const input = $('meInput');
  const message = String(text ?? input.value).trim();
  if (!message || open.busy) return;

  open.busy = true;
  input.value = '';
  input.style.height = 'auto';

  turn({ mine: true, text: message });
  const pending = turn({ node: el('span', { class: 'dots' }, [el('i'), el('i'), el('i')]) });

  try {
    const answer = await api('/api/chat', {
      method: 'POST',
      body: {
        message,
        history: open.messages.slice(-16),
        mode: me.settings.mode,
        model: me.settings.model,
        skills: liveSkills(),
      },
    });

    open.messages.push({ role: 'user', content: message });
    open.messages.push({ role: 'assistant', content: answer.reply });
    open.messages = open.messages.slice(-120);

    clear(pending.body).appendChild(prose(answer.reply));
    keep();
  } catch (error) {
    pending.wrap.classList.add('turn--error');
    pending.body.textContent = error.message || 'Something went wrong.';

    if (error.reason) pending.body.appendChild(el('div', { class: 'turn__why', text: error.reason }));
    if (error.tried?.length) {
      pending.body.appendChild(el('div', { class: 'turn__why', text: `Models tried: ${error.tried.join(', ')}` }));
    }
  } finally {
    open.busy = false;
    $('meLog').scrollTop = $('meLog').scrollHeight;
    input.focus();
  }
}

/* How many standing instructions are riding along. Worth saying out loud:
   somebody who wrote "answer in Turkish" three weeks ago and forgot should be
   able to see why every answer is in Turkish. */
function skillLine() {
  const on = liveSkills().length;

  return el('a', {
    class: 'skillnote',
    href: '#/skills',
    title: 'Your skills',
    text: on ? `${on} skill${on === 1 ? '' : 's'} on` : 'No skills on',
  });
}

export async function show(chatId) {
  if (chatId && chatId !== open.id) {
    await openChat(chatId).catch(() => reset());
  }

  const view = clear($('view'));

  view.appendChild(el('div', { class: 'chatbar' }, [
    el('span', { class: 'chatbar__title', text: open.messages.length ? open.title : 'New chat' }),
    skillLine(),
    el('span', { class: 'grow' }),
    me.chats.length ? el('a', { class: 'ghostlink', href: '#/history', text: 'History' }) : null,
    el('button', {
      class: 'btn btn--sm', type: 'button', text: '+ New chat',
      onclick: () => { reset(); show(); },
    }),
  ]));

  const log = el('div', { class: 'chatlog', id: 'meLog' });

  if (!open.messages.length) {
    log.appendChild(el('div', { class: 'welcome', id: 'meWelcome' }, [
      el('img', { class: 'welcome__photo', src: 'assets/img/vlipa-ai-256.png', alt: 'Vlipa', width: 76, height: 76 }),
      el('h2', { text: me.user?.name ? `Hello, ${me.user.name.split(' ')[0]}` : 'I am Vlipa' }),
      el('p', { text: 'Ask me anything. What you teach me in Skills, I remember for every conversation.' }),
      el('div', { class: 'starters' }, [
        'Explain what you can do',
        'Help me plan my week',
        'Rewrite this email so it sounds warmer',
      ].map((text) => el('button', { type: 'button', text, onclick: () => send(text) }))),
    ]));
  } else {
    for (const message of open.messages) {
      const face = message.role === 'user'
        ? el('span')
        : el('img', { class: 'turn__avatar', src: AVATAR, alt: 'Vlipa', width: 30, height: 30 });

      log.appendChild(el('div', { class: `turn${message.role === 'user' ? ' turn--me' : ''}` }, [
        face,
        el('div', { class: 'turn__body' }, [message.role === 'user' ? message.content : prose(message.content)]),
      ]));
    }
  }

  view.appendChild(log);

  const input = el('textarea', {
    id: 'meInput',
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
            'aria-pressed': String(me.settings.mode === mode),
            text: label,
            onclick: (event) => {
              me.settings.mode = mode;
              event.target.parentElement.querySelectorAll('button').forEach((button) => {
                button.setAttribute('aria-pressed', String(button === event.target));
              });
              call({ action: 'settings', settings: me.settings }).catch(() => {});
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

  log.scrollTop = log.scrollHeight;
  input.focus();
}
