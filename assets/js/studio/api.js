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
  storage: 'kv',
  storageNote: '',
};

/* A request that never answers used to leave the studio staring at a blank
   page, so every call gives up on its own. */
const TIMEOUT_MS = 25000;

export async function api(path, { method = 'GET', body } = {}) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);

  let response;

  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: stop.signal,
    });
  } catch (problem) {
    const error = new Error(problem.name === 'AbortError'
      ? 'The server did not answer (25 seconds).'
      : 'Could not reach the server. Check your connection.');
    error.status = 0;
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    // Without storage the server forgets sessions between requests, so a
    // signed-in visitor gets told to sign in. Say what is really wrong.
    const message = response.status === 401 && state.storage === 'memory'
      ? 'The server has no storage, so your sign-in does not survive from one request to the next. Connect a database — see Settings.'
      : data.error || `The request failed (${response.status}).`;

    const error = new Error(message);
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
  if (!seat) return 'Unknown';
  return seat.name || seat.email;
}

/* The company request can be started before the session comes back, since the
   id is already in this browser: `already` is that head start. */
export async function loadCompany(id, already) {
  const data = await (already || api(id ? `/api/company?id=${encodeURIComponent(id)}` : '/api/company'));

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
