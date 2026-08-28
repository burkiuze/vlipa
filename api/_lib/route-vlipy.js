/* Vlipy: learning a trade the way a language app teaches a language.

   POST { action: 'plan' }    → a course: twenty units, three lessons in each
   POST { action: 'lesson' }  → one lesson: what it teaches, then the questions
   POST { action: 'save' }    → keep progress against an account
   POST { action: 'load' }    → read it back
   POST { action: 'company' } → read, or set, what a company teaches its own
                                people: its departments and its own material

   The first two need no account: somebody should be able to find out whether
   this is any good before signing up for anything. Keeping what they have
   done does need one, because there is nowhere else to put it.

   Everything the model sends back is checked rather than trusted. A lesson
   whose right answer points at an option that is not there is worse than no
   lesson at all. */

import { SESSION_COOKIE, userFromToken } from './auth.js';
import { can, companiesOf, membership } from './org.js';
import { callerKey, fail, json, methodGuard, parseCookies, readBody, withinLimit } from './http.js';
import { chatCompletion, hasKey } from './openrouter.js';
import * as store from './store.js';

/* One model does this, and it is named rather than inherited: the course and
   the lessons should read the same from one day to the next. */
const MODEL = process.env.VLIPY_MODEL || 'minimax/minimax-m3:free';

const UNITS = 20;
const LESSONS = 3;

const READING = {
  basic: 'is still learning this language, so use short sentences and everyday words',
  ok: 'reads this language comfortably, so ordinary working language is fine',
  fluent: 'is fluent in this language, so write it the way the trade is really spoken',
};

const KNOWN = {
  new: 'has never worked in this sector',
  some: 'has seen a little of it',
  working: 'already works in it and wants to go deeper',
};

const MINUTES = { 5: 'about five minutes a day', 10: 'about ten minutes a day', 20: 'about twenty minutes a day' };

function tidy(value, cap = 80) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
}

/* What the learner ticked inside the sector. It arrives as names the browser
   chose from a fixed list, but it is still typed by a stranger, so it is cut
   to length and to count like everything else. */
function chosen(value) {
  return (Array.isArray(value) ? value : [])
    .slice(0, 16)
    .map((one) => tidy(one, 40))
    .filter(Boolean);
}

function parseJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  try {
    return JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
  } catch {
    return null;
  }
}

const think = (messages, maxTokens) => chatCompletion({ messages, model: MODEL, json: true, maxTokens, mode: 'thinking' });

/* ---------- the course ---------- */

/* Twenty units is a lot of words, so the shape is short: t is the title, a is
   the aim, l is the list of lessons. The model has fewer characters to spend
   on punctuation and more to spend on the course. */
async function plan(res, body) {
  const sector = tidy(body.sector, 60);
  if (sector.length < 2) return fail(res, 400, 'Say which sector you want to learn.');

  const language = tidy(body.language, 30) || 'English';
  const areas = chosen(body.areas);
  const tools = chosen(body.tools);

  const answer = await think([
    {
      role: 'system',
      content: [
        'You are Vlipy. You build long courses that teach a sector the way a language app teaches a language.',
        'Return JSON only, using these short keys:',
        '{"title":"...","note":"one sentence on what they will be able to do at the end",',
        `"units":[{"t":"unit title","a":"one line aim","l":["lesson title","lesson title","lesson title"]}]}`,
        `Exactly ${UNITS} units, ${LESSONS} lessons in each — ${UNITS * LESSONS} lessons altogether.`,
        'It has to go somewhere: the first units are the ground floor, the last ones are what a senior person does.',
        'Order them so nothing needs something taught later.',
        'Titles are three or four words and say what the learner will be able to do, not what the topic is called.',
        'If the learner named parts of the sector, the whole course is about those parts and nothing else.',
        'If they named tools or languages, teach the sector through those and use them in the examples.',
        'Write every word in the language you are told to use.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Sector: ${sector}`,
        areas.length ? `Inside it they want: ${areas.join(', ')}. Every unit belongs to one of these.` : '',
        tools.length ? `They want to work with: ${tools.join(', ')}. Teach and give examples in these.` : '',
        `Language of the course: ${language}`,
        `The learner ${READING[body.reading] || READING.ok}.`,
        `In this sector the learner ${KNOWN[body.known] || KNOWN.new}.`,
        `They have ${MINUTES[body.minutes] || MINUTES[10]}.`,
      ].filter(Boolean).join('\n'),
    },
  ], 4000);

  const parsed = parseJson(answer);

  const units = (parsed?.units || []).slice(0, UNITS + 4).map((unit, index) => ({
    title: tidy(unit?.t || unit?.title, 60) || `Unit ${index + 1}`,
    aim: tidy(unit?.a || unit?.aim, 140),
    lessons: (unit?.l || unit?.lessons || []).slice(0, 5).map((lesson, at) => ({
      title: tidy(typeof lesson === 'string' ? lesson : lesson?.title, 60) || `Lesson ${at + 1}`,
    })).filter((lesson) => lesson.title),
  })).filter((unit) => unit.lessons.length);

  // A course this short is not the course that was asked for.
  if (units.length < 8) {
    return fail(res, 502, 'Vlipy could not put a course together for that. Try saying the sector a little differently.');
  }

  return json(res, 200, {
    ok: true,
    course: {
      title: tidy(parsed?.title, 80) || sector,
      note: tidy(parsed?.note, 200),
      sector,
      areas,
      tools,
      language,
      reading: body.reading || 'ok',
      known: body.known || 'new',
      minutes: Number(body.minutes) || 10,
      units,
    },
  });
}

/* ---------- one lesson ---------- */

const KINDS = ['choice', 'truefalse', 'gap'];

/* A lesson teaches first. Being asked a question about something nobody has
   explained is a test, and a test is not a lesson. */
async function lesson(res, req, body) {
  const sector = tidy(body.sector, 60);
  const title = tidy(body.title, 60);
  if (!sector || !title) return fail(res, 400, 'Which lesson?');

  const areas = chosen(body.areas);
  const tools = chosen(body.tools);

  // A lesson in a company course is taught out of the company's own material,
  // which means proving first that the reader is in that company.
  let material = '';

  if (body.companyId) {
    const held = await seat(req, tidy(body.companyId, 60));
    if (held.error) return fail(res, held.status, held.error);

    const kept = await courseFor(tidy(body.companyId, 60));
    material = String(kept?.material || '').slice(0, 24000);
  }

  const answer = await think([
    {
      role: 'system',
      content: [
        'You are Vlipy, writing one short lesson: first the teaching, then the questions about it.',
        'Return JSON only:',
        '{"teach":[{"head":"...","body":"two or three sentences","example":"a line from the real job, or empty"}],',
        '"questions":[{"kind":"choice|truefalse|gap","ask":"...","options":["...","..."],"answer":0,"why":"one line"}]}',
        'Three teaching cards, then six questions, and every question must be answerable from the cards above it.',
        'A choice question has four options, a truefalse has exactly ["True","False"],',
        'a gap question has four options and the ask contains ___ where the word goes.',
        '"answer" is the index of the right option and must point at one that exists.',
        'Teach how the work is done, not what the words mean. No trick questions.',
        'Where the learner named tools or languages, the examples are written in those.',
        'Where a company\'s own material is given, that is the source: teach how this company does it,',
        'quote its own words for things, and do not replace them with the general practice.',
        'Write every word in the language you are told to use.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Sector: ${sector}`,
        areas.length ? `Within: ${areas.join(', ')}` : '',
        tools.length ? `Tools and languages they are learning: ${tools.join(', ')}` : '',
        `Unit: ${tidy(body.unit, 60)}`,
        `Lesson: ${title}`,
        `Language: ${tidy(body.language, 30) || 'English'}`,
        `The learner ${READING[body.reading] || READING.ok}.`,
        material ? `The company's own material:\n${material}` : '',
      ].filter(Boolean).join('\n'),
    },
  ], 2400);

  const parsed = parseJson(answer);

  const teach = (parsed?.teach || []).slice(0, 4).map((card) => ({
    head: tidy(card?.head, 80),
    body: tidy(card?.body, 420),
    example: tidy(card?.example, 200),
  })).filter((card) => card.head && card.body);

  const questions = (parsed?.questions || []).slice(0, 8).map((question) => {
    const kind = KINDS.includes(question?.kind) ? question.kind : 'choice';

    const options = (kind === 'truefalse' ? ['True', 'False'] : (question?.options || []))
      .slice(0, 4)
      .map((option) => tidy(option, 120))
      .filter(Boolean);

    return {
      kind,
      ask: tidy(question?.ask, 240),
      options,
      answer: Number(question?.answer),
      why: tidy(question?.why, 200),
    };
  }).filter((question) => question.ask
    && question.options.length >= 2
    && Number.isInteger(question.answer)
    && question.answer >= 0
    && question.answer < question.options.length);

  if (questions.length < 3 || !teach.length) {
    return fail(res, 502, 'Vlipy could not write that lesson. Try it again in a moment.');
  }

  return json(res, 200, { ok: true, teach, questions });
}

/* ---------- keeping it ---------- */

const WHERE = (userId) => `vlipy:${userId}`;

async function whoIs(req) {
  return userFromToken(parseCookies(req)[SESSION_COOKIE]);
}

async function keep(res, req, body) {
  const user = await whoIs(req);
  if (!user) return fail(res, 401, 'Sign in to keep what you have learned.');

  const progress = body.progress || {};

  // Only the shape this is allowed to be: whatever else arrives is not kept.
  await store.set(WHERE(user.id), {
    course: progress.course || null,
    done: (Array.isArray(progress.done) ? progress.done : []).slice(0, 400).map((mark) => String(mark).slice(0, 20)),
    xp: Math.max(0, Math.min(1e7, Number(progress.xp) || 0)),
    streak: Math.max(0, Math.min(9999, Number(progress.streak) || 0)),
    lastDay: String(progress.lastDay || '').slice(0, 10),
    todayXp: Math.max(0, Math.min(1e5, Number(progress.todayXp) || 0)),
    savedAt: new Date().toISOString(),
  });

  return json(res, 200, { ok: true });
}

async function load(res, req) {
  const user = await whoIs(req);
  if (!user) return fail(res, 401, 'Sign in to pick up where you left off.');

  // Which company they are in, if any, decides whether Vlipy has a second
  // thing to teach: the sector, or this company.
  const [progress, companies] = await Promise.all([
    store.get(WHERE(user.id)),
    companiesOf(user.id).catch(() => []),
  ]);

  const company = companies[0] || null;

  return json(res, 200, {
    ok: true,
    progress,
    name: user.name || user.email,
    company: company && {
      id: company.id,
      name: company.name,
      role: company.role,
      mayManage: can(company.role, 'company.manage'),
      departments: (await courseFor(company.id))?.departments || [],
    },
  });
}

/* ---------- what a company teaches its own people ---------- */

/* A sector course is written from what the model already knows. A company
   course cannot be: nobody outside knows how this company does its invoicing.
   So the owner hands over the material — the handbook, the process notes, the
   policies — and names the departments it should be split across, and every
   lesson after that is written from what they gave rather than from the
   trade in general. */

const COMPANY = (companyId) => `vlipy-co:${companyId}`;

const MATERIAL = 60000;
const CO_UNITS = 5;
const CO_LESSONS = 4;

const courseFor = (companyId) => store.get(COMPANY(companyId));

function departmentsFrom(value) {
  return (Array.isArray(value) ? value : [])
    .slice(0, 12)
    .map((name) => tidy(name, 40))
    .filter(Boolean);
}

async function seat(req, companyId) {
  const user = await whoIs(req);
  if (!user) return { error: 'Sign in first.', status: 401 };

  const held = await membership(companyId, user.id);
  if (!held) return { error: 'You are not in that company.', status: 403 };

  return { user, role: held.role };
}

/* Reading a company's own website, when that is where the material is.

   Fetched from the server because the browser cannot read another origin.
   Only public addresses: an address that resolves inside the network this
   runs on would make Vlipy a way to read things it should not see. */
async function readSite(url) {
  let target;

  try {
    target = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    throw Object.assign(new Error('That does not look like a web address.'), { status: 400 });
  }

  if (!/^https?:$/.test(target.protocol)) {
    throw Object.assign(new Error('Only http and https addresses.'), { status: 400 });
  }

  const host = target.hostname.toLowerCase();

  const private_ = host === 'localhost'
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.test(host)
    || host.startsWith('[');

  if (private_) {
    throw Object.assign(new Error('That address is not one Vlipy will read.'), { status: 400 });
  }

  const stop = AbortSignal.timeout(12000);
  const answer = await fetch(target.href, { signal: stop, redirect: 'follow', headers: { accept: 'text/html,text/plain' } })
    .catch(() => { throw Object.assign(new Error('That page did not answer.'), { status: 502 }); });

  if (!answer.ok) throw Object.assign(new Error(`That page answered ${answer.status}.`), { status: 502 });

  const type = answer.headers.get('content-type') || '';
  if (!/text\/(html|plain)/i.test(type)) {
    throw Object.assign(new Error('That address is not a page Vlipy can read.'), { status: 400 });
  }

  const html = (await answer.text()).slice(0, 400000);

  // The words, without the machinery around them.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
    .join('\n')
    .slice(0, 40000);

  if (text.length < 120) {
    throw Object.assign(new Error('There was almost no text on that page.'), { status: 422 });
  }

  return { text, from: target.href };
}

async function companyRoute(res, req, body) {
  const companyId = tidy(body.companyId, 60);
  if (!companyId) return fail(res, 400, 'Which company?');

  const held = await seat(req, companyId);
  if (held.error) return fail(res, held.status, held.error);

  const kept = (await courseFor(companyId)) || { departments: [], material: '', updatedAt: '' };

  if (body.set) {
    if (!can(held.role, 'company.manage')) {
      return fail(res, 403, 'Setting up what the company teaches is the owner\'s job.');
    }

    const departments = departmentsFrom(body.departments);
    if (!departments.length) return fail(res, 400, 'Name at least one department to teach.');

    // A website is fetched here and folded in with whatever was handed over.
    let fromSite = '';
    let siteName = '';

    if (body.site) {
      const read = await readSite(String(body.site).slice(0, 400));
      fromSite = `--- ${read.from} ---\n${read.text}`;
      siteName = read.from;
    }

    const given = [String(body.material ?? '').trim(), fromSite].filter(Boolean).join('\n\n');
    const material = (given || String(kept.material || '')).slice(0, MATERIAL);

    const saved = {
      departments,
      material,
      site: siteName || kept.site || '',
      files: (Array.isArray(body.files) ? body.files : []).slice(0, 20).map((name) => tidy(name, 80)).filter(Boolean),
      updatedAt: new Date().toISOString(),
      by: held.user.name || held.user.email,
    };

    await store.set(COMPANY(companyId), saved);
    return json(res, 200, { ok: true, company: strip(saved) });
  }

  return json(res, 200, { ok: true, company: strip(kept), mayManage: can(held.role, 'company.manage') });
}

/* The material itself never goes back to the browser: an employee is meant to
   be taught from it, not handed it. Its size is enough to show it is there. */
const strip = (kept) => ({
  departments: kept.departments || [],
  files: kept.files || [],
  site: kept.site || '',
  letters: (kept.material || '').length,
  updatedAt: kept.updatedAt || '',
  by: kept.by || '',
});

/* A course about the company rather than about the trade: five units, four
   lessons in each, written out of the material the owner handed over. */
async function companyPlan(res, req, body) {
  const companyId = tidy(body.companyId, 60);
  const held = await seat(req, companyId);
  if (held.error) return fail(res, held.status, held.error);

  const kept = await courseFor(companyId);
  if (!kept?.departments?.length) return fail(res, 400, 'Nobody has set this company up in Vlipy yet.');

  const department = tidy(body.department, 40);
  if (!kept.departments.includes(department)) return fail(res, 400, 'That is not one of the departments.');

  const language = tidy(body.language, 30) || 'English';
  const material = String(kept.material || '').slice(0, MATERIAL);

  const answer = await think([
    {
      role: 'system',
      content: [
        'You are Vlipy, writing the course a company gives somebody joining one of its departments.',
        'Return JSON only, using these short keys:',
        '{"title":"...","note":"one sentence on what they will be able to do at the end",',
        '"units":[{"t":"unit title","a":"one line aim","l":["lesson title","lesson title","lesson title","lesson title"]}]}',
        `Exactly ${CO_UNITS} units, ${CO_LESSONS} lessons in each — ${CO_UNITS * CO_LESSONS} lessons altogether.`,
        'The course is about working in this department at this company, using the company material below.',
        'Where the material says how something is done here, that is what is taught — not the general practice.',
        'The first unit is the ground floor, the last is what somebody senior in the department does.',
        'Titles are three or four words and say what the learner will be able to do.',
        'Write every word in the language you are told to use.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Company: ${tidy(body.companyName, 60) || 'the company'}`,
        `Department: ${department}`,
        `Language of the course: ${language}`,
        `The learner ${READING[body.reading] || READING.ok}.`,
        material ? `The company's own material:\n${material}` : 'No material was given, so teach the department as it is usually run and say where the company would differ.',
      ].join('\n\n'),
    },
  ], 3000);

  const parsed = parseJson(answer);

  const units = (parsed?.units || []).slice(0, CO_UNITS + 2).map((unit, index) => ({
    title: tidy(unit?.t || unit?.title, 60) || `Unit ${index + 1}`,
    aim: tidy(unit?.a || unit?.aim, 140),
    lessons: (unit?.l || unit?.lessons || []).slice(0, 6).map((lesson, at) => ({
      title: tidy(typeof lesson === 'string' ? lesson : lesson?.title, 60) || `Lesson ${at + 1}`,
    })).filter((lesson) => lesson.title),
  })).filter((unit) => unit.lessons.length);

  if (units.length < 3) {
    return fail(res, 502, 'Vlipy could not put that course together. Try it again in a moment.');
  }

  return json(res, 200, {
    ok: true,
    course: {
      title: tidy(parsed?.title, 80) || department,
      note: tidy(parsed?.note, 200),
      sector: department,
      company: tidy(body.companyName, 60),
      companyId,
      department,
      areas: [],
      tools: [],
      language,
      reading: body.reading || 'ok',
      known: body.known || 'new',
      minutes: Number(body.minutes) || 10,
      units,
    },
  });
}

/* ---------- the door ---------- */

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  if (!withinLimit(`vlipy:${callerKey(req)}`, 20)) {
    return fail(res, 429, 'Slow down a moment: twenty of these a minute.');
  }

  const body = await readBody(req);

  try {
    if (body.action === 'save') return await keep(res, req, body);
    if (body.action === 'load') return await load(res, req);
    if (body.action === 'company') return await companyRoute(res, req, body);

    if (!hasKey()) return fail(res, 503, 'Vlipy is not connected: OPENROUTER_API_KEY is not set on the server.');

    if (body.action === 'plan') return await plan(res, body);
    if (body.action === 'companyPlan') return await companyPlan(res, req, body);
    if (body.action === 'lesson') return await lesson(res, req, body);

    return fail(res, 400, 'Unknown action.');
  } catch (error) {
    console.error('[vlipa] vlipy:', error.detail || error.message);
    return fail(res, error.status || 500, error.message || 'Vlipy cannot answer right now.', { reason: error.reason });
  }
}
