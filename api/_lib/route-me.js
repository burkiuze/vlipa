/* Vlipa on your own: what one person keeps, without a company around them.

   The business side of vlipa is built around a company — a team, roles,
   departments, work handed between people. None of that belongs to somebody
   using it alone, and making them invent a company to talk to an assistant
   was the wrong shape.

   So this holds the three things a personal account has that a browser
   cannot: the conversations, kept so they are there on the next machine; the
   skills — standing instructions you write once and switch on — and the
   handful of settings that go with them.

   POST { what: 'me' } with:
     action: 'load'                 → skills, settings, and the list of chats
     action: 'skill.save' | 'skill.drop'
     action: 'chat.save' | 'chat.open' | 'chat.drop'
     action: 'settings'             → keep the defaults
     action: 'forget'               → delete the lot */

import { SESSION_COOKIE, userFromToken } from './auth.js';
import { callerKey, fail, json, methodGuard, parseCookies, readBody, withinLimit } from './http.js';
import * as store from './store.js';

const MAX_SKILLS = 24;
const MAX_CHATS = 200;
const MAX_TURNS = 120;

const DOC = (userId) => `me:${userId}`;
const CHATS = (userId) => `me-chats:${userId}`;
const CHAT = (chatId) => `me-chat:${chatId}`;

const tidy = (value, cap) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);

/* What a personal account is, before anything has been put in it. */
const blank = () => ({
  skills: [],
  settings: { model: 'vlipa', mode: 'fast' },
});

async function docOf(userId) {
  const held = await store.get(DOC(userId));
  return { ...blank(), ...(held || {}) };
}

/* ---------- skills ---------- */

/* A skill is a standing instruction: "always answer in Turkish", "you are
   writing for a legal audience", "prefer TypeScript". It is the user's own
   words, sent with the question when it is switched on — so it is kept as
   text and never interpreted here. */
function cleanSkill(given, existing = {}) {
  const text = String(given.text ?? existing.text ?? '').trim().slice(0, 4000);
  if (!text) throw Object.assign(new Error('A skill needs something in it.'), { status: 400 });

  return {
    id: existing.id || crypto.randomUUID(),
    name: tidy(given.name ?? existing.name, 60) || 'Untitled skill',
    note: tidy(given.note ?? existing.note, 140),
    text,
    on: given.on === undefined ? existing.on !== false : Boolean(given.on),
    updatedAt: new Date().toISOString(),
  };
}

/* ---------- conversations ---------- */

/* Only the shape a conversation is allowed to be. Whatever else arrives is
   not kept: this is written to by a browser. */
function cleanChat(given, userId) {
  const messages = (Array.isArray(given.messages) ? given.messages : [])
    .slice(-MAX_TURNS)
    .filter((turn) => turn && typeof turn.content === 'string')
    .map((turn) => ({
      role: turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.content.slice(0, 8000),
    }));

  return {
    id: String(given.id || crypto.randomUUID()).slice(0, 60),
    userId,
    title: tidy(given.title, 80) || 'New chat',
    tool: given.tool === 'code' ? 'code' : 'chat',
    messages,
    updatedAt: new Date().toISOString(),
  };
}

/* The list, newest first, without the conversations themselves — opening one
   is a second request, and a hundred transcripts is not a list. */
async function chatList(userId) {
  const ids = await store.members(CHATS(userId));
  if (!ids.length) return [];

  const found = await store.getMany(ids.map((id) => CHAT(id)));
  const out = [];

  for (const id of ids) {
    const chat = found.get(CHAT(id));

    if (!chat || chat.userId !== userId) {
      store.removeFrom(CHATS(userId), id).catch(() => {});
      continue;
    }

    out.push({
      id: chat.id,
      title: chat.title,
      tool: chat.tool,
      turns: chat.messages.length,
      updatedAt: chat.updatedAt,
    });
  }

  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/* ---------- the door ---------- */

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  if (!withinLimit(`me:${callerKey(req)}`, 40)) {
    return fail(res, 429, 'Slow down a moment.');
  }

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Sign in first.');

  const body = await readBody(req);

  try {
    if (body.action === 'load') {
      const [doc, chats] = await Promise.all([docOf(user.id), chatList(user.id)]);

      return json(res, 200, {
        ok: true,
        skills: doc.skills,
        settings: doc.settings,
        chats,
        user: { id: user.id, name: user.name, email: user.email, photo: user.photo || '' },
      });
    }

    if (body.action === 'skill.save') {
      const doc = await docOf(user.id);
      const at = doc.skills.findIndex((one) => one.id === body.skill?.id);

      if (at < 0 && doc.skills.length >= MAX_SKILLS) {
        return fail(res, 429, `An account can hold ${MAX_SKILLS} skills.`);
      }

      const skill = cleanSkill(body.skill || {}, at >= 0 ? doc.skills[at] : {});

      if (at >= 0) doc.skills[at] = skill;
      else doc.skills.push(skill);

      await store.set(DOC(user.id), doc);
      return json(res, 200, { ok: true, skill, skills: doc.skills });
    }

    if (body.action === 'skill.drop') {
      const doc = await docOf(user.id);
      doc.skills = doc.skills.filter((one) => one.id !== body.id);

      await store.set(DOC(user.id), doc);
      return json(res, 200, { ok: true, skills: doc.skills });
    }

    if (body.action === 'settings') {
      const doc = await docOf(user.id);

      doc.settings = {
        model: tidy(body.settings?.model, 30) || doc.settings.model,
        mode: body.settings?.mode === 'thinking' ? 'thinking' : 'fast',
      };

      await store.set(DOC(user.id), doc);
      return json(res, 200, { ok: true, settings: doc.settings });
    }

    if (body.action === 'chat.save') {
      const ids = await store.members(CHATS(user.id));
      const chat = cleanChat(body.chat || {}, user.id);

      if (!chat.messages.length) return json(res, 200, { ok: true, chat: null });

      if (!ids.includes(chat.id) && ids.length >= MAX_CHATS) {
        // The oldest goes rather than the save failing: nobody wants to be
        // told their history is full in the middle of a sentence.
        const all = await chatList(user.id);
        const oldest = all[all.length - 1];

        if (oldest) {
          await store.del(CHAT(oldest.id));
          await store.removeFrom(CHATS(user.id), oldest.id);
        }
      }

      await store.set(CHAT(chat.id), chat);
      await store.addTo(CHATS(user.id), chat.id);

      return json(res, 200, { ok: true, chat: { id: chat.id, title: chat.title, updatedAt: chat.updatedAt } });
    }

    if (body.action === 'chat.open') {
      const chat = await store.get(CHAT(String(body.id || '')));
      if (!chat || chat.userId !== user.id) return fail(res, 404, 'That conversation is gone.');

      return json(res, 200, { ok: true, chat });
    }

    if (body.action === 'chat.drop') {
      const id = String(body.id || '');
      const chat = await store.get(CHAT(id));

      if (chat && chat.userId === user.id) await store.del(CHAT(id));
      await store.removeFrom(CHATS(user.id), id);

      return json(res, 200, { ok: true, chats: await chatList(user.id) });
    }

    /* Everything, gone. Somebody who asks for that should get it without
       having to write in and ask a person. */
    if (body.action === 'forget') {
      const ids = await store.members(CHATS(user.id));

      await Promise.all(ids.map((id) => store.del(CHAT(id))));
      await store.del(CHATS(user.id));
      await store.del(DOC(user.id));

      return json(res, 200, { ok: true });
    }

    return fail(res, 400, 'Unknown action.');
  } catch (error) {
    if (error.status) return fail(res, error.status, error.message);

    console.error('[vlipa] me:', error);
    return fail(res, 500, 'That did not save. Try it again in a moment.');
  }
}
