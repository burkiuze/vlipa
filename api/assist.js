/* Vlipa inside the workspace: it draws up work, prepares it, and does it.

   POST { action: 'plan' }   → splits a goal into tasks and suggests who takes what
   POST { action: 'brief' }  → prepares one task, step by step
   POST { action: 'do' }     → produces the task's output (text, draft, list)
   POST { action: 'rows' }   → drafts rows for a table
   POST { action: 'write' }  → writes or reworks a document (Vlipa Write)
   POST { action: 'report' } → a report over the company's own tasks

   None of it saves itself: every answer is a proposal, and what to keep stays
   the caller's decision. */

import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { callerKey, fail, json, methodGuard, parseCookies, readBody, withinLimit } from './_lib/http.js';
import { can, guard, membersOf } from './_lib/org.js';
import { alsoTry, chatCompletion, hasKey, modelForPick } from './_lib/openrouter.js';
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

async function think({ system, user, mode, wantJson = false, maxTokens, model, spares = [] }) {
  if (!hasKey()) {
    const error = new Error('Vlipa is not connected: OPENROUTER_API_KEY is not set on the server.');
    error.status = 503;
    throw error;
  }

  return chatCompletion({
    mode: mode === 'thinking' ? 'thinking' : 'fast',
    json: wantJson,
    maxTokens,
    model,
    spares,
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
      const departments = company.departments || [];

      const roster = team
        .map((member) => `- ${member.name || member.email} (${member.role}${member.department ? `, ${member.department}` : ', no department'}, id: ${member.userId})`)
        .join('\n');

      const answer = await think({
        mode,
        wantJson: true,
        maxTokens: 1800,
        system: [
          'You are Vlipa, planning work inside a company workspace.',
          'Return JSON only, nothing else.',
          'Shape: {"tasks":[{"title":string,"detail":string,"department":string,"assignee":string,"due":"YYYY-MM-DD","status":"todo"}]}',
          'Keep title short and in the imperative. detail is two or three sentences: what to do and what to watch for.',
          'Split the goal along the departments listed below and put each task in the one that owns that kind of work:',
          'the announcement, the press and the customer-facing writing go to public relations; the building, the data and the integrations go to software; the look of it goes to design; the pricing and the customers go to sales; the day-to-day running goes to operations.',
          'Write department exactly as it is spelled in the list. Use no department that is not on it.',
          'For assignee use one of the ids listed above, preferring somebody already in that department; leave it empty when nobody fits.',
          'Cover every department the goal actually touches rather than piling the work on one.',
          'due must be a date after today, spread according to the weight of the work.',
          'Draw up between three and eight tasks. Invent no names, no figures, no customers.',
          'Write in whatever language the user wrote in.',
        ].join(' '),
        user: [
          `Company: ${company.name}`,
          `Today: ${today()}`,
          `Departments: ${departments.length ? departments.join(', ') : 'none defined — leave department empty'}`,
          `Team:\n${roster}`,
          `Goal: ${goal}`,
        ].join('\n\n'),
      });

      const parsed = parseJson(answer);
      const ids = new Set(team.map((member) => member.userId));

      // A department only counts when the company actually has one by that
      // name, and a suggested owner only when they are really in the team.
      const known = new Map((company.departments || []).map((name) => [name.toLowerCase(), name]));

      const tasks = (parsed?.tasks || []).slice(0, 8).map((task) => ({
        title: String(task.title || '').slice(0, 140),
        detail: String(task.detail || '').slice(0, 2000),
        department: known.get(String(task.department || '').trim().toLowerCase()) || '',
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

    /* ---- write a document ---- */
    if (body.action === 'write') {
      const kinds = {
        draft:    'Write the piece the instruction asks for, from nothing.',
        continue: 'Continue the document from exactly where it stops. Do not repeat what is already there.',
        improve:  'Rewrite the document so it reads better: same facts, same claims, clearer sentences.',
        outline:  'Turn the instruction into an outline: headings and one line under each.',
        shorten:  'Cut the document down while keeping every fact and conclusion.',
      };

      const kind = kinds[body.kind] ? body.kind : 'draft';
      const ask = String(body.ask || '').trim();
      const document = String(body.document || '').slice(0, 12000);

      if (!ask && !document) return fail(res, 400, 'Say what to write, or put something in the document first.');

      // Sources are whatever the person put in the panel. The model has no way
      // to look anything up, so inventing a citation is the one thing it must
      // never do.
      const sources = (Array.isArray(body.sources) ? body.sources : [])
        .slice(0, 20)
        .map((source, index) => `[${index + 1}] ${String(source.title || 'Untitled').slice(0, 200)}${source.url ? ` — ${String(source.url).slice(0, 300)}` : ''}${source.note ? ` — ${String(source.note).slice(0, 400)}` : ''}`)
        .join('\n');

      const answer = await think({
        mode,
        model: modelForPick('write', body.model),
        spares: alsoTry('write', body.model),
        maxTokens: 2200,
        system: [
          'You are Vlipa Write, drafting a document inside a company workspace.',
          kinds[kind],
          'Write plain prose with short paragraphs. Headings as a line of their own, no markdown symbols, no bold markers.',
          'You cannot browse and you cannot look anything up.',
          'Cite only the sources listed below, as [1], [2] and so on, and only where they actually support the sentence.',
          'Never invent a source, an author, a title, a date, a journal, a link or a quotation.',
          'Where a fact or a citation is needed that you do not have, write [source needed] and carry on.',
          'Where a figure is needed that you were not given, write [figure] rather than a number you made up.',
          'Write in whatever language the instruction was written in.',
        ].join(' '),
        user: [
          `Company: ${company.name}`,
          `Today: ${today()}`,
          sources ? `Sources you may cite:\n${sources}` : 'Sources you may cite: none were given, so cite nothing.',
          document ? `The document so far:\n${document}` : '',
          ask ? `Instruction: ${ask}` : '',
        ].filter(Boolean).join('\n\n'),
      });

      const text = String(answer || '').trim();
      if (!text) return fail(res, 502, 'Vlipa came back with nothing.');

      return json(res, 200, { ok: true, text, kind });
    }

    /* ---- a report over the company's own work ---- */
    if (body.action === 'report') {
      const wanted = Array.isArray(body.taskIds) ? new Set(body.taskIds.map(String)) : null;
      const [ids, team] = await Promise.all([
        store.members(`co-tasks:${company.id}`),
        membersOf(company.id),
      ]);

      const names = new Map(team.map((member) => [member.userId, member.name || member.email]));
      const found = await store.getMany(ids.map((id) => `task:${id}`));

      const tasks = ids.map((id) => found.get(`task:${id}`))
        .filter(Boolean)
        .filter((task) => !wanted || wanted.has(String(task.id)))
        .slice(0, 200);

      if (!tasks.length) return fail(res, 400, 'There is no work to report on yet.');

      const line = (task) => [
        `- ${task.title}`,
        `status: ${task.status || 'todo'}`,
        task.assignee ? `with: ${names.get(task.assignee) || 'someone who has left'}` : 'nobody assigned',
        task.department ? `department: ${task.department}` : '',
        task.due ? `due: ${task.due}` : '',
        task.output ? `produced: ${String(task.output).slice(0, 400)}` : '',
      ].filter(Boolean).join(' · ');

      const answer = await think({
        mode,
        model: modelForPick('write', body.model),
        spares: alsoTry('write', body.model),
        maxTokens: 1800,
        system: [
          'You are Vlipa Write, writing a status report for the people who run this company.',
          'Use only the work listed below. Every sentence must be traceable to a line in it.',
          'Structure: one paragraph of where things stand, then Done, then In progress, then Late or blocked, then what needs a decision.',
          'Name people only as they are named in the list. Invent no task, no percentage, no deadline.',
          'Plain prose and short lines, no markdown symbols. Keep it under 400 words.',
          'Write in whatever language the tasks are written in.',
        ].join(' '),
        user: [
          `Company: ${company.name}`,
          `Date: ${today()}`,
          `Period: ${String(body.period || 'today').slice(0, 40)}`,
          `Work (${tasks.length} items):\n${tasks.map(line).join('\n')}`,
        ].join('\n\n'),
      });

      const text = String(answer || '').trim();
      if (!text) return fail(res, 502, 'Vlipa came back with nothing.');

      return json(res, 200, { ok: true, text, counted: tasks.length });
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
