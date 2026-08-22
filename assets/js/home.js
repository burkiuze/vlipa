/* vlipa — landing page behaviour: mobile menu, studio tabs, sample playback. */

(function () {
  'use strict';

  /* ---------- sticky nav border ---------- */

  var nav = document.getElementById('nav');

  function onScroll() {
    nav.classList.toggle('is-stuck', window.scrollY > 4);
  }

  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- mobile menu ---------- */

  var burger = document.getElementById('navBurger');
  var links = document.getElementById('navLinks');

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

  /* ---------- studio widget ---------- */

  var SAMPLES = {
    tts: 'In the still hush before dawn, the harbour held its breath — and then the first gull called, and the whole coast woke at once.',
    agents: 'Hi, this is the vlipa support line. I can see two open orders on your account — would you like me to reschedule the delivery for tomorrow morning?',
    music: 'A slow synth intro over brushed drums, warm bass coming in at bar nine, cinematic and unhurried.',
    dubbing: 'Merhaba, bugün sizinle yeni bir bölüme başlıyoruz — ve bu kez her şey biraz farklı olacak.',
    stt: 'Paste a transcript here, or drop in an audio file and vlipa will return it with speaker labels and word-level timestamps.'
  };

  var tabs = document.querySelectorAll('.tab');
  var text = document.getElementById('studioText');
  var count = document.getElementById('studioCount');
  var wave = document.getElementById('wave');
  var playBtn = document.getElementById('playBtn');
  var timer = null;

  function updateCount() {
    count.textContent = text.value.length + ' / 500 characters';
  }

  updateCount();
  text.addEventListener('input', updateCount);

  Array.prototype.forEach.call(tabs, function (tab) {
    tab.addEventListener('click', function () {
      Array.prototype.forEach.call(tabs, function (other) {
        other.classList.toggle('is-active', other === tab);
        other.setAttribute('aria-selected', String(other === tab));
      });
      text.value = SAMPLES[tab.dataset.tab] || '';
      updateCount();
      stop();
    });
  });

  /* voice chips */

  var voices = document.querySelectorAll('.voice');

  Array.prototype.forEach.call(voices, function (voice) {
    voice.addEventListener('click', function () {
      Array.prototype.forEach.call(voices, function (other) {
        other.classList.toggle('is-active', other === voice);
        other.setAttribute('aria-checked', String(other === voice));
      });
    });
  });

  /* simulated playback — no audio is generated yet */

  function stop() {
    window.clearTimeout(timer);
    timer = null;
    playBtn.classList.remove('is-playing');
    wave.classList.remove('is-playing');
    playBtn.setAttribute('aria-label', 'Play sample');
  }

  playBtn.addEventListener('click', function () {
    if (timer) { stop(); return; }
    playBtn.classList.add('is-playing');
    wave.classList.add('is-playing');
    playBtn.setAttribute('aria-label', 'Stop sample');
    timer = window.setTimeout(stop, 4200);
  });
})();
