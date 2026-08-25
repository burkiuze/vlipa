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

  /* ---------- spline backgrounds ---------- */

  var VIEWER_SRC = 'https://cdn.spline.design/@splinetool/viewer@2.0.6/build/spline-viewer.js';
  var scenes = document.querySelectorAll('.spline[data-scene]');
  var viewerLoading = null;

  function loadViewer() {
    if (viewerLoading) return viewerLoading;

    viewerLoading = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.type = 'module';
      script.src = VIEWER_SRC;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });

    return viewerLoading;
  }

  // The viewer draws its own badge inside its shadow root; these scenes are
  // used as plain backgrounds, so it is taken out once the root exists.
  function dropBadge(viewer) {
    var tries = 0;

    var timer = window.setInterval(function () {
      var root = viewer.shadowRoot;
      var logo = root && root.querySelector('#logo');

      if (logo) logo.remove();
      if (logo || ++tries > 30) window.clearInterval(timer);
    }, 200);
  }

  function mount(host) {
    loadViewer().then(function () {
      var viewer = document.createElement('spline-viewer');
      viewer.setAttribute('url', host.dataset.scene);
      viewer.setAttribute('loading-anim-type', 'none');
      viewer.addEventListener('load', function () {
        host.classList.add('is-ready');
        dropBadge(viewer);
      });
      host.appendChild(viewer);
      dropBadge(viewer);

      // Show the scene even if the load event never fires.
      window.setTimeout(function () { host.classList.add('is-ready'); }, 2500);
    }).catch(function () {
      // CDN unreachable: the gradient behind the layer stays as the background.
      host.remove();
    });
  }

  // 3D scenes are heavy: skip them on small screens, on a data saver, and
  // when the visitor asked for less motion.
  var heavyOk = !reduced &&
    window.matchMedia('(min-width: 900px)').matches &&
    !(navigator.connection && navigator.connection.saveData);

  if (scenes.length && heavyOk) {
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(scenes, mount);
    } else {
      var sceneWatch = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          sceneWatch.unobserve(entry.target);
          mount(entry.target);
        });
      }, { rootMargin: '200px 0px' });

      Array.prototype.forEach.call(scenes, function (host) { sceneWatch.observe(host); });
    }
  } else {
    Array.prototype.forEach.call(scenes, function (host) { host.remove(); });
  }

  /* ---------- footer year ---------- */

  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
