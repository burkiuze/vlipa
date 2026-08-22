/* vlipa — sign in page behaviour.
   No backend yet: the form validates locally and fakes a request round-trip. */

(function () {
  'use strict';

  var form = document.getElementById('loginForm');
  var email = document.getElementById('email');
  var password = document.getElementById('password');
  var emailError = document.getElementById('emailError');
  var passwordError = document.getElementById('passwordError');
  var capsHint = document.getElementById('capsHint');
  var reveal = document.getElementById('reveal');
  var submitBtn = document.getElementById('submitBtn');
  var status = document.getElementById('formStatus');

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

  /* ---------- validation ---------- */

  function setError(input, node, message) {
    if (message) {
      node.textContent = message;
      node.hidden = false;
      input.setAttribute('aria-invalid', 'true');
    } else {
      node.textContent = '';
      node.hidden = true;
      input.removeAttribute('aria-invalid');
    }
    return !message;
  }

  function validateEmail() {
    var value = email.value.trim();
    if (!value) return setError(email, emailError, 'Enter your email address.');
    if (!EMAIL_RE.test(value)) return setError(email, emailError, 'Enter a valid email address.');
    return setError(email, emailError, '');
  }

  function validatePassword() {
    var value = password.value;
    if (!value) return setError(password, passwordError, 'Enter your password.');
    if (value.length < 8) return setError(password, passwordError, 'Password must be at least 8 characters.');
    return setError(password, passwordError, '');
  }

  email.addEventListener('blur', validateEmail);
  password.addEventListener('blur', validatePassword);

  email.addEventListener('input', function () {
    if (email.hasAttribute('aria-invalid')) validateEmail();
  });

  password.addEventListener('input', function () {
    if (password.hasAttribute('aria-invalid')) validatePassword();
  });

  /* ---------- password reveal + caps lock ---------- */

  reveal.addEventListener('click', function () {
    var shown = reveal.getAttribute('aria-pressed') === 'true';
    reveal.setAttribute('aria-pressed', String(!shown));
    reveal.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
    password.type = shown ? 'password' : 'text';
    password.focus();
  });

  function checkCaps(event) {
    if (typeof event.getModifierState !== 'function') return;
    capsHint.hidden = !event.getModifierState('CapsLock');
  }

  password.addEventListener('keydown', checkCaps);
  password.addEventListener('keyup', checkCaps);
  password.addEventListener('blur', function () { capsHint.hidden = true; });

  /* ---------- submit ---------- */

  function setStatus(message, isError) {
    status.textContent = message || '';
    status.classList.toggle('is-error', Boolean(isError));
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    setStatus('');

    var okEmail = validateEmail();
    var okPassword = validatePassword();

    if (!okEmail) { email.focus(); return; }
    if (!okPassword) { password.focus(); return; }

    submitBtn.disabled = true;
    submitBtn.classList.add('is-loading');

    // Placeholder for the real auth call.
    window.setTimeout(function () {
      submitBtn.disabled = false;
      submitBtn.classList.remove('is-loading');
      setStatus('Sign-in is not connected to a backend yet.', true);
    }, 900);
  });

  /* ---------- oauth placeholders ---------- */

  Array.prototype.forEach.call(document.querySelectorAll('[data-provider]'), function (button) {
    button.addEventListener('click', function () {
      setStatus(button.dataset.provider + ' sign-in is not connected yet.', true);
    });
  });
})();
