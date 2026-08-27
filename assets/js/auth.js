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
    captchaImg.textContent = 'no connection';
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

/* Google is offered only where it is configured, so nobody is shown a button
   that cannot work. The address the visitor was heading for travels with it. */
const nextParam = new URLSearchParams(window.location.search).get('next');
const nextPath = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '';

(async () => {
  const wrap = document.getElementById('googleWrap');
  if (!wrap) return;

  try {
    const response = await fetch('/api/auth/providers');
    const data = await response.json();
    if (!data.google) return;

    if (nextPath) {
      document.getElementById('google').href = `/api/auth/google?next=${encodeURIComponent(nextPath)}`;
    }

    wrap.hidden = false;
  } catch { /* no Google button, the form still works */ }
})();

// The Google round trip comes back through the address bar when it fails.
const failed = new URLSearchParams(window.location.search).get('error');
if (failed) {
  say(failed === 'google-cancelled' ? 'The Google sign-in was interrupted.' : failed.replace(/-/g, ' '));

  // Most Google failures are a setting rather than a bad password, and the
  // setup page names the exact one.
  const help = document.createElement('a');
  help.href = '/setup';
  help.textContent = 'What is wrong with the setup?';
  help.style.cssText = 'display:inline-block;margin-top:8px;font-size:13.5px';
  message.after(help);
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

  if (!payload.email || !payload.password) return say('Enter your email and password.');
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

    // An invite link parks its address in ?next=, so the visitor lands back
    // on it instead of in an empty studio.
    say('Done, taking you through…', true);
    window.location.assign(nextPath || '/studio');
  } catch {
    say('Could not reach the server. Check your connection and try again.');
    await newCaptcha();
  } finally {
    submit.disabled = false;
    submit.textContent = isSignup ? 'Create account' : 'Sign in';
  }
});

newCaptcha();
