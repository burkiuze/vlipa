/* Groups: the company's conversations.

   Every group has a conversation. Messages sit in an ordered list; the browser
   asks for the latest ones every few seconds. One group — the company's own
   General — is open to everybody in the company whatever their role.

   GET  ?companyId= [&id=]        → the groups, and one group's messages
   POST { action: 'create' }      → open a group
   POST { action: 'rename' }      → rename it
   POST { action: 'drop' }        → delete it
   POST { action: 'post' }        → write a message
   POST { action: 'clear' }       → wipe its messages */

import crypto from 'node:crypto';
import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { callerKey, fail, json, methodGuard, parseCookies, readBody, withinLimit } from './_lib/http.js';
import { can, createGroup, dropGroup, groupsOf, guard, openToEveryone } from './_lib/org.js';
import * as store from './_lib/store.js';

const MAX_GROUPS = 20;
const KEEP = 400;      // how much of a conversation is kept

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Sign in first.');

  try {
    if (req.method === 'GET') {
      const check = await guard({ user, companyId: req.query?.companyId });
      if (check.error) return fail(res, check.status, check.error);

      const groups = await groupsOf(check.company.id);
      const wanted = req.query?.id;
      const host = process.env.MEET_HOST || 'meet.jit.si';

      if (!wanted) return json(res, 200, { ok: true, groups, host });

      const group = groups.find((item) => item.id === wanted);
      if (!group) return fail(res, 404, 'Group not found.');

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
        return fail(res, 403, 'Managing groups is an admin job.');
      }
    }

    if (body.action === 'create') {
      const groups = await groupsOf(check.company.id);
      if (groups.length >= MAX_GROUPS) return fail(res, 429, `A company can hold at most ${MAX_GROUPS} groups.`);

      const group = await createGroup({ companyId: check.company.id, name: body.name, byUserId: user.id });
      return json(res, 201, { ok: true, group });
    }

    const group = await store.get(`group:${body.groupId || body.id}`);
    if (!group || group.companyId !== check.company.id) return fail(res, 404, 'Group not found.');

    // The company's common room takes anybody who is in the company; every
    // other group goes by the role.
    if (body.action === 'post' && !openToEveryone(group) && !can(check.role, 'group.post')) {
      return fail(res, 403, 'Your role cannot write in this group.');
    }

    if (body.action === 'rename') {
      group.name = String(body.name || group.name).trim().slice(0, 40);
      await store.set(`group:${group.id}`, group);
      return json(res, 200, { ok: true, group });
    }

    if (body.action === 'drop') {
      // The room everybody shares is not one person's to close.
      if (openToEveryone(group)) return fail(res, 400, 'The group everybody is in cannot be deleted.');

      await dropGroup(check.company.id, group.id);
      return json(res, 200, { ok: true });
    }

    if (body.action === 'clear') {
      await store.dropList(`group-msgs:${group.id}`);
      return json(res, 200, { ok: true });
    }

    if (body.action === 'post') {
      if (!withinLimit(`msg:${callerKey(req)}`, 30)) {
        return fail(res, 429, 'Slow down: 30 messages a minute.');
      }

      const text = String(body.text || '').trim();
      if (!text) return fail(res, 400, 'An empty message goes nowhere.');
      if (text.length > 2000) return fail(res, 413, 'That message is too long.');

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

    return fail(res, 400, 'Unknown action.');
  } catch (error) {
    console.error('[vlipa] groups:', error);
    return fail(res, 500, 'The group service is not answering right now.');
  }
}
