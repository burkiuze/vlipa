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
  var MAX_CHARS = 500;

  var tabs = document.querySelectorAll('.tab');
  var count = document.getElementById('studioCount');
  var wave = document.getElementById('wave');
  var playBtn = document.getElementById('playBtn');
  var voicesBox = document.getElementById('studioVoices');
  var langSelect = document.getElementById('studioLang');
  var note = document.getElementById('studioNote');

  var synth = window.speechSynthesis;
  var allVoices = [];
  var shown = [];
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

    shown = voicesForLanguage().slice(0, 6);

    if (!shown.length) {
      voicesBox.innerHTML = '<span class="voice voice--more">No system voices found</span>';
      selected = null;
      return;
    }

    voicesBox.innerHTML = shown.map(function (voice, i) {
      return '<button class="voice' + (i === 0 ? ' is-active' : '') + '" type="button" ' +
             'role="radio" aria-checked="' + (i === 0) + '" data-index="' + i + '" ' +
             'title="' + voice.name + ' · ' + voice.lang + '">' +
             '<i style="--c:' + DOT_COLOURS[i % DOT_COLOURS.length] + '"></i>' +
             shortName(voice) + '</button>';
    }).join('');

    selected = shown[0];
  }

  function loadVoices() {
    if (!synth) return;
    allVoices = synth.getVoices() || [];
    renderVoices();

    if (note) {
      note.textContent = allVoices.length
        ? 'Playback uses your browser’s built-in voices — nothing leaves this page.'
        : 'Your browser reports no speech voices, so playback is unavailable here.';
    }
  }

  if (synth) {
    loadVoices();
    // Chrome fills the list asynchronously
    if (typeof synth.onvoiceschanged !== 'undefined') {
      synth.onvoiceschanged = loadVoices;
    }
    window.setTimeout(loadVoices, 400);
  } else if (note) {
    note.textContent = 'This browser has no speech synthesis support, so playback is unavailable.';
  }

  if (voicesBox) {
    voicesBox.addEventListener('click', function (event) {
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
      if (note) note.textContent = 'No voice available to play this text.';
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

  /* leaving the page mid-sentence should not keep the engine talking */
  window.addEventListener('pagehide', stop);
})();
