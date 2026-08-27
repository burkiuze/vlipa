/* Meetings: a room the company can walk into.

   The video itself runs on Jitsi Meet, which is free, needs no account and
   brings its own TURN servers — the part a serverless deployment cannot
   provide. What lives here is the room list: who opened it, for whom, and
   under which name, so everybody joins the same place.

   GET  ?companyId=            → the rooms
   POST { action: 'create' }   → open one
   POST { action: 'close' }    → close one */

import crypto from 'node:crypto';
import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { fail, json, methodGuard, parseCookies, readBody } from './_lib/http.js';
import { can, guard } from './_lib/org.js';
import * as store from './_lib/store.js';

const MAX_ROOMS = 40;

async function listMeetings(companyId) {
  const ids = await store.members(`co-meetings:${companyId}`);
  if (!ids.length) return [];

  const found = await store.getMany(ids.map((id) => `meeting:${id}`));
  const out = [];

  for (const id of ids) {
    const meeting = found.get(`meeting:${id}`);
    if (meeting) out.push(meeting);
    else store.removeFrom(`co-meetings:${companyId}`, id).catch(() => {});
  }

  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Sign in first.');

  try {
    if (req.method === 'GET') {
      const check = await guard({ user, companyId: req.query?.companyId });
      if (check.error) return fail(res, check.status, check.error);

      return json(res, 200, {
        ok: true,
        meetings: await listMeetings(check.company.id),
        host: process.env.MEET_HOST || 'meet.jit.si',
      });
    }

    const body = await readBody(req);
    const check = await guard({ user, companyId: body.companyId, right: 'meeting.manage' });
    if (check.error) return fail(res, check.status, check.error);

    if (body.action === 'create') {
      const ids = await store.members(`co-meetings:${check.company.id}`);
      if (ids.length >= MAX_ROOMS) return fail(res, 429, `A company can hold at most ${MAX_ROOMS} rooms.`);

      // A guessable room name is an open door: the random tail is the lock.
      const meeting = {
        id: crypto.randomUUID(),
        companyId: check.company.id,
        title: String(body.title || 'Meeting').slice(0, 80),
        room: `vlipa-${check.company.slug}-${crypto.randomBytes(5).toString('hex')}`,
        createdBy: user.id,
        createdByName: user.name || user.email,
        createdAt: new Date().toISOString(),
      };

      await store.set(`meeting:${meeting.id}`, meeting);
      await store.addTo(`co-meetings:${check.company.id}`, meeting.id);

      return json(res, 201, { ok: true, meeting, host: process.env.MEET_HOST || 'meet.jit.si' });
    }

    if (body.action === 'close') {
      const meeting = await store.get(`meeting:${body.id}`);
      if (!meeting || meeting.companyId !== check.company.id) return fail(res, 404, 'Room not found.');

      const mine = meeting.createdBy === user.id;
      if (!mine && !can(check.role, 'company.manage')) {
        return fail(res, 403, 'Only whoever opened this room, or an admin, can close it.');
      }

      await store.del(`meeting:${meeting.id}`);
      await store.removeFrom(`co-meetings:${check.company.id}`, meeting.id);

      return json(res, 200, { ok: true });
    }

    return fail(res, 400, 'Unknown action.');
  } catch (error) {
    console.error('[vlipa] meetings:', error);
    return fail(res, 500, 'The meeting service is not answering right now.');
  }
}
