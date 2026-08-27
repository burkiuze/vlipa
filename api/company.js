/* Companies and the people in them.

   GET                          → my companies, and the one I am looking at
   POST { action: 'create' }    → open a company (the caller becomes its owner)
   POST { action: 'rename' }    → rename it
   POST { action: 'invite' }    → make an invitation code
   POST { action: 'join' }      → redeem one
   POST { action: 'role' }      → change somebody's role
   POST { action: 'departments'} → set the company's list of departments
   POST { action: 'department' } → put somebody in one
   POST { action: 'remove' }    → take somebody out
   POST { action: 'leave' }     → take myself out
   DELETE ?id=                  → close the company down */

import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { fail, json, methodGuard, parseCookies, readBody } from './_lib/http.js';
import {
  ROLES, changeSlug, cleanDepartments, companiesOf, createCompany, createInvite, dropInvite,
  getCompany, guard, invitesOf, membersOf, membership, redeemInvite, rolesFor, setDepartment,
  setRole, unseat, validateName,
} from './_lib/org.js';
import * as store from './_lib/store.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST', 'DELETE'])) return;

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Sign in first.');

  try {
    if (req.method === 'GET') {
      const wanted = req.query?.id;

      // This is the first thing the studio asks for, so none of it waits in
      // line: the list, the seat and the team are all fetched together.
      const [companies, check] = await Promise.all([
        companiesOf(user.id),
        wanted ? guard({ user, companyId: wanted }) : null,
      ]);

      if (!wanted) {
        return json(res, 200, { ok: true, companies, roles: Object.values(ROLES) });
      }

      if (check.error) return fail(res, check.status, check.error);

      const quiet = check.role === 'guest' || check.role === 'member';

      const [members, invites] = await Promise.all([
        membersOf(wanted),
        quiet ? [] : invitesOf(wanted),
      ]);

      return json(res, 200, {
        ok: true,
        companies,
        company: check.company,
        role: check.role,
        rights: rolesFor(check.role),
        members,
        invites,
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
        return fail(res, 400, 'An owner cannot leave. Hand ownership to somebody else first.');
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

    /* ---- the shared link ---- */
    if (body.action === 'link') {
      const check = await guard({ user, companyId, right: 'member.invite' });
      if (check.error) return fail(res, check.status, check.error);

      if (body.slug !== undefined) {
        const renamed = await changeSlug(check.company, body.slug);
        if (renamed.error) return fail(res, 409, renamed.error, { field: 'slug' });
      }

      if (body.open !== undefined) check.company.linkOpen = Boolean(body.open);

      if (body.role !== undefined) {
        if (!rolesFor(check.role).includes(body.role)) {
          return fail(res, 403, 'You cannot hand out a role above your own.');
        }
        check.company.linkRole = body.role;
      }

      await store.set(`co:${companyId}`, check.company);
      return json(res, 200, { ok: true, company: check.company });
    }

    /* ---- the company's departments, and who is in which ---- */
    if (body.action === 'departments') {
      const check = await guard({ user, companyId, right: 'company.manage' });
      if (check.error) return fail(res, check.status, check.error);

      check.company.departments = cleanDepartments(body.departments);
      await store.set(`co:${companyId}`, check.company);

      return json(res, 200, { ok: true, company: check.company });
    }

    if (body.action === 'department') {
      const check = await guard({ user, companyId, right: 'member.manage' });
      if (check.error) return fail(res, check.status, check.error);

      const target = await membership(companyId, body.userId);
      if (!target) return fail(res, 404, 'That person is not in this company.');

      const wanted = String(body.department || '').trim();
      const known = check.company.departments || [];

      if (wanted && !known.some((name) => name.toLowerCase() === wanted.toLowerCase())) {
        return fail(res, 400, 'There is no department by that name.');
      }

      const updated = await setDepartment(companyId, body.userId, wanted);
      return json(res, 200, { ok: true, member: updated });
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
      if (!target) return fail(res, 404, 'That person is not in this company.');

      // Nobody hands out a role they do not hold, and only an owner may make
      // an owner or touch one.
      if (!rolesFor(check.role).includes(body.role)) {
        return fail(res, 403, 'You cannot hand out a role above your own.');
      }

      if (target.role === 'owner' && check.role !== 'owner') {
        return fail(res, 403, 'Only the owner can change the owner\'s role.');
      }

      if (body.role === 'owner') {
        if (check.role !== 'owner') return fail(res, 403, 'Only the owner can hand ownership on.');
        await setRole(companyId, user.id, 'admin');   // the old owner steps down
      }

      const updated = await setRole(companyId, body.userId, body.role);
      return json(res, 200, { ok: true, member: updated, company: await getCompany(companyId) });
    }

    if (body.action === 'remove') {
      const check = await guard({ user, companyId, right: 'member.manage' });
      if (check.error) return fail(res, check.status, check.error);

      const target = await membership(companyId, body.userId);
      if (!target) return fail(res, 404, 'That person is not in this company.');
      if (target.role === 'owner') return fail(res, 403, 'The owner cannot be removed.');
      if (target.userId === user.id) return fail(res, 400, 'You cannot remove yourself — leave the company instead.');

      await unseat(companyId, body.userId);
      return json(res, 200, { ok: true });
    }

    return fail(res, 400, 'Unknown action.');
  } catch (error) {
    console.error('[vlipa] company:', error);
    return fail(res, 500, 'The company service is not answering right now.');
  }
}
