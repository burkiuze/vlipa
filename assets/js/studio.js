/* The studio: conversations with Vlipa.

   Conversations live in this browser (localStorage) and travel with each
   request, so the server keeps nothing between turns. */

const $ = (id) => document.getElementById(id);

const log = $('log');
const thread = $('thread');
const input = $('input');
const hint = $('hint');

const AVATAR = 'assets/img/vlipa-ai-96.png';
const STORE = 'vlipa.chats';
const CURRENT = 'vlipa.chat';

const state = {
  chats: [],
  chatId: null,
  mode: 'fast',
  busy: false,
};

/* ---------- little DOM helper ---------- */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }

  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  return node;
}

function scrollDown() {
  requestAnimationFrame(() => thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' }));
}

/* ---------- stored conversations ---------- */

function readStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeStore() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state.chats.slice(0, 40)));
    if (state.chatId) localStorage.setItem(CURRENT, state.chatId);
  } catch { /* private mode, a full quota: the conversation still works */ }
}

function current() {
  return state.chats.find((chat) => chat.id === state.chatId) || null;
}

function titleFrom(messages) {
  const first = messages.find((message) => message.role === 'user');
  if (!first) return 'Yeni sohbet';
  return first.content.replace(/\s+/g, ' ').trim().slice(0, 44) || 'Yeni sohbet';
}

function when(stamp) {
  const date = new Date(stamp);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);

  if (days === 0) return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'dün';
  if (days < 7) return `${days} gün önce`;
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

function newChat({ render = true } = {}) {
  const chat = {
    id: `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    title: 'Yeni sohbet',
    updatedAt: Date.now(),
    messages: [],
  };

  state.chats.unshift(chat);
  state.chatId = chat.id;

  writeStore();
  if (render) { drawSidebar(); drawThread(); }
  return chat;
}

function openChat(id) {
  state.chatId = id;
  writeStore();
  drawSidebar();
  drawThread();
  closeSidebar();
}

function deleteChat(id) {
  state.chats = state.chats.filter((chat) => chat.id !== id);

  if (state.chatId === id) {
    state.chatId = state.chats[0]?.id || null;
    if (!state.chatId) newChat({ render: false });
  }

  writeStore();
  drawSidebar();
  drawThread();
}

function record(role, content) {
  const chat = current() || newChat({ render: false });

  chat.messages.push({ role, content });
  chat.messages = chat.messages.slice(-40);
  chat.title = titleFrom(chat.messages);
  chat.updatedAt = Date.now();

  state.chats = [chat, ...state.chats.filter((other) => other.id !== chat.id)];

  writeStore();
  drawSidebar();
}

/* The last few turns, which is what the model is given. */
function history() {
  return (current()?.messages || []).slice(-16);
}

/* ---------- sidebar ---------- */

function drawSidebar() {
  const list = $('chatList');
  list.innerHTML = '';

  const saved = state.chats.filter((chat) => chat.messages.length);

  if (!saved.length) {
    list.appendChild(el('p', { class: 'side__empty', text: 'Henüz sohbet yok. Aşağıdan yaz, burada birikecek.' }));
    return;
  }

  for (const chat of saved) {
    list.appendChild(el('button', {
      class: 'chatrow',
      type: 'button',
      'aria-current': String(chat.id === state.chatId),
      onclick: () => openChat(chat.id),
    }, [
      el('span', {}, [
        el('b', { text: chat.title }),
        el('span', { text: `${when(chat.updatedAt)} · ${chat.messages.length} mesaj` }),
      ]),
      el('span', {
        class: 'chatrow__x',
        role: 'button',
        title: 'Sohbeti sil',
        onclick: (event) => {
          event.stopPropagation();
          deleteChat(chat.id);
        },
      }, [el('span', { html: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' })]),
    ]));
  }
}

function openSidebar() { $('side').classList.add('is-open'); $('scrim').hidden = false; }
function closeSidebar() { $('side').classList.remove('is-open'); $('scrim').hidden = true; }

/* ---------- the thread ---------- */

function welcome() {
  return el('div', { class: 'welcome', id: 'welcome' }, [
    el('img', { class: 'welcome__photo', src: 'assets/img/vlipa-ai-256.png', alt: 'Vlipa', width: 88, height: 88 }),
    el('h1', { text: 'Ben Vlipa' }),
    el('p', { text: 'Bir şey sor. İstersen önce düşünmemi, istersen hemen cevap vermemi seç.' }),
    el('div', { class: 'starters' }, [
      el('button', { type: 'button', text: 'Sen kimsin?' }),
      el('button', { type: 'button', text: 'vlipa neler yapıyor?' }),
      el('button', { type: 'button', text: 'Küçük bir işletmeye otomasyon fikri ver' }),
    ]),
  ]);
}

function drawThread() {
  const chat = current();
  log.innerHTML = '';

  if (!chat || !chat.messages.length) {
    log.appendChild(welcome());
    $('clear').hidden = true;
    return;
  }

  $('clear').hidden = false;
  for (const message of chat.messages) {
    turn({ mine: message.role === 'user', text: message.content });
  }

  scrollDown();
}

function turn({ mine, text, node, error }) {
  $('welcome')?.remove();
  if (!mine) $('clear').hidden = false;

  const avatar = mine
    ? el('span')
    : el('img', { class: 'turn__avatar', src: AVATAR, alt: 'Vlipa', width: 30, height: 30 });

  const body = el('div', { class: 'turn__body' }, node ? [node] : [text || '']);
  const wrap = el('div', { class: `turn${mine ? ' turn--me' : ''}${error ? ' turn--error' : ''}` }, [avatar, body]);

  log.appendChild(wrap);
  scrollDown();

  return { wrap, body };
}

function pendingTurn() {
  return turn({ node: el('span', { class: 'dots' }, [el('i'), el('i'), el('i')]) });
}

/* A failed turn says what actually went wrong underneath, so a dead model id
   or a spent quota is visible instead of the same sentence every time. */
function showFailure(slot, error) {
  slot.wrap.classList.add('turn--error');
  slot.body.textContent = error.message || 'Bir şeyler ters gitti.';

  if (error.reason) slot.body.appendChild(el('div', { class: 'turn__why', text: error.reason }));

  if (error.tried?.length) {
    slot.body.appendChild(el('div', {
      class: 'turn__why',
      text: `Denenen modeller: ${error.tried.join(', ')}`,
    }));
  }

  scrollDown();
}

/* ---------- asking Vlipa ---------- */

async function ask(message) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, history: history(), mode: state.mode }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.ok) {
    const failure = new Error(data.error || 'Vlipa şu an yanıt veremiyor.');
    failure.reason = data.reason;
    failure.tried = data.tried;
    throw failure;
  }

  return data.reply;
}

async function send(text) {
  const message = String(text ?? input.value).trim();
  if (!message || state.busy) return;

  state.busy = true;
  input.value = '';
  input.style.height = 'auto';
  $('send').disabled = true;

  turn({ mine: true, text: message });
  const pending = pendingTurn();

  try {
    const reply = await ask(message);

    record('user', message);
    record('assistant', reply);

    pending.body.textContent = reply;
    scrollDown();
  } catch (error) {
    showFailure(pending, error);
  } finally {
    state.busy = false;
    $('send').disabled = false;
    input.focus();
  }
}

/* ---------- wiring ---------- */

function boot() {
  state.chats = readStore();
  state.chatId = localStorage.getItem(CURRENT);

  if (!current()) {
    const withMessages = state.chats.find((chat) => chat.messages.length);
    state.chatId = withMessages ? withMessages.id : null;
  }

  if (!state.chatId) newChat({ render: false });

  drawSidebar();
  drawThread();

  document.querySelectorAll('.modes button').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;

      document.querySelectorAll('.modes button').forEach((other) => {
        other.setAttribute('aria-pressed', String(other === button));
      });

      hint.textContent = state.mode === 'thinking'
        ? 'Düşün modu: önce düşünür, sonra cevaplar. Biraz daha yavaş.'
        : 'Enter gönderir, Shift + Enter alt satıra geçer.';
    });
  });

  $('send').addEventListener('click', () => send());
  $('newChat').addEventListener('click', () => { newChat(); closeSidebar(); input.focus(); });
  $('burger').addEventListener('click', openSidebar);
  $('scrim').addEventListener('click', closeSidebar);

  $('clear').addEventListener('click', () => {
    const chat = current();
    if (!chat) return;

    chat.messages = [];
    chat.title = 'Yeni sohbet';

    writeStore();
    drawSidebar();
    drawThread();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 168)}px`;
  });

  log.addEventListener('click', (event) => {
    const starter = event.target.closest('.starters button');
    if (starter) send(starter.textContent);
  });

  fetch('/api/status')
    .then((response) => response.json())
    .then((data) => {
      if (data.ready) return;
      hint.textContent = 'Sunucuda OPENROUTER_API_KEY tanımlı değil, bu yüzden Vlipa şu an cevap veremiyor.';
      hint.classList.add('hint--warn');
    })
    .catch(() => { /* the studio still loads; the first message will report it */ });

  input.focus();
}

boot();
