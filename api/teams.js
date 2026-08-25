/* AI teams.

   A team is a handful of roles, each one bound to the vlipa model that suits
   that role. The visitor writes a goal and the team answers in turn. */

import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { fail, json, methodGuard, parseCookies, readBody } from './_lib/http.js';
import { resolve } from './_lib/models.js';
import { chat } from './_lib/openrouter.js';
import * as store from './_lib/store.js';

const MAX_TEAMS = 12;

export const ROLE_LIBRARY = [
  { id: 'lead', title: 'Project lead', alias: 'vlipa-think',
    brief: 'Breaks the goal into steps, names the risks and says what to do first.' },
  { id: 'designer', title: 'Designer', alias: 'vlipa-write',
    brief: 'Decides the look: layout, palette, type and what each screen shows.' },
  { id: 'engineer', title: 'Engineer', alias: 'vlipa-code',
    brief: 'Writes the code and explains the parts that need a decision.' },
  { id: 'builder', title: 'Site builder', alias: 'vlipa-build',
    brief: 'Turns the plan into pages and sections.' },
  { id: 'writer', title: 'Copywriter', alias: 'vlipa-write',
    brief: 'Writes the words a customer reads: headlines, product text, emails.' },
  { id: 'analyst', title: 'Analyst', alias: 'vlipa-think',
    brief: 'Checks the numbers, compares options and argues for one.' },
];

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST', 'DELETE'])) return;

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Sign in to use the studio.');

  const own = `teams:${user.id}`;

  try {
    if (req.method === 'GET') {
      const ids = await store.members(own);
      const teams = [];

      for (const id of ids) {
        const team = await store.get(`team:${id}`);
        if (team && team.ownerId === user.id) teams.push(team);
      }

      return json(res, 200, { ok: true, teams, library: ROLE_LIBRARY });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '');
      const team = await store.get(`team:${id}`);
      if (!team || team.ownerId !== user.id) return fail(res, 404, 'No such team.');

      await store.del(`team:${id}`);
      await store.removeFrom(own, id);
      return json(res, 200, { ok: true });
    }

    const body = await readBody(req);

    /* ---- run the team on a goal ---- */
    if (body.action === 'run') {
      const team = await store.get(`team:${body.id}`);
      if (!team || team.ownerId !== user.id) return fail(res, 404, 'No such team.');

      const goal = String(body.goal || '').trim().slice(0, 2000);
      if (goal.length < 5) return fail(res, 400, 'Give the team something to work on.');

      const answers = [];
      let context = `Goal: ${goal}`;

      for (const member of team.roles.slice(0, 4)) {
        const { role, model } = await resolve(member.alias);

        const system = `You are the ${member.title} on a small team. ${member.brief} ` +
          'Answer in the language of the goal. Keep it under 200 words, concrete, no preamble. ' +
          'Build on what your colleagues already said instead of repeating it.';

        const answer = await chat({
          model: model.id,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: context },
          ],
          temperature: 0.7,
          maxTokens: 700,
        });

        answers.push({ role: member.title, alias: member.alias, model: role.title, text: answer.text });
        context += `\n\n${member.title} said: ${answer.text}`;
      }

      return json(res, 200, { ok: true, answers });
    }

    /* ---- create or update ---- */
    const name = String(body.name || '').trim().slice(0, 60);
    const roleIds = Array.isArray(body.roles) ? body.roles.slice(0, 4) : [];
    if (!name) return fail(res, 400, 'Give the team a name.');
    if (!roleIds.length) return fail(res, 400, 'Pick at least one role.');

    const ids = await store.members(own);
    const existing = body.id ? await store.get(`team:${body.id}`) : null;
    if (existing && existing.ownerId !== user.id) return fail(res, 403, 'That team belongs to someone else.');
    if (!existing && ids.length >= MAX_TEAMS) return fail(res, 429, `You can keep ${MAX_TEAMS} teams at a time.`);

    const team = {
      id: existing ? existing.id : (globalThis.crypto?.randomUUID?.() || `t${Date.now()}`),
      ownerId: user.id,
      name,
      goal: String(body.goal || '').slice(0, 400),
      roles: roleIds
        .map((id) => ROLE_LIBRARY.find((role) => role.id === id))
        .filter(Boolean),
      updatedAt: new Date().toISOString(),
    };

    await store.set(`team:${team.id}`, team);
    await store.addTo(own, team.id);

    json(res, 200, { ok: true, team });
  } catch (error) {
    console.error('teams', error);
    fail(res, error.status || 500, error.message || 'The team service had a problem.');
  }
}
