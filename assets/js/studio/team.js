/* Ekip: kim var, kim ne yapabilir, kim davet edildi. */

import { api, can, loadCompany, state } from './api.js';
import { avatar } from './avatar.js';
import { $, clear, dialog, el, field, toast, when } from './dom.js';

const ROLE_NOTE = {
  owner: 'Everything: deletes the company, changes roles, hands ownership on.',
  admin: 'Runs the team, the tasks, the tables and the meetings.',
  member: 'Takes work, updates their own tasks, writes rows.',
  guest: 'Reads. Nothing else.',
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
        `Hand ownership to ${label}? You stay on as an admin.`)) {
        event.target.value = member.role;
        return;
      }

      try {
        await api('/api/company', {
          method: 'POST',
          body: { action: 'role', companyId: state.companyId, userId: member.userId, role },
        });

        await members();
        toast('Role updated.');
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
  if (!window.confirm(`Remove ${member.name || member.email} from the company?`)) return;

  try {
    await api('/api/company', {
      method: 'POST',
      body: { action: 'remove', companyId: state.companyId, userId: member.userId },
    });

    await members();
    toast('Removed.');
  } catch (error) {
    toast(error.message, 'bad');
  }
}

function invite() {
  dialog({
    title: 'Create an invite code',
    confirm: 'Create',
    body: [
      field('Role it grants', el('select', { name: 'role' }, ['guest', 'member', 'admin']
        .filter((role) => state.role === 'owner' || role !== 'owner')
        .map((role) => el('option', {
          value: role,
          selected: role === 'member',
          text: `${state.roles.find((item) => item.id === role)?.label || role} — ${ROLE_NOTE[role]}`,
        }))), 'Good for 14 days. Whoever has it opens an account and joins with it.'),
    ],
    onConfirm: async (data) => {
      const created = await api('/api/company', {
        method: 'POST',
        body: { action: 'invite', companyId: state.companyId, role: data.get('role') },
      });

      await members();
      toast(`Invite code: ${created.invite.code}`);
    },
  });
}

async function revoke(code) {
  try {
    await api('/api/company', { method: 'POST', body: { action: 'revoke', companyId: state.companyId, code } });
    await members();
  } catch (error) {
    toast(error.message, 'bad');
  }
}

/* Which part of the company somebody works in. Vlipa reads this when it hands
   work out. */
function departmentSelect(member) {
  const names = state.company?.departments || [];

  if (!can('member.manage')) {
    return el('span', { class: 'muted', text: member.department || '—' });
  }

  return el('select', {
    class: 'deptpick',
    onchange: async (event) => {
      const wanted = event.target.value;

      try {
        await api('/api/company', {
          method: 'POST',
          body: { action: 'department', companyId: state.companyId, userId: member.userId, department: wanted },
        });

        member.department = wanted;
        toast('Department updated.');
      } catch (error) {
        toast(error.message, 'bad');
        event.target.value = member.department || '';
      }
    },
  }, [
    el('option', { value: '', selected: !member.department, text: '—' }),
    ...names.map((name) => el('option', {
      value: name, selected: member.department === name, text: name,
    })),
  ]);
}

/* Two views of the same people.

   Everybody gets the cards: who is here, what they do, which department they
   are in. Whoever runs the company gets the panel behind it, where the roles
   are handed out and somebody can be shown the door — which is not a thing
   the rest of the team needs on screen. */

function personCard(member) {
  const you = member.userId === state.user.id;

  return el('article', { class: `person__card${you ? ' is-you' : ''}` }, [
    avatar(member, 48),
    el('div', { class: 'person__who' }, [
      el('b', { text: `${member.name || member.email}${you ? ' (you)' : ''}` }),
      el('span', { class: 'muted', text: member.email }),
      el('div', { class: 'person__tags' }, [
        el('span', { class: `rolebadge rolebadge--${member.role}`, text: state.roles.find((role) => role.id === member.role)?.label || member.role }),
        member.department ? el('span', { class: 'pill pill--dept', text: member.department }) : null,
      ]),
    ]),
  ]);
}

export async function show({ refresh = true } = {}) {
  // Members and invitations arrive with the company, so the page has to ask
  // for them again rather than drawing whatever was loaded at boot.
  if (refresh) await loadCompany(state.companyId);

  const host = clear($('view'));

  host.appendChild(el('div', { class: 'toolbar' }, [
    el('h3', { text: `${state.members.length} ${state.members.length === 1 ? 'person' : 'people'}` }),
    el('div', { class: 'spread' }, [
      can('member.manage')
        ? el('button', { class: 'btn btn--ghost', type: 'button', text: 'Members', onclick: () => { window.location.hash = '#/members'; } })
        : null,
      can('member.invite') ? el('button', { class: 'btn', type: 'button', text: '+ Invite', onclick: invite }) : null,
    ]),
  ]));

  const byDepartment = new Map();

  for (const member of state.members) {
    const name = member.department || 'No department';
    if (!byDepartment.has(name)) byDepartment.set(name, []);
    byDepartment.get(name).push(member);
  }

  for (const [name, people] of byDepartment) {
    host.appendChild(el('h3', { class: 'sectionhead' }, [name, el('span', { class: 'count', text: String(people.length) })]));
    host.appendChild(el('div', { class: 'people' }, people.map(personCard)));
  }
}

/* ---------- the panel behind it ---------- */

export async function members({ refresh = true } = {}) {
  if (refresh) await loadCompany(state.companyId);

  const host = clear($('view'));

  if (!can('member.manage')) {
    host.appendChild(el('p', { class: 'empty', text: 'Handing out roles is an admin job.' }));
    return;
  }

  host.appendChild(el('div', { class: 'toolbar' }, [
    el('h3', { text: `${state.members.length} members` }),
    can('member.invite') ? el('button', { class: 'btn', type: 'button', text: '+ Invite', onclick: invite }) : null,
  ]));

  host.appendChild(el('div', { class: 'tablewrap' }, [
    el('table', { class: 'grid' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Person' }),
        el('th', { text: 'Role' }),
        el('th', { text: 'Department' }),
        el('th', { text: 'Joined' }),
        el('th', { class: 'shrink', text: '' }),
      ])]),
      el('tbody', {}, state.members.map((member) => el('tr', {}, [
        el('td', {}, [
          el('div', { class: 'person' }, [
            avatar(member, 34),
            el('div', {}, [
              el('b', { text: member.name || member.email }),
              el('span', { class: 'muted block', text: member.email }),
            ]),
          ]),
        ]),
        el('td', {}, [roleSelect(member)]),
        el('td', {}, [departmentSelect(member)]),
        el('td', { class: 'muted', text: when(member.joinedAt) }),
        el('td', { class: 'shrink' }, [
          can('member.manage') && member.role !== 'owner' && member.userId !== state.user.id
            ? el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Remove', onclick: () => remove(member) })
            : null,
        ]),
      ]))),
    ]),
  ]));

  if (can('member.invite')) {
    host.appendChild(el('h3', { class: 'sectionhead', text: 'Open invitations' }));

    host.appendChild(state.invites.length
      ? el('div', { class: 'invites' }, state.invites.map((item) => el('div', { class: 'invite' }, [
          el('code', { text: item.code }),
          el('span', { class: 'muted', text: state.roles.find((role) => role.id === item.role)?.label || item.role }),
          el('button', {
            class: 'ghostlink', type: 'button', text: 'Copy',
            onclick: () => {
              navigator.clipboard?.writeText(item.code);
              toast('Code copied.');
            },
          }),
          el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Revoke', onclick: () => revoke(item.code) }),
        ])))
      : el('p', { class: 'empty', text: 'No invitations waiting.' }));
  }

  host.appendChild(el('h3', { class: 'sectionhead', text: 'What each role may do' }));
  host.appendChild(el('div', { class: 'rolecards' }, state.roles.map((role) => el('div', { class: 'card' }, [
    el('h4', { text: role.label }),
    el('p', { text: role.note }),
  ]))));
}
