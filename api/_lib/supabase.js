/* Supabase as the store behind the studio.

   Everything the studio keeps — accounts, sessions, companies, tasks, tables,
   messages — goes through three small tables reached over PostgREST. The
   schema is in supabase.sql; paste it into the SQL editor once.

   The key matters. This runs on the server, holds password hashes and live
   session tokens, and therefore needs the **secret** key (`sb_secret_…`, or
   the older `service_role`). The publishable key is the one meant for
   browsers: it cannot get past row level security, and anything it could
   reach would be reachable by anyone holding it. So a publishable key is
   refused here rather than half-working. */

const URL_ENV = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');

const SECRET = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || '';

const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || '';

const KV = 'vlipa_kv';
const SET = 'vlipa_set';
const LIST = 'vlipa_list';

export function ready() {
  return Boolean(URL_ENV && SECRET);
}

/* What is missing, in a sentence, for /api/status to repeat. */
export function problem() {
  if (ready()) return null;
  if (!URL_ENV && !SECRET && !PUBLISHABLE) return null;
  if (!URL_ENV) return 'SUPABASE_URL tanımlı değil.';

  return SECRET
    ? null
    : 'SUPABASE_SECRET_KEY tanımlı değil. Publishable (anon) anahtar yetmez: sunucu tarafı depolama gizli anahtar ister.';
}

const enc = encodeURIComponent;

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: SECRET,
    authorization: `Bearer ${SECRET}`,
    'content-type': 'application/json',
  };

  if (prefer) headers.prefer = prefer;

  const response = await fetch(`${URL_ENV}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    const error = new Error(`Supabase ${response.status}: ${detail}`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ---------- values ---------- */

export async function get(key) {
  const rows = await rest(`${KV}?key=eq.${enc(key)}&select=value,expires_at&limit=1`);
  const row = rows?.[0];

  if (!row) return null;

  // Postgres does not expire rows on its own, so a stale one is dropped the
  // moment somebody asks for it.
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    await del(key).catch(() => {});
    return null;
  }

  return row.value;
}

export async function set(key, value, ttlSeconds) {
  await rest(`${KV}?on_conflict=key`, {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: [{
      key,
      value,
      expires_at: ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null,
    }],
  });
}

export async function del(key) {
  await rest(`${KV}?key=eq.${enc(key)}`, { method: 'DELETE', prefer: 'return=minimal' });
}

/* ---------- sets ---------- */

export async function addTo(setKey, member) {
  await rest(`${SET}?on_conflict=key,member`, {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: [{ key: setKey, member: String(member) }],
  });
}

export async function removeFrom(setKey, member) {
  await rest(`${SET}?key=eq.${enc(setKey)}&member=eq.${enc(member)}`, {
    method: 'DELETE',
    prefer: 'return=minimal',
  });
}

export async function members(setKey) {
  const rows = await rest(`${SET}?key=eq.${enc(setKey)}&select=member`);
  return (rows || []).map((row) => row.member);
}

/* ---------- lists ---------- */

export async function push(listKey, value, cap = 500) {
  await rest(LIST, { method: 'POST', prefer: 'return=minimal', body: [{ key: listKey, value }] });

  // Keep the tail: find the newest row that is one past the cap and drop
  // everything at or below it.
  const older = await rest(`${LIST}?key=eq.${enc(listKey)}&select=id&order=id.desc&offset=${cap}&limit=1`);

  if (older?.length) {
    await rest(`${LIST}?key=eq.${enc(listKey)}&id=lte.${older[0].id}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    });
  }
}

/* Redis' index rules, because that is what the callers were written against:
   (0, -1) is everything and (-120, -1) is the last hundred and twenty. */
export async function range(listKey, start = 0, stop = -1) {
  if (start < 0) {
    const rows = await rest(`${LIST}?key=eq.${enc(listKey)}&select=value&order=id.desc&limit=${-start}`);
    return (rows || []).map((row) => row.value).reverse();
  }

  const limit = stop === -1 ? 1000 : Math.max(0, stop - start + 1);
  const rows = await rest(`${LIST}?key=eq.${enc(listKey)}&select=value&order=id.asc&offset=${start}&limit=${limit}`);
  return (rows || []).map((row) => row.value);
}

export async function dropList(listKey) {
  await rest(`${LIST}?key=eq.${enc(listKey)}`, { method: 'DELETE', prefer: 'return=minimal' });
}

/* ---------- health ---------- */

export async function ping() {
  try {
    await rest(`${KV}?select=key&limit=1`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
