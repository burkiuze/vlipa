/* Key/value storage.

   Uses the Upstash-compatible REST API that Vercel KV provides. Without those
   environment variables it falls back to an in-memory map, which is fine for
   local development and useless in production: every deployment and every
   serverless instance gets its own copy. */

const URL_ENV = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN_ENV = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export const remoteStore = Boolean(URL_ENV && TOKEN_ENV);

const memory = new Map();
const memorySets = new Map();
const memoryLists = new Map();

async function command(path, body) {
  const response = await fetch(`${URL_ENV}/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN_ENV}` },
    body,
  });

  if (!response.ok) throw new Error(`Storage error ${response.status}`);
  const data = await response.json();
  return data.result;
}

function alive(entry) {
  return entry && (!entry.expires || entry.expires > Date.now());
}

export async function get(key) {
  if (!remoteStore) {
    const entry = memory.get(key);
    if (!alive(entry)) { memory.delete(key); return null; }
    return entry.value;
  }

  const raw = await command(`get/${encodeURIComponent(key)}`);
  if (raw === null || raw === undefined) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function set(key, value, ttlSeconds) {
  const raw = JSON.stringify(value);

  if (!remoteStore) {
    memory.set(key, { value, expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
    return;
  }

  const path = ttlSeconds
    ? `setex/${encodeURIComponent(key)}/${Math.floor(ttlSeconds)}`
    : `set/${encodeURIComponent(key)}`;

  await command(path, raw);
}

export async function del(key) {
  if (!remoteStore) { memory.delete(key); return; }
  await command(`del/${encodeURIComponent(key)}`);
}

export async function addTo(setKey, member) {
  if (!remoteStore) {
    if (!memorySets.has(setKey)) memorySets.set(setKey, new Set());
    memorySets.get(setKey).add(member);
    return;
  }

  await command(`sadd/${encodeURIComponent(setKey)}/${encodeURIComponent(member)}`);
}

export async function removeFrom(setKey, member) {
  if (!remoteStore) {
    const bag = memorySets.get(setKey);
    if (bag) bag.delete(member);
    return;
  }

  await command(`srem/${encodeURIComponent(setKey)}/${encodeURIComponent(member)}`);
}

/* Lists, for things that have an order: messages in a group. */
export async function push(listKey, value, cap = 500) {
  const raw = JSON.stringify(value);

  if (!remoteStore) {
    const list = memoryLists.get(listKey) || [];
    list.push(value);
    memoryLists.set(listKey, list.slice(-cap));
    return;
  }

  await command(`rpush/${encodeURIComponent(listKey)}`, raw);
  await command(`ltrim/${encodeURIComponent(listKey)}/${-cap}/-1`);
}

export async function range(listKey, start = 0, stop = -1) {
  if (!remoteStore) {
    const list = memoryLists.get(listKey) || [];
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(start, end);
  }

  const result = await command(`lrange/${encodeURIComponent(listKey)}/${start}/${stop}`);

  return (Array.isArray(result) ? result : []).map((item) => {
    try {
      return JSON.parse(item);
    } catch {
      return item;
    }
  });
}

export async function dropList(listKey) {
  if (!remoteStore) { memoryLists.delete(listKey); return; }
  await command(`del/${encodeURIComponent(listKey)}`);
}

export async function members(setKey) {
  if (!remoteStore) return Array.from(memorySets.get(setKey) || []);
  const result = await command(`smembers/${encodeURIComponent(setKey)}`);
  return Array.isArray(result) ? result : [];
}
