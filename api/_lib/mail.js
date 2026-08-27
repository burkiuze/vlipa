/* Outgoing mail.

   One message matters here: somebody was given a piece of work, and they are
   not looking at the studio. It goes out through Resend's HTTP API, because a
   serverless function cannot hold an SMTP connection open.

   Nothing is sent until RESEND_API_KEY is set, and a failure never breaks the
   request that triggered it: the task is created either way, and the mail is
   the part that can be retried by looking at the board. */

const FROM = process.env.MAIL_FROM || 'Vlipa <no-reply@vlipa.dev>';
const ENDPOINT = process.env.MAIL_API_URL || 'https://api.resend.com/emails';

export function mailReady() {
  return Boolean(process.env.RESEND_API_KEY);
}

function escape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function send({ to, subject, text, html }) {
  if (!mailReady()) return { skipped: 'no key' };
  if (!to) return { skipped: 'no address' };

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      console.warn('[vlipa] mail refused', response.status, detail);
      return { error: `mail ${response.status}` };
    }

    return { sent: true };
  } catch (error) {
    console.warn('[vlipa] mail failed', error.message);
    return { error: error.message };
  }
}

/* "You have been given a piece of work." Sent to the person it was given to,
   never to the person who gave it. */
export async function taskAssigned({ to, name, task, company, byName, url }) {
  const title = task.title || 'a task';
  const when = task.due ? `Due ${task.due}.` : 'No date on it.';
  const where = task.department ? ` (${task.department})` : '';

  const lines = [
    `${name ? `${name},` : 'Hello,'}`,
    '',
    `${byName || 'Somebody'} gave you a task in ${company.name}${where}: ${title}`,
    task.detail ? `\n${task.detail}\n` : '',
    when,
    '',
    url ? `Open it: ${url}` : '',
    '',
    'This message came from vlipa studio. Nobody reads replies to this address.',
  ].filter((line) => line !== undefined);

  return send({
    to,
    subject: `${company.name}: ${title}`,
    text: lines.join('\n'),
    html: [
      '<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#14142b;max-width:520px">',
      `<p style="margin:0 0 14px">${escape(name ? `${name},` : 'Hello,')}</p>`,
      `<p style="margin:0 0 6px">${escape(byName || 'Somebody')} gave you a task in <b>${escape(company.name)}</b>${where ? ` ${escape(where.trim())}` : ''}:</p>`,
      `<p style="margin:0 0 14px;font-size:17px;font-weight:600">${escape(title)}</p>`,
      task.detail ? `<p style="margin:0 0 14px;color:#4a4a68;white-space:pre-wrap">${escape(task.detail)}</p>` : '',
      `<p style="margin:0 0 18px;color:#6a6a86">${escape(when)}</p>`,
      url ? `<p style="margin:0 0 22px"><a href="${escape(url)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#3532f6;color:#fff;text-decoration:none;font-weight:600">Open the task</a></p>` : '',
      '<p style="margin:0;color:#9a9ab0;font-size:12.5px">vlipa studio · nobody reads replies to this address.</p>',
      '</div>',
    ].join(''),
  });
}
