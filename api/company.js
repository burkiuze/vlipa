/* Companies and the people in them.

   GET                          → my companies, and the one I am looking at
   POST { action: 'create' }    → open a company (the caller becomes its owner)
   POST { action: 'rename' }    → rename it
   POST { action: 'invite' }    → make an invitation code
   POST { action: 'join' }      → redeem one
   POST { action: 'role' }      → change somebody's role
   POST { action: 'remove' }    → take somebody out
   POST { action: 'leave' }     → take myself out
   DELETE ?id=                  → close the company down */

import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { fail, json, methodGuard, parseCookies, readBody } from './_lib/http.js';
import {
  ROLES, companiesOf, createCompany, createInvite, dropInvite, getCompany, guard,
  invitesOf, membersOf, membership, redeemInvite, rolesFor, setRole, unseat, validateName,
} from './_lib/org.js';
import * as store from './_lib/store.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST', 'DELETE'])) return;

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Önce giriş yap.');

  try {
    if (req.method === 'GET') {
      const companies = await companiesOf(user.id);
      const wanted = req.query?.id;

      if (!wanted) {
        return json(res, 200, { ok: true, companies, roles: Object.values(ROLES) });
      }

      const check = await guard({ user, companyId: wanted });
      if (check.error) return fail(res, check.status, check.error);

      return json(res, 200, {
        ok: true,
        companies,
        company: check.company,
        role: check.role,
        rights: rolesFor(check.role),
        members: await membersOf(wanted),
        invites: check.role === 'guest' || check.role === 'member' ? [] : await invitesOf(wanted),
        roles: Object.values(ROLES),
      });
    }

    if (req.method === 'DELETE') {
      const check = await guard({ user, companyId: req.query?.id, right: 'company.delete' });
      if (check.error) return fail(res, check.status, check.error);

      for (const seat of await membersOf(check.company.id)) {
        await unseat(check.company.id, seat.userId);
      }

      await store.del(`co-slug:${check.company.slug}`);
      await store.del(`co:${check.company.id}`);

      return json(res, 200, { ok: true });
    }

    const body = await readBody(req);

    /* ---- open a company ---- */
    if (body.action === 'create') {
      const result = await createCompany({ name: body.name, owner: user });
      if (result.error) return fail(res, 400, result.error);

      return json(res, 201, { ok: true, company: result.company, role: 'owner' });
    }

    /* ---- join with a code: no membership needed yet ---- */
    if (body.action === 'join') {
      const result = await redeemInvite(body.code, user);
      if (result.error) return fail(res, 400, result.error);

      return json(res, 200, { ok: true, company: result.company, role: result.seat.role });
    }

    /* everything below happens inside a company */
    const companyId = body.companyId;

    if (body.action === 'leave') {
      const check = await guard({ user, companyId });
      if (check.error) return fail(res, check.status, check.error);

      if (check.role === 'owner') {
        return fail(res, 400, 'Sahip şirketten ayrılamaz. Önce sahipliği başka birine devret.');
      }

      await unseat(companyId, user.id);
      return json(res, 200, { ok: true });
    }

    if (body.action === 'rename') {
      const check = await guard({ user, companyId, right: 'company.manage' });
      if (check.error) return fail(res, check.status, check.error);

      const problem = validateName(body.name);
      if (problem) return fail(res, 400, problem);

      check.company.name = String(body.name).trim();
      await store.set(`co:${companyId}`, check.company);

      return json(res, 200, { ok: true, company: check.company });
    }

    if (body.action === 'invite') {
      const check = await guard({ user, companyId, right: 'member.invite' });
      if (check.error) return fail(res, check.status, check.error);

      const role = rolesFor(check.role).includes(body.role) ? body.role : 'member';
      const invite = await createInvite({ companyId, role, byUserId: user.id });

      return json(res, 201, { ok: true, invite });
    }

    if (body.action === 'revoke') {
      const check = await guard({ user, companyId, right: 'member.invite' });
      if (check.error) return fail(res, check.status, check.error);

      await dropInvite(companyId, String(body.code || '').toUpperCase());
      return json(res, 200, { ok: true });
    }

    if (body.action === 'role') {
      const check = await guard({ user, companyId, right: 'role.assign' });
      if (check.error) return fail(res, check.status, check.error);

      const target = await membership(companyId, body.userId);
      if (!target) return fail(res, 404, 'Bu kişi şirkette değil.');

      // Nobody hands out a role they do not hold, and only an owner may make
      // an owner or touch one.
      if (!rolesFor(check.role).includes(body.role)) {
        return fail(res, 403, 'Kendi seviyenin üstünde bir rol veremezsin.');
      }

      if (target.role === 'owner' && check.role !== 'owner') {
        return fail(res, 403, 'Sahibin rolünü sadece sahip değiştirebilir.');
      }

      if (body.role === 'owner') {
        if (check.role !== 'owner') return fail(res, 403, 'Sahipliği sadece sahip devredebilir.');
        await setRole(companyId, user.id, 'admin');   // the old owner steps down
      }

      const updated = await setRole(companyId, body.userId, body.role);
      return json(res, 200, { ok: true, member: updated, company: await getCompany(companyId) });
    }

    if (body.action === 'remove') {
      const check = await guard({ user, companyId, right: 'member.manage' });
      if (check.error) return fail(res, check.status, check.error);

      const target = await membership(companyId, body.userId);
      if (!target) return fail(res, 404, 'Bu kişi şirkette değil.');
      if (target.role === 'owner') return fail(res, 403, 'Şirket sahibi çıkarılamaz.');
      if (target.userId === user.id) return fail(res, 400, 'Kendini çıkaramazsın; "ayrıl" kullan.');

      await unseat(companyId, body.userId);
      return json(res, 200, { ok: true });
    }

    return fail(res, 400, 'Bilinmeyen işlem.');
  } catch (error) {
    console.error('[vlipa] company:', error);
    return fail(res, 500, 'Şirket servisi şu an cevap veremiyor.');
  }
}
