/* The shared invitation link: /invite/<link-name> */

const slug = decodeURIComponent(window.location.pathname.replace(/^\/invite\/?/, '').replace(/\/$/, ''));

const title = document.getElementById('title');
const note = document.getElementById('note');
const actions = document.getElementById('actions');

function button(text, onClick, ghost) {
  const node = document.createElement('button');
  node.className = `btn btn--block${ghost ? ' btn--ghost' : ''}`;
  node.type = 'button';
  node.textContent = text;
  node.addEventListener('click', onClick);
  return node;
}

function link(text, href, ghost) {
  const node = document.createElement('a');
  node.className = `btn btn--block${ghost ? ' btn--ghost' : ''}`;
  node.href = href;
  node.textContent = text;
  node.style.textDecoration = 'none';
  return node;
}

async function join() {
  actions.textContent = 'Joining…';

  try {
    const response = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    });

    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'That did not work.');

    localStorage.setItem('vlipa.company', data.company.id);
    window.location.assign('/studio');
  } catch (error) {
    note.textContent = error.message;
    note.className = 'note error';
    actions.replaceChildren(button('Try again', join));
  }
}

async function start() {
  if (!slug) {
    title.textContent = 'The link is incomplete';
    note.textContent = 'It should look like vlipa.dev/invite/company-name';
    return;
  }

  try {
    const data = await (await fetch(`/api/invite?slug=${encodeURIComponent(slug)}`)).json();

    if (!data.open) {
      title.textContent = 'This invitation link does not work';
      note.textContent = 'It may have been closed, or never opened at all. Ask the company for a new link or an invite code.';
      actions.replaceChildren(link('Sign in', '/login', true));
      return;
    }

    title.textContent = `${data.name} is inviting you`;

    if (data.member) {
      note.textContent = 'You are already in this company.';
      actions.replaceChildren(link('Open the studio', '/studio'));
      return;
    }

    const roles = { owner: 'Owner', admin: 'Admin', member: 'Member', guest: 'Guest' };
    note.textContent = `You would join as "${roles[data.role] || data.role}".`;

    if (data.signedIn) {
      actions.replaceChildren(button(`Join ${data.name}`, join));
      return;
    }

    const where = encodeURIComponent(window.location.pathname);
    actions.replaceChildren(
      link('Create an account and join', `/signup?next=${where}`),
      Object.assign(document.createElement('div'), { style: 'height:10px' }),
      link('I already have an account', `/login?next=${where}`, true),
    );
  } catch {
    title.textContent = 'Could not connect';
    note.textContent = 'The server could not be reached. Try again in a moment.';
  }
}

start();
