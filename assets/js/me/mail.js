/* Mail: your own mailbox, with Vlipa sitting next to it.

   It takes the whole screen, because a mailbox with a page around it is a
   mailbox in a letterbox. Two columns, and which one is which is the point:
   on the left Vlipa with the mailbox in front of it, on the right the mailbox
   itself — one line per message the way a mailbox is actually read, and the
   message you open in the same column.

   The panel is one box for two things, and it works out which: "what needs an
   answer today?" comes back as an answer, "reply to Riani and say Thursday,
   with the invoice attached" comes back as a finished message with its
   recipients, its subject and the file on it, and one Send button under it.

   That button is the line. Vlipa writes the whole thing, addresses it and
   attaches to it; a person presses Send. An address it was not given it never
   invents — the server drops any recipient that was not in front of it — so
   the worst it can do is hand you a message with an empty To box.

   No message text is ever put into the page as markup. Every line here is a
   text node, so a mail carrying a script tag is a mail that says "script
   tag". */

import { api } from '../studio/api.js';
import { modelsFor } from '../studio/agent.js';
import { avatar } from '../studio/avatar.js';
import { $, clear, dialog, el, field, menu, prose, toast } from '../studio/dom.js';

const MODEL_KEY = 'vlipa.me.mail.model';

const BOXES = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'unread', label: 'Unread' },
  { id: 'starred', label: 'Starred' },
  { id: 'sent', label: 'Sent' },
  { id: 'archive', label: 'Archived' },
];

const mail = {
  ready: false,
  connected: false,
  account: null,
  vlipa: false,

  box: 'inbox',
  query: '',
  messages: [],
  nextPageToken: '',
  loading: false,

  open: null,
  opening: '',

  models: [],
  model: 'vlipa',

  turns: [],
  asking: false,

  // Starring a message redraws the whole page, and half a typed question
  // disappearing because of that is infuriating. So the box's contents live
  // here rather than only in the box.
  question: '',

  /* Files picked in the panel, as { name, type, size, data } with the bytes
     base64 in this browser. They go nowhere until something is sent. */
  files: [],
};

const call = (body, options = {}) => api('/api/mail', { method: 'POST', body, ...options });

/* "Riani Söylemez <riani@example.com>" → the name for a list, the address for
   a reply. A header that is only an address shows the part before the @,
   which is what every mail client does and what people actually read. */
function who(header) {
  const raw = String(header || '').trim();
  const angled = raw.match(/^(.*?)<([^<>]+)>\s*$/);

  const address = (angled ? angled[2] : raw).trim();
  const name = angled ? angled[1].replace(/^"|"$/g, '').trim() : '';

  return { name: name || address.split('@')[0] || address, address };
}

/* Whole days between two moments, counted on the calendar rather than in
   hours: something sent at eleven last night is yesterday at nine this
   morning, however few hours ago that was. */
function daysAgo(value) {
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return Infinity;

  const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((midnight(new Date()) - midnight(then)) / 86400000);
}

/* The face on a row.

   Gmail does not hand over a sender's picture, and the thing people actually
   recognise in a list is the company's mark rather than a photograph — so the
   sender's own domain provides it, through the icon service the browser can
   reach. A person at gmail.com, or an icon that will not load, falls back to
   the coloured initial every other list in here uses.

   It is one request per domain to Google, which is where this mailbox already
   lives; nothing about the message is in it beyond the domain. */
function senderFace(person, size = 26) {
  const domain = String(person.address || '').split('@')[1] || '';
  const plain = /^(gmail|googlemail|hotmail|outlook|yahoo|icloud|yandex|proton(mail)?)\./i.test(`${domain}.`);

  const letter = avatar({ name: person.name }, size);
  if (!domain || plain) return letter;

  const mark = el('img', {
    class: 'face face--mark',
    src: `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`,
    alt: '',
    width: size,
    height: size,
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
    style: `width:${size}px;height:${size}px`,
  });

  // An icon that does not arrive leaves the initial in its place rather than
  // a broken picture.
  mark.addEventListener('error', () => mark.replaceWith(letter));

  return mark;
}

/* A mailbox is read by when things arrived, so the list is broken up the same
   way rather than running as one column of a hundred rows. */
function bucket(value) {
  if (!value) return 'Earlier';

  const days = daysAgo(value);

  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Last 7 days';
  if (days < 30) return 'Last 30 days';

  return 'Earlier';
}

/* The time on a row: the clock for today, the date for anything older. Long
   enough to be useful, short enough to sit in a column. */
function stamp(value) {
  if (!value) return '';

  const date = new Date(value);
  const days = daysAgo(value);

  if (days <= 0) return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (days < 300) return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

/* ---------- what Google said on the way back ---------- */

let trouble = '';
let offHere = false;

function landing() {
  const query = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const said = query.get('mail');
  if (!said) return;

  const lines = {
    connected: ['Mailbox connected.', ''],
    cancelled: ['You cancelled that.', 'bad'],
    session: ['That took too long. Try connecting again.', 'bad'],
    failed: ['Google would not finish the connection.', 'bad'],
    off: ['Mail is not switched on for this deployment.', 'bad'],
  };

  const [message, kind] = lines[said] || [];
  if (message) toast(message, kind);

  trouble = kind === 'bad' ? [message, query.get('why')].filter(Boolean).join(' ') : '';
  offHere = said === 'off';

  window.history.replaceState(null, '', '#/mail');
}

/* ---------- reading ---------- */

async function loadList({ more = false } = {}) {
  if (mail.loading) return;

  mail.loading = true;
  if (!more) { mail.messages = []; mail.nextPageToken = ''; }
  render();

  try {
    const data = await call({
      action: 'list',
      box: mail.box,
      query: mail.query,
      pageToken: more ? mail.nextPageToken : '',
    });

    mail.messages = more ? [...mail.messages, ...data.messages] : data.messages;
    mail.nextPageToken = data.nextPageToken || '';
  } catch (error) {
    if (error.status === 428) mail.connected = false;
    else toast(error.message, 'bad');
  } finally {
    mail.loading = false;
    render();
  }
}

async function openMessage(id) {
  mail.opening = id;
  mail.open = null;
  render();

  try {
    const data = await call({ action: 'open', id });

    mail.open = data.message;

    // The row in the list is the same message: it stops being bold here too,
    // rather than after the next refresh.
    const row = mail.messages.find((one) => one.id === id);
    if (row) row.unread = false;
  } catch (error) {
    toast(error.message, 'bad');
  } finally {
    mail.opening = '';
    render();
  }
}

/* Star it, archive it, bin it, mark it unread. The list is updated from what
   comes back rather than from what was asked for, so a row can never claim
   something the mailbox did not do. */
async function change(id, move) {
  try {
    const data = await call({ action: 'change', id, move });
    const at = mail.messages.findIndex((one) => one.id === id);

    // Something that left this box leaves the list; anything else is redrawn
    // as the mailbox now has it.
    const gone = (move === 'archive' && mail.box === 'inbox')
      || (move === 'bin')
      || (move === 'unstar' && mail.box === 'starred')
      || (move === 'read' && mail.box === 'unread')
      || (move === 'inbox' && mail.box === 'archive');

    if (at >= 0) {
      if (gone) mail.messages.splice(at, 1);
      else mail.messages[at] = { ...mail.messages[at], ...data.message };
    }

    if (mail.open?.id === id) {
      if (gone) mail.open = null;
      else mail.open = { ...mail.open, ...data.message };
    }

    toast({
      archive: 'Archived.',
      inbox: 'Back in the inbox.',
      bin: 'Moved to the bin.',
      star: 'Starred.',
      unstar: 'Unstarred.',
      read: 'Marked read.',
      unread: 'Marked unread.',
    }[move] || 'Done.');
  } catch (error) {
    toast(error.message, 'bad');
  }

  render();
}

/* ---------- attachments ---------- */

/* Vercel hands a function the whole request in memory, and base64 makes a
   file a third larger on the way. Three megabytes is what fits with room to
   breathe, and the server refuses the rest with the same number. */
const MAX_ATTACH = 3 * 1024 * 1024;

const sizeOf = (bytes) => (bytes > 1024 * 1024
  ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/* A file, as base64, without leaving the browser. */
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve({
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      data: String(reader.result).split(',')[1] || '',
    });

    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.readAsDataURL(file);
  });
}

/* The picker and the list of what is on the message, as one block. `held` is
   the array it adds to and removes from, and `redraw` is how whoever owns
   that array puts the change on screen. */
function attachments(held, redraw) {
  const input = el('input', {
    type: 'file',
    multiple: true,
    hidden: true,
    onchange: async (event) => {
      const picked = [...event.target.files];
      event.target.value = '';

      for (const file of picked) {
        const already = held.reduce((sum, one) => sum + one.size, 0);

        if (held.length >= 5) { toast('Five files is the most a message carries.', 'bad'); break; }
        if (already + file.size > MAX_ATTACH) { toast(`${file.name} is too big — ${sizeOf(MAX_ATTACH)} in total is the limit.`, 'bad'); continue; }

        try {
          held.push(await readFile(file));
        } catch (error) {
          toast(error.message, 'bad');
        }
      }

      redraw();
    },
  });

  return el('div', { class: 'mailclip' }, [
    input,

    el('button', {
      class: 'chip',
      type: 'button',
      title: 'Attach a file',
      onclick: () => input.click(),
      html: '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8L9.7 17.4a1.8 1.8 0 0 1-2.5-2.5l7.8-7.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    }, [el('span', { text: held.length ? `${held.length} attached` : 'Attach' })]),

    ...held.map((file, at) => el('span', { class: 'mailclip__file', title: `${file.name} · ${sizeOf(file.size)}` }, [
      el('span', { class: 'mailclip__name', text: file.name }),
      el('span', { class: 'mailclip__size', text: sizeOf(file.size) }),
      el('button', {
        class: 'mailclip__off',
        type: 'button',
        title: 'Take it off',
        'aria-label': `Take ${file.name} off`,
        text: '×',
        onclick: () => { held.splice(at, 1); redraw(); },
      }),
    ])),
  ]);
}

/* ---------- writing ---------- */

/* The composer. One dialog for a new mail, for a reply, and for something
   Vlipa wrote that somebody wants to change before it goes.

   The Vlipa row at the top is a line about what to say; the subject and body
   underneath are written for you. It fills the boxes and goes quiet; sending
   is the button at the bottom, pressed by a person. */
function compose({ to = '', subject = '', text = '', replyTo = '', quote = '', instruction = '', files = [] } = {}) {
  const toBox = el('input', { name: 'to', value: to, placeholder: 'someone@example.com', required: true, autocomplete: 'off' });
  const ccBox = el('input', { name: 'cc', placeholder: 'Nobody, unless you say so', autocomplete: 'off' });
  const subjectBox = el('input', { name: 'subject', value: subject, maxlength: 200, placeholder: 'What it is about' });
  const bodyBox = el('textarea', { name: 'text', rows: 12, placeholder: 'Write it, or ask Vlipa above.' });

  bodyBox.value = text;

  const held = [...files];
  const clipRow = el('div', { class: 'mailclip__row' });
  const drawClips = () => clear(clipRow).appendChild(attachments(held, drawClips));

  drawClips();

  const ask = el('input', {
    value: instruction,
    placeholder: replyTo
      ? 'Tell Vlipa how to answer this — "agree, and ask for Thursday instead"'
      : 'Tell Vlipa what to write — "ask about the invoice, politely, short"',
    autocomplete: 'off',
  });

  const write = el('button', { class: 'btn btn--ai btn--sm', type: 'button', text: 'Write it' });
  const note = el('p', { class: 'muted mailask__note', text: '' });

  let cc = false;

  const ccRow = field('Cc', ccBox);
  ccRow.hidden = true;

  const draft = async () => {
    const said = ask.value.trim();

    if (!said) {
      note.textContent = 'Say what it should say first.';
      return;
    }

    write.disabled = true;
    note.textContent = 'Vlipa is writing…';

    try {
      const data = await call({
        action: 'draft',
        ask: said,
        to: toBox.value,
        subject: subjectBox.value,
        text: bodyBox.value,
        replyTo,
        model: mail.model,
      }, { timeout: 60000 });

      if (data.draft.to && !toBox.value.trim()) toBox.value = data.draft.to;
      if (data.draft.subject) subjectBox.value = data.draft.subject;
      bodyBox.value = data.draft.body;

      note.textContent = 'Read it before you send it. Anything in [brackets] is something Vlipa did not know.';
      bodyBox.focus();
    } catch (error) {
      note.textContent = error.reason || error.message;
    } finally {
      write.disabled = false;
    }
  };

  write.addEventListener('click', draft);

  ask.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); draft(); }
  });

  dialog({
    title: replyTo ? 'Reply' : 'New message',
    confirm: 'Send',
    body: [
      // A composer wants more room than a confirmation box; this is what the
      // stylesheet widens the dialog by.
      el('div', { class: 'mailcompose', hidden: true }),

      mail.vlipa
        ? el('div', { class: 'mailask' }, [
            el('div', { class: 'mailask__row' }, [
              ask,
              mail.models.length > 1
                ? menu({
                    label: 'Model',
                    value: mail.model,
                    options: mail.models,
                    onPick: (id) => {
                      mail.model = id;
                      try { localStorage.setItem(MODEL_KEY, id); } catch { /* private mode */ }
                    },
                  })
                : null,
              write,
            ]),
            note,
          ])
        : null,

      field('To', toBox, 'One address, or several separated by commas.'),
      ccRow,
      el('button', {
        class: 'ghostlink',
        type: 'button',
        text: 'Add Cc',
        onclick: (event) => {
          cc = !cc;
          ccRow.hidden = !cc;
          event.target.textContent = cc ? 'Remove Cc' : 'Add Cc';
          if (cc) ccBox.focus();
        },
      }),
      field('Subject', subjectBox),
      field('Message', bodyBox),
      clipRow,

      quote ? el('details', { class: 'mailquote' }, [
        el('summary', { text: 'The message you are answering' }),
        el('div', { class: 'mailquote__body', text: quote }),
      ]) : null,
    ].filter(Boolean),

    onConfirm: async (form) => {
      await send({
        to: form.get('to'),
        cc: cc ? form.get('cc') : '',
        subject: form.get('subject'),
        text: form.get('text'),
        replyTo,
        files: held,
      });
    },
  });

  if (instruction) draft();
}

/* The one place a message actually leaves. Everything that sends — the
   composer, and the card Vlipa writes — comes through here. */
async function send({ to, cc = '', subject, text, replyTo = '', files = [] }) {
  const data = await call({
    action: 'send',
    to,
    cc,
    subject,
    text,
    replyTo,
    files: files.map((file) => ({ name: file.name, type: file.type, data: file.data })),
  }, { timeout: 90000 });

  toast(`Sent to ${data.to.join(', ')}${data.files?.length ? ` with ${data.files.join(', ')}` : ''}.`);

  // A sent mail belongs in Sent, and the inbox has not changed — so the list
  // is only refetched where it would actually be different.
  if (mail.box === 'sent') loadList();

  return data;
}

function replyTo(message) {
  const from = who(message.from);
  const quoted = `On ${new Date(message.at).toLocaleString('en-GB')}, ${from.name} wrote:\n\n${message.body}`;

  compose({
    to: from.address,
    subject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`,
    replyTo: message.id,
    quote: message.body,
    text: `\n\n---\n${quoted}`,
  });
}

async function disconnect() {
  if (!window.confirm('Disconnect this mailbox? Nothing in it changes, and vlipa forgets the connection.')) return;

  await call({ action: 'disconnect' }).catch((error) => toast(error.message, 'bad'));

  Object.assign(mail, { connected: false, account: null, messages: [], open: null, turns: [], files: [] });
  render();
}

/* ---------- Vlipa, over the mailbox ---------- */

/* One box, two answers. A question about the mailbox comes back as words; a
   "write to Riani and say…" comes back as a message, addressed and attached
   to, waiting on one button.

   The mailbox is read on the server for each turn, so the answer is about the
   mail as it is now rather than as this page last drew it. */
async function askVlipa(question) {
  if (!question || mail.asking) return;

  mail.turns.push({ role: 'user', content: question });
  mail.asking = true;
  render();

  try {
    const data = await call({
      action: 'assist',
      question,
      box: mail.box,
      query: mail.query,
      id: mail.open?.id || '',
      model: mail.model,
      files: mail.files.map((file) => ({ name: file.name, size: file.size })),
    }, { timeout: 90000 });

    if (data.kind === 'mail') {
      // The files it was told about travel with the message it wrote, and the
      // panel's clip is emptied: they are on this mail now, not waiting for
      // the next one.
      mail.turns.push({ role: 'mail', mail: { ...data.mail, files: mail.files } });
      mail.files = [];
    } else {
      mail.turns.push({ role: 'assistant', content: data.answer });
    }
  } catch (error) {
    mail.turns.push({ role: 'assistant', content: error.reason || error.message, bad: true });
  } finally {
    mail.asking = false;
    render();
  }
}

/* What Vlipa wrote, as it will go out: who it is addressed to, what it says,
   what is on it — and the two buttons. Send is one press; Change it opens the
   same message in the composer.

   An empty To box is the server having dropped an address that was never in
   front of the model. Saying so is better than sending it somewhere. */
function proposal(turn, at) {
  const written = turn.mail;
  const ready = Boolean(written.to);

  return el('div', { class: 'mailturn mailturn--draft' }, [
    el('div', { class: 'maildraft__head' }, [
      el('span', { class: 'maildraft__tag', text: written.replyTo ? 'Reply' : 'New message' }),
      el('b', { text: written.subject || '(no subject)' }),
    ]),

    el('p', { class: ready ? 'muted' : 'maildraft__warn', text: ready ? `To ${written.to}` : 'No address — Vlipa was not given one, so put it in before this goes.' }),

    el('div', { class: 'maildraft__body', text: written.body }),

    written.files?.length
      ? el('p', { class: 'muted', text: `Attached: ${written.files.map((file) => `${file.name} (${sizeOf(file.size)})`).join(', ')}` })
      : null,

    el('div', { class: 'maildraft__acts' }, [
      el('button', {
        class: 'btn btn--sm',
        type: 'button',
        text: turn.sending ? 'Sending…' : 'Send it',
        disabled: !ready || turn.sending || turn.sent,
        onclick: async () => {
          turn.sending = true;
          render();

          try {
            await send({ ...written, text: written.body });
            turn.sent = true;
          } catch (error) {
            toast(error.message, 'bad');
          } finally {
            turn.sending = false;
            render();
          }
        },
      }),

      el('button', {
        class: 'btn btn--ghost btn--sm',
        type: 'button',
        text: 'Change it first',
        onclick: () => compose({
          to: written.to,
          subject: written.subject,
          text: written.body,
          replyTo: written.replyTo || '',
          files: written.files || [],
        }),
      }),

      el('button', {
        class: 'ghostlink ghostlink--bad',
        type: 'button',
        text: 'Drop it',
        onclick: () => { mail.turns.splice(at, 1); render(); },
      }),
    ]),

    turn.sent ? el('p', { class: 'maildraft__sent', text: '✓ Sent.' }) : null,
  ].filter(Boolean));
}

/* ---------- drawing ---------- */

function icon(path) {
  return el('span', {
    class: 'mailico',
    html: `<svg viewBox="0 0 24 24" fill="none"><path d="${path}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  });
}

const STAR = 'M12 4.5l2.1 4.6 5 .6-3.7 3.4 1 4.9L12 15.6l-4.4 2.4 1-4.9L4.9 9.7l5-.6z';
const ARCHIVE = 'M4 7.5h16M5.5 7.5V19h13V7.5M9.5 11.5h5';
const ENVELOPE = 'M4.5 6.5h15v11h-15zM4.5 7l7.5 6 7.5-6';
const BACK = 'M4 12l8-7 8 7M6.5 10.5V19h11v-8.5';

/* One message, one line: who it is from, what it says, and when. The buttons
   take the place of the time while the pointer is on the row. */
function row(message) {
  const from = who(mail.box === 'sent' ? message.to : message.from);
  const chosen = mail.open?.id === message.id;

  const act = (title, path, move, on = false) => el('button', {
    class: `mailact${on ? ' is-on' : ''}`,
    type: 'button',
    title,
    'aria-label': title,
    onclick: (event) => { event.stopPropagation(); change(message.id, move); },
  }, [icon(path)]);

  return el('div', {
    class: `mailrow${message.unread ? ' is-unread' : ''}${chosen ? ' is-open' : ''}`,
    role: 'button',
    tabindex: '0',
    onclick: () => openMessage(message.id),
    onkeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openMessage(message.id); }
    },
  }, [
    senderFace(from, 26),

    el('span', { class: 'mailrow__who', text: from.name }),

    el('span', { class: 'mailrow__text' }, [
      el('span', { class: 'mailrow__subject', text: message.subject }),
      message.snippet ? el('span', { class: 'mailrow__snippet', text: ` — ${message.snippet}` }) : null,
    ]),

    message.starred ? el('span', { class: 'mailrow__star', title: 'Starred' }, [icon(STAR)]) : null,

    el('span', { class: 'mailrow__when', text: stamp(message.at) }),

    el('span', { class: 'mailrow__acts' }, [
      act(message.starred ? 'Unstar' : 'Star', STAR, message.starred ? 'unstar' : 'star', message.starred),
      act(message.unread ? 'Mark read' : 'Mark unread', ENVELOPE, message.unread ? 'read' : 'unread'),
      mail.box === 'archive'
        ? act('Back to the inbox', BACK, 'inbox')
        : act('Archive', ARCHIVE, 'archive'),
    ]),
  ].filter(Boolean));
}

function list() {
  const host = el('div', { class: 'maillist' });

  if (mail.loading && !mail.messages.length) {
    host.appendChild(el('p', { class: 'empty', text: 'Reading the mailbox…' }));
    return host;
  }

  if (!mail.messages.length) {
    host.appendChild(el('div', { class: 'empty empty--big' }, [
      el('h3', { text: mail.query ? 'Nothing matched' : 'Nothing here' }),
      el('p', { text: mail.query ? 'Try fewer words, or a different box.' : 'This box is empty.' }),
    ]));
    return host;
  }

  let heading = '';

  for (const message of mail.messages) {
    const group = bucket(message.at);

    if (group !== heading) {
      heading = group;
      host.appendChild(el('div', { class: 'mailgroup', text: group.toUpperCase() }));
    }

    host.appendChild(row(message));
  }

  if (mail.nextPageToken) {
    host.appendChild(el('button', {
      class: 'btn btn--ghost btn--sm maillist__more',
      type: 'button',
      text: mail.loading ? 'Reading…' : 'Load more',
      disabled: mail.loading,
      onclick: () => loadList({ more: true }),
    }));
  }

  return host;
}

function reader() {
  const message = mail.open;
  const from = who(message.from);

  return el('div', { class: 'mailread' }, [
    el('button', {
      class: 'ghostlink mailread__back',
      type: 'button',
      text: '← Back to the list',
      onclick: () => { mail.open = null; render(); },
    }),

    el('div', { class: 'mailread__head' }, [
      el('h3', { text: message.subject }),
      el('div', { class: 'mailread__from' }, [
        senderFace(from, 32),
        el('div', {}, [
          el('p', { text: `${from.name} <${from.address}>` }),
          el('p', { class: 'muted', text: `To ${who(message.to).address}${message.cc ? `, cc ${message.cc}` : ''} · ${new Date(message.at).toLocaleString('en-GB')}` }),
        ]),
      ]),
    ]),

    el('div', { class: 'mailread__acts' }, [
      el('button', { class: 'btn btn--sm', type: 'button', text: 'Reply', onclick: () => replyTo(message) }),
      el('button', {
        class: 'btn btn--ai btn--sm',
        type: 'button',
        text: 'Reply with Vlipa',
        disabled: !mail.vlipa,
        title: mail.vlipa ? 'Vlipa drafts the answer; you send it' : 'Vlipa is not connected on this deployment',
        onclick: () => replyTo(message),
      }),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Archive', onclick: () => change(message.id, 'archive') }),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Unread', onclick: () => change(message.id, 'unread') }),
      el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: 'Bin', onclick: () => change(message.id, 'bin') }),
    ]),

    message.files.length
      ? el('p', { class: 'muted mailread__files', text: `Attached: ${message.files.map((file) => file.name).join(', ')} — open these in Gmail.` })
      : null,

    el('div', { class: 'mailread__body', text: message.body || '(this message has no text in it)' }),

    message.truncated ? el('p', { class: 'muted', text: 'This message is longer than what is shown; the rest is in Gmail.' }) : null,
  ].filter(Boolean));
}

/* The left column: Vlipa, with the mailbox in front of it. */
function panel() {
  const go = () => {
    const said = mail.question.trim();
    mail.question = '';
    askVlipa(said);
  };

  const box = el('textarea', {
    class: 'mailpanel__ask',
    rows: 3,
    placeholder: mail.open
      ? 'Answer this one, ask about your mail, or say who to write to…'
      : 'Ask about your mail, or say who to write to and what to say…',
    oninput: (event) => { mail.question = event.target.value; },
    onkeydown: (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        go();
      }
    },
  });

  box.value = mail.question;

  const log = el('div', { class: 'mailpanel__log' });

  if (!mail.turns.length) {
    log.appendChild(el('div', { class: 'mailpanel__welcome' }, [
      el('img', { src: 'assets/img/vlipa-ai-96.png', alt: '', width: 34, height: 34 }),
      el('h3', { text: 'How can I help with your mail?' }),
      el('p', { class: 'muted', text: 'Ask what is in there, or say who to write to and what to say — attachments included. It writes and addresses it; you press Send.' }),
    ]));
  } else {
    mail.turns.forEach((turn, at) => {
      if (turn.role === 'user') {
        log.appendChild(el('div', { class: 'mailturn mailturn--me' }, [el('p', { text: turn.content })]));
      } else if (turn.role === 'mail') {
        log.appendChild(proposal(turn, at));
      } else {
        log.appendChild(el('div', { class: `mailturn${turn.bad ? ' mailturn--bad' : ''}` }, [prose(turn.content)]));
      }
    });

    if (mail.asking) log.appendChild(el('div', { class: 'mailturn' }, [el('p', { class: 'muted', text: 'Reading your mail…' })]));
  }

  const clipRow = el('div', { class: 'mailclip__row' });
  const drawClips = () => clear(clipRow).appendChild(attachments(mail.files, drawClips));

  drawClips();

  return el('aside', { class: 'mailpanel' }, [
    log,

    el('div', { class: 'mailpanel__foot' }, [
      box,
      clipRow,

      el('div', { class: 'mailpanel__row' }, [
        mail.models.length > 1
          ? menu({ label: 'Model', value: mail.model, options: mail.models, onPick: (id) => {
              mail.model = id;
              try { localStorage.setItem(MODEL_KEY, id); } catch { /* private mode */ }
            } })
          : null,

        el('button', {
          class: 'btn btn--sm',
          type: 'button',
          text: mail.asking ? 'Working…' : 'Send to Vlipa',
          disabled: mail.asking,
          onclick: go,
        }),
      ].filter(Boolean)),
    ]),
  ]);
}

function inbox(view) {
  const search = el('input', {
    class: 'mailsearch',
    type: 'search',
    value: mail.query,
    placeholder: 'Search this mailbox — from:someone, has:attachment, invoice',
    onkeydown: (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      mail.query = event.target.value.trim();
      mail.open = null;
      loadList();
    },
  });

  const boxes = el('div', { class: 'mailboxes' }, BOXES.map((one) => el('button', {
    class: `chip${mail.box === one.id ? ' chip--on' : ''}`,
    type: 'button',
    text: one.label,
    onclick: () => {
      if (mail.box === one.id) return;
      mail.box = one.id;
      mail.open = null;
      loadList();
    },
  })));

  view.appendChild(el('div', { class: 'mailshell' }, [
    // The whole screen is the mailbox, so its heading is one line across the
    // top rather than a page header above a page.
    el('header', { class: 'mailtop' }, [
      el('h2', { text: 'Mail' }),
      el('span', { class: 'mailtop__who', text: mail.account.email }),
      el('button', { class: 'btn btn--sm', type: 'button', text: 'New message', onclick: () => compose() }),
      el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Disconnect', onclick: disconnect }),
    ]),

    el('div', { class: 'mailpage' }, [
      mail.vlipa ? panel() : null,

      el('section', { class: 'mailbox' }, [
        el('div', { class: 'mailbar' }, [boxes, search]),
        mail.opening
          ? el('div', { class: 'mailread' }, [el('p', { class: 'empty', text: 'Opening…' })])
          : mail.open ? reader() : list(),
      ]),
    ].filter(Boolean)),
  ]));
}

function offer(view) {
  view.appendChild(el('div', { class: 'pagehead' }, [
    el('div', {}, [
      el('h2', { text: 'Mail' }),
      el('p', { class: 'muted', text: 'Your own mailbox, with Vlipa next to it: read what came in, and have the answer written for you before you send it.' }),
    ]),
  ]));

  if (trouble) {
    view.appendChild(el('div', { class: 'panelcard panelcard--warn' }, [
      el('h3', { text: 'That did not connect' }),
      el('p', { text: trouble }),
      el('p', {
        class: 'muted',
        text: offHere
          ? 'The Google client is not on the server yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the deployment environment and redeploy — /setup says which one is missing.'
          : `The OAuth client needs ${window.location.origin}/api/mail/callback in its redirect addresses, exactly as written, and the Gmail API switched on for the project.`,
      }),
    ]));
  }

  view.appendChild(el('section', { class: 'panelcard' }, [
    el('h3', { text: 'Connect your mailbox' }),
    el('p', { class: 'muted', text: 'Google asks you first, and shows exactly what it is handing over. The connection is yours alone and this page cuts it whenever you like.' }),

    el('ul', { class: 'way__list' }, [
      'Read your own inbox here, and search it',
      'Answer in place, from your own address',
      'Ask Vlipa what needs answering, and for the words to answer it with',
      'Star, archive and mark read — it is your real mailbox',
    ].map((line) => el('li', { text: line }))),

    el('p', { class: 'muted', text: 'vlipa never sends anything on its own: Vlipa writes into the composer and the Send button is yours.' }),

    el('div', { class: 'spread' }, [
      el('a', { class: 'btn', href: '/api/mail/start', text: 'Connect Gmail' }),
    ]),
  ]));
}

function render() {
  if (!$('view') || !window.location.hash.startsWith('#/mail')) return;

  const view = clear($('view'));
  if (mail.connected && mail.account) inbox(view);
  else offer(view);

  // A conversation reads from the bottom.
  const log = view.querySelector('.mailpanel__log');
  if (log) log.scrollTop = log.scrollHeight;
}

async function load() {
  try {
    const data = await call({ action: 'status' });

    mail.ready = true;
    mail.connected = data.connected;
    mail.account = data.account || null;
    mail.vlipa = Boolean(data.vlipa);
  } catch (error) {
    mail.ready = error.status !== 503;
    mail.connected = false;

    if (error.status && error.status !== 503 && error.status !== 401) toast(error.message, 'bad');
    if (error.status === 503) trouble = error.message;
  }
}

export async function show() {
  landing();

  try {
    mail.model = localStorage.getItem(MODEL_KEY) || mail.model;
  } catch { /* private mode: the default is fine */ }

  render();
  await load();
  render();

  if (mail.connected) {
    // The model list is only wanted by the panel and the composer, so it is
    // fetched beside the mailbox rather than in front of it.
    if (!mail.models.length) {
      modelsFor('mail').then((models) => {
        mail.models = models;
        if (!models.some((model) => model.id === mail.model)) mail.model = models[0]?.id || 'vlipa';
        render();
      }).catch(() => {});
    }

    await loadList();
  }
}
