/* Vlipy — learning a trade the way a language app teaches a language.

   Pick what you want to learn, answer four questions, and Vlipy writes you a
   course: five units, three lessons each, questions generated when you open
   a lesson. Nothing needs an account — everything you have done is kept in
   this browser — and a lesson is short enough to do while the kettle boils.

   The whole thing is one screen that swaps what it draws, so there is no
   router, no framework and nothing to load. */

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }

  return node;
}

function toast(message, kind = '') {
  const node = $('toast');
  node.textContent = message;
  node.className = `toast${kind ? ` is-${kind}` : ''}`;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 3200);
}

const mascot = (pose, alt = '') => el('img', { src: `assets/img/vlipy/${pose}.png`, alt, width: 320, height: 320 });

/* ---------- what this browser remembers ---------- */

const KEY = 'vlipy.save';

const save = {
  course: null,
  done: [],          // "unit:lesson" for every lesson finished
  xp: 0,
  streak: 0,
  lastDay: '',
  todayXp: 0,
  goal: 20,
};

function read() {
  try {
    Object.assign(save, JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch { /* a broken save is not worth keeping */ }

  if (!Array.isArray(save.done)) save.done = [];

  // A new day resets what you have done today, and breaks the streak unless
  // yesterday was the last one.
  const today = new Date().toISOString().slice(0, 10);

  if (save.lastDay !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (save.lastDay && save.lastDay !== yesterday) save.streak = 0;
    save.todayXp = 0;
  }
}

/* Who is signed in, if anybody. Progress lives in this browser either way;
   an account is what makes it survive the browser. */
let who = null;
let syncing = null;

function keep() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch { /* private mode */ }

  if (who) push();
}

/* Sent quietly and not waited on: losing a save is a nuisance, but blocking
   the lesson on it would be worse. */
function push() {
  clearTimeout(push.timer);

  push.timer = setTimeout(() => {
    syncing = ask({
      action: 'save',
      progress: {
        course: save.course,
        done: save.done,
        xp: save.xp,
        streak: save.streak,
        lastDay: save.lastDay,
        todayXp: save.todayXp,
      },
    }).catch(() => {});
  }, 400);
}

/* On the way in: if there is an account, what it holds wins — that is the
   whole point of having one. */
async function pull() {
  try {
    const answer = await ask({ action: 'load' });
    who = answer.name || 'you';

    if (answer.progress?.course) {
      Object.assign(save, answer.progress);
      if (!Array.isArray(save.done)) save.done = [];
      try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* private mode */ }
    } else if (save.course) {
      push();   // signed in on a browser that already had a course
    }
  } catch {
    who = null;   // signed out, and that is allowed
  }
}

function award(xp) {
  const today = new Date().toISOString().slice(0, 10);

  if (save.lastDay !== today) {
    save.streak = (save.streak || 0) + 1;
    save.lastDay = today;
    save.todayXp = 0;
  }

  save.xp += xp;
  save.todayXp += xp;
  keep();
}

/* ---------- talking to the server ---------- */

async function ask(body) {
  const response = await fetch('/api/vlipy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);

  if (!response) throw new Error('Could not reach the server. Check your connection.');

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `The request failed (${response.status}).`);

  return data;
}

/* ---------- the questions Vlipy asks first ---------- */

/* Sectors, not job titles: somebody picks the industry they want to work in,
   and the course goes from the ground floor of it to what a senior person
   does. Anything not here gets typed in. */
const SECTORS = [
  { id: 'Software', emoji: '💻', label: 'Software', note: 'Building and running software' },
  { id: 'Energy', emoji: '⚡', label: 'Energy', note: 'Power, grid, renewables' },
  { id: 'Finance', emoji: '🏦', label: 'Finance', note: 'Banking, markets, credit' },
  { id: 'Health', emoji: '🩺', label: 'Health', note: 'Care, clinics, devices' },
  { id: 'Construction', emoji: '🏗️', label: 'Construction', note: 'Sites, trades, projects' },
  { id: 'Manufacturing', emoji: '🏭', label: 'Manufacturing', note: 'Production and quality' },
  { id: 'Logistics', emoji: '🚢', label: 'Logistics', note: 'Freight, stock, routes' },
  { id: 'Retail', emoji: '🛍️', label: 'Retail', note: 'Shops and e-commerce' },
  { id: 'Agriculture', emoji: '🌾', label: 'Agriculture', note: 'Growing, livestock, land' },
  { id: 'Tourism', emoji: '🧳', label: 'Tourism', note: 'Hotels, travel, hospitality' },
  { id: 'Education', emoji: '🎓', label: 'Education', note: 'Teaching and training' },
  { id: 'Media', emoji: '🎬', label: 'Media', note: 'Publishing, film, advertising' },
  { id: 'Law', emoji: '⚖️', label: 'Law', note: 'Contracts, compliance, courts' },
  { id: 'Automotive', emoji: '🚗', label: 'Automotive', note: 'Vehicles and mobility' },
  { id: 'Telecom', emoji: '📡', label: 'Telecom', note: 'Networks and operators' },
  { id: 'Real estate', emoji: '🏢', label: 'Real estate', note: 'Property and development' },
  { id: 'Public sector', emoji: '🏛️', label: 'Public sector', note: 'Government and services' },
  { id: 'own', emoji: '✏️', label: 'Something else', note: 'Say it in your own words' },
];

const LANGUAGES = [
  { id: 'Türkçe', emoji: '🇹🇷', label: 'Türkçe' },
  { id: 'English', emoji: '🇬🇧', label: 'English' },
  { id: 'Deutsch', emoji: '🇩🇪', label: 'Deutsch' },
  { id: 'Español', emoji: '🇪🇸', label: 'Español' },
  { id: 'Français', emoji: '🇫🇷', label: 'Français' },
  { id: 'Italiano', emoji: '🇮🇹', label: 'Italiano' },
  { id: 'Русский', emoji: '🇷🇺', label: 'Русский' },
  { id: 'العربية', emoji: '🇸🇦', label: 'العربية' },
];

/* How well they read the language they picked, so the course is written at a
   level they can actually follow. */
const READING = [
  { id: 'basic', emoji: '🐣', label: 'Still learning it', note: 'Short sentences, everyday words' },
  { id: 'ok', emoji: '🙂', label: 'Comfortable', note: 'Ordinary working language' },
  { id: 'fluent', emoji: '🎯', label: 'Fluent', note: 'The way the trade really talks' },
];

const KNOWN = [
  { id: 'new', emoji: '🌱', label: 'Never worked in it', note: 'Start from the ground' },
  { id: 'some', emoji: '🌿', label: 'Seen a little', note: 'I know the words' },
  { id: 'working', emoji: '🌳', label: 'I work in it', note: 'Take me deeper' },
];

const MINUTES = [
  { id: 5, emoji: '⚡', label: '5 minutes', note: 'A lesson a day' },
  { id: 10, emoji: '🔥', label: '10 minutes', note: 'Steady' },
  { id: 20, emoji: '🚀', label: '20 minutes', note: 'Serious about it' },
];

const wanted = { language: '', reading: '', sector: '', own: '', known: '', minutes: 0 };

/* The language comes first: everything after it is written in that language,
   including the course itself. */
const STEPS = [
  { said: 'Which language should I teach in?', options: LANGUAGES, field: 'language', pose: 'wave' },
  { said: 'How well do you read that language?', options: READING, field: 'reading', pose: 'idea' },
  { said: 'Which sector do you want to learn?', options: SECTORS, field: 'sector', pose: 'laptop', own: true },
  { said: 'How much of it do you know already?', options: KNOWN, field: 'known', pose: 'cheer' },
  { said: 'How long have you got each day?', options: MINUTES, field: 'minutes', pose: 'rocket' },
];

let step = 0;

function drawAsk() {
  const here = STEPS[step];
  const app = $('app');
  app.replaceChildren();

  const body = el('div', { class: 'ask__body' });

  body.append(el('div', { class: 'ask__said' }, [
    mascot(here.pose, 'Vlipy'),
    el('div', { class: 'bubble', text: here.said }),
  ]));

  const own = el('input', {
    id: 'ownTrade',
    placeholder: 'Mining, insurance, aviation, textiles…',
    maxlength: 60,
    value: wanted.own,
    oninput: (event) => {
      wanted.own = event.target.value;
      $('askNext').disabled = !event.target.value.trim();
    },
    onkeydown: (event) => { if (event.key === 'Enter' && wanted.own.trim()) next(); },
  });

  const ownField = el('div', { class: 'ownfield', id: 'ownField', hidden: wanted.sector !== 'own' }, [own]);

  const picks = el('div', { class: 'picks' }, here.options.map((option) => el('button', {
    class: `pick${wanted[here.field] === option.id ? ' is-on' : ''}`,
    type: 'button',
    'data-id': String(option.id),
    onclick: () => {
      wanted[here.field] = option.id;

      if (here.own) {
        ownField.hidden = option.id !== 'own';
        if (option.id === 'own') setTimeout(() => own.focus(), 30);
      }

      drawAsk();
    },
  }, [
    el('span', { class: 'pick__emoji', text: option.emoji }),
    el('span', { class: 'pick__text' }, [
      el('b', { text: option.label }),
      option.note ? el('span', { text: option.note }) : null,
    ]),
  ])));

  body.append(picks);
  if (here.own) body.append(ownField);

  const ready = Boolean(wanted[here.field]) && (here.field !== 'sector' || wanted.sector !== 'own' || wanted.own.trim());

  app.append(el('div', { class: 'ask' }, [
    el('div', { class: 'ask__top' }, [
      el('button', { class: 'ask__back', type: 'button', title: 'Back', text: '←', onclick: back }),
      el('div', { class: 'bar' }, [el('i', { style: `width: ${((step + 1) / STEPS.length) * 100}%` })]),
    ]),
    body,
    el('div', { class: 'ask__foot' }, [
      el('div', {}, [
        el('button', {
          class: 'vbtn vbtn--big', id: 'askNext', type: 'button',
          text: step === STEPS.length - 1 ? 'Build my course' : 'Continue',
          disabled: !ready,
          onclick: next,
        }),
      ]),
    ]),
  ]));
}

function back() {
  if (step === 0) return drawHello();
  step -= 1;
  return drawAsk();
}

function next() {
  if (step < STEPS.length - 1) {
    step += 1;
    return drawAsk();
  }

  return build();
}

/* ---------- the front page ---------- */

function drawHello() {
  const app = $('app');
  app.replaceChildren();

  app.append(el('div', { class: 'hello' }, [
    el('div', { class: 'hello__inner' }, [
      el('img', { class: 'hello__mascot', src: 'assets/img/vlipy/hero.png', alt: 'Vlipy', width: 460, height: 460 }),
      el('h1', { text: 'Learn the job, five minutes at a time' }),
      el('p', { text: 'Vlipy teaches a sector the way a language app teaches a language: twenty units, sixty short lessons, each one explaining the thing before it asks you about it. Tell it what you want to learn and it writes the course.' }),
      el('div', { class: 'hello__acts' }, [
        el('button', {
          class: 'vbtn vbtn--big vbtn--wide', type: 'button', text: 'Get started',
          onclick: () => { step = 0; drawAsk(); },
        }),
        save.course
          ? el('button', {
              class: 'vbtn vbtn--big vbtn--wide vbtn--ghost', type: 'button', text: 'Carry on learning',
              onclick: drawPath,
            })
          : null,
      ]),
      el('p', { class: 'hello__home' }, [
        'Part of ',
        el('a', { class: 'vlink', href: '/', text: 'vlipa' }),
        ' · nothing to sign up for',
      ]),
    ]),
  ]));
}

/* ---------- waiting for Vlipy to write something ---------- */

function drawBusy(line, note, pose = 'laptop') {
  const app = $('app');
  app.replaceChildren();

  app.append(el('div', { class: 'busy' }, [
    el('div', { class: 'busy__inner' }, [
      mascot(pose, ''),
      el('b', { text: line }),
      el('span', { text: note }),
      el('div', { class: 'dots' }, [el('i'), el('i'), el('i')]),
    ]),
  ]));
}

async function build() {
  const sector = wanted.sector === 'own' ? wanted.own.trim() : wanted.sector;

  drawBusy('Writing your course…',
    'Twenty units, sixty lessons, in an order where nothing needs something you have not been taught yet. This takes a moment.');

  try {
    const answer = await ask({
      action: 'plan',
      sector,
      language: wanted.language,
      reading: wanted.reading,
      known: wanted.known,
      minutes: wanted.minutes,
    });

    save.course = answer.course;
    save.done = [];
    keep();
    drawPath();
  } catch (error) {
    toast(error.message, 'bad');
    drawAsk();
  }
}

/* ---------- the path ---------- */

const BANDS = [
  ['#5b2fe0', '#4420a8'],
  ['#2aa9f0', '#1b7fb8'],
  ['#2fbf5e', '#22994a'],
  ['#ffb020', '#d98a00'],
  ['#e8465a', '#c22d40'],
];

const tag = (unit, lesson) => `${unit}:${lesson}`;

/* The first lesson you have not done: everything before it is open, and
   everything after it waits. */
function upNext() {
  const units = save.course?.units || [];

  for (let unit = 0; unit < units.length; unit += 1) {
    for (let lesson = 0; lesson < units[unit].lessons.length; lesson += 1) {
      if (!save.done.includes(tag(unit, lesson))) return { unit, lesson };
    }
  }

  return null;
}

function drawPath() {
  if (!save.course) return drawHello();

  const app = $('app');
  app.replaceChildren();

  const now = upNext();
  const total = save.course.units.reduce((count, unit) => count + unit.lessons.length, 0);

  const path = el('div', { class: 'path' });

  save.course.units.forEach((unit, index) => {
    const [band, dark] = BANDS[index % BANDS.length];

    const block = el('div', { class: 'unit' }, [
      el('div', { class: 'unit__band', style: `--band:${band}; --bandDark:${dark}` }, [
        el('div', {}, [
          el('b', { text: `Unit ${index + 1}` }),
          el('h3', { text: unit.title }),
        ]),
      ]),
      unit.aim ? el('p', { class: 'unit__aim', text: unit.aim }) : null,
    ]);

    unit.lessons.forEach((lesson, at) => {
      const done = save.done.includes(tag(index, at));
      const here = now && now.unit === index && now.lesson === at;
      const state = done ? 'done' : here ? 'now' : 'locked';

      // A gentle wander to both sides, so it reads as a path rather than a list.
      const shift = Math.round(Math.sin(at * 0.95) * 88);

      block.append(el('div', {
        class: `node node--${state}`,
        style: `--shift:${shift}px`,
      }, [
        here ? el('span', { class: 'node__now', text: 'Start' }) : null,
        el('button', {
          class: 'node__button',
          type: 'button',
          disabled: state === 'locked',
          title: lesson.title,
          text: done ? '★' : here ? '▶' : '🔒',
          onclick: () => openLesson(index, at),
        }),
        el('span', { class: 'node__name', text: lesson.title }),
      ]));
    });

    path.append(block);
  });

  if (!now) {
    path.append(el('div', { class: 'card', style: 'text-align:center' }, [
      el('h4', { text: 'That is the whole course' }),
      el('p', { style: 'margin:0 0 12px; color:var(--ink-2); font-weight:700', text: 'Every lesson done. Start another trade whenever you like.' }),
      el('button', { class: 'vbtn', type: 'button', text: 'Learn something else', onclick: () => { step = 0; drawAsk(); } }),
    ]));
  }

  app.append(el('div', {}, [
    el('div', { class: 'learn' }, [
      el('div', {}, [
        el('div', { class: 'learn__head' }, [
          el('div', {}, [
            el('b', { text: `${save.done.length} of ${total} lessons` }),
            el('h2', { text: save.course.title }),
          ]),
          el('a', { class: 'vbtn vbtn--ghost', href: '/', text: 'vlipa' }),
        ]),
        path,
      ]),

      el('div', { class: 'rail' }, [
        el('div', { class: 'card' }, [
          el('div', { class: 'tally' }, [
            el('div', {}, [el('b', { class: 'is-fire', text: `🔥 ${save.streak || 0}` }), el('span', { text: 'Day streak' })]),
            el('div', {}, [el('b', { class: 'is-xp', text: `⭐ ${save.xp || 0}` }), el('span', { text: 'XP' })]),
          ]),
        ]),

        el('div', { class: 'card' }, [
          el('h4', { text: 'Today' }),
          el('div', { class: 'goal' }, [
            el('div', { class: 'goal__bar' }, [
              el('i', { style: `width:${Math.min(100, ((save.todayXp || 0) / save.goal) * 100)}%` }),
            ]),
            el('span', { text: `${save.todayXp || 0} / ${save.goal} XP` }),
          ]),
        ]),

        save.course.note
          ? el('div', { class: 'card' }, [el('h4', { text: 'What this is for' }), el('p', { style: 'margin:0; color:var(--ink-2); font-size:13.5px; font-weight:700; line-height:1.55', text: save.course.note })])
          : null,

        who
          ? el('div', { class: 'card card--kept' }, [
              el('h4', { text: 'Saved' }),
              el('p', { style: 'margin:0; color:var(--ink-2); font-size:13px; font-weight:700', text: `Kept against your account, ${who}. It will be here on any browser you sign in on.` }),
            ])
          : el('div', { class: 'card card--nudge' }, [
              el('h4', { text: 'Keep your progress' }),
              el('p', { style: 'margin:0 0 10px; color:var(--ink-2); font-size:13px; font-weight:700', text: 'Right now this lives in this browser only. An account keeps your course, your streak and your XP.' }),
              el('a', { class: 'vbtn vbtn--wide', href: '/signup?next=%2Fvlipy', text: 'Create a profile' }),
              el('a', { class: 'vbtn vbtn--wide vbtn--ghost', href: '/login?next=%2Fvlipy', text: 'Sign in', style: 'margin-top:8px' }),
            ]),

        el('div', { class: 'card' }, [
          el('h4', { text: 'Start over' }),
          el('p', { style: 'margin:0 0 10px; color:var(--ink-2); font-size:13px; font-weight:700', text: 'A different trade, or the same one from the beginning.' }),
          el('button', {
            class: 'vbtn vbtn--ghost vbtn--wide', type: 'button', text: 'New course',
            onclick: () => {
              if (!window.confirm('Start a new course? What you have done here goes.')) return;
              save.course = null;
              save.done = [];
              keep();
              step = 0;
              drawAsk();
            },
          }),
        ]),

        el('img', { class: 'railmascot', src: 'assets/img/vlipy/heart.png', alt: '', width: 320, height: 320 }),
      ]),
    ]),
  ]));
}

/* ---------- a lesson ---------- */

const run = {
  unit: 0, lesson: 0, title: '',
  teach: [], card: 0,
  questions: [], at: 0,
  hearts: 3, right: 0, picked: null, checked: false,
};

async function openLesson(unit, lesson) {
  const course = save.course;
  const which = course.units[unit].lessons[lesson];

  drawBusy(which.title, 'Vlipy is writing this one: what it teaches, then the questions about it.', 'idea');

  try {
    const answer = await ask({
      action: 'lesson',
      sector: course.sector,
      unit: course.units[unit].title,
      title: which.title,
      language: course.language,
      reading: course.reading,
    });

    Object.assign(run, {
      unit, lesson, title: which.title,
      teach: answer.teach || [], card: 0,
      questions: answer.questions, at: 0,
      hearts: 3, right: 0, picked: null, checked: false,
    });

    drawTeach();
  } catch (error) {
    toast(error.message, 'bad');
    drawPath();
  }
}

/* A lesson teaches before it asks. Being questioned about something nobody
   explained is a test, and this is not a test. */
function drawTeach() {
  const card = run.teach[run.card];
  if (!card) return drawQuestion();

  const app = $('app');
  app.replaceChildren();

  const last = run.card === run.teach.length - 1;

  app.append(el('div', { class: 'lesson' }, [
    el('div', { class: 'lesson__top' }, [
      el('button', {
        class: 'ask__back', type: 'button', title: 'Leave this lesson', text: '✕',
        onclick: () => { if (window.confirm('Leave this lesson? It will not be marked as done.')) drawPath(); },
      }),
      el('div', { class: 'bar' }, [el('i', { style: `width:${(run.card / (run.teach.length + run.questions.length)) * 100}%` })]),
      el('span', { class: 'lesson__step', text: `${run.card + 1} / ${run.teach.length}` }),
    ]),

    el('div', { class: 'lesson__body' }, [
      el('span', { class: 'lesson__kind', text: run.title }),
      el('div', { class: 'teach' }, [
        el('div', { class: 'teach__said' }, [
          mascot(run.card === 0 ? 'wave' : run.card === 1 ? 'idea' : 'cool', ''),
          el('div', { class: 'bubble' }, [
            el('h3', { text: card.head }),
            el('p', { text: card.body }),
          ]),
        ]),
        card.example ? el('div', { class: 'teach__example' }, [
          el('b', { text: 'On the job' }),
          el('span', { text: card.example }),
        ]) : null,
      ]),
    ]),

    el('div', { class: 'lesson__foot' }, [
      el('div', {}, [
        el('span', { class: 'lesson__kind', text: last ? 'Then some questions about it' : 'Read this first' }),
        el('button', {
          class: 'vbtn vbtn--big', type: 'button',
          text: last ? 'Start the questions' : 'Got it',
          onclick: () => { run.card += 1; if (run.card >= run.teach.length) drawQuestion(); else drawTeach(); },
        }),
      ]),
    ]),
  ]));
}

const KINDS = { choice: 'Pick the right one', truefalse: 'True or false', gap: 'Fill the gap' };

function drawQuestion() {
  const question = run.questions[run.at];
  const app = $('app');
  app.replaceChildren();

  const options = el('div', { class: 'options' }, question.options.map((option, index) => el('button', {
    class: `option${run.picked === index ? ' is-on' : ''}${run.checked && index === question.answer ? ' is-right' : ''}${run.checked && run.picked === index && index !== question.answer ? ' is-wrong' : ''}`,
    type: 'button',
    disabled: run.checked,
    onclick: () => { run.picked = index; drawQuestion(); },
  }, [
    el('span', { class: 'option__key', text: String(index + 1) }),
    el('span', { text: option }),
  ])));

  const right = run.checked && run.picked === question.answer;

  const foot = el('div', { class: `lesson__foot${run.checked ? (right ? ' is-right' : ' is-wrong') : ''}` }, [
    el('div', {}, [
      run.checked
        ? el('div', { class: 'verdict' }, [
            mascot(right ? 'cheer' : 'wink', ''),
            el('div', {}, [
              el('b', { text: right ? 'That is it.' : `The answer is: ${question.options[question.answer]}` }),
              question.why ? el('span', { text: question.why }) : null,
            ]),
          ])
        : el('span', { class: 'lesson__kind', text: KINDS[question.kind] || KINDS.choice }),

      el('button', {
        class: `vbtn vbtn--big${run.checked ? (right ? ' vbtn--green' : '') : ''}`,
        type: 'button',
        text: run.checked ? (run.at === run.questions.length - 1 ? 'Finish' : 'Continue') : 'Check',
        disabled: !run.checked && run.picked === null,
        onclick: run.checked ? onwards : check,
      }),
    ]),
  ]);

  app.append(el('div', { class: 'lesson' }, [
    el('div', { class: 'lesson__top' }, [
      el('button', {
        class: 'ask__back', type: 'button', title: 'Leave this lesson', text: '✕',
        onclick: () => { if (window.confirm('Leave this lesson? It will not be marked as done.')) drawPath(); },
      }),
      el('div', { class: 'bar' }, [el('i', {
        style: `width:${((run.teach.length + run.at) / (run.teach.length + run.questions.length)) * 100}%`,
      })]),
      el('span', { class: 'lesson__hearts', text: `❤ ${run.hearts}` }),
    ]),

    el('div', { class: 'lesson__body' }, [
      el('p', { class: 'lesson__ask', text: question.ask }),
      options,
    ]),

    foot,
  ]));
}

function check() {
  run.checked = true;

  if (run.picked === run.questions[run.at].answer) run.right += 1;
  else run.hearts -= 1;

  drawQuestion();
}

function onwards() {
  if (run.hearts <= 0) return drawOut();

  run.at += 1;
  run.picked = null;
  run.checked = false;

  if (run.at >= run.questions.length) return finish();
  return drawQuestion();
}

/* Out of hearts: the lesson is not lost, it is just not finished. */
function drawOut() {
  const app = $('app');
  app.replaceChildren();

  app.append(el('div', { class: 'done' }, [
    el('div', { class: 'done__inner' }, [
      mascot('wink', ''),
      el('h2', { text: 'Out of hearts' }),
      el('p', { style: 'margin:0; color:var(--ink-2); font-weight:700', text: 'No harm done. Go through it again — the questions come out differently each time.' }),
      el('button', { class: 'vbtn vbtn--big', type: 'button', text: 'Try again', onclick: () => openLesson(run.unit, run.lesson) }),
      el('button', { class: 'vbtn vbtn--big vbtn--ghost', type: 'button', text: 'Back to the path', onclick: drawPath }),
    ]),
  ]));
}

function finish() {
  const mark = tag(run.unit, run.lesson);
  const fresh = !save.done.includes(mark);

  if (fresh) save.done.push(mark);

  const xp = run.right * 2 + (fresh ? 6 : 0);
  award(xp);

  const app = $('app');
  app.replaceChildren();

  app.append(el('div', { class: 'done' }, [
    el('div', { class: 'done__inner' }, [
      mascot('rocket', ''),
      el('h2', { text: 'Lesson done' }),
      el('div', { class: 'scores' }, [
        el('div', { class: 'score' }, [el('b', { class: 'is-xp', text: `+${xp}` }), el('span', { text: 'XP' })]),
        el('div', { class: 'score' }, [el('b', { text: `${run.right}/${run.questions.length}` }), el('span', { text: 'Right' })]),
        el('div', { class: 'score' }, [el('b', { class: 'is-fire', text: `🔥 ${save.streak}` }), el('span', { text: 'Streak' })]),
      ]),
      el('button', { class: 'vbtn vbtn--big vbtn--green', type: 'button', text: 'Carry on', onclick: drawPath }),
    ]),
  ]));
}

/* ---------- go ---------- */

read();

// Draw what this browser knows straight away, then let the account correct it.
if (save.course) drawPath();
else drawHello();

pull().then(() => {
  if (save.course) drawPath();
  else drawHello();
});
