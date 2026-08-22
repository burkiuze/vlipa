/* vlipa — landing page behaviour: mobile menu, studio tabs, speech playback.

   Audio comes from the browser's own speech engine (the Web Speech API), so
   the demo works on a static host with no key and no backend. Voices are
   whatever the visitor's OS provides.

   If a Netlify function is deployed at /.netlify/functions/tts (see
   netlify/functions/tts.mjs) the page uses that instead, for higher-quality
   neural voices. */

(function () {
  'use strict';

  /* ---------- sticky nav border ---------- */

  var nav = document.getElementById('nav');

  if (nav) {
    let onScroll = function () {
      nav.classList.toggle('is-stuck', window.scrollY > 4);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- mobile menu ---------- */

  var burger = document.getElementById('navBurger');
  var links = document.getElementById('navLinks');

  if (burger && links) {
    burger.addEventListener('click', function () {
      var open = burger.getAttribute('aria-expanded') === 'true';
      burger.setAttribute('aria-expanded', String(!open));
      burger.setAttribute('aria-label', open ? 'Open menu' : 'Close menu');
      links.classList.toggle('is-open', !open);
    });

    links.addEventListener('click', function (event) {
      if (event.target.tagName !== 'A') return;
      burger.setAttribute('aria-expanded', 'false');
      links.classList.remove('is-open');
    });
  }

  /* ---------- studio widget ---------- */

  var text = document.getElementById('studioText');
  if (!text) return;               // pages without the studio widget stop here

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

  var tabs = document.querySelectorAll('.tab');
  var count = document.getElementById('studioCount');
  var wave = document.getElementById('wave');
  var playBtn = document.getElementById('playBtn');
  var voicesBox = document.getElementById('studioVoices');
  var langSelect = document.getElementById('studioLang');
  var note = document.getElementById('studioNote');
  var downloadBtn = document.getElementById('downloadBtn');

  var synth = window.speechSynthesis;
  var allVoices = [];
  var available = [];
  var shown = [];
  var expanded = false;
  var selected = null;
  var utterance = null;
  var remoteAudio = null;

  /* ---------- voices ---------- */

  function language() {
    return langSelect ? langSelect.value : 'en';
  }

  function voicesForLanguage() {
    var prefix = language();
    var matching = allVoices.filter(function (voice) {
      return voice.lang && voice.lang.toLowerCase().indexOf(prefix) === 0;
    });
    return matching.length ? matching : allVoices;
  }

  function shortName(voice) {
    // "Microsoft Emel - Turkish (Turkey)" -> "Emel"
    var name = voice.name.replace(/^(Microsoft|Google|Apple)\s+/i, '');
    name = name.split(/[-(]/)[0].trim();
    return name.length > 18 ? name.slice(0, 17) + '…' : name;
  }

  function renderVoices() {
    if (!voicesBox) return;

    available = voicesForLanguage();
    shown = expanded ? available : available.slice(0, VISIBLE_VOICES);

    if (!available.length) {
      voicesBox.innerHTML = '<span class="voice voice--more">No system voices found</span>';
      selected = null;
      updateNote();
      return;
    }

    var chips = shown.map(function (voice, i) {
      var active = selected ? voice.voiceURI === selected.voiceURI : i === 0;
      return '<button class="voice' + (active ? ' is-active' : '') + '" type="button" ' +
             'role="radio" aria-checked="' + active + '" data-index="' + i + '" ' +
             'title="' + voice.name + ' · ' + voice.lang + '">' +
             '<i style="--c:' + DOT_COLOURS[i % DOT_COLOURS.length] + '"></i>' +
             shortName(voice) + '</button>';
    });

    var hidden = available.length - shown.length;
    if (hidden > 0) {
      chips.push('<button class="voice voice--more" type="button" id="moreVoices">' +
                 '+' + hidden + ' more</button>');
    } else if (expanded && available.length > VISIBLE_VOICES) {
      chips.push('<button class="voice voice--more" type="button" id="fewerVoices">Show fewer</button>');
    }

    voicesBox.innerHTML = chips.join('');

    if (!selected || available.indexOf(selected) === -1) selected = available[0];
    updateNote();
  }

  function updateNote(message) {
    if (!note) return;

    if (message) { note.textContent = message; return; }

    if (!synth) {
      note.textContent = 'This browser has no speech synthesis support, so playback is unavailable.';
      return;
    }

    if (!available.length) {
      note.textContent = allVoices.length
        ? 'No voices installed for this language.'
        : 'Your browser reports no speech voices, so playback is unavailable here.';
      return;
    }

    note.textContent = available.length + (available.length === 1 ? ' voice' : ' voices') +
      ' available on this device · ' + allVoices.length + ' in total. ' +
      'Playback uses your browser’s own engine — nothing leaves this page.';
  }

  function loadVoices() {
    if (!synth) return;
    allVoices = synth.getVoices() || [];
    renderVoices();
  }

  if (synth) {
    loadVoices();
    // Chrome fills the list asynchronously
    if (typeof synth.onvoiceschanged !== 'undefined') {
      synth.onvoiceschanged = loadVoices;
    }
    window.setTimeout(loadVoices, 400);
  } else {
    updateNote();
  }

  if (voicesBox) {
    voicesBox.addEventListener('click', function (event) {
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

  /* ---------- tabs ---------- */

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

  /* ---------- playback ---------- */

  function playing(on) {
    playBtn.classList.toggle('is-playing', on);
    wave.classList.toggle('is-playing', on);
    playBtn.setAttribute('aria-label', on ? 'Stop' : 'Play sample');
  }

  function stop() {
    if (synth && synth.speaking) synth.cancel();
    if (remoteAudio) { remoteAudio.pause(); remoteAudio = null; }
    utterance = null;
    playing(false);
  }

  function speakLocally(value) {
    if (!synth || !selected) {
      updateNote('No voice available to play this text.');
      playing(false);
      return;
    }

    utterance = new SpeechSynthesisUtterance(value);
    utterance.voice = selected;
    utterance.lang = selected.lang;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = function () { playing(false); };
    utterance.onerror = function () { playing(false); };

    synth.cancel();          // Safari refuses to start while a stale one is queued
    synth.speak(utterance);
  }

  /* optional server-side voices; falls back the moment anything is off */
  function speakRemotely(value) {
    return fetch('/.netlify/functions/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: value, lang: language() })
    }).then(function (response) {
      if (!response.ok) throw new Error('tts unavailable');
      return response.blob();
    }).then(function (blob) {
      remoteAudio = new Audio(URL.createObjectURL(blob));
      remoteAudio.onended = function () { playing(false); };
      remoteAudio.onerror = function () { playing(false); };
      return remoteAudio.play();
    });
  }

  playBtn.addEventListener('click', function () {
    if (playBtn.classList.contains('is-playing')) { stop(); return; }

    var value = text.value.trim().slice(0, MAX_CHARS);
    if (!value) { text.focus(); return; }

    playing(true);

    if (window.VLIPA_REMOTE_TTS) {
      speakRemotely(value).catch(function () { speakLocally(value); });
    } else {
      speakLocally(value);
    }
  });


  /* ---------- download ----------
     The Web Speech API renders straight to the system audio device and gives
     no capture hook, so browser voices cannot be saved to a file. Downloading
     therefore needs a real audio source: the TTS function (see
     netlify/functions/tts.mjs). Without it, say so plainly. */

  function fileName(value) {
    var slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    return 'vlipa-' + (slug || 'audio') + '.mp3';
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

  if (downloadBtn) {
    downloadBtn.addEventListener('click', function () {
      var value = text.value.trim().slice(0, MAX_CHARS);
      if (!value) { text.focus(); return; }

      downloadBtn.disabled = true;
      downloadBtn.classList.add('is-busy');
      updateNote('Rendering audio…');

      var done = function (message) {
        downloadBtn.disabled = false;
        downloadBtn.classList.remove('is-busy');
        updateNote(message);
      };

      fetch('/.netlify/functions/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value, lang: language() })
      }).then(function (response) {
        if (response.status === 501 || response.status === 404) throw new Error('disabled');
        if (!response.ok) throw new Error('failed');
        return response.blob();
      }).then(function (blob) {
        saveBlob(blob, fileName(value));
        done('Saved ' + fileName(value) + '.');
        window.setTimeout(function () { updateNote(); }, 6000);
      }).catch(function (error) {
        done(error.message === 'disabled'
          ? 'Downloading needs the server-side voice enabled — the browser’s own voices play but cannot be recorded. See the README.'
          : 'Could not render the audio. Try again in a moment.');
        window.setTimeout(function () { updateNote(); }, 8000);
      });
    });
  }

  /* leaving the page mid-sentence should not keep the engine talking */
  window.addEventListener('pagehide', stop);
})();
