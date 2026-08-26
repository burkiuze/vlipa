/* Key/value storage, in front of whichever backend this deployment has.

   Supabase first, since that is where the data is meant to live. A Vercel KV
   (Upstash) store is still honoured if one is connected. With neither, it
   falls back to an in-memory map: fine for a look around on a laptop, useless
   in production, because every deployment and every serverless instance gets
   its own copy and forgets it on the next cold start. */

import * as supabase from './supabase.js';

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export const backend = supabase.ready() ? 'supabase' : (KV_URL && KV_TOKEN ? 'kv' : 'memory');
export const remoteStore = backend !== 'memory';

/* Why a configured-looking Supabase is not being used, if that is the case. */
export const storageNote = supabase.problem();

const memory = new Map();
const memorySets = new Map();
const memoryLists = new Map();

async function command(path, body) {
  const response = await fetch(`${KV_URL}/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KV_TOKEN}` },
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
  if (backend === 'supabase') return supabase.get(key);

  if (backend === 'memory') {
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
  if (backend === 'supabase') return supabase.set(key, value, ttlSeconds);

  if (backend === 'memory') {
    memory.set(key, { value, expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
    return;
  }

  const path = ttlSeconds
    ? `setex/${encodeURIComponent(key)}/${Math.floor(ttlSeconds)}`
    : `set/${encodeURIComponent(key)}`;

  await command(path, JSON.stringify(value));
}

export async function del(key) {
  if (backend === 'supabase') return supabase.del(key);
  if (backend === 'memory') { memory.delete(key); return; }
  await command(`del/${encodeURIComponent(key)}`);
}

export async function addTo(setKey, member) {
  if (backend === 'supabase') return supabase.addTo(setKey, member);

  if (backend === 'memory') {
    if (!memorySets.has(setKey)) memorySets.set(setKey, new Set());
    memorySets.get(setKey).add(member);
    return;
  }

  await command(`sadd/${encodeURIComponent(setKey)}/${encodeURIComponent(member)}`);
}

export async function removeFrom(setKey, member) {
  if (backend === 'supabase') return supabase.removeFrom(setKey, member);

  if (backend === 'memory') {
    const bag = memorySets.get(setKey);
    if (bag) bag.delete(member);
    return;
  }

  await command(`srem/${encodeURIComponent(setKey)}/${encodeURIComponent(member)}`);
}

export async function members(setKey) {
  if (backend === 'supabase') return supabase.members(setKey);
  if (backend === 'memory') return Array.from(memorySets.get(setKey) || []);

  const result = await command(`smembers/${encodeURIComponent(setKey)}`);
  return Array.isArray(result) ? result : [];
}

/* Lists, for things that have an order: messages in a group. */
export async function push(listKey, value, cap = 500) {
  if (backend === 'supabase') return supabase.push(listKey, value, cap);

  if (backend === 'memory') {
    const list = memoryLists.get(listKey) || [];
    list.push(value);
    memoryLists.set(listKey, list.slice(-cap));
    return;
  }

  await command(`rpush/${encodeURIComponent(listKey)}`, JSON.stringify(value));
  await command(`ltrim/${encodeURIComponent(listKey)}/${-cap}/-1`);
}

export async function range(listKey, start = 0, stop = -1) {
  if (backend === 'supabase') return supabase.range(listKey, start, stop);

  if (backend === 'memory') {
    const list = memoryLists.get(listKey) || [];
    const from = start < 0 ? Math.max(0, list.length + start) : start;
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(from, end);
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
  if (backend === 'supabase') return supabase.dropList(listKey);
  if (backend === 'memory') { memoryLists.delete(listKey); return; }
  await command(`del/${encodeURIComponent(listKey)}`);
}

/* Is the backend actually answering? Used by /api/status. */
export async function ping() {
  if (backend === 'supabase') return supabase.ping();
  if (backend === 'memory') return { ok: true, note: 'Bellek: sunucu yenilenince her şey gider.' };

  try {
    await command('ping');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
