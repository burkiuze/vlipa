/* Vlipa inside the workspace: it draws up work, prepares it, and does it.

   POST { action: 'plan' }   → splits a goal into tasks and suggests who takes what
   POST { action: 'brief' }  → prepares one task, step by step
   POST { action: 'do' }     → produces the task's output (text, draft, list)
   POST { action: 'rows' }   → drafts rows for a table

   None of it saves itself: every answer is a proposal, and what to keep stays
   the caller's decision. */

import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { callerKey, fail, json, methodGuard, parseCookies, readBody, withinLimit } from './_lib/http.js';
import { can, guard, membersOf } from './_lib/org.js';
import { chatCompletion, hasKey } from './_lib/openrouter.js';
import * as store from './_lib/store.js';

const STATES = ['todo', 'doing', 'review', 'done'];

/* Models wrap JSON in prose and code fences often enough to plan for it. */
function parseJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');

  if (start < 0 || end < start) return null;

  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function think({ system, user, mode, wantJson = false, maxTokens }) {
  if (!hasKey()) {
    const error = new Error('Vlipa is not connected: OPENROUTER_API_KEY is not set on the server.');
    error.status = 503;
    throw error;
  }

  return chatCompletion({
    mode: mode === 'thinking' ? 'thinking' : 'fast',
    json: wantJson,
    maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Sign in first.');

  if (!withinLimit(`assist:${callerKey(req)}`, 12)) {
    return fail(res, 429, 'Slow down: 12 requests a minute.');
  }

  const body = await readBody(req);
  const check = await guard({ user, companyId: body.companyId, right: 'chat.use' });
  if (check.error) return fail(res, check.status, check.error);

  const company = check.company;
  const mode = body.mode === 'thinking' ? 'thinking' : 'fast';

  try {
    /* ---- split a goal into tasks ---- */
    if (body.action === 'plan') {
      if (!can(check.role, 'task.own')) return fail(res, 403, 'Planning work needs at least a member role.');

      const goal = String(body.goal || '').trim();
      if (goal.length < 8) return fail(res, 400, 'Hedefi biraz daha anlat.');

      const team = await membersOf(company.id);
      const roster = team
        .map((member) => `- ${member.name || member.email} (${member.role}, id: ${member.userId})`)
        .join('\n');

      const answer = await think({
        mode,
        wantJson: true,
        maxTokens: 1800,
        system: [
          'You are Vlipa, planning work inside a company workspace.',
          'Return JSON only, nothing else.',
          'Shape: {"tasks":[{"title":string,"detail":string,"assignee":string,"due":"YYYY-MM-DD","status":"todo"}]}',
          'Keep title short and in the imperative. detail is two or three sentences: what to do and what to watch for.',
          'For assignee use one of the ids listed above; leave it empty when unsure.',
          'Pick who does the work by role: admins coordinate, members carry it out.',
          'due must be a date after today, spread according to the weight of the work.',
          'Draw up between three and eight tasks. Invent no names, no figures, no customers.',
          'Write in whatever language the user wrote in.',
        ].join(' '),
        user: [
          `Company: ${company.name}`,
          `Today: ${today()}`,
          `Team:\n${roster}`,
          `Goal: ${goal}`,
        ].join('\n\n'),
      });

      const parsed = parseJson(answer);
      const ids = new Set(team.map((member) => member.userId));

      const tasks = (parsed?.tasks || []).slice(0, 8).map((task) => ({
        title: String(task.title || '').slice(0, 140),
        detail: String(task.detail || '').slice(0, 2000),
        assignee: ids.has(task.assignee) ? task.assignee : '',
        due: /^\d{4}-\d{2}-\d{2}$/.test(task.due || '') && task.due >= today() ? task.due : '',
        status: STATES.includes(task.status) ? task.status : 'todo',
      })).filter((task) => task.title);

      if (!tasks.length) return fail(res, 502, 'Vlipa could not turn that into tasks. Say it a little more concretely.');

      return json(res, 200, { ok: true, tasks });
    }

    /* ---- prepare or do one task ---- */
    if (body.action === 'brief' || body.action === 'do') {
      const task = await store.get(`task:${body.taskId}`);
      if (!task || task.companyId !== company.id) return fail(res, 404, 'Task not found.');

      const brief = body.action === 'brief';

      const answer = await think({
        mode,
        maxTokens: brief ? 900 : 1600,
        system: brief
          ? [
              'You are Vlipa. You are making a task doable.',
              'Write a short preparation: the aim in one sentence, then the steps in order,',
              'then at most three warnings under a "watch out" heading. No markdown headings —',
              'plain text with dashes for bullets. Add nothing you do not know.',
              'Write in the language the task was written in.',
            ].join(' ')
          : [
              'You are Vlipa. You are doing this task, not explaining how it would be done.',
              'Produce the thing asked for: the text, the list, the draft — whatever it is.',
              'No preamble, no "here you go", no commentary around it.',
              'Where a fact is needed that you do not have, leave a gap in brackets: [date], [price].',
              'Write in the language the task was written in.',
            ].join(' '),
        user: [
          `Company: ${company.name}`,
          `Task: ${task.title}`,
          task.detail ? `Details: ${task.detail}` : '',
          task.due ? `Due: ${task.due}` : '',
          body.ask ? `Also: ${String(body.ask).slice(0, 500)}` : '',
        ].filter(Boolean).join('\n'),
      });

      const text = String(answer || '').trim();
      if (!text) return fail(res, 502, 'Vlipa came back with nothing.');

      return json(res, 200, { ok: true, text, taskId: task.id, kind: body.action });
    }

    /* ---- draft rows for a table ---- */
    if (body.action === 'rows') {
      if (!can(check.role, 'row.write')) return fail(res, 403, 'You are not allowed to write rows.');

      const table = await store.get(`table:${body.tableId}`);
      if (!table || table.companyId !== company.id) return fail(res, 404, 'Table not found.');

      const ask = String(body.ask || '').trim();
      if (ask.length < 4) return fail(res, 400, 'Say what kind of rows you want.');

      const columns = table.columns
        .map((column) => `- ${column.key} (${column.label}, ${column.type})`)
        .join('\n');

      const answer = await think({
        mode,
        wantJson: true,
        maxTokens: 1600,
        system: [
          'You are Vlipa, drafting rows for a table.',
          'Return JSON only: {"rows":[{"<column key>": "value"}]}',
          'Use only the column keys given. Numbers in number columns.',
          'Dates as YYYY-MM-DD. At most ten rows.',
          'Produce what was asked for rather than realistic-looking invented records;',
          'leave blank anything you do not know.',
        ].join(' '),
        user: [`Table: ${table.name}`, `Columns:\n${columns}`, `Wanted: ${ask}`].join('\n\n'),
      });

      const parsed = parseJson(answer);
      const keys = table.columns.map((column) => column.key);

      const rows = (parsed?.rows || []).slice(0, 10).map((row) => {
        const clean = {};
        for (const key of keys) clean[key] = row?.[key] === undefined ? '' : String(row[key]).slice(0, 500);
        return clean;
      }).filter((row) => Object.values(row).some(Boolean));

      if (!rows.length) return fail(res, 502, 'Vlipa could not draft any rows. Say what you want a little more clearly.');

      return json(res, 200, { ok: true, rows, columns: table.columns });
    }

    return fail(res, 400, 'Unknown action.');
  } catch (error) {
    console.error('[vlipa] assist:', error.detail || error);

    return fail(res, error.status || 500, error.message || 'Vlipa cannot help right now.', {
      reason: error.reason || '',
      tried: error.tried || [],
    });
  }
}
