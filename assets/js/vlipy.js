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

function keep() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch { /* private mode */ }
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

const TRADES = [
  { id: 'software', emoji: '💻', label: 'Software', note: 'Writing and shipping code' },
  { id: 'design', emoji: '🎨', label: 'Design', note: 'Interfaces and brand' },
  { id: 'sales', emoji: '🤝', label: 'Sales', note: 'Finding and closing work' },
  { id: 'marketing', emoji: '📣', label: 'Marketing', note: 'Getting people to hear about it' },
  { id: 'ecommerce', emoji: '🛒', label: 'E-commerce', note: 'Running a shop online' },
  { id: 'accounting', emoji: '🧮', label: 'Accounting', note: 'Books, invoices, tax' },
  { id: 'barista', emoji: '☕', label: 'Barista', note: 'Coffee, properly' },
  { id: 'cooking', emoji: '🍳', label: 'Kitchen', note: 'Cooking as a job' },
  { id: 'hairdressing', emoji: '💇', label: 'Hairdressing', note: 'Cutting and colour' },
  { id: 'electrics', emoji: '🔌', label: 'Electrics', note: 'Wiring and repair' },
  { id: 'photography', emoji: '📷', label: 'Photography', note: 'Shooting and editing' },
  { id: 'logistics', emoji: '🚚', label: 'Logistics', note: 'Stock, shipping, routes' },
  { id: 'support', emoji: '🎧', label: 'Customer service', note: 'Handling people well' },
  { id: 'realestate', emoji: '🏠', label: 'Property', note: 'Listing and letting' },
  { id: 'fitness', emoji: '🏋️', label: 'Fitness coaching', note: 'Training other people' },
  { id: 'own', emoji: '✏️', label: 'Something else', note: 'Say it in your own words' },
];

const LANGUAGES = [
  { id: 'Türkçe', emoji: '🇹🇷', label: 'Türkçe' },
  { id: 'English', emoji: '🇬🇧', label: 'English' },
  { id: 'Deutsch', emoji: '🇩🇪', label: 'Deutsch' },
  { id: 'Español', emoji: '🇪🇸', label: 'Español' },
  { id: 'Français', emoji: '🇫🇷', label: 'Français' },
  { id: 'العربية', emoji: '🇸🇦', label: 'العربية' },
];

const LEVELS = [
  { id: 'new', emoji: '🌱', label: 'Never done it', note: 'Start from nothing' },
  { id: 'some', emoji: '🌿', label: 'A little', note: 'I have tried it' },
  { id: 'working', emoji: '🌳', label: 'I work in it', note: 'I want to get better' },
];

const MINUTES = [
  { id: 5, emoji: '⚡', label: '5 minutes', note: 'A lesson a day' },
  { id: 10, emoji: '🔥', label: '10 minutes', note: 'Steady' },
  { id: 20, emoji: '🚀', label: '20 minutes', note: 'Serious about it' },
];

const wanted = { trade: '', own: '', language: 'Türkçe', level: '', minutes: 0 };

const STEPS = [
  {
    said: 'What do you want to learn?',
    options: TRADES,
    field: 'trade',
    pose: 'wave',
    own: true,
  },
  { said: 'Which language should I teach in?', options: LANGUAGES, field: 'language', pose: 'idea' },
  { said: 'How much do you know already?', options: LEVELS, field: 'level', pose: 'laptop' },
  { said: 'How long have you got each day?', options: MINUTES, field: 'minutes', pose: 'cheer' },
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
    placeholder: 'Bee-keeping, tiling, running a bakery…',
    maxlength: 60,
    value: wanted.own,
    oninput: (event) => {
      wanted.own = event.target.value;
      $('askNext').disabled = !event.target.value.trim();
    },
    onkeydown: (event) => { if (event.key === 'Enter' && wanted.own.trim()) next(); },
  });

  const ownField = el('div', { class: 'ownfield', id: 'ownField', hidden: wanted.trade !== 'own' }, [own]);

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

  const ready = Boolean(wanted[here.field]) && (here.field !== 'trade' || wanted.trade !== 'own' || wanted.own.trim());

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
      el('img', { class: 'hello__mascot', src: 'assets/img/vlipy/wave.png', alt: 'Vlipy', width: 320, height: 320 }),
      el('h1', { text: 'Learn the job, five minutes at a time' }),
      el('p', { text: 'Vlipy teaches a trade the way a language app teaches a language: short lessons, one idea each, and a path you can see the end of. Tell it what you want to learn and it writes the course.' }),
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
  const trade = wanted.trade === 'own'
    ? wanted.own.trim()
    : (TRADES.find((item) => item.id === wanted.trade)?.label || wanted.trade);

  drawBusy('Writing your course…', 'Vlipy is working out what to teach first, and what has to wait until you know it.');

  try {
    const answer = await ask({
      action: 'plan',
      trade,
      language: wanted.language,
      level: wanted.level,
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

const run = { unit: 0, lesson: 0, questions: [], at: 0, hearts: 3, right: 0, picked: null, checked: false };

async function openLesson(unit, lesson) {
  const course = save.course;
  const which = course.units[unit].lessons[lesson];

  drawBusy(which.title, 'Vlipy is writing the questions for this one.', 'idea');

  try {
    const answer = await ask({
      action: 'lesson',
      trade: course.trade,
      unit: course.units[unit].title,
      title: which.title,
      about: which.about,
      language: course.language,
    });

    Object.assign(run, {
      unit, lesson, questions: answer.questions, at: 0, hearts: 3, right: 0, picked: null, checked: false,
    });

    drawQuestion();
  } catch (error) {
    toast(error.message, 'bad');
    drawPath();
  }
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
      el('div', { class: 'bar' }, [el('i', { style: `width:${(run.at / run.questions.length) * 100}%` })]),
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

// Somebody who already has a course wants the path, not the front door.
if (save.course) drawPath();
else drawHello();
