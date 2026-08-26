/* Toplantılar: şirketin görüntülü konuşma odaları.

   Görüntü ve ses Jitsi Meet üzerinden gidiyor: ücretsiz, hesap istemiyor ve
   TURN sunucularını kendi sağlıyor — sunucusuz bir kurulumun sağlayamadığı
   parça orası. Burada tutulan şey oda listesi: kim açtı, adı ne, kim katılacak. */

import { api, can, state } from './api.js';
import { $, clear, dialog, el, field, toast, when } from './dom.js';

let meetings = [];
let host = 'meet.jit.si';
let joined = null;

function link(meeting) {
  return `https://${host}/${meeting.room}`;
}

export function create() {
  dialog({
    title: 'Yeni toplantı odası',
    confirm: 'Aç',
    body: [
      field('Oda adı', el('input', { name: 'title', required: true, maxlength: 80, placeholder: 'Pazartesi toplantısı' }),
        'Oda adresi tahmin edilemesin diye sonuna rastgele bir ek konur.'),
    ],
    onConfirm: async (data) => {
      await api('/api/meetings', {
        method: 'POST',
        body: { action: 'create', companyId: state.companyId, title: data.get('title') },
      });

      await load();
      toast('Oda açıldı.');
    },
  });
}

async function close(meeting) {
  if (!window.confirm(`"${meeting.title}" odası kapatılsın mı?`)) return;

  try {
    await api('/api/meetings', { method: 'POST', body: { action: 'close', companyId: state.companyId, id: meeting.id } });
    if (joined?.id === meeting.id) joined = null;
    await load();
  } catch (error) {
    toast(error.message, 'bad');
  }
}

function draw() {
  const view = clear($('view'));

  view.appendChild(el('div', { class: 'toolbar' }, [
    el('h3', { text: `${meetings.length} oda` }),
    can('meeting.manage') ? el('button', { class: 'btn', type: 'button', text: '+ Oda aç', onclick: create }) : null,
  ]));

  if (joined) {
    view.appendChild(el('div', { class: 'meetstage' }, [
      el('div', { class: 'meetstage__bar' }, [
        el('b', { text: joined.title }),
        el('div', { class: 'spread' }, [
          el('a', { class: 'ghostlink', href: link(joined), target: '_blank', rel: 'noopener', text: 'Yeni sekmede aç' }),
          el('button', { class: 'ghostlink', type: 'button', text: 'Kapat', onclick: () => { joined = null; draw(); } }),
        ]),
      ]),
      el('iframe', {
        class: 'meetstage__frame',
        src: `${link(joined)}#userInfo.displayName="${encodeURIComponent(state.user.name || state.user.email)}"`,
        allow: 'camera; microphone; fullscreen; display-capture; autoplay',
        title: joined.title,
      }),
    ]));
  }

  if (!meetings.length) {
    view.appendChild(el('p', { class: 'empty', text: 'Henüz oda yok. Aç, adresi ekiple paylaş, kameranı aç.' }));
    return;
  }

  view.appendChild(el('div', { class: 'cards' }, meetings.map((meeting) => el('article', { class: 'card' }, [
    el('h4', { text: meeting.title }),
    el('p', { class: 'muted', text: `${meeting.createdByName || 'Biri'} açtı · ${when(meeting.createdAt)}` }),
    el('div', { class: 'spread' }, [
      el('button', {
        class: 'btn btn--sm', type: 'button', text: 'Katıl',
        onclick: () => { joined = meeting; draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
      }),
      el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', text: 'Bağlantıyı kopyala',
        onclick: () => { navigator.clipboard?.writeText(link(meeting)); toast('Bağlantı kopyalandı.'); },
      }),
      can('meeting.manage') ? el('button', {
        class: 'ghostlink ghostlink--bad', type: 'button', text: 'Kapat', onclick: () => close(meeting),
      }) : null,
    ]),
  ]))));

  view.appendChild(el('p', { class: 'footnote', text:
    'Görüntülü görüşme Jitsi Meet üzerinden yapılır. Oda adresini bilen herkes katılabilir, o yüzden bağlantıyı ekip dışına verme.' }));
}

async function load() {
  const data = await api(`/api/meetings?companyId=${encodeURIComponent(state.companyId)}`);

  meetings = data.meetings || [];
  host = data.host || host;

  draw();
}

export async function show() {
  clear($('view')).appendChild(el('p', { class: 'empty', text: 'Odalar yükleniyor…' }));
  await load();
}

export function summary() {
  return { meetings: meetings.length };
}
