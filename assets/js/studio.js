/* The studio: one conversation with Vlipa, typed or spoken.

   The transcript lives here in the browser and travels with each request, so
   the server keeps nothing between turns. Speech recognition is the browser's
   own Web Speech API: no audio is uploaded. Replies are spoken with Vlipa's
   voice from the server, and with the browser's voice when that is
   unavailable, so speaking degrades instead of breaking. */

const $ = (id) => document.getElementById(id);

const log = $('log');
const input = $('input');
const player = $('player');
const hint = $('hint');
const call = $('call');

const AVATAR = 'assets/img/vlipa-ai-96.png';
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const state = {
  history: [],
  mode: 'fast',
  busy: false,
  ready: true,
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

function scrollDown() {
  requestAnimationFrame(() => log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' }));
}

/* ---------- the thread ---------- */

function turn({ mine, text, node, error }) {
  $('welcome')?.remove();
  $('clear').hidden = false;

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

function settle(slot, reply) {
  slot.body.textContent = reply;
  slot.body.appendChild(el('div', { class: 'turn__meta' }, [
    el('span', { text: state.mode === 'thinking' ? 'Düşün' : 'Hızlı' }),
    el('button', {
      type: 'button',
      title: 'Sesli oku',
      onclick: () => speak(reply),
    }, [
      el('span', { html: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 9a4 4 0 0 1 0 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' }),
      'Dinle',
    ]),
  ]));

  scrollDown();
}

function remember(question, reply) {
  state.history.push({ role: 'user', content: question });
  state.history.push({ role: 'assistant', content: reply });
  state.history = state.history.slice(-16);
}

/* ---------- speaking ---------- */

function browserSpeak(text, onEnd) {
  if (!('speechSynthesis' in window)) { onEnd?.(); return; }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  const turkish = window.speechSynthesis.getVoices().find((voice) => voice.lang?.startsWith('tr'));

  if (turkish) utterance.voice = turkish;
  utterance.lang = turkish ? turkish.lang : 'tr-TR';
  utterance.rate = 1.03;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();

  window.speechSynthesis.speak(utterance);
}

function playBlob(blob, onEnd) {
  player.src = URL.createObjectURL(blob);

  player.onended = () => onEnd?.();
  player.onerror = () => onEnd?.();
  player.play().catch(() => onEnd?.());
}

async function speak(text) {
  if (!text) return;

  try {
    const response = await fetch('/api/voice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) throw new Error('no voice');
    playBlob(await response.blob());
  } catch {
    browserSpeak(text);
  }
}

/* ---------- asking Vlipa ---------- */

async function ask(message, { spoken = false } = {}) {
  const payload = { message, history: state.history, mode: state.mode, voice: spoken };

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

    // The answer arrived even though the voice did not.
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
  const pending = pendingTurn();

  try {
    const { reply } = await ask(message);
    settle(pending, reply);
    remember(message, reply);
  } catch (error) {
    pending.wrap.classList.add('turn--error');
    pending.body.textContent = error.message || 'Bir şeyler ters gitti.';
  } finally {
    state.busy = false;
    $('send').disabled = false;
    input.focus();
  }
}

/* ---------- dictation into the box ---------- */

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

const callState = $('callState');
const callSaid = $('callSaid');
const callNote = $('callNote');

let listener = null;
let callTranscript = '';

function setCallPhase(phase, text) {
  call.classList.toggle('is-listening', phase === 'listening');
  call.classList.toggle('is-speaking', phase === 'speaking');
  callState.textContent = text;
}

function startListening() {
  if (!state.inCall || listener) return;

  listener = new Recognition();
  listener.lang = 'tr-TR';
  listener.interimResults = true;
  listener.continuous = false;

  callTranscript = '';

  listener.onstart = () => setCallPhase('listening', 'Seni dinliyorum');

  listener.onresult = (event) => {
    callTranscript = Array.from(event.results).map((result) => result[0].transcript).join(' ');
    callSaid.textContent = callTranscript;
  };

  listener.onerror = (event) => {
    if (event.error === 'not-allowed') {
      callNote.textContent = 'Mikrofon izni verilmedi. Adres çubuğundan izin verip tekrar dene.';
      endCall();
    }
  };

  listener.onend = () => {
    listener = null;
    if (!state.inCall) return;

    const said = callTranscript.trim();

    // Nothing was heard: keep the line open, but pause first so a muted or
    // silent microphone cannot spin this into a tight loop.
    if (said) answerAloud(said);
    else setTimeout(startListening, 400);
  };

  try {
    listener.start();
  } catch {
    listener = null;
  }
}

function stopListening() {
  if (!listener) return;
  const current = listener;
  listener = null;
  try { current.stop(); } catch { /* already stopped */ }
}

async function answerAloud(said) {
  setCallPhase('thinking', state.mode === 'thinking' ? 'Düşünüyorum…' : 'Düşünüyorum');
  callSaid.textContent = said;

  turn({ mine: true, text: said });
  const pending = pendingTurn();

  try {
    const { reply, audio } = await ask(said, { spoken: true });

    settle(pending, reply);
    remember(said, reply);

    if (!state.inCall) return;

    setCallPhase('speaking', 'Konuşuyorum');
    callSaid.textContent = reply;

    const next = () => { if (state.inCall) startListening(); };

    if (audio) playBlob(audio, next);
    else browserSpeak(reply, next);
  } catch (error) {
    pending.wrap.classList.add('turn--error');
    pending.body.textContent = error.message || 'Bir şeyler ters gitti.';

    setCallPhase('idle', 'Cevap veremedim');
    callSaid.textContent = error.message || '';
    if (state.inCall) setTimeout(startListening, 1200);
  }
}

function startCall() {
  if (!Recognition) {
    hint.textContent = 'Sesli konuşma için Chrome ya da Edge gerekiyor; bu tarayıcı konuşma tanımayı desteklemiyor.';
    hint.classList.add('hint--warn');
    return;
  }

  state.inCall = true;
  call.hidden = false;
  callSaid.textContent = '';
  callNote.textContent = 'Konuşmayı bitirince sus, Vlipa cevap verecek.';
  setCallPhase('listening', 'Seni dinliyorum');
  startListening();
}

function endCall() {
  state.inCall = false;
  stopListening();

  window.speechSynthesis?.cancel();
  player.pause();

  call.hidden = true;
  setCallPhase('idle', '');
}

/* ---------- wiring ---------- */

function boot() {
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

  $('clear').addEventListener('click', () => {
    state.history = [];
    window.speechSynthesis?.cancel();
    log.innerHTML = '';
    $('clear').hidden = true;

    log.appendChild(el('div', { class: 'welcome', id: 'welcome' }, [
      el('img', { class: 'welcome__photo', src: 'assets/img/vlipa-ai-256.png', alt: 'Vlipa', width: 96, height: 96 }),
      el('h1', { text: 'Sohbet temizlendi' }),
      el('p', { text: 'Yeni bir şey sor. Vlipa öncekini hatırlamıyor.' }),
    ]));
  });

  $('startCall').addEventListener('click', startCall);
  $('callEnd').addEventListener('click', endCall);

  $('callHold').addEventListener('click', () => {
    window.speechSynthesis?.cancel();
    player.pause();
    stopListening();
    startListening();
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
      state.ready = Boolean(data.ready);

      if (!state.ready) {
        hint.textContent = 'Sunucuda OPENROUTER_API_KEY tanımlı değil, bu yüzden Vlipa şu an cevap veremiyor.';
        hint.classList.add('hint--warn');
      }
    })
    .catch(() => { /* the studio still loads; the first message will report it */ });

  input.focus();
}

boot();
