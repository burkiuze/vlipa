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
    captchaImg.textContent = 'offline';
  }
}

function say(text, good) {
  message.textContent = text;
  message.className = good ? 'ok' : 'error';
}

if (strength) {
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
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

  if (!payload.email || !payload.password) return say('Fill in your email and password.');
  if (!payload.captcha) return say('Type the security code.');

  submit.disabled = true;
  submit.textContent = isSignup ? 'Creating…' : 'Signing in…';

  try {
    const response = await fetch(`/api/auth/${isSignup ? 'signup' : 'login'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      say(data.error || 'That did not work. Try again.');
      await newCaptcha();
      return;
    }

    say('Done. Opening the studio…', true);
    window.location.assign('/studio');
  } catch {
    say('Could not reach the server. Check your connection and try again.');
    await newCaptcha();
  } finally {
    submit.disabled = false;
    submit.textContent = isSignup ? 'Create account' : 'Sign in';
  }
});

newCaptcha();
