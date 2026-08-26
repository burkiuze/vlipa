/* The studio: conversations with Vlipa, typed or spoken.

   Conversations live in this browser (localStorage) and travel with each
   request, so the server keeps nothing between turns. Speech recognition is
   the browser's own Web Speech API: no audio is uploaded. Replies are spoken
   with Vlipa's voice from the server, and with the browser's voice when that
   is unavailable, so speaking degrades instead of breaking. */

const $ = (id) => document.getElementById(id);

const log = $('log');
const thread = $('thread');
const input = $('input');
const player = $('player');
const hint = $('hint');
const call = $('call');

const AVATAR = 'assets/img/vlipa-ai-96.png';
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const STORE = 'vlipa.chats';
const CURRENT = 'vlipa.chat';

const state = {
  chats: [],
  chatId: null,
  mode: 'fast',
  busy: false,
  inCall: false,
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

function bars(big) {
  return el('span', { class: `bars${big ? ' bars--big' : ''}` },
    [el('i'), el('i'), el('i'), el('i'), el('i')]);
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
  const chat = { id: `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`, title: 'Yeni sohbet', updatedAt: Date.now(), messages: [] };

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
    el('p', { text: 'Yaz, konuş ya da sesli aramayı başlat. İstersen önce düşünmemi, istersen hemen cevap vermemi seç.' }),
    el('div', { class: 'starters' }, [
      el('button', { type: 'button', text: 'Sen kimsin?' }),
      el('button', { type: 'button', text: 'vlipa neler yapıyor?' }),
      el('button', { type: 'button', text: 'Küçük bir işletmeye otomasyon fikri ver' }),
      el('button', { type: 'button', text: 'Saat kaç?' }),
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
    turn({ mine: message.role === 'user', text: message.content, meta: message.role === 'assistant' });
  }

  scrollDown();
}

function turn({ mine, text, node, error, meta }) {
  $('welcome')?.remove();
  if (!mine) $('clear').hidden = false;

  const avatar = mine
    ? el('span')
    : el('img', { class: 'turn__avatar', src: AVATAR, alt: 'Vlipa', width: 30, height: 30 });

  const body = el('div', { class: 'turn__body' }, node ? [node] : [text || '']);
  const wrap = el('div', { class: `turn${mine ? ' turn--me' : ''}${error ? ' turn--error' : ''}` }, [avatar, body]);

  log.appendChild(wrap);
  if (meta && text) body.appendChild(metaRow(text));
  scrollDown();

  return { wrap, body };
}

function pendingTurn_ui() {
  return turn({ node: el('span', { class: 'dots' }, [el('i'), el('i'), el('i')]) });
}

function metaRow(reply) {
  const listen = el('button', { type: 'button', title: 'Sesli oku' }, [
    el('span', { html: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 9a4 4 0 0 1 0 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' }),
    'Dinle',
  ]);

  listen.addEventListener('click', async () => {
    const label = listen.innerHTML;
    listen.replaceChildren(bars(false));

    await speak(reply);
    listen.innerHTML = label;
  });

  return el('div', { class: 'turn__meta' }, [
    el('span', { text: state.mode === 'thinking' ? 'Düşün' : 'Hızlı' }),
    listen,
  ]);
}

function settle(slot, reply) {
  slot.body.textContent = reply;
  slot.body.appendChild(metaRow(reply));
  scrollDown();
}

/* ---------- speaking, and the bars that go with it ---------- */

const sound = { ctx: null, source: null, analyser: null, frame: 0 };

function analyser() {
  if (sound.analyser) return sound.analyser;

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;

  try {
    sound.ctx = sound.ctx || new Ctx();
    sound.source = sound.source || sound.ctx.createMediaElementSource(player);
    sound.analyser = sound.ctx.createAnalyser();
    sound.analyser.fftSize = 64;

    sound.source.connect(sound.analyser);
    sound.analyser.connect(sound.ctx.destination);
  } catch {
    return null;   // some browsers refuse a second source on the same element
  }

  return sound.analyser;
}

/* Real levels while an audio file plays. */
function driveBars(node) {
  const scope = analyser();
  if (!node) return () => {};

  if (!scope) {
    node.classList.add('bars--synthetic');
    return () => node.classList.remove('bars--synthetic');
  }

  const data = new Uint8Array(scope.frequencyBinCount);
  const sticks = Array.from(node.children);
  const tall = node.classList.contains('bars--big') ? 50 : 15;
  const short = node.classList.contains('bars--big') ? 10 : 4;

  const tick = () => {
    scope.getByteFrequencyData(data);

    sticks.forEach((stick, index) => {
      const slot = Math.floor((index + 1) * (data.length / (sticks.length + 2)));
      const level = data[slot] / 255;
      stick.style.height = `${short + level * (tall - short)}px`;
    });

    sound.frame = requestAnimationFrame(tick);
  };

  tick();

  return () => {
    cancelAnimationFrame(sound.frame);
    sticks.forEach((stick) => { stick.style.height = ''; });
  };
}

/* The browser's own voice gives no signal to read, so the bars are animated. */
function fakeBars(node) {
  if (!node) return () => {};
  node.classList.add('bars--synthetic');
  return () => node.classList.remove('bars--synthetic');
}

function browserSpeak(text, node, onEnd) {
  if (!('speechSynthesis' in window)) { onEnd?.(); return; }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  const turkish = window.speechSynthesis.getVoices().find((voice) => voice.lang?.startsWith('tr'));

  if (turkish) utterance.voice = turkish;
  utterance.lang = turkish ? turkish.lang : 'tr-TR';
  utterance.rate = 1.03;

  const stop = fakeBars(node);
  const done = () => { stop(); onEnd?.(); };

  utterance.onend = done;
  utterance.onerror = done;

  window.speechSynthesis.speak(utterance);
}

function playBlob(blob, node, onEnd) {
  player.src = URL.createObjectURL(blob);

  const stop = driveBars(node);
  const done = () => { stop(); onEnd?.(); };

  player.onended = done;
  player.onerror = done;

  // Routing through an AudioContext is what makes the bars real, but a
  // suspended context would play nothing at all: wake it first, then start.
  const start = () => player.play().catch(done);

  if (sound.ctx && sound.ctx.state === 'suspended') sound.ctx.resume().then(start, start);
  else start();
}

async function speak(text, node) {
  if (!text) return;

  await new Promise(async (resolve) => {
    try {
      const response = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) throw new Error('no voice');
      playBlob(await response.blob(), node, resolve);
    } catch {
      browserSpeak(text, node, resolve);
    }
  });
}

/* ---------- asking Vlipa ---------- */

async function ask(message, { spoken = false } = {}) {
  const payload = { message, history: history(), mode: state.mode, voice: spoken };

  if (spoken) {
    const response = await fetch('/api/voice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const header = response.headers.get('x-vlipa-reply') || '';
      const reply = header
        ? new TextDecoder().decode(Uint8Array.from(atob(header), (c) => c.charCodeAt(0)))
        : '';

      return { reply: reply || '…', audio: await response.blob() };
    }

    const data = await response.json().catch(() => ({}));
    if (data.reply) return { reply: data.reply, audio: null };
    throw new Error(data.error || 'Vlipa sesli yanıt veremedi.');
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || 'Vlipa şu an yanıt veremiyor.');

  return { reply: data.reply, audio: null };
}

async function send(text) {
  const message = String(text ?? input.value).trim();
  if (!message || state.busy) return;

  state.busy = true;
  input.value = '';
  input.style.height = 'auto';
  $('send').disabled = true;

  turn({ mine: true, text: message });
  const pending = pendingTurn_ui();

  try {
    const { reply } = await ask(message);

    record('user', message);
    record('assistant', reply);
    settle(pending, reply);
  } catch (error) {
    pending.wrap.classList.add('turn--error');
    pending.body.textContent = error.message || 'Bir şeyler ters gitti.';
  } finally {
    state.busy = false;
    $('send').disabled = false;
    input.focus();
  }
}

/* ---------- dictation ---------- */

let dictation = null;

function setupMic() {
  const mic = $('mic');

  if (!Recognition) {
    mic.disabled = true;
    mic.title = 'Bu tarayıcı konuşma tanımayı desteklemiyor. Chrome ya da Edge dene.';
    return;
  }

  mic.addEventListener('click', () => {
    if (dictation) { dictation.stop(); return; }

    dictation = new Recognition();
    dictation.lang = 'tr-TR';
    dictation.interimResults = true;
    dictation.continuous = false;

    let heard = '';

    dictation.onstart = () => {
      mic.classList.add('is-live');
      mic.setAttribute('aria-pressed', 'true');
      hint.textContent = 'Dinliyorum… bitince mikrofona tekrar bas.';
    };

    dictation.onresult = (event) => {
      heard = Array.from(event.results).map((result) => result[0].transcript).join(' ');
      input.value = heard;
    };

    dictation.onerror = (event) => {
      hint.textContent = event.error === 'not-allowed'
        ? 'Mikrofon izni verilmedi. Adres çubuğundan izin ver.'
        : 'Ses alınamadı, tekrar dene.';
      hint.classList.add('hint--warn');
    };

    dictation.onend = () => {
      dictation = null;
      mic.classList.remove('is-live');
      mic.setAttribute('aria-pressed', 'false');
      hint.classList.remove('hint--warn');
      hint.textContent = 'Enter gönderir, Shift + Enter alt satıra geçer.';

      if (heard.trim()) send(heard.trim());
    };

    dictation.start();
  });
}

/* ---------- the voice call ---------- */

/* The microphone stays open for the whole call, including while Vlipa is
   talking, so starting to speak takes the turn back on its own. The catch is
   that an open microphone also hears Vlipa through the speakers, so anything
   that matches what is being said out loud is treated as echo and ignored. */

let listener = null;
let pendingTurn = '';
let spokenNow = '';
let speakingSince = 0;

const BARGE_GRACE_MS = 600;   // the first moments of playback are usually the speaker
const BARGE_MIN_CHARS = 5;    // a stray syllable should not cut Vlipa off

function setCallPhase(phase, text) {
  call.classList.toggle('is-listening', phase === 'listening');
  $('callBars').hidden = phase !== 'speaking';
  $('callState').textContent = text;
}

/* Punctuation and casing differ between what is spoken and what the
   microphone hears back, so both sides are flattened before comparing, and a
   mostly-overlapping phrase counts as echo. */
function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEcho(said) {
  if (!spokenNow) return false;

  const heard = normalise(said);
  const spoken = normalise(spokenNow);

  if (!heard) return true;
  if (spoken.includes(heard)) return true;

  const words = heard.split(' ');
  const shared = words.filter((word) => word.length > 2 && spoken.includes(word)).length;

  return shared / words.length >= 0.6;
}

function stopSpeaking() {
  window.speechSynthesis?.cancel();

  if (!player.paused) {
    player.pause();
    player.dispatchEvent(new Event('ended'));   // tidies up the bars and hands over
  }

  spokenNow = '';
}

/* Someone started talking over Vlipa: give them the floor. */
function maybeBargeIn(said) {
  if (!spokenNow) return;
  if (Date.now() - speakingSince < BARGE_GRACE_MS) return;
  if (said.length < BARGE_MIN_CHARS) return;
  if (isEcho(said)) return;

  stopSpeaking();
  setCallPhase('listening', 'Seni dinliyorum');
}

function startListening() {
  if (!state.inCall || listener) return;

  listener = new Recognition();
  listener.lang = 'tr-TR';
  listener.interimResults = true;
  listener.continuous = true;

  listener.onstart = () => {
    if (!spokenNow) setCallPhase('listening', 'Seni dinliyorum');
  };

  listener.onresult = (event) => {
    let settled = '';
    let running = '';

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) settled += result[0].transcript;
      else running += result[0].transcript;
    }

    const heard = (settled || running).trim();
    if (!heard) return;

    if (spokenNow) {
      maybeBargeIn(heard);
      if (spokenNow) return;   // it was echo: nothing to show, nothing to send
    }

    $('callSaid').textContent = heard;
    if (settled.trim()) takeTurn(settled.trim());
  };

  listener.onerror = (event) => {
    if (event.error === 'not-allowed') {
      $('callNote').textContent = 'Mikrofon izni verilmedi. Adres çubuğundan izin verip tekrar dene.';
      endCall();
    }
  };

  listener.onend = () => {
    listener = null;
    // Browsers close a long recognition session on their own: reopen the line.
    if (state.inCall) setTimeout(startListening, 300);
  };

  try {
    listener.start();
  } catch {
    listener = null;
  }
}

function stopListening() {
  if (!listener) return;
  const running = listener;
  listener = null;
  try { running.stop(); } catch { /* already stopped */ }
}

/* One turn at a time: anything said while Vlipa is answering waits its turn. */
function takeTurn(said) {
  if (state.busy) { pendingTurn = said; return; }
  answerAloud(said);
}

async function answerAloud(said) {
  state.busy = true;
  setCallPhase('thinking', 'Düşünüyorum');
  $('callSaid').textContent = said;

  turn({ mine: true, text: said });
  const pending = pendingTurn_ui();

  try {
    const { reply, audio } = await ask(said, { spoken: true });

    record('user', said);
    record('assistant', reply);
    settle(pending, reply);

    if (!state.inCall) return;

    spokenNow = reply;
    speakingSince = Date.now();
    setCallPhase('speaking', 'Konuşuyorum');
    $('callSaid').textContent = reply;

    const next = () => {
      spokenNow = '';
      if (!state.inCall) return;

      setCallPhase('listening', 'Seni dinliyorum');
      startListening();
    };

    if (audio) playBlob(audio, $('bars'), next);
    else browserSpeak(reply, $('bars'), next);
  } catch (error) {
    pending.wrap.classList.add('turn--error');
    pending.body.textContent = error.message || 'Bir şeyler ters gitti.';

    spokenNow = '';
    setCallPhase('idle', 'Cevap veremedim');
    $('callSaid').textContent = error.message || '';
  } finally {
    state.busy = false;

    // Something said while Vlipa was answering goes next.
    if (pendingTurn && state.inCall) {
      const queued = pendingTurn;
      pendingTurn = '';
      setTimeout(() => answerAloud(queued), 150);
    }
  }
}

function startCall() {
  if (!Recognition) {
    hint.textContent = 'Sesli konuşma için Chrome ya da Edge gerekiyor; bu tarayıcı konuşma tanımayı desteklemiyor.';
    hint.classList.add('hint--warn');
    return;
  }

  state.inCall = true;
  pendingTurn = '';
  spokenNow = '';

  call.hidden = false;
  $('callSaid').textContent = '';
  $('callNote').textContent = 'Mikrofon açık kalır. Konuşmaya başladığın an Vlipa susar ve söz sana geçer.';
  setCallPhase('listening', 'Seni dinliyorum');
  startListening();
}

function endCall() {
  state.inCall = false;
  pendingTurn = '';

  stopListening();
  stopSpeaking();

  call.hidden = true;
  setCallPhase('idle', '');
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
        : 'Hızlı mod: hemen cevap verir.';
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
    window.speechSynthesis?.cancel();

    writeStore();
    drawSidebar();
    drawThread();
  });

  $('startCall').addEventListener('click', startCall);
  $('callEnd').addEventListener('click', endCall);

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

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.inCall) endCall();
  });

  log.addEventListener('click', (event) => {
    const starter = event.target.closest('.starters button');
    if (starter) send(starter.textContent);
  });

  setupMic();

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
