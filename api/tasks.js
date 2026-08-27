/* Tasks: who is doing what, and where it stands.

   GET  ?companyId=            → the company's tasks
   POST { action: 'create' }   → open one, optionally assigned to somebody
   POST { action: 'update' }   → change it (own tasks need no manage right)
   POST { action: 'delete' }   → drop it */

import crypto from 'node:crypto';
import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { fail, json, methodGuard, parseCookies, readBody } from './_lib/http.js';
import { siteOrigin } from './_lib/google.js';
import { taskAssigned } from './_lib/mail.js';
import { can, guard, membership } from './_lib/org.js';
import * as store from './_lib/store.js';

const STATES = ['todo', 'doing', 'review', 'done'];
const MAX_TASKS = 500;

function clean(task) {
  return {
    ...task,
    title: String(task.title || '').slice(0, 140),
    detail: String(task.detail || '').slice(0, 2000),
    status: STATES.includes(task.status) ? task.status : 'todo',
    due: /^\d{4}-\d{2}-\d{2}$/.test(task.due || '') ? task.due : '',
    output: String(task.output || '').slice(0, 8000),
    department: String(task.department || '').slice(0, 40),
  };
}

/* Whoever the work landed on hears about it, unless they gave it to
   themselves. Mail never blocks the answer: the task exists either way. */
async function tellAssignee({ task, company, actor, req }) {
  if (!task.assignee || task.assignee === actor.id) return;

  try {
    const seat = await membership(company.id, task.assignee);
    if (!seat?.email) return;

    const origin = siteOrigin(req);

    await taskAssigned({
      to: seat.email,
      name: seat.name,
      task,
      company,
      byName: actor.name || actor.email,
      url: `${origin}/studio#/tasks`,
    });
  } catch (error) {
    console.warn('[vlipa] assignment mail:', error.message);
  }
}

async function listTasks(companyId) {
  const ids = await store.members(`co-tasks:${companyId}`);
  if (!ids.length) return [];

  const found = await store.getMany(ids.map((id) => `task:${id}`));
  const out = [];

  for (const id of ids) {
    const task = found.get(`task:${id}`);
    if (task) out.push(task);
    else store.removeFrom(`co-tasks:${companyId}`, id).catch(() => {});
  }

  const order = { todo: 0, doing: 1, review: 2, done: 3 };
  return out.sort((a, b) => order[a.status] - order[b.status] ||
    String(a.due || '9999').localeCompare(String(b.due || '9999')) ||
    String(b.createdAt).localeCompare(String(a.createdAt)));
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Sign in first.');

  try {
    if (req.method === 'GET') {
      const check = await guard({ user, companyId: req.query?.companyId });
      if (check.error) return fail(res, check.status, check.error);

      return json(res, 200, { ok: true, tasks: await listTasks(check.company.id), states: STATES });
    }

    const body = await readBody(req);
    const check = await guard({ user, companyId: body.companyId });
    if (check.error) return fail(res, check.status, check.error);

    const mayManage = can(check.role, 'task.manage');
    const mayOwn = can(check.role, 'task.own');

    /* The tasks Vlipa drew up are created in one go. */
    if (body.action === 'bulk') {
      if (!mayOwn) return fail(res, 403, 'You are not allowed to create tasks.');

      const wanted = Array.isArray(body.tasks) ? body.tasks.slice(0, 12) : [];
      if (!wanted.length) return fail(res, 400, 'There are no tasks to create.');

      const ids = await store.members(`co-tasks:${check.company.id}`);
      if (ids.length + wanted.length > MAX_TASKS) {
        return fail(res, 429, `A company can hold at most ${MAX_TASKS} tasks.`);
      }

      const made = [];

      for (const item of wanted) {
        if (!String(item.title || '').trim()) continue;

        let assignee = item.assignee || user.id;

        // Handing work to somebody else is still a manager's job, even when
        // the suggestion came from Vlipa.
        if (assignee !== user.id && !mayManage) assignee = user.id;
        if (assignee && !(await membership(check.company.id, assignee))) assignee = user.id;

        const task = clean({
          id: crypto.randomUUID(),
          companyId: check.company.id,
          title: item.title,
          detail: item.detail,
          status: item.status,
          due: item.due,
          department: item.department,
          assignee,
          createdBy: user.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        await store.set(`task:${task.id}`, task);
        await store.addTo(`co-tasks:${check.company.id}`, task.id);
        made.push(task);
      }

      if (!made.length) return fail(res, 400, 'Not one of them could be created.');

      for (const task of made) await tellAssignee({ task, company: check.company, actor: user, req });

      return json(res, 201, { ok: true, tasks: made });
    }

    if (body.action === 'create') {
      if (!mayOwn) return fail(res, 403, 'You are not allowed to create tasks.');
      if (!String(body.title || '').trim()) return fail(res, 400, 'A task needs a title.');

      const ids = await store.members(`co-tasks:${check.company.id}`);
      if (ids.length >= MAX_TASKS) return fail(res, 429, `A company can hold at most ${MAX_TASKS} tasks.`);

      // Handing work to somebody else is a manager's job; a member opens their own.
      let assignee = body.assignee || user.id;
      if (assignee !== user.id && !mayManage) {
        return fail(res, 403, 'Assigning work to somebody else is an admin job.');
      }

      if (assignee && !(await membership(check.company.id, assignee))) {
        return fail(res, 400, 'That person is not in this company.');
      }

      const task = clean({
        id: crypto.randomUUID(),
        companyId: check.company.id,
        title: body.title,
        detail: body.detail,
        status: body.status,
        due: body.due,
        department: body.department,
        assignee,
        createdBy: user.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await store.set(`task:${task.id}`, task);
      await store.addTo(`co-tasks:${check.company.id}`, task.id);
      await tellAssignee({ task, company: check.company, actor: user, req });

      return json(res, 201, { ok: true, task });
    }

    const task = await store.get(`task:${body.id}`);
    if (!task || task.companyId !== check.company.id) return fail(res, 404, 'Task not found.');

    const mine = task.assignee === user.id || task.createdBy === user.id;
    if (!mayManage && !(mayOwn && mine)) {
      return fail(res, 403, 'This task is not yours; changing it is an admin job.');
    }

    if (body.action === 'delete') {
      await store.del(`task:${task.id}`);
      await store.removeFrom(`co-tasks:${check.company.id}`, task.id);
      return json(res, 200, { ok: true });
    }

    if (body.action === 'update') {
      if (body.assignee !== undefined && body.assignee !== task.assignee && !mayManage) {
        return fail(res, 403, 'Handing a task to somebody else is an admin job.');
      }

      if (body.assignee && !(await membership(check.company.id, body.assignee))) {
        return fail(res, 400, 'That person is not in this company.');
      }

      const updated = clean({
        ...task,
        title: body.title ?? task.title,
        detail: body.detail ?? task.detail,
        status: body.status ?? task.status,
        due: body.due ?? task.due,
        assignee: body.assignee ?? task.assignee,
        department: body.department ?? task.department,
        output: body.output ?? task.output,
        updatedAt: new Date().toISOString(),
      });

      await store.set(`task:${task.id}`, updated);

      // Only a change of hands is worth an email.
      if (updated.assignee && updated.assignee !== task.assignee) {
        await tellAssignee({ task: updated, company: check.company, actor: user, req });
      }

      return json(res, 200, { ok: true, task: updated });
    }

    return fail(res, 400, 'Unknown action.');
  } catch (error) {
    console.error('[vlipa] tasks:', error);
    return fail(res, 500, 'The task service is not answering right now.');
  }
}
