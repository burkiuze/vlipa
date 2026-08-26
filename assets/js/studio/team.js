/* Ekip: kim var, kim ne yapabilir, kim davet edildi. */

import { api, can, loadCompany, state } from './api.js';
import { $, clear, dialog, el, field, toast, when } from './dom.js';

const ROLE_NOTE = {
  owner: 'Her şeyi yapabilir; şirketi siler, rolleri değiştirir, sahipliği devreder.',
  admin: 'Ekibi, görevleri, tabloları ve toplantıları yönetir.',
  member: 'Görev alır, kendi görevini günceller, tablolara satır ekler.',
  guest: 'Sadece görür.',
};

function roleSelect(member) {
  const allowed = state.role === 'owner'
    ? ['guest', 'member', 'admin', 'owner']
    : ['guest', 'member', 'admin'];

  const locked = !can('role.assign') ||
    (member.role === 'owner' && state.role !== 'owner') ||
    member.userId === state.user.id;

  return el('select', {
    class: 'rolepick',
    disabled: locked,
    onchange: async (event) => {
      const role = event.target.value;
      const label = member.name || member.email;

      if (role === 'owner' && !window.confirm(
        `Sahiplik ${label} kişisine devredilsin mi? Sen yönetici olarak kalacaksın.`)) {
        event.target.value = member.role;
        return;
      }

      try {
        await api('/api/company', {
          method: 'POST',
          body: { action: 'role', companyId: state.companyId, userId: member.userId, role },
        });

        await show();
        toast('Rol güncellendi.');
      } catch (error) {
        event.target.value = member.role;
        toast(error.message, 'bad');
      }
    },
  }, allowed.map((role) => el('option', {
    value: role,
    selected: member.role === role,
    text: state.roles.find((item) => item.id === role)?.label || role,
  })));
}

async function remove(member) {
  if (!window.confirm(`${member.name || member.email} şirketten çıkarılsın mı?`)) return;

  try {
    await api('/api/company', {
      method: 'POST',
      body: { action: 'remove', companyId: state.companyId, userId: member.userId },
    });

    await show();
    toast('Çıkarıldı.');
  } catch (error) {
    toast(error.message, 'bad');
  }
}

function invite() {
  dialog({
    title: 'Davet kodu oluştur',
    confirm: 'Oluştur',
    body: [
      field('Hangi rolle katılsın', el('select', { name: 'role' }, ['guest', 'member', 'admin']
        .filter((role) => state.role === 'owner' || role !== 'owner')
        .map((role) => el('option', {
          value: role,
          selected: role === 'member',
          text: `${state.roles.find((item) => item.id === role)?.label || role} — ${ROLE_NOTE[role]}`,
        }))), 'Kod 14 gün geçerli. Kodu alan kişi hesabını açıp katılabilir.'),
    ],
    onConfirm: async (data) => {
      const created = await api('/api/company', {
        method: 'POST',
        body: { action: 'invite', companyId: state.companyId, role: data.get('role') },
      });

      await show();
      toast(`Davet kodu: ${created.invite.code}`);
    },
  });
}

async function revoke(code) {
  try {
    await api('/api/company', { method: 'POST', body: { action: 'revoke', companyId: state.companyId, code } });
    await show();
  } catch (error) {
    toast(error.message, 'bad');
  }
}

export async function show({ refresh = true } = {}) {
  // Members and invitations arrive with the company, so the page has to ask
  // for them again rather than drawing whatever was loaded at boot.
  if (refresh) await loadCompany(state.companyId);

  const host = clear($('view'));

  host.appendChild(el('div', { class: 'toolbar' }, [
    el('h3', { text: `${state.members.length} kişi` }),
    can('member.invite') ? el('button', { class: 'btn', type: 'button', text: '+ Davet et', onclick: invite }) : null,
  ]));

  host.appendChild(el('div', { class: 'tablewrap' }, [
    el('table', { class: 'grid' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Kişi' }),
        el('th', { text: 'Rol' }),
        el('th', { text: 'Katıldı' }),
        el('th', { class: 'shrink', text: '' }),
      ])]),
      el('tbody', {}, state.members.map((member) => el('tr', {}, [
        el('td', {}, [
          el('b', { text: member.name || member.email }),
          el('span', { class: 'muted block', text: member.email }),
        ]),
        el('td', {}, [roleSelect(member)]),
        el('td', { class: 'muted', text: when(member.joinedAt) }),
        el('td', { class: 'shrink' }, [
          can('member.manage') && member.role !== 'owner' && member.userId !== state.user.id
            ? el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Çıkar', onclick: () => remove(member) })
            : null,
        ]),
      ]))),
    ]),
  ]));

  if (can('member.invite')) {
    host.appendChild(el('h3', { class: 'sectionhead', text: 'Bekleyen davetler' }));

    host.appendChild(state.invites.length
      ? el('div', { class: 'invites' }, state.invites.map((item) => el('div', { class: 'invite' }, [
          el('code', { text: item.code }),
          el('span', { class: 'muted', text: state.roles.find((role) => role.id === item.role)?.label || item.role }),
          el('button', {
            class: 'ghostlink', type: 'button', text: 'Kopyala',
            onclick: () => {
              navigator.clipboard?.writeText(item.code);
              toast('Kod kopyalandı.');
            },
          }),
          el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'İptal', onclick: () => revoke(item.code) }),
        ])))
      : el('p', { class: 'empty', text: 'Bekleyen davet yok.' }));
  }

  host.appendChild(el('h3', { class: 'sectionhead', text: 'Roller ne yapabilir' }));
  host.appendChild(el('div', { class: 'rolecards' }, state.roles.map((role) => el('div', { class: 'card' }, [
    el('h4', { text: role.label }),
    el('p', { text: role.note }),
  ]))));
}
