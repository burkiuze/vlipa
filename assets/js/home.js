/* vlipa — site davranışları: yapışkan menü, mobil menü, SSS akordeonu,
   görünürlük animasyonu ve footer yılı. */

(function () {
  'use strict';

  /* ---------- yapışkan menü gölgesi ---------- */

  var nav = document.getElementById('nav');

  if (nav) {
    var onScroll = function () {
      nav.classList.toggle('is-stuck', window.scrollY > 8);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- mobil menü ---------- */

  var burger = document.getElementById('navBurger');
  var links = document.getElementById('navLinks');

  if (burger && links) {
    burger.addEventListener('click', function () {
      var open = burger.getAttribute('aria-expanded') === 'true';
      burger.setAttribute('aria-expanded', String(!open));
      burger.setAttribute('aria-label', open ? 'Menüyü aç' : 'Menüyü kapat');
      links.classList.toggle('is-open', !open);
    });

    links.addEventListener('click', function (event) {
      if (event.target.tagName !== 'A') return;
      burger.setAttribute('aria-expanded', 'false');
      burger.setAttribute('aria-label', 'Menüyü aç');
      links.classList.remove('is-open');
    });
  }

  /* ---------- SSS akordeonu ---------- */

  var faq = document.getElementById('faq');

  if (faq) {
    faq.addEventListener('click', function (event) {
      var button = event.target.closest('.faq__q');
      if (!button) return;

      var item = button.parentElement;
      var open = item.classList.toggle('is-open');
      button.setAttribute('aria-expanded', String(open));
    });
  }

  /* ---------- görünürlük animasyonu ---------- */

  var reveals = document.querySelectorAll('.reveal');

  if (reveals.length && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });

    reveals.forEach(function (el) { observer.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- footer yılı ---------- */

  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
