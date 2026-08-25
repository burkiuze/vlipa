/* vlipa — sign-in page: validation, captcha, and the call to /api/auth/login. */

(function () {
  'use strict';

  var form = document.getElementById('loginForm');
  var email = document.getElementById('email');
  var password = document.getElementById('password');
  var remember = document.getElementById('remember');
  var emailError = document.getElementById('emailError');
  var passwordError = document.getElementById('passwordError');
  var captchaError = document.getElementById('captchaError');
  var capsHint = document.getElementById('capsHint');
  var reveal = document.getElementById('reveal');
  var submitBtn = document.getElementById('submitBtn');
  var status = document.getElementById('formStatus');

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

  /* ---------- field errors ---------- */

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
    if (!value) return setError(email, emailError, 'E-posta adresinizi girin.');
    if (!EMAIL_RE.test(value)) return setError(email, emailError, 'Geçerli bir e-posta adresi girin.');
    return setError(email, emailError, '');
  }

  function validatePassword() {
    var value = password.value;
    if (!value) return setError(password, passwordError, 'Şifrenizi girin.');
    if (value.length < 8) return setError(password, passwordError, 'Şifre en az 8 karakter olmalı.');
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
    reveal.setAttribute('aria-label', shown ? 'Şifreyi göster' : 'Şifreyi gizle');
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

  /* ---------- captcha ---------- */

  var captchaInput = document.getElementById('captcha');
  var captcha = window.VlipaCaptcha.create({
    canvas: document.getElementById('captchaCanvas'),
    input: captchaInput,
    reload: document.getElementById('captchaReload'),
    setError: function (message) { return setError(captchaInput, captchaError, message); }
  });

  /* ---------- submit ---------- */

  function setStatus(message, isError) {
    status.textContent = message || '';
    status.classList.toggle('is-error', Boolean(isError));
  }

  function busy(on) {
    submitBtn.disabled = on;
    submitBtn.classList.toggle('is-loading', on);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    setStatus('');

    var okEmail = validateEmail();
    var okPassword = validatePassword();
    var okCaptcha = captcha.validate();

    if (!okEmail) { email.focus(); return; }
    if (!okPassword) { password.focus(); return; }
    if (!okCaptcha) { captcha.refresh(); captchaInput.focus(); return; }

    busy(true);

    window.VlipaAuth.login({
      email: email.value.trim(),
      password: password.value,
      remember: remember.checked
    }).then(function (result) {
      if (result.ok) {
        setStatus('Giriş yapıldı, yönlendiriliyorsunuz…', false);
        window.location.assign('/account');
        return;
      }

      busy(false);
      captcha.refresh();
      setStatus(window.VlipaAuth.message(result), true);
    }).catch(function () {
      busy(false);
      captcha.refresh();
      setStatus('Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.', true);
    });
  });

  /* already signed in? skip the form */
  window.VlipaAuth.me().then(function (result) {
    if (result.ok) window.location.replace('/account');
  }).catch(function () {});
})();
