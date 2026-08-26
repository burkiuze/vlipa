/* Gruplar: ekibin konuştuğu yer.

   Her grubun yazışması ve bir sesli odası var. Yazışma sunucudan belli
   aralıklarla çekilir; sesli oda Jitsi üzerinden, kamera kapalı açılır. */

import { api, can, state } from './api.js';
import { $, clear, dialog, el, field, toast } from './dom.js';

let groups = [];
let openGroup = null;
let messages = [];
let host = 'meet.jit.si';
let inVoice = false;
let timer = null;
let lastAt = 0;

function stopPolling() {
  clearInterval(timer);
  timer = null;
}

/* Only poll while this page is the one being looked at. */
function startPolling() {
  stopPolling();

  timer = setInterval(async () => {
    if (!openGroup || document.hidden || !document.getElementById('groupLog')) return;

    try {
      const data = await api(`/api/groups?companyId=${state.companyId}&id=${openGroup.id}&since=${lastAt}`);
      if (!data.messages?.length) return;

      messages = messages.concat(data.messages);
      lastAt = Math.max(lastAt, ...data.messages.map((message) => message.at));
      drawMessages();
    } catch { /* a dropped poll is not worth shouting about */ }
  }, 4000);
}

export function create() {
  dialog({
    title: 'Yeni grup',
    confirm: 'Aç',
    body: [field('Grup adı', el('input', { name: 'name', required: true, maxlength: 40, placeholder: 'Tasarım' }),
      'Her grubun kendi yazışması ve sesli odası olur.')],
    onConfirm: async (data) => {
      const created = await api('/api/groups', {
        method: 'POST',
        body: { action: 'create', companyId: state.companyId, name: data.get('name') },
      });

      await load(created.group.id);
      toast('Grup açıldı.');
    },
  });
}

function rename() {
  dialog({
    title: 'Grubu yeniden adlandır',
    body: [field('Ad', el('input', { name: 'name', required: true, maxlength: 40, value: openGroup.name }))],
    onConfirm: async (data) => {
      await api('/api/groups', {
        method: 'POST',
        body: { action: 'rename', companyId: state.companyId, groupId: openGroup.id, name: data.get('name') },
      });

      await load(openGroup.id);
    },
  });
}

async function drop() {
  if (!window.confirm(`"${openGroup.name}" grubu ve içindeki yazışma silinsin mi?`)) return;

  try {
    await api('/api/groups', {
      method: 'POST',
      body: { action: 'drop', companyId: state.companyId, groupId: openGroup.id },
    });

    openGroup = null;
    await load();
    toast('Grup silindi.');
  } catch (error) {
    toast(error.message, 'bad');
  }
}

async function post(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || !openGroup) return;

  const input = $('groupInput');
  input.value = '';
  input.style.height = 'auto';

  try {
    const sent = await api('/api/groups', {
      method: 'POST',
      body: { action: 'post', companyId: state.companyId, groupId: openGroup.id, text: trimmed },
    });

    messages.push(sent.message);
    lastAt = Math.max(lastAt, sent.message.at);
    drawMessages();
  } catch (error) {
    toast(error.message, 'bad');
    input.value = trimmed;
  }
}

function drawMessages() {
  const log = $('groupLog');
  if (!log) return;

  clear(log);

  if (!messages.length) {
    log.appendChild(el('p', { class: 'empty', text: 'Burada henüz konuşulmadı. İlk mesajı sen yaz.' }));
    return;
  }

  let lastWho = null;

  for (const message of messages) {
    const mine = message.userId === state.user.id;
    const sameAsBefore = lastWho === message.userId;
    lastWho = message.userId;

    log.appendChild(el('div', { class: `msg${mine ? ' msg--me' : ''}${sameAsBefore ? ' msg--run' : ''}` }, [
      sameAsBefore ? null : el('div', { class: 'msg__who' }, [
        el('b', { text: mine ? 'Sen' : message.name }),
        el('span', { text: new Date(message.at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) }),
      ]),
      el('div', { class: 'msg__body', text: message.text }),
    ]));
  }

  log.scrollTop = log.scrollHeight;
}

function draw() {
  const view = clear($('view'));

  view.appendChild(el('div', { class: 'toolbar' }, [
    el('div', { class: 'tabs' }, groups.map((group) => el('button', {
      type: 'button',
      class: openGroup?.id === group.id ? 'is-on' : '',
      text: `# ${group.name}`,
      onclick: () => load(group.id),
    }))),
    can('group.manage') ? el('button', { class: 'btn', type: 'button', text: '+ Grup', onclick: create }) : null,
  ]));

  if (!groups.length) {
    view.appendChild(el('p', { class: 'empty', text: 'Henüz grup yok.' }));
    return;
  }

  if (!openGroup) {
    view.appendChild(el('p', { class: 'empty', text: 'Yukarıdan bir grup seç.' }));
    return;
  }

  view.appendChild(el('div', { class: 'toolbar toolbar--sub' }, [
    el('h3', { text: `# ${openGroup.name}` }),
    el('div', { class: 'spread' }, [
      el('button', {
        class: inVoice ? 'btn btn--sm' : 'btn btn--ghost btn--sm',
        type: 'button',
        text: inVoice ? 'Sesli odadan çık' : '🔊 Sesli odaya katıl',
        onclick: () => { inVoice = !inVoice; draw(); },
      }),
      can('group.manage') ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Yeniden adlandır', onclick: rename }) : null,
      can('group.manage') ? el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Grubu sil', onclick: drop }) : null,
    ]),
  ]));

  if (inVoice) {
    // Audio only: the camera stays off and the toolbar is trimmed to what a
    // voice room needs.
    const url = `https://${host}/${openGroup.room}#config.startWithVideoMuted=true` +
      '&config.prejoinPageEnabled=false' +
      `&userInfo.displayName="${encodeURIComponent(state.user.name || state.user.email)}"` +
      '&interfaceConfig.TOOLBAR_BUTTONS=["microphone","hangup","settings","raisehand","tileview"]';

    view.appendChild(el('div', { class: 'voicebar' }, [
      el('span', { class: 'voicebar__dot' }),
      el('b', { text: `${openGroup.name} sesli odası` }),
      el('span', { class: 'muted', text: 'Kamera kapalı. Aynı odaya giren herkes birbirini duyar.' }),
    ]));

    view.appendChild(el('iframe', {
      class: 'voiceframe',
      src: url,
      allow: 'microphone; autoplay; display-capture',
      title: `${openGroup.name} sesli oda`,
    }));
  }

  view.appendChild(el('div', { class: 'grouplog', id: 'groupLog' }));

  const input = el('textarea', {
    id: 'groupInput',
    rows: 1,
    placeholder: `# ${openGroup.name} grubuna yaz…`,
    onkeydown: (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        post(event.target.value);
      }
    },
    oninput: (event) => {
      event.target.style.height = 'auto';
      event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`;
    },
  });

  view.appendChild(el('div', { class: 'composer' }, [
    el('div', { class: 'composer__box' }, [
      input,
      el('div', { class: 'composer__row' }, [
        el('span', { class: 'muted', text: can('group.post') ? 'Enter gönderir.' : 'Yazma yetkin yok.' }),
        el('span', { class: 'grow' }),
        el('button', {
          class: 'round round--send', type: 'button', title: 'Gönder',
          html: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12h13M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
          onclick: () => post(input.value),
        }),
      ]),
    ]),
  ]));

  drawMessages();
  input.focus();
}

async function load(id) {
  const query = new URLSearchParams({ companyId: state.companyId });
  if (id || openGroup) query.set('id', id || openGroup.id);

  const data = await api(`/api/groups?${query}`);

  groups = data.groups || [];
  host = data.host || host;

  if (data.group) {
    if (openGroup?.id !== data.group.id) inVoice = false;
    openGroup = data.group;
    messages = data.messages || [];
    lastAt = messages.length ? Math.max(...messages.map((message) => message.at)) : 0;
  } else if (!id && groups.length && !openGroup) {
    return load(groups[0].id);
  }

  if (openGroup && !groups.some((group) => group.id === openGroup.id)) openGroup = null;

  draw();
  startPolling();
}

export async function show() {
  clear($('view')).appendChild(el('p', { class: 'empty', text: 'Gruplar yükleniyor…' }));
  await load(openGroup?.id);
}

export function leave() {
  stopPolling();
  inVoice = false;
}
