/* Your account: your name and face, which model answers by default, and the
   two things a person should never have to write in and ask for — a copy of
   everything, and the end of it. */

import { modelsFor } from '../studio/agent.js';
import { api } from '../studio/api.js';
import { avatar, shrink } from '../studio/avatar.js';
import { $, clear, el, field, menu, toast } from '../studio/dom.js';
import { call, me, shell } from './state.js';

/* Everything on the account, as a file. Written here rather than asked of the
   server: it is already in the browser, apart from the transcripts, and those
   are fetched one at a time. */
async function download() {
  toast('Collecting your conversations…');

  const chats = [];

  for (const row of me.chats) {
    const data = await call({ action: 'chat.open', id: row.id }).catch(() => null);
    if (data?.chat) chats.push({ title: data.chat.title, updatedAt: data.chat.updatedAt, messages: data.chat.messages });
  }

  const blob = new Blob([JSON.stringify({
    account: { name: me.user?.name, email: me.user?.email },
    exportedAt: new Date().toISOString(),
    settings: me.settings,
    skills: me.skills,
    chats,
  }, null, 2)], { type: 'application/json' });

  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: 'vlipa-personal.json' });

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function forget() {
  const said = window.prompt('This deletes every conversation and every skill on this account, and cannot be undone. Type DELETE to confirm.');
  if (said !== 'DELETE') return;

  await call({ action: 'forget' });

  me.skills = [];
  me.chats = [];
  me.settings = { model: 'vlipa', mode: 'fast' };

  toast('Everything personal has been deleted.');
  show();
}

export async function show() {
  const view = clear($('view'));

  view.appendChild(el('div', { class: 'pagehead' }, [
    el('div', {}, [
      el('h2', { text: 'Settings' }),
      el('p', { class: 'muted', text: 'Your account, and how Vlipa answers by default.' }),
    ]),
  ]));

  /* ---------- who you are ---------- */

  const face = el('div', { class: 'facepick' }, [avatar(me.user, 72)]);
  const name = el('input', { id: 'meName', value: me.user?.name || '', maxlength: 60 });

  const pick = el('input', {
    id: 'mePhoto',
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp',
    hidden: true,
    onchange: async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      try {
        const photo = await shrink(file);
        const data = await api('/api/auth/profile', { method: 'POST', body: { photo } });

        me.user = data.user;
        clear(face).appendChild(avatar(me.user, 72));
        shell.redraw();
        toast('Photo saved.');
      } catch (error) {
        toast(error.message, 'bad');
      }
    },
  });

  view.appendChild(el('section', { class: 'panelcard' }, [
    el('h3', { text: 'You' }),
    el('div', { class: 'meform' }, [
      el('div', { class: 'meform__side' }, [
        face,
        el('button', { class: 'ghostlink', type: 'button', text: 'Change photo', onclick: () => pick.click() }),
        me.user?.photo ? el('button', {
          class: 'ghostlink ghostlink--bad',
          type: 'button',
          text: 'Remove',
          onclick: async () => {
            const data = await api('/api/auth/profile', { method: 'POST', body: { photo: '' } }).catch((error) => {
              toast(error.message, 'bad');
              return null;
            });

            if (!data) return;
            me.user = data.user;
            shell.redraw();
            show();
          },
        }) : null,
        pick,
      ]),
      el('div', { class: 'meform__main' }, [
        field('Your name', name),
        el('p', { class: 'muted', text: me.user?.email || '' }),
        el('button', {
          class: 'btn',
          type: 'button',
          text: 'Save',
          onclick: async () => {
            const data = await api('/api/auth/profile', { method: 'POST', body: { name: name.value } }).catch((error) => {
              toast(error.message, 'bad');
              return null;
            });

            if (!data) return;
            me.user = data.user;
            shell.redraw();
            toast('Saved.');
          },
        }),
      ]),
    ]),
  ]));

  /* ---------- how it answers ---------- */

  const models = await modelsFor('chat').catch(() => []);

  const save = async () => {
    await call({ action: 'settings', settings: me.settings }).catch((error) => toast(error.message, 'bad'));
  };

  view.appendChild(el('section', { class: 'panelcard' }, [
    el('h3', { text: 'How Vlipa answers' }),
    el('p', { class: 'muted', text: 'Where a new conversation starts. You can still change either of them mid-chat.' }),

    el('div', { class: 'spread' }, [
      models.length ? menu({
        label: 'Model',
        value: me.settings.model,
        options: models,
        onPick: (id) => { me.settings.model = id; save(); },
      }) : el('p', { class: 'muted', text: 'No models are configured on this deployment.' }),

      el('div', { class: 'modes' }, [['fast', 'Fast'], ['thinking', 'Think']].map(([mode, label]) => el('button', {
        type: 'button',
        'aria-pressed': String(me.settings.mode === mode),
        text: label,
        onclick: (event) => {
          me.settings.mode = mode;
          event.target.parentElement.querySelectorAll('button').forEach((button) => {
            button.setAttribute('aria-pressed', String(button === event.target));
          });
          save();
        },
      }))),
    ]),
  ]));

  /* ---------- what is kept ---------- */

  view.appendChild(el('section', { class: 'panelcard' }, [
    el('h3', { text: 'What is kept' }),
    el('p', { class: 'muted', text: `${me.chats.length} conversation${me.chats.length === 1 ? '' : 's'} and ${me.skills.length} skill${me.skills.length === 1 ? '' : 's'} are on this account. Nothing else about you is stored, and none of it is used to train anything.` }),
    el('div', { class: 'spread' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', text: 'Download a copy', onclick: () => download().catch((error) => toast(error.message, 'bad')) }),
      el('button', { class: 'btn btn--ghost ghostlink--bad', type: 'button', text: 'Delete everything', onclick: () => forget().catch((error) => toast(error.message, 'bad')) }),
    ]),
  ]));

  /* ---------- the other half of vlipa ---------- */

  view.appendChild(el('section', { class: 'panelcard' }, [
    el('h3', { text: 'Working with other people' }),
    el('p', { class: 'muted', text: 'This account is yours alone. Vlipa for Business is the same assistant with a company around it — tasks, tables, meetings, a team and what everybody is getting done.' }),
    el('div', { class: 'spread' }, [
      el('a', { class: 'btn btn--ghost', href: '/studio', text: 'Open Vlipa for Business' }),
    ]),
  ]));
}
