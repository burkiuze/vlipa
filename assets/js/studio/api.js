/* Every call to the server goes through here, and every failure comes back as
   an Error carrying whatever the server said about it. */

export const state = {
  user: null,
  companies: [],
  companyId: null,
  company: null,
  role: 'guest',
  members: [],
  invites: [],
  roles: [],
};

export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || `İstek başarısız (${response.status}).`);
    error.status = response.status;
    error.reason = data.reason;
    error.tried = data.tried;
    throw error;
  }

  return data;
}

/* What the current role may do, mirroring api/_lib/org.js. The server decides;
   this only keeps the interface honest about what it offers. */
const RIGHTS = {
  owner:  ['company.manage', 'company.delete', 'member.manage', 'member.invite', 'role.assign',
           'task.manage', 'task.own', 'table.manage', 'row.write', 'meeting.manage',
           'group.manage', 'group.post', 'chat.use'],
  admin:  ['company.manage', 'member.manage', 'member.invite', 'role.assign',
           'task.manage', 'task.own', 'table.manage', 'row.write', 'meeting.manage',
           'group.manage', 'group.post', 'chat.use'],
  member: ['task.own', 'row.write', 'meeting.manage', 'group.post', 'chat.use'],
  guest:  ['group.post', 'chat.use'],
};

export function can(right) {
  return (RIGHTS[state.role] || []).includes(right);
}

export function memberName(userId) {
  const seat = state.members.find((member) => member.userId === userId);
  if (!seat) return 'Bilinmeyen';
  return seat.name || seat.email;
}

export async function loadCompany(id) {
  const data = await api(id ? `/api/company?id=${encodeURIComponent(id)}` : '/api/company');

  state.companies = data.companies || [];
  state.roles = data.roles || [];

  if (data.company) {
    state.company = data.company;
    state.companyId = data.company.id;
    state.role = data.role;
    state.members = data.members || [];
    state.invites = data.invites || [];
    localStorage.setItem('vlipa.company', data.company.id);
  }

  return data;
}
