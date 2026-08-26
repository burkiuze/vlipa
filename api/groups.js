/* Gruplar: şirketin konuşma odaları.

   Her grubun yazışması ve bir de sesli odası var. Mesajlar sırayla bir listede
   durur; tarayıcı belli aralıklarla son mesajları ister.

   GET  ?companyId= [&id=]        → gruplar, seçilen grubun mesajları
   POST { action: 'create' }      → grup aç
   POST { action: 'rename' }      → adını değiştir
   POST { action: 'drop' }        → grubu sil
   POST { action: 'post' }        → mesaj yaz
   POST { action: 'clear' }       → mesajları temizle */

import crypto from 'node:crypto';
import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { callerKey, fail, json, methodGuard, parseCookies, readBody, withinLimit } from './_lib/http.js';
import { can, createGroup, dropGroup, groupsOf, guard } from './_lib/org.js';
import * as store from './_lib/store.js';

const MAX_GROUPS = 20;
const KEEP = 400;      // mesaj geçmişi bu sayıda tutulur

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Önce giriş yap.');

  try {
    if (req.method === 'GET') {
      const check = await guard({ user, companyId: req.query?.companyId });
      if (check.error) return fail(res, check.status, check.error);

      const groups = await groupsOf(check.company.id);
      const wanted = req.query?.id;
      const host = process.env.MEET_HOST || 'meet.jit.si';

      if (!wanted) return json(res, 200, { ok: true, groups, host });

      const group = groups.find((item) => item.id === wanted);
      if (!group) return fail(res, 404, 'Grup bulunamadı.');

      const since = Number(req.query?.since || 0);
      const all = await store.range(`group-msgs:${group.id}`, -120, -1);
      const messages = since ? all.filter((message) => message.at > since) : all;

      return json(res, 200, { ok: true, groups, group, messages, host });
    }

    const body = await readBody(req);
    const check = await guard({ user, companyId: body.companyId });
    if (check.error) return fail(res, check.status, check.error);

    if (body.action === 'create' || body.action === 'rename' || body.action === 'drop' || body.action === 'clear') {
      if (!can(check.role, 'group.manage')) {
        return fail(res, 403, 'Grupları yönetmek için yönetici olman gerekiyor.');
      }
    } else if (!can(check.role, 'group.post')) {
      return fail(res, 403, 'Bu grupta yazma yetkin yok.');
    }

    if (body.action === 'create') {
      const groups = await groupsOf(check.company.id);
      if (groups.length >= MAX_GROUPS) return fail(res, 429, `Bir şirkette en fazla ${MAX_GROUPS} grup olabilir.`);

      const group = await createGroup({ companyId: check.company.id, name: body.name, byUserId: user.id });
      return json(res, 201, { ok: true, group });
    }

    const group = await store.get(`group:${body.groupId || body.id}`);
    if (!group || group.companyId !== check.company.id) return fail(res, 404, 'Grup bulunamadı.');

    if (body.action === 'rename') {
      group.name = String(body.name || group.name).trim().slice(0, 40);
      await store.set(`group:${group.id}`, group);
      return json(res, 200, { ok: true, group });
    }

    if (body.action === 'drop') {
      await dropGroup(check.company.id, group.id);
      return json(res, 200, { ok: true });
    }

    if (body.action === 'clear') {
      await store.dropList(`group-msgs:${group.id}`);
      return json(res, 200, { ok: true });
    }

    if (body.action === 'post') {
      if (!withinLimit(`msg:${callerKey(req)}`, 30)) {
        return fail(res, 429, 'Biraz yavaş: dakikada 30 mesaj.');
      }

      const text = String(body.text || '').trim();
      if (!text) return fail(res, 400, 'Boş mesaj gönderilmez.');
      if (text.length > 2000) return fail(res, 413, 'Bu mesaj çok uzun.');

      const message = {
        id: crypto.randomUUID(),
        userId: user.id,
        name: user.name || user.email,
        text,
        at: Date.now(),
      };

      await store.push(`group-msgs:${group.id}`, message, KEEP);
      return json(res, 201, { ok: true, message });
    }

    return fail(res, 400, 'Bilinmeyen işlem.');
  } catch (error) {
    console.error('[vlipa] groups:', error);
    return fail(res, 500, 'Grup servisi şu an cevap veremiyor.');
  }
}
