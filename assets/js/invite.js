/* Paylaşılan davet linki: /invite/<link-adı> */

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
  actions.textContent = 'Katılıyorsun…';

  try {
    const response = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    });

    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Katılamadın.');

    localStorage.setItem('vlipa.company', data.company.id);
    window.location.assign('/studio');
  } catch (error) {
    note.textContent = error.message;
    note.className = 'note error';
    actions.replaceChildren(button('Tekrar dene', join));
  }
}

async function start() {
  if (!slug) {
    title.textContent = 'Davet linki eksik';
    note.textContent = 'Adres şöyle olmalı: vlipa.dev/invite/sirket-adi';
    return;
  }

  try {
    const data = await (await fetch(`/api/invite?slug=${encodeURIComponent(slug)}`)).json();

    if (!data.open) {
      title.textContent = 'Bu davet linki çalışmıyor';
      note.textContent = 'Link kapatılmış ya da hiç açılmamış olabilir. Şirketten yeni bir link ya da davet kodu iste.';
      actions.replaceChildren(link('Giriş yap', '/login', true));
      return;
    }

    title.textContent = `${data.name} seni davet ediyor`;

    if (data.member) {
      note.textContent = 'Zaten bu şirketin üyesisin.';
      actions.replaceChildren(link('Studio\'yu aç', '/studio'));
      return;
    }

    const roles = { owner: 'Sahip', admin: 'Yönetici', member: 'Üye', guest: 'Misafir' };
    note.textContent = `Katılırsan rolün "${roles[data.role] || data.role}" olacak.`;

    if (data.signedIn) {
      actions.replaceChildren(button(`${data.name} şirketine katıl`, join));
      return;
    }

    const where = encodeURIComponent(window.location.pathname);
    actions.replaceChildren(
      link('Hesap aç ve katıl', `/signup?next=${where}`),
      Object.assign(document.createElement('div'), { style: 'height:10px' }),
      link('Zaten hesabım var', `/login?next=${where}`, true),
    );
  } catch {
    title.textContent = 'Bağlantı kurulamadı';
    note.textContent = 'Sunucuya ulaşılamadı. Birazdan tekrar dene.';
  }
}

start();
