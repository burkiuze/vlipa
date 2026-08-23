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
  var TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm';
  var KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

  /* Open-source models a visitor can pick and use straight away: they run in
     this tab, so there is nothing to install, connect or pay for. The weights
     download once and the browser caches them. */
  var MMS_CODE = { en: 'eng', tr: 'tur', de: 'deu', es: 'spa', fr: 'fra', ja: 'jpn' };

  var MODELS = {
    system: {
      label: 'System voices',
      kind: 'browser',
      blurb: 'Your device’s own voices. Instant, offline, but cannot be saved to a file.'
    },
    kokoro: {
      kind: 'kokoro',
      label: 'Kokoro-82M',
      licence: 'Apache-2.0',
      size: '~80 MB',
      langs: ['en'],
      blurb: 'Kokoro-82M · Apache-2.0 · runs in this tab. Downloads about 80 MB the first time, then it is cached.'
    },
    mms: {
      kind: 'transformers',
      label: 'MMS-TTS',
      licence: 'CC-BY-NC 4.0',
      size: '~40 MB',
      langs: ['en', 'tr', 'de', 'es', 'fr', 'ja'],
      model: function (lang) { return 'Xenova/mms-tts-' + (MMS_CODE[lang] || 'eng'); },
      blurb: 'Meta MMS-TTS · CC-BY-NC 4.0, so non-commercial use only · runs in this tab, about 40 MB per language.'
    },
    server: {
      kind: 'server',
      label: 'My own server',
      blurb: 'Advanced: point vlipa at your own OpenAI-compatible endpoint.'
    }
  };

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
  var choice = 'system';                 // key into MODELS
  var engine = 'browser';                // MODELS[choice].kind

  var browserVoices = [];
  var available = [];
  var shown = [];
  var expanded = false;
  var selected = null;

  var kokoro = null;          // the loaded Kokoro model
  var kokoroLoading = null;   // in-flight load promise
  var kokoroVoices = [];
  var pipelines = {};         // transformers.js pipelines, by model id
  var pipelineLoading = {};

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

    var model = MODELS[choice];

    if (engine === 'kokoro' || engine === 'transformers') {
      var loaded = engine === 'kokoro' ? kokoro : pipelines[modelId()];
      note.textContent = loaded
        ? model.label + ' is loaded and running in this tab · ' + model.licence + '.'
        : model.blurb;
      return;
    }

    if (engine === 'server') {
      note.textContent = server.url
        ? 'Using your server at ' + shortUrl(server.url) + '.'
        : model.blurb;
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
      ' on this device · ' + browserVoices.length + ' in total. Instant, and nothing leaves this page.';
  }

  function modelId() {
    var model = MODELS[choice];
    return typeof model.model === 'function' ? model.model(language()) : null;
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
    if (engine === 'transformers') return [];
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

    if (engine === 'transformers') {
      var model = MODELS[choice];
      voicesBox.innerHTML = '<span class="voice"><i style="--c:' + DOT_COLOURS[2] + '"></i>' +
        model.label + ' · ' + language().toUpperCase() + '</span>' +
        '<span class="voice voice--more">' + model.licence + ' · ' + model.size + '</span>';
      selected = null;
      setNote();
      return;
    }

    if (!available.length) {
      voicesBox.innerHTML = '<span class="voice voice--more">' +
        (engine === 'kokoro' ? 'Loading the model…' : 'No system voices found') +
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
      choice = engineSelect.value;
      engine = MODELS[choice].kind;
      expanded = false;
      selected = null;

      document.getElementById('studio').dataset.engine = engine;
      renderVoices();

      if (engine === 'kokoro' && !kokoro) {
        loadKokoro().catch(function () {});      // the failure path reports itself
        return;
      }

      if (engine === 'transformers' && !pipelines[modelId()]) {
        loadPipeline().catch(function () {});
        return;
      }

      if (engine === 'server' && !server.url) openPanel();
    });
  }

  /* A model that cannot be reached is not a dead end: say why and go back to
     the voices that are already on the device. */
  function fallToSystem(reason) {
    if (engineSelect) engineSelect.value = 'system';
    choice = 'system';
    engine = 'browser';
    document.getElementById('studio').dataset.engine = engine;
    renderVoices();
    setNote(reason);
  }

  /* ---------- Kokoro in the browser ---------- */

  function loadKokoro() {
    if (kokoro) return Promise.resolve(kokoro);
    if (kokoroLoading) return kokoroLoading;

    setNote('Loading Kokoro-82M… the first run downloads about 80 MB.');
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
        fallToSystem('Could not load Kokoro-82M — its weights come from a public CDN and ' +
                     'this network blocked the download. Back on system voices.');
        throw new Error('model');
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


  /* ---------- transformers.js models (MMS-TTS) ---------- */

  function loadPipeline() {
    var id = modelId();
    if (pipelines[id]) return Promise.resolve(pipelines[id]);
    if (pipelineLoading[id]) return pipelineLoading[id];

    var model = MODELS[choice];
    setNote('Loading ' + model.label + ' (' + language().toUpperCase() + ')… about ' +
            model.size.replace('~', '') + ' the first time.');
    busy(true);

    pipelineLoading[id] = import(/* webpackIgnore: true */ TRANSFORMERS_CDN)
      .then(function (module) {
        var pipeline = module.pipeline || (module.default && module.default.pipeline);
        if (!pipeline) throw new Error('library');

        return pipeline('text-to-speech', id, {
          dtype: 'q8',
          progress_callback: function (report) {
            if (!report || typeof report.progress !== 'number') return;
            setNote('Loading ' + model.label + '… ' + Math.round(report.progress) + '%');
          }
        });
      })
      .then(function (ready) {
        pipelines[id] = ready;
        pipelineLoading[id] = null;
        busy(false);
        renderVoices();
        setNote();
        return ready;
      })
      .catch(function () {
        pipelineLoading[id] = null;
        busy(false);
        fallToSystem('Could not load ' + model.label + ' — its weights come from a public CDN ' +
                     'and this network blocked the download. Back on system voices.');
        throw new Error('model');
      });

    return pipelineLoading[id];
  }

  function generateWithPipeline() {
    return loadPipeline().then(function (ready) {
      return ready(value());
    }).then(function (output) {
      if (!output || !output.audio) throw new Error('audio');
      return encodeWav(output.audio, output.sampling_rate || 16000);
    });
  }

  /* Float32 samples -> a 16-bit PCM WAV blob, so the result can be played and
     saved without another dependency. */
  function encodeWav(samples, sampleRate) {
    var length = samples.length;
    var buffer = new ArrayBuffer(44 + length * 2);
    var view = new DataView(buffer);

    function writeText(offset, text) {
      for (var i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    }

    writeText(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);          // PCM header size
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, 1, true);           // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);           // block align
    view.setUint16(34, 16, true);          // bits per sample
    writeText(36, 'data');
    view.setUint32(40, length * 2, true);

    for (var i = 0; i < length; i++) {
      var sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  window.VlipaEncodeWav = encodeWav;      // exported so it can be tested

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

  function generate() {
    if (engine === 'kokoro') return generateWithKokoro();
    if (engine === 'transformers') return generateWithPipeline();
    return generateWithServer();
  }


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
    setNote(engine === 'server' ? 'Asking your server…' : 'Generating…');

    var work = generate();

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
      } else if (String(error.message) !== 'model') {
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
        setNote('System voices play through the sound card and cannot be recorded. ' +
                'Pick an open-source model above — Kokoro-82M or MMS-TTS — to download audio.');
        return;
      }

      downloadBtn.disabled = true;
      downloadBtn.classList.add('is-busy');
      setNote(engine === 'server' ? 'Asking your server…' : 'Rendering ' + MODELS[choice].label + '…');

      var done = function (message) {
        downloadBtn.disabled = false;
        downloadBtn.classList.remove('is-busy');
        setNote(message);
        if (message) window.setTimeout(function () { setNote(); }, 7000);
      };

      var work = generate();

      work.then(function (blob) {
        var name = fileName(input, extensionFor(blob));
        saveBlob(blob, name);
        done('Saved ' + name + '.');
      }).catch(function (error) {
        if (String(error.message) === 'model') { done(''); return; }
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

      // MMS ships one model per language, so switching language loads another
      if (engine === 'transformers' && !pipelines[modelId()]) loadPipeline().catch(function () {});
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
