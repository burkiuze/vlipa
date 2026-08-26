/* Companies: who they are, who belongs to them, and what each person may do.

   A company is the unit everything else hangs off. Tasks, tables and meetings
   all carry a companyId, and every request is checked against the caller's
   role in that company before it touches anything. */

import crypto from 'node:crypto';
import * as store from './store.js';

export const ROLES = {
  owner:  { id: 'owner',  label: 'Sahip',    note: 'Her şeyi yapabilir. Şirketi siler, rolleri değiştirir, sahipliği devreder.' },
  admin:  { id: 'admin',  label: 'Yönetici', note: 'Ekibi, görevleri, tabloları ve toplantıları yönetir.' },
  member: { id: 'member', label: 'Üye',      note: 'Görev alır, kendi görevini günceller, tablolara satır ekler.' },
  guest:  { id: 'guest',  label: 'Misafir',  note: 'Sadece görür. Hiçbir şeyi değiştiremez.' },
};

/* What each role is allowed to do. Everything not listed is refused. */
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

export function can(role, right) {
  return (RIGHTS[role] || []).includes(right);
}

export function rolesFor(role) {
  // Nobody hands out a role above their own; only an owner can make an owner.
  const ladder = ['guest', 'member', 'admin', 'owner'];
  const ceiling = ladder.indexOf(role === 'owner' ? 'owner' : 'admin');
  return ladder.slice(0, ceiling + 1);
}

const SLUG_TAKEN = ['www', 'api', 'app', 'studio', 'admin', 'vlipa', 'dev', 'mail', 'blog'];

export function slugify(name) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', İ: 'i' };

  return String(name || '')
    .toLowerCase()
    .replace(/[çğıöşüİ]/g, (char) => map[char] || char)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

export function validateName(name) {
  const trimmed = String(name || '').trim();
  if (trimmed.length < 2) return 'Şirket adı en az 2 karakter olmalı.';
  if (trimmed.length > 60) return 'Şirket adı çok uzun.';
  return null;
}

/* ---------- reading ---------- */

export async function getCompany(id) {
  return id ? store.get(`co:${id}`) : null;
}

export async function membership(companyId, userId) {
  if (!companyId || !userId) return null;
  return store.get(`member:${companyId}:${userId}`);
}

export async function companiesOf(userId) {
  const ids = await store.members(`user-cos:${userId}`);
  const out = [];

  for (const id of ids) {
    const company = await getCompany(id);
    const seat = await membership(id, userId);
    if (company && seat) out.push({ ...company, role: seat.role });
  }

  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function membersOf(companyId) {
  const ids = await store.members(`co-members:${companyId}`);
  const out = [];

  for (const id of ids) {
    const seat = await membership(companyId, id);
    if (seat) out.push(seat);
  }

  const order = ['owner', 'admin', 'member', 'guest'];
  return out.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) ||
    String(a.name || a.email).localeCompare(String(b.name || b.email)));
}

/* ---------- writing ---------- */

export async function createCompany({ name, owner }) {
  const problem = validateName(name);
  if (problem) return { error: problem };

  const mine = await companiesOf(owner.id);
  if (mine.length >= 5) return { error: 'Aynı anda en fazla 5 şirket kurabilirsin.' };

  let slug = slugify(name) || 'sirket';
  if (SLUG_TAKEN.includes(slug) || await store.get(`co-slug:${slug}`)) {
    slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
  }

  const company = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    slug,
    ownerId: owner.id,
    createdAt: new Date().toISOString(),
    linkOpen: false,       // the shared link is off until somebody turns it on
    linkRole: 'member',
  };

  await store.set(`co:${company.id}`, company);
  await store.set(`co-slug:${slug}`, company.id);
  await seat(company.id, owner, 'owner');

  // Every company starts with somewhere to talk.
  await createGroup({ companyId: company.id, name: 'Genel', byUserId: owner.id });

  return { company };
}

export async function seat(companyId, user, role) {
  const record = {
    companyId,
    userId: user.id,
    email: user.email,
    name: user.name || '',
    role,
    joinedAt: new Date().toISOString(),
  };

  await store.set(`member:${companyId}:${user.id}`, record);
  await store.addTo(`co-members:${companyId}`, user.id);
  await store.addTo(`user-cos:${user.id}`, companyId);

  return record;
}

export async function unseat(companyId, userId) {
  await store.del(`member:${companyId}:${userId}`);
  await store.removeFrom(`co-members:${companyId}`, userId);
  await store.removeFrom(`user-cos:${userId}`, companyId);
}

export async function setRole(companyId, userId, role) {
  const record = await membership(companyId, userId);
  if (!record) return null;

  record.role = role;
  await store.set(`member:${companyId}:${userId}`, record);

  if (role === 'owner') {
    const company = await getCompany(companyId);
    if (company) {
      company.ownerId = userId;
      await store.set(`co:${companyId}`, company);
    }
  }

  return record;
}

/* ---------- the shared link: vlipa.dev/invite/<slug> ---------- */

export async function companyBySlug(slug) {
  const id = await store.get(`co-slug:${String(slug || '').toLowerCase()}`);
  return id ? getCompany(id) : null;
}

export async function changeSlug(company, wanted) {
  const slug = slugify(wanted);

  if (!slug || slug.length < 3) return { error: 'Link adı en az 3 karakter olmalı.' };
  if (SLUG_TAKEN.includes(slug)) return { error: 'Bu link adı ayrılmış.' };

  const holder = await store.get(`co-slug:${slug}`);
  if (holder && holder !== company.id) return { error: 'Bu link adı başka bir şirkette.' };

  if (company.slug && company.slug !== slug) await store.del(`co-slug:${company.slug}`);

  company.slug = slug;
  await store.set(`co-slug:${slug}`, company.id);
  await store.set(`co:${company.id}`, company);

  return { company };
}

/* ---------- groups ---------- */

export async function createGroup({ companyId, name, byUserId }) {
  const group = {
    id: crypto.randomUUID(),
    companyId,
    name: String(name || 'Yeni grup').trim().slice(0, 40),
    createdBy: byUserId,
    createdAt: new Date().toISOString(),
    room: `vlipa-g-${crypto.randomBytes(5).toString('hex')}`,   // its voice room
  };

  await store.set(`group:${group.id}`, group);
  await store.addTo(`co-groups:${companyId}`, group.id);

  return group;
}

export async function groupsOf(companyId) {
  const ids = await store.members(`co-groups:${companyId}`);
  const out = [];

  for (const id of ids) {
    const group = await store.get(`group:${id}`);
    if (group) out.push(group);
    else await store.removeFrom(`co-groups:${companyId}`, id);
  }

  return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function dropGroup(companyId, groupId) {
  await store.dropList(`group-msgs:${groupId}`);
  await store.del(`group:${groupId}`);
  await store.removeFrom(`co-groups:${companyId}`, groupId);
}

/* ---------- invitations ---------- */

export async function createInvite({ companyId, role, byUserId }) {
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();

  const invite = {
    code,
    companyId,
    role: ROLES[role] ? role : 'member',
    byUserId,
    createdAt: new Date().toISOString(),
  };

  await store.set(`invite:${code}`, invite, 14 * 24 * 60 * 60);   // a fortnight
  await store.addTo(`co-invites:${companyId}`, code);

  return invite;
}

export async function invitesOf(companyId) {
  const codes = await store.members(`co-invites:${companyId}`);
  const out = [];

  for (const code of codes) {
    const invite = await store.get(`invite:${code}`);
    if (invite) out.push(invite);
    else await store.removeFrom(`co-invites:${companyId}`, code);   // expired
  }

  return out;
}

export async function redeemInvite(code, user) {
  const invite = await store.get(`invite:${String(code || '').trim().toUpperCase()}`);
  if (!invite) return { error: 'Bu davet kodu geçersiz ya da süresi dolmuş.' };

  const company = await getCompany(invite.companyId);
  if (!company) return { error: 'Davetin ait olduğu şirket bulunamadı.' };

  const already = await membership(company.id, user.id);
  if (already) return { company, seat: already };

  return { company, seat: await seat(company.id, user, invite.role) };
}

export async function dropInvite(companyId, code) {
  await store.del(`invite:${code}`);
  await store.removeFrom(`co-invites:${companyId}`, code);
}

/* ---------- the guard every endpoint uses ---------- */

/* Resolves the caller's seat in a company and checks one right. */
export async function guard({ user, companyId, right }) {
  if (!user) return { status: 401, error: 'Önce giriş yap.' };
  if (!companyId) return { status: 400, error: 'Şirket seçilmedi.' };

  const company = await getCompany(companyId);
  if (!company) return { status: 404, error: 'Şirket bulunamadı.' };

  const seatRecord = await membership(companyId, user.id);
  if (!seatRecord) return { status: 403, error: 'Bu şirkete üye değilsin.' };

  if (right && !can(seatRecord.role, right)) {
    return { status: 403, error: `Bu işlem için yetkin yok (${ROLES[seatRecord.role]?.label || seatRecord.role}).` };
  }

  return { company, seat: seatRecord, role: seatRecord.role };
}
