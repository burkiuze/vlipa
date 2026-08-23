/* vlipa — site chrome: sticky nav and the mobile menu. */

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
})();
