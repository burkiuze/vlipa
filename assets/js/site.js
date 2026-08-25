/* vlipa — scroll progress, sticky bar, section highlighting and reveals. */

(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- scroll progress + sticky bar ---------- */

  var progress = document.getElementById('progress');
  var bar = document.getElementById('bar');
  var ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;

    window.requestAnimationFrame(function () {
      var y = window.scrollY;
      var max = document.documentElement.scrollHeight - window.innerHeight;

      if (progress) progress.style.transform = 'scaleX(' + (max > 0 ? y / max : 0) + ')';
      if (bar) bar.classList.toggle('is-stuck', y > 40);

      ticking = false;
    });
  }

  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  /* ---------- reveal on scroll ---------- */

  var reveals = document.querySelectorAll('.reveal, .step');

  if (reduced || !('IntersectionObserver' in window)) {
    Array.prototype.forEach.call(reveals, function (el) { el.classList.add('is-in'); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

    Array.prototype.forEach.call(reveals, function (el) { observer.observe(el); });
  }

  /* ---------- highlight the section in view ---------- */

  var links = Array.prototype.slice.call(document.querySelectorAll('.bar nav a[href^="#"]'));
  var sections = links
    .map(function (link) { return document.querySelector(link.getAttribute('href')); })
    .filter(Boolean);

  if (sections.length && 'IntersectionObserver' in window) {
    var visible = new Map();

    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) visible.set(entry.target, entry.intersectionRatio);
        else visible.delete(entry.target);
      });

      var best = null;
      visible.forEach(function (ratio, section) {
        if (!best || ratio > visible.get(best)) best = section;
      });

      links.forEach(function (link) {
        link.classList.toggle('is-active',
          best !== null && link.getAttribute('href') === '#' + best.id);
      });
    }, { rootMargin: '-40% 0px -45% 0px', threshold: [0, 0.25, 0.5, 1] });

    sections.forEach(function (section) { spy.observe(section); });
  }

  /* ---------- footer year ---------- */

  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
