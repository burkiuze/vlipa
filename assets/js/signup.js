/* vlipa — sign-up page: validation, captcha, and the call to /api/auth/signup. */

(function () {
  'use strict';

  var form = document.getElementById('signupForm');
  var name = document.getElementById('name');
  var email = document.getElementById('email');
  var password = document.getElementById('password');
  var emailError = document.getElementById('emailError');
  var passwordError = document.getElementById('passwordError');
  var captchaError = document.getElementById('captchaError');
  var strength = document.getElementById('strength');
  var reveal = document.getElementById('reveal');
  var submitBtn = document.getElementById('submitBtn');
  var status = document.getElementById('formStatus');

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

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
    if (!value) return setError(password, passwordError, 'Bir şifre belirleyin.');
    if (value.length < 8) return setError(password, passwordError, 'En az 8 karakter kullanın.');
    if (value.length > 200) return setError(password, passwordError, 'Bu şifre çok uzun.');
    return setError(password, passwordError, '');
  }

  /* a rough strength read-out — length and variety, nothing clever */
  function scorePassword(value) {
    var score = 0;
    if (value.length >= 8) score++;
    if (value.length >= 12) score++;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
    if (/\d/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;
    return Math.min(score, 4);
  }

  password.addEventListener('input', function () {
    var value = password.value;
    var score = scorePassword(value);
    var labels = ['Çok kısa', 'Zayıf', 'Orta', 'İyi', 'Güçlü'];

    strength.hidden = !value;
    strength.dataset.score = String(score);
    strength.querySelector('span').textContent = value ? labels[score] : '';

    if (password.hasAttribute('aria-invalid')) validatePassword();
  });

  email.addEventListener('blur', validateEmail);
  password.addEventListener('blur', validatePassword);

  email.addEventListener('input', function () {
    if (email.hasAttribute('aria-invalid')) validateEmail();
  });

  reveal.addEventListener('click', function () {
    var shown = reveal.getAttribute('aria-pressed') === 'true';
    reveal.setAttribute('aria-pressed', String(!shown));
    reveal.setAttribute('aria-label', shown ? 'Şifreyi göster' : 'Şifreyi gizle');
    password.type = shown ? 'password' : 'text';
    password.focus();
  });

  var captchaInput = document.getElementById('captcha');
  var captcha = window.VlipaCaptcha.create({
    canvas: document.getElementById('captchaCanvas'),
    input: captchaInput,
    reload: document.getElementById('captchaReload'),
    setError: function (message) { return setError(captchaInput, captchaError, message); }
  });

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

    window.VlipaAuth.signup({
      name: name.value.trim(),
      email: email.value.trim(),
      password: password.value,
      remember: true
    }).then(function (result) {
      if (result.ok) {
        setStatus('Hesap oluşturuldu, yönlendiriliyorsunuz…', false);
        window.location.assign('/account');
        return;
      }

      busy(false);
      captcha.refresh();
      setStatus(window.VlipaAuth.message(result), true);

      if (result.status === 409) email.focus();
    }).catch(function () {
      busy(false);
      captcha.refresh();
      setStatus('Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.', true);
    });
  });

  window.VlipaAuth.me().then(function (result) {
    if (result.ok) window.location.replace('/account');
  }).catch(function () {});
})();
