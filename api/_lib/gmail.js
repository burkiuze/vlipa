/* Somebody's own mailbox, on their behalf.

   The same shape as the GitHub connection next door: the person authorises
   Google once, the tokens are kept beside their vlipa account on the server,
   and the browser never holds one. A page asks for "the inbox" and gets a
   list; it asks to send and hands over a subject and some words. Nothing that
   could read a mailbox travels to a browser.

   This is a second handshake, not the sign-in one. Signing in with Google
   asks for a name and an address and nothing else, and it would be wrong to
   make everybody who signs in hand over their mail as well. So mail is its
   own consent, with its own callback address and its own scopes, and cutting
   it changes nothing about how somebody signs in.

   Set in the hosting environment:

     GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET    shared with the sign-in
     GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET      optional: a client of its own

   The redirect address is <site>/api/mail/callback, and it has to be on the
   OAuth client alongside the sign-in one. /setup prints the exact string. */

import crypto from 'node:crypto';

const AUTH_URL = process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const API_URL = process.env.GMAIL_API_URL || 'https://gmail.googleapis.com/gmail/v1';

/* Read the mailbox, change what is read or where a message sits, and send.
   Not delete: gmail.modify stops short of permanent deletion on purpose, and
   nothing here should be able to destroy somebody's mail. */
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
];

/* A mailbox is long and a list is a screen. These are the ceilings the
   handlers work inside; the browser can ask for less and never for more. */
export const MAX_LIST = 25;
export const MAX_BODY_CHARS = 40000;

const clientId = () => process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const clientSecret = () => process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';

export function gmailReady() {
  return Boolean(clientId() && clientSecret());
}

/* Whether the mailbox is offered at all.

   Off unless MAIL_PAGE=on, and deliberately so. Reading somebody's inbox
   means Gmail's restricted scopes, and until Google has verified the app for
   them only the accounts listed as test users can connect — everybody else
   reaches a consent screen that refuses them. A page that exists for a
   hundred people and turns the rest away is worse than no page, so it stays
   out of sight until the deployment says otherwise.

   Nothing else changes when it is off: the code is all here, the tokens
   already stored stay stored, and turning it back on is one variable. */
export function mailPageOn() {
  return gmailReady() && String(process.env.MAIL_PAGE || '').trim().toLowerCase() === 'on';
}

/* Which half is absent, so a page can say which box to fill in rather than
   "not switched on". */
export function gmailMissing() {
  return [
    clientId() ? '' : 'GOOGLE_CLIENT_ID',
    clientSecret() ? '' : 'GOOGLE_CLIENT_SECRET',
  ].filter(Boolean);
}

/* The host the visitor is actually on, not PUBLIC_URL — same reasoning as
   github.js: apex and www are two origins, and a handshake that starts on one
   and lands on the other loses the cookie holding its state. */
function siteUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';

  if (host) {
    const protocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0]
      || (String(host).startsWith('localhost') ? 'http' : 'https');

    return `${protocol}://${host}`;
  }

  return String(process.env.PUBLIC_URL || 'https://vlipa.dev').trim().replace(/\/+$/, '');
}

export const callbackUrl = (req) => `${siteUrl(req)}/api/mail/callback`;

export const randomState = () => crypto.randomBytes(18).toString('hex');

export function sameState(a, b) {
  const one = Buffer.from(String(a || ''));
  const two = Buffer.from(String(b || ''));

  return one.length > 0 && one.length === two.length && crypto.timingSafeEqual(one, two);
}

/* offline + consent, because a refresh token is the whole point: without one
   the connection dies an hour after it is made, and Google only hands one
   back when it is asked this way. */
export function authUrl({ req, state }) {
  const query = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: callbackUrl(req),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  return `${AUTH_URL}?${query}`;
}

function fail(status, message, detail = '') {
  const error = new Error(message);
  error.status = status;
  if (detail) error.detail = String(detail).slice(0, 300);
  return error;
}

/* ---------- tokens ---------- */

async function askForTokens(body) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    // Google names the problem in a field, not a sentence: invalid_grant is a
    // revoked or expired refresh token and means "connect again", which is
    // worth saying rather than "mail failed".
    const said = String(data.error || `${response.status}`);
    const message = said === 'invalid_grant'
      ? 'Google will not renew this connection. Connect your mailbox again.'
      : 'Google would not complete the mail connection.';

    throw fail(said === 'invalid_grant' ? 401 : 502, message, `${said} ${data.error_description || ''}`);
  }

  return data;
}

export async function tokensFromCode({ req, code }) {
  const data = await askForTokens({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: callbackUrl(req),
    grant_type: 'authorization_code',
  });

  if (!data.access_token) throw fail(502, 'Google did not answer as expected.');

  return {
    access: data.access_token,
    refresh: data.refresh_token || '',
    scope: String(data.scope || ''),
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
}

/* A live access token for a stored link, renewing it when it is spent.

   `changed` is how the caller knows to write the link back: renewing costs a
   round trip to Google, and doing it on every request because nobody saved
   the new token is the sort of waste that only shows up as slowness. */
export async function liveToken(link) {
  if (link.access && link.expiresAt - 60000 > Date.now()) {
    return { token: link.access, link, changed: false };
  }

  if (!link.refresh) {
    throw fail(401, 'That mail connection has expired. Connect your mailbox again.');
  }

  const data = await askForTokens({
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: link.refresh,
    grant_type: 'refresh_token',
  });

  const next = {
    ...link,
    access: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };

  return { token: next.access, link: next, changed: true };
}

/* ---------- the API ---------- */

async function call(token, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) return {};

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const said = String(data.error?.message || `${response.status}`);

    if (response.status === 401) throw fail(401, 'That mail connection is no longer valid. Connect your mailbox again.', said);
    if (response.status === 403) {
      throw fail(403, 'Google refused that: the mailbox connection does not carry the permission it needs. Connect it again and accept every box.', said);
    }
    if (response.status === 404) throw fail(404, 'That message is not in the mailbox any more.', said);
    if (response.status === 429) throw fail(429, 'Gmail is rate limiting this account. Try again in a moment.', said);

    throw fail(502, 'Gmail could not be reached. Try again in a moment.', said);
  }

  return data;
}

export async function mailboxAddress(token) {
  const profile = await call(token, '/users/me/profile');
  return String(profile.emailAddress || '').toLowerCase();
}

/* ---------- reading ---------- */

const headerOf = (message, name) => {
  const found = (message.payload?.headers || []).find(
    (header) => String(header.name).toLowerCase() === name,
  );

  return found ? String(found.value) : '';
};

const decode = (data) => {
  if (!data) return '';
  try {
    return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
};

/* HTML-only mail, as something to read. Not sanitising for display — nothing
   here is ever put into a page as markup — but turning a marketing template
   into the sentences inside it, so a text-only reader still shows something. */
function textFromHtml(html) {
  return String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* Mail arrives as a tree: a part holding two parts, one of them holding the
   attachments. This walks it once and keeps the first of each kind it finds,
   which is the one a reader is meant to see. */
function walkParts(part, found = { text: '', html: '', files: [] }) {
  if (!part) return found;

  const type = String(part.mimeType || '');

  if (part.filename && part.body?.attachmentId) {
    found.files.push({ name: String(part.filename).slice(0, 200), type, size: Number(part.body.size) || 0 });
  } else if (type === 'text/plain' && !found.text) {
    found.text = decode(part.body?.data);
  } else if (type === 'text/html' && !found.html) {
    found.html = decode(part.body?.data);
  }

  for (const child of part.parts || []) walkParts(child, found);
  return found;
}

/* The one line a list row needs. Everything expensive — the body, the
   attachments — is left for whoever opens it. */
function summarise(message) {
  const labels = message.labelIds || [];

  return {
    id: message.id,
    threadId: message.threadId,
    from: headerOf(message, 'from'),
    to: headerOf(message, 'to'),
    subject: headerOf(message, 'subject') || '(no subject)',
    snippet: String(message.snippet || '').slice(0, 300),
    at: Number(message.internalDate) ? new Date(Number(message.internalDate)).toISOString() : '',
    unread: labels.includes('UNREAD'),
    starred: labels.includes('STARRED'),
    labels: labels.filter((one) => !/^Label_/.test(one)).slice(0, 12),
  };
}

/* A page of the mailbox.

   Gmail answers a list with ids and nothing else, so each row is a second
   call. They go together rather than one after another — twenty five in
   sequence is a visible wait — and a row that fails is dropped rather than
   failing the page. */
export async function listMail(token, { box = 'inbox', query = '', pageToken = '', limit = MAX_LIST } = {}) {
  const search = new URLSearchParams({ maxResults: String(Math.min(Math.max(limit, 1), MAX_LIST)) });

  const labels = {
    inbox: 'INBOX',
    unread: 'INBOX',
    sent: 'SENT',
    drafts: 'DRAFT',
    starred: 'STARRED',
    archive: '',
  };

  const label = labels[box] === undefined ? 'INBOX' : labels[box];
  if (label) search.set('labelIds', label);

  const bits = [];
  if (box === 'unread') bits.push('is:unread');
  if (box === 'archive') bits.push('-in:inbox in:all -in:spam -in:trash');
  if (query) bits.push(query);
  if (bits.length) search.set('q', bits.join(' '));

  if (pageToken) search.set('pageToken', pageToken);

  const page = await call(token, `/users/me/messages?${search}`);
  const ids = (page.messages || []).map((one) => one.id);

  const rows = await Promise.all(ids.map((id) => call(
    token,
    `/users/me/messages/${encodeURIComponent(id)}?format=metadata`
      + '&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date',
  ).then(summarise).catch(() => null)));

  return {
    messages: rows.filter(Boolean),
    nextPageToken: page.nextPageToken || '',
    estimate: Number(page.resultSizeEstimate) || rows.length,
  };
}

/* One message, opened. */
export async function readMail(token, id) {
  const message = await call(token, `/users/me/messages/${encodeURIComponent(id)}?format=full`);
  const parts = walkParts(message.payload);
  const body = parts.text || (parts.html ? textFromHtml(parts.html) : '');

  return {
    ...summarise(message),
    cc: headerOf(message, 'cc'),
    messageId: headerOf(message, 'message-id'),
    references: headerOf(message, 'references'),
    body: body.slice(0, MAX_BODY_CHARS),
    truncated: body.length > MAX_BODY_CHARS,
    files: parts.files.slice(0, 20),
  };
}

/* Where a message sits and whether it has been read. Archiving is the removal
   of INBOX, which is the whole of what archiving is in Gmail. */
export async function changeMail(token, id, { add = [], remove = [] }) {
  const allowed = new Set(['UNREAD', 'STARRED', 'INBOX', 'TRASH', 'IMPORTANT']);

  const message = await call(token, `/users/me/messages/${encodeURIComponent(id)}/modify`, {
    method: 'POST',
    body: {
      addLabelIds: add.filter((one) => allowed.has(one)),
      removeLabelIds: remove.filter((one) => allowed.has(one)),
    },
  });

  return summarise(message);
}

/* ---------- sending ---------- */

/* A header value cannot carry a line break: one would end the header and
   start another, which is how a subject line becomes a Bcc. Everything that
   goes into a header goes through here first. */
const oneLine = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

const ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;".]+\.[^\s@<>,;"]+$/;

/* "a@b.com, Someone <c@d.com>" → the addresses, checked. A name is kept when
   it is there and quoted, because an unquoted comma in a display name is
   another way of adding a recipient nobody asked for. */
export function cleanAddresses(value, cap = 25) {
  const out = [];

  for (const piece of String(value ?? '').split(/[,;]/)) {
    const raw = piece.trim();
    if (!raw) continue;

    const angled = raw.match(/^(.*?)<([^<>]+)>$/);
    const address = oneLine(angled ? angled[2] : raw).trim();
    if (!ADDRESS.test(address) || address.length > 254) continue;

    const name = angled ? oneLine(angled[1]).replace(/^"|"$/g, '').trim() : '';

    out.push(name ? `"${name.replace(/["\\]/g, '')}" <${address}>` : address);
    if (out.length >= cap) break;
  }

  return out;
}

/* Anything but plain ASCII has to be announced in a header, or Gmail sends
   the bytes and the reader shows mojibake. */
const encodeHeader = (value) => {
  const text = oneLine(value);
  if (!text) return '';

  return /^[\x20-\x7e]*$/.test(text)
    ? text
    : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
};

/* What may be attached, and how much of it.

   A serverless function is handed the whole request in memory and Vercel caps
   that at four and a half megabytes; base64 adds a third to whatever a file
   weighs. Three megabytes of real file is what fits with room to breathe, and
   somebody trying to send a video should hear that now rather than watch a
   request fail with nothing to read. */
export const MAX_FILES_OUT = 5;
export const MAX_ATTACH_BYTES = 3 * 1024 * 1024;

/* A filename, with everything that is not a filename taken out: no path, no
   quotes, no line breaks — the name goes into a header, and a header is one
   line whatever the file was called. */
const cleanName = (value) => String(value ?? '')
  .replace(/[\r\n"\\]/g, '')
  .replace(/[/\\]/g, '-')
  .trim()
  .slice(0, 120) || 'attachment';

/* The type as announced, or nothing. A made-up content type is worse than
   the honest default, which every mail client already knows how to handle. */
const cleanType = (value) => (/^[\w.+-]+\/[\w.+-]+$/.test(String(value || '')) ? String(value) : 'application/octet-stream');

const wrap = (base64) => String(base64).replace(/(.{76})/g, '$1\r\n');

/* The files, checked. Whatever is not a file, or does not fit, does not go —
   and the caller is told which, because "it sent without the attachment" is
   the kind of silence that costs somebody a morning. */
export function cleanAttachments(given) {
  const files = [];
  const refused = [];
  let bytes = 0;

  for (const file of Array.isArray(given) ? given : []) {
    const data = String(file?.data || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    const name = cleanName(file?.name);

    if (!data) { refused.push(`${name}: there was nothing in it`); continue; }

    if (files.length >= MAX_FILES_OUT) { refused.push(`${name}: more than ${MAX_FILES_OUT} files`); continue; }

    // The base64 length, not the file's: what travels is what has to fit.
    const size = Math.floor((data.length * 3) / 4);

    if (bytes + size > MAX_ATTACH_BYTES) {
      refused.push(`${name}: over the ${Math.round(MAX_ATTACH_BYTES / (1024 * 1024))} MB a message can carry`);
      continue;
    }

    bytes += size;
    files.push({ name, type: cleanType(file?.type), data, size });
  }

  return { files, refused };
}

/* The message itself. Plain text, base64: a body carrying a long line, an
   accent or a line that happens to start with "From " is a mangled mail
   otherwise, and every one of those is ordinary writing.

   With something attached it becomes multipart/mixed: the words as the first
   part, each file as one after it. Without, it stays the single plain-text
   message it was — a boundary nothing needs is a boundary that can go wrong. */
function rfc822({ from, to, cc, bcc, subject, text, inReplyTo, references, files = [] }) {
  // The headers are filtered — a message with no Cc has no Cc line — and the
  // body is joined on afterwards rather than being one more entry in the
  // list. It was an entry once, and the empty string that separates the two
  // halves went out with the filter: every header after it read as body, and
  // the body read as a header.
  const boundary = `vlipa-${crypto.randomBytes(12).toString('hex')}`;
  const words = wrap(Buffer.from(String(text ?? ''), 'utf8').toString('base64'));

  const headers = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    cc.length ? `Cc: ${cc.join(', ')}` : '',
    bcc.length ? `Bcc: ${bcc.join(', ')}` : '',
    `Subject: ${encodeHeader(subject)}`,
    inReplyTo ? `In-Reply-To: ${oneLine(inReplyTo)}` : '',
    references ? `References: ${oneLine(references)}` : '',
    'MIME-Version: 1.0',
    files.length
      ? `Content-Type: multipart/mixed; boundary="${boundary}"`
      : 'Content-Type: text/plain; charset="UTF-8"',
    files.length ? '' : 'Content-Transfer-Encoding: base64',
  ].filter((line) => line !== '');

  if (!files.length) {
    return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${words}`, 'utf8').toString('base64url');
  }

  const parts = [
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      words,
    ].join('\r\n'),

    ...files.map((file) => [
      `--${boundary}`,
      `Content-Type: ${file.type}; name="${cleanName(file.name)}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${cleanName(file.name)}"`,
      '',
      wrap(file.data),
    ].join('\r\n')),

    `--${boundary}--`,
  ];

  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n`, 'utf8').toString('base64url');
}

export async function sendMail(token, { from, to, cc = [], bcc = [], subject, text, threadId, inReplyTo, references, files = [] }) {
  const sent = await call(token, '/users/me/messages/send', {
    method: 'POST',
    body: {
      raw: rfc822({ from, to, cc, bcc, subject, text, inReplyTo, references, files }),
      ...(threadId ? { threadId: String(threadId) } : {}),
    },
  });

  return { id: sent.id, threadId: sent.threadId };
}
