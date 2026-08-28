/* Meetings: a room the company can walk into.

   The video is ours. Browsers already carry everything a call needs —
   getUserMedia for the camera, RTCPeerConnection for the link, and the codecs
   in between — so what a meeting actually needs from a server is not media
   but introductions: a way for two people in the same room to swap the
   handful of messages that let them find each other.

   That is what lives here. Each person in a room has a seat and a mailbox;
   they post offers, answers and network candidates addressed to each other,
   and read what has been left for them. The audio and video never touch this
   server — once the introduction is made the browsers talk directly.

   Serverless cannot hold a socket open, so the mailboxes are polled rather
   than pushed. That costs a second on the way in and nothing at all after,
   because the media does not come this way.

   GET  ?companyId=            → the rooms
   POST { action: 'create' }   → open one
   POST { action: 'close' }    → close one
   POST { action: 'join' }     → take a seat, and see who is already there
   POST { action: 'poll' }     → read my mailbox, and who is there now
   POST { action: 'signal' }   → leave a message for one of them
   POST { action: 'leave' }    → give up the seat */

import crypto from 'node:crypto';
import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { fail, json, methodGuard, parseCookies, readBody } from './_lib/http.js';
import { can, guard, membership } from './_lib/org.js';
import * as store from './_lib/store.js';

const MAX_ROOMS = 40;

/* Every person in a call sends their picture to every other person, so the
   number of streams goes up with the square of the room. Six is where an
   ordinary laptop and an ordinary upstream give out; past that a meeting
   needs a media server, which is a different thing entirely. */
const MAX_IN_ROOM = 6;

/* A seat is held by saying so. Somebody whose laptop shut mid-call stops
   saying so, and their seat goes. */
const SEAT_SECONDS = 45;

/* Where the browsers should look to find each other.

   STUN is a question and an answer — "what does my address look like from out
   there?" — and public ones are free and stateless, so the deployment needs
   nothing of its own for the ordinary case: two people on ordinary
   connections link up directly and the media never comes near this server.

   The awkward case is a network that will not let anything in at all, and
   the only cure for that is a relay, which is a real server that carries the
   video. There is no free one worth trusting with a company's calls, so
   TURN_URL / TURN_USER / TURN_PASS are read if they are set and simply not
   used if they are not. Without one, a few people on strict corporate or
   carrier networks will not connect — and the room says so rather than
   spinning. */
function iceServers() {
  const servers = [{
    urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',').map((one) => one.trim()).filter(Boolean),
  }];

  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL.split(',').map((one) => one.trim()).filter(Boolean),
      username: process.env.TURN_USER || undefined,
      credential: process.env.TURN_PASS || undefined,
    });
  }

  return servers;
}

const seatKey = (meetingId, peerId) => `meet-seat:${meetingId}:${peerId}`;
const boxKey = (meetingId, peerId) => `meet-box:${meetingId}:${peerId}`;
const roomKey = (meetingId) => `meet-room:${meetingId}`;

/* Who is in the room right now. Anybody whose seat has gone cold is dropped
   on the way past, which is the only tidying this needs. */
async function roomRoster(meetingId, exceptPeerId = '') {
  const ids = await store.members(roomKey(meetingId));
  if (!ids.length) return [];

  const found = await store.getMany(ids.map((id) => seatKey(meetingId, id)));
  const cutoff = Date.now() - SEAT_SECONDS * 1000;
  const out = [];

  for (const id of ids) {
    const seat = found.get(seatKey(meetingId, id));

    if (!seat || seat.at < cutoff) {
      store.removeFrom(roomKey(meetingId), id).catch(() => {});
      store.dropList(boxKey(meetingId, id)).catch(() => {});
      continue;
    }

    if (id !== exceptPeerId) out.push({ peerId: seat.peerId, userId: seat.userId, name: seat.name, photo: seat.photo });
  }

  return out;
}

/* Only somebody holding a seat in this room may post into it. */
async function seatOf(meetingId, peerId) {
  const seat = await store.get(seatKey(meetingId, peerId));
  if (!seat || seat.meetingId !== meetingId) return null;
  return seat;
}

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
        ice: iceServers(),
        room: MAX_IN_ROOM,
      });
    }

    const body = await readBody(req);

    /* ---- being in a call ---- */

    /* Walking into a room is not managing one: anybody in the company may. */
    if (['join', 'poll', 'signal', 'leave'].includes(body.action)) {
      const seatCheck = await guard({ user, companyId: body.companyId });
      if (seatCheck.error) return fail(res, seatCheck.status, seatCheck.error);

      const meeting = await store.get(`meeting:${body.meetingId}`);
      if (!meeting || meeting.companyId !== seatCheck.company.id) return fail(res, 404, 'Room not found.');

      const peerId = String(body.peerId || '').slice(0, 40);

      if (body.action === 'join') {
        const already = await roomRoster(meeting.id);

        // Somebody rejoining takes their old seat back rather than a second one.
        if (already.length >= MAX_IN_ROOM && !already.some((one) => one.peerId === peerId)) {
          return fail(res, 429, `This room holds ${MAX_IN_ROOM} people at once.`);
        }

        const mine = peerId || crypto.randomUUID();
        const seat = await membership(seatCheck.company.id, user.id);

        await store.set(seatKey(meeting.id, mine), {
          meetingId: meeting.id,
          peerId: mine,
          userId: user.id,
          name: user.name || user.email,
          photo: seat?.photo || '',
          at: Date.now(),
        }, SEAT_SECONDS * 2);

        await store.addTo(roomKey(meeting.id), mine);

        return json(res, 200, { ok: true, peerId: mine, peers: await roomRoster(meeting.id, mine) });
      }

      const held = await seatOf(meeting.id, peerId);
      if (!held || held.userId !== user.id) return fail(res, 409, 'That seat is not yours. Rejoin the room.');

      if (body.action === 'leave') {
        await store.removeFrom(roomKey(meeting.id), peerId);
        await store.del(seatKey(meeting.id, peerId));
        await store.dropList(boxKey(meeting.id, peerId));

        return json(res, 200, { ok: true });
      }

      if (body.action === 'signal') {
        const to = String(body.to || '').slice(0, 40);
        if (!(await seatOf(meeting.id, to))) return fail(res, 404, 'That person has left the room.');

        // An offer is a few kilobytes of SDP; anything much larger is not one.
        const said = JSON.stringify(body.data ?? null);
        if (said.length > 24000) return fail(res, 413, 'That message is too large for a signal.');

        await store.push(boxKey(meeting.id, to), {
          from: peerId,
          kind: String(body.kind || '').slice(0, 20),
          data: body.data ?? null,
          at: Date.now(),
        }, 400);

        return json(res, 200, { ok: true });
      }

      // poll: what has been left for me, and who is in the room now. The
      // mailbox is read and emptied in one go — there is nowhere to keep a
      // cursor between two serverless invocations that would be any safer.
      held.at = Date.now();
      await store.set(seatKey(meeting.id, peerId), held, SEAT_SECONDS * 2);

      const waiting = await store.range(boxKey(meeting.id, peerId), 0, -1);
      if (waiting.length) await store.dropList(boxKey(meeting.id, peerId));

      return json(res, 200, {
        ok: true,
        messages: waiting,
        peers: await roomRoster(meeting.id, peerId),
      });
    }

    /* ---- opening and closing rooms ---- */

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

      return json(res, 201, { ok: true, meeting });
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
