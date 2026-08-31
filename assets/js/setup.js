/* The setup check.

   Reads /api/status and turns it into one row per thing that has to be true
   before the studio works, with the exact value to paste where it belongs.
   Nothing secret is shown: a client id is public, and keys are only ever
   reported as present or missing. */

const list = document.getElementById('list');

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }

  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  return node;
}

function copyRow(value) {
  const button = el('button', { type: 'button', text: 'Copy' });

  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy'; }, 1500);
    } catch {
      button.textContent = 'Select it by hand';
    }
  });

  return el('div', { class: 'copy' }, [el('code', { text: value }), button]);
}

function check({ state, title, body, steps, copy }) {
  return el('div', { class: `check check--${state}` }, [
    el('span', { class: 'check__mark', text: state === 'ok' ? '✓' : state === 'warn' ? '!' : '×' }),
    el('div', {}, [
      el('h2', { text: title }),
      ...[].concat(body).filter(Boolean).map((line) => el('p', { text: line })),
      copy ? copyRow(copy) : null,
      steps ? el('ol', {}, steps.map((step) => el('li', { text: step }))) : null,
    ]),
  ]);
}

function storageRow(data) {
  if (data.storage === 'supabase' && data.storageCheck?.ok) {
    return check({ state: 'ok', title: 'Storage — Supabase', body: 'Connected and answering. Accounts, companies and work survive a restart.' });
  }

  if (data.storage === 'supabase') {
    return check({
      state: 'bad',
      title: 'Storage — Supabase is refusing',
      body: ['The keys are set, but the request came back with an error. The usual cause is that the tables do not exist yet.', data.storageCheck?.error || ''],
      steps: ['Open Supabase → SQL Editor.', 'Run supabase.sql from the repository. It creates three tables.', 'Reload this page.'],
    });
  }

  if (data.storage === 'kv') {
    return check({ state: 'ok', title: 'Storage — Vercel KV', body: 'Connected. Supabase would take over if you set SUPABASE_URL and SUPABASE_SECRET_KEY.' });
  }

  return check({
    state: 'bad',
    title: 'Storage — nothing connected',
    body: [
      data.storageNote || 'No database is set, so the server keeps everything in memory.',
      'This is why signing in does not hold and why companies disappear: each request can land on a different server, and none of them remember anything.',
    ],
    steps: [
      'Supabase → SQL Editor → run supabase.sql once.',
      'Supabase → Project Settings → API: copy the Project URL and the secret key (sb_secret_… , formerly service_role).',
      'Vercel → Settings → Environment Variables: SUPABASE_URL and SUPABASE_SECRET_KEY. Not the publishable key, and never with a NEXT_PUBLIC_ prefix.',
      'Vercel → Deployments → ⋯ → Redeploy. Variables do not reach a deployment that already exists.',
    ],
  });
}

function googleRow(data) {
  if (!data.google?.on) {
    return check({
      state: 'warn',
      title: 'Signing in with Google — off',
      body: `Optional. Missing: ${[!data.google?.clientId && 'GOOGLE_CLIENT_ID', !data.google?.secret && 'GOOGLE_CLIENT_SECRET'].filter(Boolean).join(' and ') || 'one of the two values'}. Email and password sign-in works either way.`,
      steps: [
        'Google Cloud → Google Auth Platform → Clients → Create client → Web application.',
        'Put the client id and secret into Vercel as GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
        'Redeploy, then come back here for the redirect address to register.',
      ],
    });
  }

  // A site served on www that also answers on the bare domain (or the other way
  // round) is the classic mismatch: one host is registered, the browser arrives
  // on the other, and everything looks correct.
  let twin = '';

  try {
    const url = new URL(data.google.callback);

    // Only a real domain has a www twin worth registering.
    if (url.hostname.includes('.') && !url.hostname.endsWith('localhost')) {
      const other = url.hostname.startsWith('www.')
        ? url.hostname.slice(4)
        : `www.${url.hostname}`;

      twin = `${url.protocol}//${other}${url.pathname}`;
    }
  } catch { /* no twin worth mentioning */ }

  return check({
    state: 'warn',
    title: 'Signing in with Google — on, and this is the address it uses',
    body: [
      'Google refuses the sign-in (Error 400: redirect_uri_mismatch) unless this exact line is registered on the same OAuth client. Not a character more or less: no trailing slash, https not http, and the host exactly as written.',
      twin ? `Register the other host too — ${twin} — so the sign-in works whichever way somebody types the address. Registering both costs nothing.` : '',
    ],
    copy: data.google.callback,
    steps: [
      'Google Cloud → Google Auth Platform → Clients.',
      `Open the client whose id starts ${String(data.google.clientId || '').slice(0, 18)}… — it must be the same one, not another client you made earlier.`,
      'Authorized redirect URIs → + Add URI → paste the line above → Save.',
      'Authorized JavaScript origins should hold the site address itself as well — both hosts, again.',
      'Google can take a few minutes to publish the change. Then try again.',
    ],
  });
}

function addressRow(data) {
  const site = data.site || {};

  if (site.publicUrl && site.asked && site.resolved !== site.asked) {
    return check({
      state: 'bad',
      title: 'Address — PUBLIC_URL does not match this page',
      body: [
        `PUBLIC_URL resolves to ${site.resolved}, but you opened this page on ${site.asked}.`,
        'The Google callback is built from PUBLIC_URL, so on this address the sign-in cannot match. Either open the site on the address PUBLIC_URL names, or set PUBLIC_URL to the one you actually use.',
      ],
    });
  }

  return check({
    state: 'ok',
    title: 'Address',
    body: `${site.resolved || site.asked || 'unknown'}${site.publicUrl ? '' : ' (taken from the request; PUBLIC_URL is not set)'}`,
  });
}

/* The variables themselves, by name. This is the row that settles arguments:
   "I added Supabase" and "the server can see SUPABASE_URL" are not the same
   sentence. */
function envRow(data) {
  const env = data.env || {};

  const rows = [
    ['SUPABASE_URL', env.SUPABASE_URL, 'required — Supabase → Project Settings → API → Project URL'],
    ['SUPABASE_SECRET_KEY', env.SUPABASE_SECRET_KEY, 'required — the secret key, sb_secret_… (formerly service_role)'],
    ['AUTH_SECRET', env.AUTH_SECRET, 'required — any long random string; signs the captcha'],
    ['OPENROUTER_API_KEY', env.OPENROUTER_API_KEY, 'for Vlipa'],
    ['GOOGLE_CLIENT_ID', env.GOOGLE_CLIENT_ID, 'for signing in with Google'],
    ['GOOGLE_CLIENT_SECRET', env.GOOGLE_CLIENT_SECRET, 'for signing in with Google'],
    ['RESEND_API_KEY', env.RESEND_API_KEY, 'to email somebody when work lands on them'],
    ['GROQ_API_KEY', env.GROQ_API_KEY, 'for the Qwen model in Vlipa Studio'],
  ];

  const list = el('ul', { class: 'envlist' }, rows.map(([name, present, note]) => el('li', {
    class: present ? 'is-on' : 'is-off',
  }, [
    el('code', { text: name }),
    el('span', { text: present ? 'set' : 'missing' }),
    el('em', { text: note }),
  ])));

  const notes = [];

  if (env.SUPABASE_PUBLISHABLE_KEY) {
    notes.push(el('p', {
      text: 'A publishable (anon) key is set. This deployment does not use it and cannot: it is the key meant for browsers, it cannot get past row level security, and the tables here hold password hashes and live session tokens. It does no harm sitting there — it is public by design — but it is not what makes storage work.',
    }));
  }

  if (env.KV_REST_API_URL && !env.SUPABASE_URL) {
    notes.push(el('p', { text: 'A Vercel KV store is connected and is being used instead of Supabase.' }));
  }

  return el('div', { class: 'check check--plain' }, [
    el('span', { class: 'check__mark check__mark--flat', text: '·' }),
    el('div', {}, [
      el('h2', { text: 'What the server can see' }),
      el('p', { text: 'Names only — no value ever leaves the server. Anything missing here is missing from this deployment, whatever the Vercel list shows: a variable added after the last deploy does not reach it until you redeploy.' }),
      list,
      ...notes,
    ]),
  ]);
}

/* The first thing to check when a change does not seem to have arrived. */
function buildRow(data) {
  const build = data.build || {};

  if (!build.commit) {
    return check({ state: 'ok', title: 'Build — local', body: 'This is not a Vercel deployment, so there is no commit to name.' });
  }

  return check({
    state: 'ok',
    title: `Build — ${build.commit}${build.branch ? ` on ${build.branch}` : ''}`,
    body: [
      build.message || '',
      'If this is not the commit you expect, the deployment has not finished or it failed — check Vercel → Deployments. If it is, and the page still looks old, the browser is holding the last version: reload it once more.',
    ],
  });
}

function groqRow(data) {
  if (!data.groq?.on) {
    return check({
      state: 'warn',
      title: 'Qwen on Groq — off',
      body: 'Optional. Without GROQ_API_KEY, Vlipa Studio simply does not offer Qwen; the other models are unaffected.',
      steps: [
        'Create an API key at console.groq.com.',
        'Vercel → Settings → Environment Variables: GROQ_API_KEY.',
        'Redeploy.',
      ],
    });
  }

  return check({
    state: 'ok',
    title: 'Qwen on Groq — on',
    body: `Vlipa Studio offers it, running ${data.groq.model}. If Groq answers 404 for that id, set GROQ_MODEL to the name Groq lists — provider catalogues move.`,
  });
}

function mailRow(data) {
  if (data.mail?.on) {
    return check({
      state: 'ok',
      title: 'Mail — on',
      body: `Whoever is given a task hears about it, sent as ${data.mail.from}. Make sure that domain is verified with your mail provider, or the messages will be dropped before anybody sees them.`,
    });
  }

  return check({
    state: 'warn',
    title: 'Mail — off',
    body: 'Nobody is emailed when work is assigned to them. Everything else works; the studio simply stays silent.',
    steps: [
      'Create an account at a mail provider that speaks HTTP — Resend is what this is written against.',
      'Verify vlipa.dev there and add the DNS records it asks for, otherwise mail from no-reply@vlipa.dev is refused.',
      'Vercel → Settings → Environment Variables: RESEND_API_KEY. Optionally MAIL_FROM to change the sender.',
      'Redeploy.',
    ],
  });
}

/* The mailbox page. It rides on the same Google client as the sign-in, and
   needs two more boxes ticked over there: a redirect address of its own, and
   the Gmail API switched on for the project. */
function gmailRow(data) {
  // Credentials present but the page deliberately switched off: that is a
  // decision, not a missing variable, and it should read like one.
  if (data.gmail?.on && !data.gmail?.page) {
    return check({
      state: 'warn',
      title: 'Mailbox — built, and switched off',
      body: [
        'The Google client is set, but the Mail page is not offered and its endpoints answer nothing. MAIL_PAGE is not set to "on".',
        'It is off by default on purpose: reading a mailbox needs Gmail\'s restricted scopes, and until Google has verified this app only the accounts listed as test users can connect. Everybody else meets a consent screen that turns them away.',
      ],
      steps: [
        'Vercel → Settings → Environment Variables: MAIL_PAGE = on.',
        'Redeploy. The page comes back exactly as it was, and so does any mailbox already connected.',
      ],
    });
  }

  if (!data.gmail?.on) {
    return check({
      state: 'warn',
      title: 'Mailbox — off',
      body: 'Optional. Without a Google client, the Mail page offers nothing to connect to and stays out of the way.',
      steps: [
        'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, as for signing in with Google.',
        'Redeploy, then come back here for the redirect address to register.',
      ],
    });
  }

  return check({
    state: 'warn',
    title: 'Mailbox — on, and this is the address it comes back to',
    body: [
      'Connecting a mailbox is a second handshake with its own address. Register this one alongside the sign-in address on the same OAuth client, exactly as written.',
      'Google Cloud → APIs & Services → Library: the Gmail API has to be enabled for the project, and the consent screen has to list the Gmail scopes below. Until it is published, only the accounts listed as test users can connect.',
      (data.gmail.scopes || []).join(' '),
    ],
    copy: data.gmail.callback,
    steps: [
      'Google Cloud → Google Auth Platform → Clients → the same client as above.',
      'Authorized redirect URIs → + Add URI → paste the line above → Save.',
      'APIs & Services → Library → Gmail API → Enable.',
      'Google Auth Platform → Data access → add the gmail.modify and gmail.send scopes.',
      'Audience → add yourself as a test user, or publish the app.',
    ],
  });
}

function vlipaRow(data) {
  return data.ready
    ? check({ state: 'ok', title: 'Vlipa — key present', body: `Running on ${data.modes?.[0]?.model || 'the configured model'}. Use /api/status?probe=1 to ask the model itself whether it answers.` })
    : check({
        state: 'warn',
        title: 'Vlipa — no key',
        body: 'OPENROUTER_API_KEY is not set, so the assistant cannot answer. Everything else in the studio works without it.',
      });
}

async function start() {
  try {
    const data = await (await fetch('/api/status')).json();

    list.replaceChildren(
      buildRow(data),
      storageRow(data),
      googleRow(data),
      addressRow(data),
      vlipaRow(data),
      mailRow(data),
      gmailRow(data),
      groqRow(data),
      envRow(data),
    );
  } catch {
    list.replaceChildren(el('p', { class: 'error', text: 'Could not reach /api/status. The server may still be deploying.' }));
  }
}

start();
