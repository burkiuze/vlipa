/* vlipa — the studio widget.
 *
 * Three engines, chosen from the Engine select:
 *
 *   browser  the Web Speech API. Instant, no download, no network. Cannot be
 *            recorded, so Download is unavailable.
 *   kokoro   Kokoro-82M (Apache-2.0) running in this tab through kokoro-js and
 *            ONNX Runtime. ~80 MB of weights on first use, cached by the
 *            browser afterwards. Produces a WAV, so Download works.
 *   server   any OpenAI-compatible /v1/audio/speech server the visitor points
 *            us at — their own Kokoro-FastAPI, a Space, localhost. Also
 *            downloadable.
 *
 * Nothing here needs an account or an API key of ours.
 */

(function () {
  'use strict';

  var text = document.getElementById('studioText');
  if (!text) return;

  var KOKORO_CDN = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
  var KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

  /* Kokoro ships a fixed voice list; used if the library does not expose one. */
  var KOKORO_FALLBACK_VOICES = [
    { id: 'af_heart', label: 'Heart', lang: 'en' },
    { id: 'af_bella', label: 'Bella', lang: 'en' },
    { id: 'af_nicole', label: 'Nicole', lang: 'en' },
    { id: 'am_michael', label: 'Michael', lang: 'en' },
    { id: 'am_puck', label: 'Puck', lang: 'en' },
    { id: 'bf_emma', label: 'Emma', lang: 'en' },
    { id: 'bm_george', label: 'George', lang: 'en' }
  ];

  var SAMPLES = {
    tts: 'In the still hush before dawn, the harbour held its breath — and then the first gull called, and the whole coast woke at once.',
    agents: 'Hi, this is the vlipa support line. I can see two open orders on your account — would you like me to reschedule the delivery for tomorrow morning?',
    music: 'A slow synth intro over brushed drums, warm bass coming in at bar nine, cinematic and unhurried.',
    dubbing: 'Merhaba, bugün sizinle yeni bir bölüme başlıyoruz — ve bu kez her şey biraz farklı olacak.',
    stt: 'Paste a transcript here, or read it out loud and vlipa will return it with speaker labels and word-level timestamps.'
  };

  var LANG_FOR_TAB = { dubbing: 'tr' };
  var DOT_COLOURS = ['#e8674a', '#3f7ae0', '#2fa36b', '#a463d6', '#d9a13b', '#4aa0b5'];
  var VISIBLE_VOICES = 6;
  var MAX_CHARS = 500;
  var STORAGE_KEY = 'vlipa-server';

  var tabs = document.querySelectorAll('.tab');
  var count = document.getElementById('studioCount');
  var wave = document.getElementById('wave');
  var playBtn = document.getElementById('playBtn');
  var downloadBtn = document.getElementById('downloadBtn');
  var voicesBox = document.getElementById('studioVoices');
  var langSelect = document.getElementById('studioLang');
  var engineSelect = document.getElementById('studioEngine');
  var note = document.getElementById('studioNote');
  var panel = document.getElementById('serverPanel');
  var panelUrl = document.getElementById('serverUrl');
  var panelKey = document.getElementById('serverKey');
  var panelVoice = document.getElementById('serverVoice');
  var panelModel = document.getElementById('serverModel');
  var panelSave = document.getElementById('serverSave');
  var panelClose = document.getElementById('serverClose');

  var synth = window.speechSynthesis;
  var engine = 'browser';

  var browserVoices = [];
  var available = [];
  var shown = [];
  var expanded = false;
  var selected = null;

  var kokoro = null;          // the loaded model
  var kokoroLoading = null;   // in-flight load promise
  var kokoroVoices = [];

  var server = readServer();
  var audioEl = null;
  var lastBlob = null;        // what Download saves

  /* ---------- small helpers ---------- */

  function language() {
    return langSelect ? langSelect.value : 'en';
  }

  function setNote(message) {
    if (!note) return;
    if (message) { note.textContent = message; return; }

    if (engine === 'kokoro') {
      note.textContent = kokoro
        ? kokoroVoices.length + ' open-source voices ready · Kokoro-82M runs in this tab.'
        : 'Kokoro-82M (Apache-2.0) runs in your browser. First use downloads about 80 MB.';
      return;
    }

    if (engine === 'server') {
      note.textContent = server.url
        ? 'Using your server at ' + shortUrl(server.url) + '.'
        : 'Point vlipa at any OpenAI-compatible /v1/audio/speech server.';
      return;
    }

    if (!synth) {
      note.textContent = 'This browser has no speech synthesis support, so playback is unavailable.';
      return;
    }

    if (!available.length) {
      note.textContent = browserVoices.length
        ? 'No voices installed for this language.'
        : 'Your browser reports no speech voices, so playback is unavailable here.';
      return;
    }

    note.textContent = available.length + (available.length === 1 ? ' voice' : ' voices') +
      ' available on this device · ' + browserVoices.length + ' in total. ' +
      'Playback uses your browser’s own engine — nothing leaves this page.';
  }

  function shortUrl(value) {
    try { return new URL(value).host; } catch (e) { return value; }
  }

  function playing(on) {
    playBtn.classList.toggle('is-playing', on);
    wave.classList.toggle('is-playing', on);
    playBtn.setAttribute('aria-label', on ? 'Stop' : 'Play sample');
  }

  function stop() {
    if (synth && synth.speaking) synth.cancel();
    if (audioEl) { audioEl.pause(); audioEl = null; }
    playing(false);
  }

  function busy(on) {
    playBtn.classList.toggle('is-busy', on);
    if (downloadBtn) downloadBtn.disabled = on;
  }

  function value() {
    return text.value.trim().slice(0, MAX_CHARS);
  }

  /* ---------- voice chips ---------- */

  function shortName(voice) {
    var name = voice.name.replace(/^(Microsoft|Google|Apple)\s+/i, '');
    name = name.split(/[-(]/)[0].trim();
    return name.length > 18 ? name.slice(0, 17) + '…' : name;
  }

  function currentList() {
    if (engine === 'kokoro') return kokoroVoices;
    if (engine === 'server') return [];

    var prefix = language();
    var matching = browserVoices.filter(function (voice) {
      return voice.lang && voice.lang.toLowerCase().indexOf(prefix) === 0;
    });
    return matching.length ? matching : browserVoices;
  }

  function labelFor(item) {
    return engine === 'kokoro' ? item.label : shortName(item);
  }

  function renderVoices() {
    if (!voicesBox) return;

    available = currentList();

    if (engine === 'server') {
      voicesBox.innerHTML = '<button class="voice voice--more" type="button" id="openServer">' +
        (server.url ? 'Change server…' : 'Connect a server…') + '</button>';
      selected = null;
      setNote();
      return;
    }

    if (!available.length) {
      voicesBox.innerHTML = '<span class="voice voice--more">' +
        (engine === 'kokoro' ? 'Load the model to see its voices' : 'No system voices found') +
        '</span>';
      selected = null;
      setNote();
      return;
    }

    shown = expanded ? available : available.slice(0, VISIBLE_VOICES);

    var chips = shown.map(function (item, i) {
      var id = engine === 'kokoro' ? item.id : item.voiceURI;
      var current = selected && (engine === 'kokoro' ? selected.id : selected.voiceURI);
      var active = current ? id === current : i === 0;
      return '<button class="voice' + (active ? ' is-active' : '') + '" type="button" ' +
             'role="radio" aria-checked="' + active + '" data-index="' + i + '">' +
             '<i style="--c:' + DOT_COLOURS[i % DOT_COLOURS.length] + '"></i>' +
             labelFor(item) + '</button>';
    });

    var hidden = available.length - shown.length;
    if (hidden > 0) {
      chips.push('<button class="voice voice--more" type="button" id="moreVoices">+' + hidden + ' more</button>');
    } else if (expanded && available.length > VISIBLE_VOICES) {
      chips.push('<button class="voice voice--more" type="button" id="fewerVoices">Show fewer</button>');
    }

    voicesBox.innerHTML = chips.join('');

    if (!selected || available.indexOf(selected) === -1) selected = available[0];
    setNote();
  }

  function loadBrowserVoices() {
    if (!synth) return;
    browserVoices = synth.getVoices() || [];
    if (engine === 'browser') renderVoices();
  }

  if (synth) {
    loadBrowserVoices();
    if (typeof synth.onvoiceschanged !== 'undefined') synth.onvoiceschanged = loadBrowserVoices;
    window.setTimeout(loadBrowserVoices, 400);
  } else {
    setNote();
  }

  /* ---------- engine switching ---------- */

  if (engineSelect) {
    engineSelect.addEventListener('change', function () {
      stop();
      engine = engineSelect.value;
      expanded = false;
      selected = null;
      lastBlob = null;

      document.getElementById('studio').dataset.engine = engine;

      if (engine === 'kokoro' && !kokoro) {
        renderVoices();
        // the failure path reports itself; nothing to add here
        loadKokoro().catch(function () {});
        return;
      }

      if (engine === 'server') {
        renderVoices();
        if (!server.url) openPanel();
        return;
      }

      renderVoices();
    });
  }

  /* ---------- Kokoro in the browser ---------- */

  function loadKokoro() {
    if (kokoro) return Promise.resolve(kokoro);
    if (kokoroLoading) return kokoroLoading;

    setNote('Loading Kokoro-82M… first use downloads about 80 MB.');
    busy(true);

    kokoroLoading = import(/* webpackIgnore: true */ KOKORO_CDN)
      .then(function (module) {
        var KokoroTTS = module.KokoroTTS || (module.default && module.default.KokoroTTS);
        if (!KokoroTTS) throw new Error('library');

        return KokoroTTS.from_pretrained(KOKORO_MODEL, {
          dtype: 'q8',
          device: navigator.gpu ? 'webgpu' : 'wasm',
          progress_callback: function (report) {
            if (!report || typeof report.progress !== 'number') return;
            setNote('Loading Kokoro-82M… ' + Math.round(report.progress) + '%');
          }
        });
      })
      .then(function (model) {
        kokoro = model;
        kokoroVoices = readKokoroVoices(model);
        busy(false);
        renderVoices();
        setNote();
        return model;
      })
      .catch(function () {
        kokoroLoading = null;
        busy(false);

        if (engineSelect) engineSelect.value = 'browser';
        engine = 'browser';
        document.getElementById('studio').dataset.engine = engine;
        renderVoices();

        // after renderVoices, so the explanation is what stays on screen
        setNote('Could not load Kokoro — the model is fetched from a public CDN and ' +
                'this network blocked it. Back on browser voices.');

        throw new Error('kokoro');
      });

    return kokoroLoading;
  }

  /* the library has changed shape between releases; accept either */
  function readKokoroVoices(model) {
    var raw = null;

    try {
      if (typeof model.list_voices === 'function') raw = model.list_voices();
      else if (model.voices) raw = model.voices;
    } catch (e) { raw = null; }

    if (raw && !Array.isArray(raw)) {
      return Object.keys(raw).map(function (id) {
        var meta = raw[id] || {};
        return { id: id, label: meta.name || id, lang: meta.language || 'en' };
      });
    }

    if (Array.isArray(raw) && raw.length) {
      return raw.map(function (item) {
        if (typeof item === 'string') return { id: item, label: item, lang: 'en' };
        return { id: item.id || item.name, label: item.name || item.id, lang: item.language || 'en' };
      });
    }

    return KOKORO_FALLBACK_VOICES.slice();
  }

  function generateWithKokoro() {
    return loadKokoro().then(function (model) {
      return model.generate(value(), { voice: (selected && selected.id) || 'af_heart' });
    }).then(function (audio) {
      if (audio && typeof audio.toBlob === 'function') return audio.toBlob();
      if (audio && typeof audio.toWav === 'function') return new Blob([audio.toWav()], { type: 'audio/wav' });
      throw new Error('audio');
    });
  }

  /* ---------- the visitor's own server ---------- */

  function readServer() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function openPanel() {
    if (!panel) return;
    panelUrl.value = server.url || '';
    panelKey.value = server.key || '';
    panelVoice.value = server.voice || '';
    panelModel.value = server.model || '';
    panel.hidden = false;
    panelUrl.focus();
  }

  function closePanel() {
    if (panel) panel.hidden = true;
  }

  if (panelSave) {
    panelSave.addEventListener('click', function () {
      var url = panelUrl.value.trim();
      if (url && !/^https?:\/\//i.test(url)) {
        setNote('The server address needs to start with http:// or https://.');
        return;
      }

      server = { url: url, key: panelKey.value.trim(), voice: panelVoice.value.trim(), model: panelModel.value.trim() };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(server)); } catch (e) {}

      closePanel();
      renderVoices();
      setNote();
    });
  }

  if (panelClose) panelClose.addEventListener('click', closePanel);

  function generateWithServer() {
    if (!server.url) {
      openPanel();
      return Promise.reject(new Error('no server'));
    }

    var headers = { 'Content-Type': 'application/json' };
    if (server.key) headers.Authorization = 'Bearer ' + server.key;

    return fetch(server.url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: server.model || 'kokoro',
        voice: server.voice || 'af_heart',
        input: value(),
        response_format: 'mp3'
      })
    }).then(function (response) {
      if (!response.ok) throw new Error('server ' + response.status);
      return response.blob();
    });
  }

  /* ---------- playback ---------- */

  function speakWithBrowser() {
    if (!synth || !selected) {
      setNote('No voice available to play this text.');
      playing(false);
      return;
    }

    var utterance = new SpeechSynthesisUtterance(value());
    utterance.voice = selected;
    utterance.lang = selected.lang;
    utterance.onend = function () { playing(false); };
    utterance.onerror = function () { playing(false); };

    synth.cancel();
    synth.speak(utterance);
  }

  function playBlob(blob) {
    lastBlob = blob;
    audioEl = new Audio(URL.createObjectURL(blob));
    audioEl.onended = function () { playing(false); };
    audioEl.onerror = function () { playing(false); setNote('That audio could not be played.'); };
    return audioEl.play();
  }

  playBtn.addEventListener('click', function () {
    if (playBtn.classList.contains('is-playing')) { stop(); return; }
    if (!value()) { text.focus(); return; }

    playing(true);

    if (engine === 'browser') { speakWithBrowser(); return; }

    busy(true);
    setNote(engine === 'kokoro' ? 'Generating…' : 'Asking your server…');

    var work = engine === 'kokoro' ? generateWithKokoro() : generateWithServer();

    work.then(function (blob) {
      busy(false);
      setNote();
      return playBlob(blob);
    }).catch(function (error) {
      busy(false);
      playing(false);
      if (String(error.message).indexOf('server') === 0) {
        setNote('Your server answered with an error (' + error.message.replace('server ', '') +
                '). Check the address, the CORS headers and the voice name.');
      } else if (String(error.message) === 'no server') {
        setNote('Add your server address first.');
      } else if (String(error.message) !== 'kokoro') {
        setNote('Could not generate that audio.');
      }
    });
  });

  /* ---------- download ---------- */

  function fileName(value, extension) {
    var slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    return 'vlipa-' + (slug || 'audio') + '.' + extension;
  }

  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function extensionFor(blob) {
    if (blob.type.indexOf('wav') !== -1) return 'wav';
    if (blob.type.indexOf('ogg') !== -1) return 'ogg';
    return 'mp3';
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', function () {
      var input = value();
      if (!input) { text.focus(); return; }

      if (engine === 'browser') {
        setNote('Browser voices play through the sound card and cannot be recorded. ' +
                'Switch the engine to Kokoro or your own server to download audio.');
        return;
      }

      downloadBtn.disabled = true;
      downloadBtn.classList.add('is-busy');
      setNote(engine === 'kokoro' ? 'Rendering with Kokoro…' : 'Asking your server…');

      var done = function (message) {
        downloadBtn.disabled = false;
        downloadBtn.classList.remove('is-busy');
        setNote(message);
        if (message) window.setTimeout(function () { setNote(); }, 7000);
      };

      var work = engine === 'kokoro' ? generateWithKokoro() : generateWithServer();

      work.then(function (blob) {
        var name = fileName(input, extensionFor(blob));
        saveBlob(blob, name);
        done('Saved ' + name + '.');
      }).catch(function (error) {
        if (String(error.message) === 'kokoro') { done(''); return; }
        done(String(error.message).indexOf('server') === 0
          ? 'Your server answered with an error (' + error.message.replace('server ', '') + ').'
          : 'Could not render that audio.');
      });
    });
  }

  /* ---------- chips, tabs, counters ---------- */

  if (voicesBox) {
    voicesBox.addEventListener('click', function (event) {
      if (event.target.closest('#openServer')) { openPanel(); return; }
      if (event.target.closest('#moreVoices')) { expanded = true; renderVoices(); return; }
      if (event.target.closest('#fewerVoices')) { expanded = false; renderVoices(); return; }

      var button = event.target.closest('[data-index]');
      if (!button) return;

      stop();
      selected = shown[Number(button.dataset.index)] || null;
      Array.prototype.forEach.call(voicesBox.querySelectorAll('.voice'), function (chip) {
        chip.classList.toggle('is-active', chip === button);
        chip.setAttribute('aria-checked', String(chip === button));
      });
    });
  }

  if (langSelect) {
    langSelect.addEventListener('change', function () {
      stop();
      expanded = false;
      selected = null;
      renderVoices();
    });
  }

  function updateCount() {
    count.textContent = text.value.length + ' / ' + MAX_CHARS + ' characters';
    count.classList.toggle('is-over', text.value.length > MAX_CHARS);
  }

  updateCount();
  text.addEventListener('input', updateCount);

  Array.prototype.forEach.call(tabs, function (tab) {
    tab.addEventListener('click', function () {
      Array.prototype.forEach.call(tabs, function (other) {
        other.classList.toggle('is-active', other === tab);
        other.setAttribute('aria-selected', String(other === tab));
      });

      stop();
      text.value = SAMPLES[tab.dataset.tab] || '';
      updateCount();

      var lang = LANG_FOR_TAB[tab.dataset.tab];
      if (lang && langSelect && langSelect.value !== lang) {
        langSelect.value = lang;
        expanded = false;
        selected = null;
        renderVoices();
      }
    });
  });

  window.addEventListener('pagehide', stop);

  renderVoices();
  setNote();
})();
