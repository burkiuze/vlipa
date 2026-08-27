/* Vlipy: learning a trade the way Duolingo teaches a language.

   Two things happen here, and neither of them needs an account — somebody
   who wants to learn should not have to sign up to find out whether this is
   any good.

   POST { action: 'plan' }    → a course: units, and the lessons inside them
   POST { action: 'lesson' }  → the questions for one lesson

   Everything comes back as JSON that has been checked rather than trusted:
   a model that answers with the wrong shape, a lesson with no right answer,
   an index pointing at an option that is not there — all of that is caught
   here, because a broken question is worse than no question. */

import { callerKey, fail, json, methodGuard, readBody, withinLimit } from './http.js';
import { chatCompletion, hasKey } from './openrouter.js';

const LEVELS = {
  new: 'has never done this work',
  some: 'has tried it a little',
  working: 'already works in it and wants to get better',
};

const MINUTES = { 5: 'about five minutes a day', 10: 'about ten minutes a day', 20: 'about twenty minutes a day' };

/* Everything the browser sends is a string somebody typed. */
function tidy(value, cap = 80) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
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

/* ---------- the course ---------- */

async function plan(res, body) {
  const trade = tidy(body.trade, 60);
  if (trade.length < 2) return fail(res, 400, 'Say what you want to learn.');

  const language = tidy(body.language, 30) || 'English';
  const level = LEVELS[body.level] || LEVELS.new;
  const minutes = MINUTES[body.minutes] || MINUTES[10];

  const answer = await chatCompletion({
    mode: 'thinking',
    json: true,
    maxTokens: 2000,
    messages: [
      {
        role: 'system',
        content: [
          'You are Vlipy, and you build short courses that teach a trade the way a language app teaches a language.',
          'Return JSON only:',
          '{"title":"...","note":"one sentence on what they will be able to do at the end",',
          '"units":[{"title":"...","aim":"one line","lessons":[{"title":"...","about":"the one thing this lesson teaches"}]}]}',
          'Five units. Three lessons in each. Order them so nothing needs something taught later.',
          'Titles are short — three or four words — and say what the learner will be able to do,',
          'not what the topic is called. Concrete over academic: the real steps of the real job.',
          'Write every word in the language you are told to use.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `Trade: ${trade}`,
          `Language of the course: ${language}`,
          `The learner ${level}.`,
          `They have ${minutes}.`,
        ].join('\n'),
      },
    ],
  });

  const parsed = parseJson(answer);

  const units = (parsed?.units || []).slice(0, 6).map((unit, index) => ({
    title: tidy(unit?.title, 60) || `Unit ${index + 1}`,
    aim: tidy(unit?.aim, 140),
    lessons: (unit?.lessons || []).slice(0, 5).map((lesson, at) => ({
      title: tidy(lesson?.title, 60) || `Lesson ${at + 1}`,
      about: tidy(lesson?.about, 160),
    })).filter((lesson) => lesson.title),
  })).filter((unit) => unit.lessons.length);

  if (units.length < 2) {
    return fail(res, 502, 'Vlipy could not put a course together for that. Try saying it a little differently.');
  }

  return json(res, 200, {
    ok: true,
    course: {
      title: tidy(parsed?.title, 80) || trade,
      note: tidy(parsed?.note, 200),
      trade,
      language,
      level: body.level || 'new',
      minutes: Number(body.minutes) || 10,
      units,
    },
  });
}

/* ---------- one lesson ---------- */

const KINDS = ['choice', 'truefalse', 'gap'];

async function lesson(res, body) {
  const trade = tidy(body.trade, 60);
  const title = tidy(body.title, 60);
  if (!trade || !title) return fail(res, 400, 'Which lesson?');

  const answer = await chatCompletion({
    mode: 'fast',
    json: true,
    maxTokens: 1800,
    messages: [
      {
        role: 'system',
        content: [
          'You are Vlipy, writing the questions for one short lesson.',
          'Return JSON only:',
          '{"questions":[{"kind":"choice|truefalse|gap","ask":"...","options":["...","..."],"answer":0,"why":"one line on why that is right"}]}',
          'Six questions. Mix the kinds. A choice question has four options, a truefalse has exactly',
          '["True","False"], a gap question has four options and the ask contains ___ where the word goes.',
          '"answer" is the index of the right option and must point at one that exists.',
          'Ask about doing the work, not about definitions. One idea per question, and no trick questions.',
          'Write every word in the language you are told to use.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `Trade: ${trade}`,
          `Unit: ${tidy(body.unit, 60)}`,
          `Lesson: ${title}`,
          body.about ? `It teaches: ${tidy(body.about, 160)}` : '',
          `Language: ${tidy(body.language, 30) || 'English'}`,
        ].filter(Boolean).join('\n'),
      },
    ],
  });

  const parsed = parseJson(answer);

  const questions = (parsed?.questions || []).slice(0, 8).map((question) => {
    const kind = KINDS.includes(question?.kind) ? question.kind : 'choice';

    const options = (kind === 'truefalse' ? ['True', 'False'] : (question?.options || []))
      .slice(0, 4)
      .map((option) => tidy(option, 120))
      .filter(Boolean);

    const at = Number(question?.answer);

    return {
      kind,
      ask: tidy(question?.ask, 240),
      options,
      answer: at,
      why: tidy(question?.why, 200),
    };
  }).filter((question) => question.ask
    && question.options.length >= 2
    && Number.isInteger(question.answer)
    && question.answer >= 0
    && question.answer < question.options.length);

  if (questions.length < 3) {
    return fail(res, 502, 'Vlipy could not write that lesson. Try it again in a moment.');
  }

  return json(res, 200, { ok: true, questions });
}

/* ---------- the door ---------- */

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  // Nothing here needs an account, so the limit is what keeps it honest.
  if (!withinLimit(`vlipy:${callerKey(req)}`, 12)) {
    return fail(res, 429, 'Slow down a moment: twelve of these a minute.');
  }

  if (!hasKey()) return fail(res, 503, 'Vlipy is not connected: OPENROUTER_API_KEY is not set on the server.');

  const body = await readBody(req);

  try {
    if (body.action === 'plan') return await plan(res, body);
    if (body.action === 'lesson') return await lesson(res, body);
    return fail(res, 400, 'Unknown action.');
  } catch (error) {
    console.error('[vlipa] vlipy:', error.detail || error.message);
    return fail(res, error.status || 500, error.message || 'Vlipy cannot answer right now.', { reason: error.reason });
  }
}
