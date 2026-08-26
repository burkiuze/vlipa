/* Sign-in and sign-up. The captcha is drawn by the server; the browser only
   ever holds an opaque token and whatever the visitor types. */

const form = document.getElementById('form');
const message = document.getElementById('message');
const submit = document.getElementById('submit');
const captchaImg = document.getElementById('captchaImg');
const captchaInput = document.getElementById('captcha');
const strength = document.getElementById('strength');
const isSignup = Boolean(document.getElementById('name'));

let captchaToken = '';

async function newCaptcha() {
  captchaImg.innerHTML = '';
  captchaInput.value = '';

  try {
    const response = await fetch('/api/captcha', { headers: { accept: 'application/json' } });
    const data = await response.json();
    captchaToken = data.token || '';
    captchaImg.innerHTML = data.svg || '';
  } catch {
    captchaImg.textContent = 'bağlantı yok';
  }
}

function say(text, good) {
  message.textContent = text;
  message.className = good ? 'ok' : 'error';
}

if (strength) {
  const labels = ['Çok kısa', 'Zayıf', 'Orta', 'İyi', 'Güçlü'];
  const password = document.getElementById('password');

  password.addEventListener('input', () => {
    const value = password.value;
    let score = 0;

    if (value.length >= 8) score += 1;
    if (value.length >= 12) score += 1;
    if (/[^A-Za-z]/.test(value)) score += 1;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
    if (value.length < 8) score = 0;

    strength.dataset.score = String(score);
    strength.querySelector('span').textContent = value ? labels[score] : '';
  });
}

document.getElementById('captchaNew').addEventListener('click', newCaptcha);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  say('', false);

  const payload = {
    email: document.getElementById('email').value.trim(),
    password: document.getElementById('password').value,
    captcha: captchaInput.value,
    captchaToken,
    remember: true,
  };

  if (isSignup) payload.name = document.getElementById('name').value.trim();

  if (!payload.email || !payload.password) return say('E-posta ve şifreni gir.');
  if (!payload.captcha) return say('Güvenlik kodunu yaz.');

  submit.disabled = true;
  submit.textContent = isSignup ? 'Açılıyor…' : 'Giriş yapılıyor…';

  try {
    const response = await fetch(`/api/auth/${isSignup ? 'signup' : 'login'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      say(data.error || 'Olmadı, tekrar dene.');
      await newCaptcha();
      return;
    }

    // An invite link parks its address in ?next=, so the visitor lands back
    // on it instead of in an empty studio.
    const next = new URLSearchParams(window.location.search).get('next');
    const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/studio';

    say('Tamam, devam ediliyor…', true);
    window.location.assign(target);
  } catch {
    say('Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.');
    await newCaptcha();
  } finally {
    submit.disabled = false;
    submit.textContent = isSignup ? 'Hesap aç' : 'Giriş yap';
  }
});

newCaptcha();
