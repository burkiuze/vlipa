/* The studio: one conversation with Vlipa, typed or spoken.

   The transcript lives here in the browser and travels with each request, so
   the server keeps nothing between turns. Speech recognition is the browser's
   own Web Speech API: no audio is uploaded. Replies are spoken by Vlipa's
   voice from the server, and by the browser's voice if that is unavailable. */

const $ = (id) => document.getElementById(id);

const log = $('log');
const input = $('input');
const player = $('player');
const statusDot = $('status');
const statusText = $('statusText');
const hint = $('hint');

const state = {
  history: [],
  mode: 'fast',
  voice: false,
  busy: false,
  ready: false,
};

const AVATAR = 'assets/img/vlipa-ai-96.png';

/* ---------- rendering ---------- */

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

function turn({ who, text, error, node }) {
  const empty = $('empty');
  if (empty) empty.remove();

  const mine = who === 'me';

  const avatar = mine
    ? el('span', { class: 'turn__avatar', text: 'Sen' })
    : el('img', { class: 'turn__avatar', src: AVATAR, alt: 'Vlipa', width: 34, height: 34 });

  const body = el('div', { class: 'turn__body' }, node ? [node] : [text || '']);
  const wrap = el('div', { class: `turn${mine ? ' turn--me' : ''}${error ? ' turn--error' : ''}` }, [avatar, body]);

  log.appendChild(wrap);
  scrollDown();

  return { wrap, body };
}

function thinkingTurn() {
  const dots = el('span', { class: 'dots' }, [el('i'), el('i'), el('i')]);
  return turn({ who: 'vlipa', node: dots });
}

function speakButton(text) {
  return el('button', {
    type: 'button',
    title: 'Sesli oku',
    onclick: () => speak(text),
  }, [
    el('span', { html: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 9a4 4 0 0 1 0 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' }),
    'Dinle',
  ]);
}

/* ---------- speaking ---------- */

let speaking = false;

function browserSpeak(text) {
  if (!('speechSynthesis' in window)) return false;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const preferred = window.speechSynthesis.getVoices().find((voice) => voice.lang?.startsWith('tr'));

  if (preferred) utterance.voice = preferred;
  utterance.lang = preferred ? preferred.lang : document.documentElement.lang || 'tr-TR';
  utterance.rate = 1.02;

  window.speechSynthesis.speak(utterance);
  return true;
}

async function speak(text) {
  if (!text || speaking) return;
  speaking = true;
  setStatus('busy', 'Konuşuyor…');

  try {
    const response = await fetch('/api/voice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) throw new Error('voice unavailable');

    const blob = await response.blob();
    player.src = URL.createObjectURL(blob);
    await player.play();

    await new Promise((resolve) => {
      player.onended = resolve;
      player.onerror = resolve;
    });
  } catch {
    // Vlipa's own voice is not reachable: read it out with the browser's.
    browserSpeak(text);
  } finally {
    speaking = false;
    setStatus(state.ready ? 'on' : 'off');
  }
}

/* ---------- status ---------- */

function setStatus(kind, text) {
  statusDot.classList.toggle('is-busy', kind === 'busy');
  statusDot.classList.toggle('is-off', kind === 'off');

  if (text) {
    statusText.textContent = text;
  } else if (kind === 'off') {
    statusText.textContent = 'Şu an bağlı değil.';
  } else {
    statusText.textContent = state.mode === 'thinking'
      ? 'Hazır · düşünme modu'
      : 'Hazır · hızlı mod';
  }
}

/* ---------- talking to the server ---------- */

async function send(text) {
  const message = String(text ?? input.value).trim();
  if (!message || state.busy) return;

  state.busy = true;
  input.value = '';
  input.style.height = 'auto';
  $('send').disabled = true;

  turn({ who: 'me', text: message });
  const pending = thinkingTurn();
  setStatus('busy', state.mode === 'thinking' ? 'Düşünüyor…' : 'Yazıyor…');

  const payload = {
    message,
    history: state.history,
    mode: state.mode,
    voice: state.voice,
  };

  try {
    if (state.voice) {
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

        finish(pending, reply || '…');

        const blob = await response.blob();
        player.src = URL.createObjectURL(blob);
        player.play().catch(() => browserSpeak(reply));
        return;
      }

      const data = await response.json().catch(() => ({}));

      // The answer came through even though the voice did not.
      if (data.reply) {
        finish(pending, data.reply);
        browserSpeak(data.reply);
        return;
      }

      throw new Error(data.error || 'Vlipa sesli yanıt veremedi.');
    }

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'Vlipa şu an yanıt veremiyor.');

    finish(pending, data.reply);
  } catch (error) {
    pending.wrap.classList.add('turn--error');
    pending.body.textContent = error.message || 'Bir şeyler ters gitti.';
  } finally {
    state.busy = false;
    $('send').disabled = false;
    setStatus(state.ready ? 'on' : 'off');
    input.focus();
  }

  function finish(slot, reply) {
    slot.body.textContent = reply;
    slot.body.appendChild(el('div', { class: 'turn__meta' }, [
      el('span', { text: state.mode === 'thinking' ? 'Düşünme modu' : 'Hızlı mod' }),
      speakButton(reply),
    ]));

    state.history.push({ role: 'user', content: message });
    state.history.push({ role: 'assistant', content: reply });
    state.history = state.history.slice(-16);

    scrollDown();
  }
}

/* ---------- speech recognition ---------- */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recogniser = null;
let listening = false;

function setupMic() {
  const mic = $('mic');

  if (!Recognition) {
    mic.disabled = true;
    mic.title = 'Bu tarayıcı konuşma tanımayı desteklemiyor. Chrome ya da Edge dene.';
    return;
  }

  mic.addEventListener('click', () => {
    if (listening) {
      recogniser.stop();
      return;
    }

    recogniser = new Recognition();
    recogniser.lang = 'tr-TR';
    recogniser.interimResults = true;
    recogniser.continuous = false;

    let transcript = '';

    recogniser.onstart = () => {
      listening = true;
      mic.classList.add('is-live');
      mic.setAttribute('aria-pressed', 'true');
      hint.textContent = 'Dinliyorum… bitince mikrofona tekrar bas.';
    };

    recogniser.onresult = (event) => {
      transcript = Array.from(event.results).map((result) => result[0].transcript).join(' ');
      input.value = transcript;
    };

    recogniser.onerror = (event) => {
      hint.textContent = event.error === 'not-allowed'
        ? 'Mikrofon izni verilmedi. Tarayıcı adres çubuğundan izin ver.'
        : 'Ses alınamadı, tekrar dene.';
      hint.classList.add('hint--warn');
    };

    recogniser.onend = () => {
      listening = false;
      mic.classList.remove('is-live');
      mic.setAttribute('aria-pressed', 'false');
      hint.classList.remove('hint--warn');
      hint.textContent = 'Enter gönderir, Shift + Enter alt satıra geçer.';

      const said = transcript.trim();
      if (said) send(said);
    };

    recogniser.start();
  });
}

/* ---------- wiring ---------- */

function boot() {
  document.querySelectorAll('.modes button').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;

      document.querySelectorAll('.modes button').forEach((other) => {
        other.setAttribute('aria-pressed', String(other === button));
      });

      setStatus(state.ready ? 'on' : 'off');
    });
  });

  $('voiceToggle').addEventListener('click', (event) => {
    state.voice = !state.voice;
    event.currentTarget.setAttribute('aria-pressed', String(state.voice));
    hint.textContent = state.voice
      ? 'Sesli cevap açık: Vlipa yazdıklarını sesli okuyacak.'
      : 'Enter gönderir, Shift + Enter alt satıra geçer.';
  });

  $('clear').addEventListener('click', () => {
    state.history = [];
    window.speechSynthesis?.cancel();
    log.innerHTML = '';
    log.appendChild(el('div', { class: 'empty', id: 'empty' }, [
      el('h2', { text: 'Sohbet temizlendi' }),
      el('p', { text: 'Yeni bir şey sor, Vlipa öncekini hatırlamıyor.' }),
    ]));
  });

  $('send').addEventListener('click', () => send());

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
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
      setStatus(state.ready ? 'on' : 'off');

      if (!state.ready) {
        hint.textContent = 'Sunucuda OPENROUTER_API_KEY tanımlı değil, bu yüzden Vlipa şu an cevap veremiyor.';
        hint.classList.add('hint--warn');
      }
    })
    .catch(() => {
      state.ready = false;
      setStatus('off', 'Sunucuya ulaşılamıyor.');
    });

  input.focus();
}

boot();
