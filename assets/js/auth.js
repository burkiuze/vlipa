/* vlipa — sign in page behaviour.
   Email and password only, plus a locally drawn captcha.
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

  /* ---------- captcha ----------
     Drawn in the browser, so it only stops casual scripted submissions.
     Real protection needs a challenge issued and verified server-side. */

  var captchaInput = document.getElementById('captcha');
  var captchaError = document.getElementById('captchaError');
  var canvas = document.getElementById('captchaCanvas');
  var reload = document.getElementById('captchaReload');
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';

  function randomCode(length) {
    var out = '';
    var values = new Uint32Array(length);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(values);
    } else {
      for (var j = 0; j < length; j++) values[j] = Math.floor(Math.random() * 4294967296);
    }
    for (var i = 0; i < length; i++) out += ALPHABET[values[i] % ALPHABET.length];
    return out;
  }

  function drawCaptcha() {
    code = randomCode(5);

    var ratio = window.devicePixelRatio || 1;
    var w = canvas.width;
    var h = canvas.height;

    if (canvas.width !== w * ratio) {
      canvas.width = w * ratio;
      canvas.height = h * ratio;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }

    var ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f6f6f4';
    ctx.fillRect(0, 0, w, h);

    /* noise: a few faint strokes and dots */
    ctx.strokeStyle = 'rgba(10, 10, 10, .14)';
    ctx.lineWidth = 1;
    for (var n = 0; n < 4; n++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * w, Math.random() * h);
      ctx.bezierCurveTo(Math.random() * w, Math.random() * h,
                        Math.random() * w, Math.random() * h,
                        Math.random() * w, Math.random() * h);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(10, 10, 10, .18)';
    for (var d = 0; d < 26; d++) {
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
    }

    /* the characters, each nudged and rotated a little */
    var step = w / (code.length + 1);
    for (var i = 0; i < code.length; i++) {
      ctx.save();
      ctx.translate(step * (i + 1), h / 2 + (Math.random() * 6 - 3));
      ctx.rotate((Math.random() * 0.5 - 0.25));
      ctx.fillStyle = '#0a0a0a';
      ctx.font = '600 ' + (22 + Math.random() * 5).toFixed(0) +
                 'px Inter, Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(code[i], 0, 0);
      ctx.restore();
    }

    canvas.setAttribute('aria-label', 'Captcha image, five characters');
  }

  function validateCaptcha() {
    var value = captchaInput.value.trim().toUpperCase();
    if (!value) return setError(captchaInput, captchaError, 'Enter the code shown above.');
    if (value !== code) return setError(captchaInput, captchaError, 'That code does not match.');
    return setError(captchaInput, captchaError, '');
  }

  drawCaptcha();

  reload.addEventListener('click', function () {
    drawCaptcha();
    captchaInput.value = '';
    setError(captchaInput, captchaError, '');
    captchaInput.focus();
  });

  captchaInput.addEventListener('blur', function () {
    if (captchaInput.value.trim()) validateCaptcha();
  });

  captchaInput.addEventListener('input', function () {
    if (captchaInput.hasAttribute('aria-invalid')) validateCaptcha();
  });

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
    var okCaptcha = validateCaptcha();

    if (!okEmail) { email.focus(); return; }
    if (!okPassword) { password.focus(); return; }
    if (!okCaptcha) { drawCaptcha(); captchaInput.value = ''; captchaInput.focus(); return; }

    submitBtn.disabled = true;
    submitBtn.classList.add('is-loading');

    // Placeholder for the real auth call.
    window.setTimeout(function () {
      submitBtn.disabled = false;
      submitBtn.classList.remove('is-loading');
      drawCaptcha();
      captchaInput.value = '';
      setStatus('Sign-in is not connected to a backend yet.', true);
    }, 900);
  });


})();
