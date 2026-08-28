/* Vlipy — learning a trade the way a language app teaches a language.

   Pick what you want to learn, answer four questions, and Vlipy writes you a
   course: five units, three lessons each, questions generated when you open
   a lesson. Nothing needs an account — everything you have done is kept in
   this browser — and a lesson is short enough to do while the kettle boils.

   The whole thing is one screen that swaps what it draws, so there is no
   router, no framework and nothing to load. */

import { LANGUAGES, RTL, SECTOR_NAMES, sectorsFor, wordsFor } from './vlipy-words.js';
import { areasFor, hasFields, namesOf, toolsFor } from './vlipy-fields.js';
import { textOfAll } from './pdf-text.js';
import { PAGES } from './studio/pages.js';

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

/* Google is offered only where the deployment has it configured, so nobody is
   shown a button that cannot work. */
let googleOn = false;

/* The company this account is in, if any, and what it has set Vlipy up to
   teach. Filled in by the same request that reads the saved progress. */
let company = null;

const GOOGLE_MARK = '<svg viewBox="0 0 18 18" aria-hidden="true" width="18" height="18">'
  + '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>'
  + '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>'
  + '<path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>'
  + '<path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>'
  + '</svg>';

const googleButton = (extra = '') => (googleOn
  ? el('a', { class: `vbtn vbtn--wide vbtn--google${extra}`, href: '/api/auth/google?next=%2Fvlipy' }, [
      el('span', { class: 'vbtn__mark', html: GOOGLE_MARK }),
      el('span', { text: say.withGoogle }),
    ])
  : null);

async function askGoogle() {
  try {
    const response = await fetch('/api/auth/providers');
    googleOn = Boolean((await response.json()).google);
  } catch { /* no button, the email form still works */ }
}

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
    company = answer.company || null;

    if (answer.progress?.course) {
      Object.assign(save, answer.progress);
      if (!Array.isArray(save.done)) save.done = [];
      try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* private mode */ }
    } else if (save.course) {
      push();   // signed in on a browser that already had a course
    }
  } catch {
    who = null;      // signed out, and that is allowed
    company = null;
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

/* Everything below the first question is shown in the language being taught,
   because somebody who asked to be taught in Turkish should not then be
   questioned in English. */
let say = wordsFor('English');

function speak(language) {
  say = wordsFor(language);
  document.documentElement.lang = language === 'Türkçe' ? 'tr' : language === 'English' ? 'en' : '';
  document.documentElement.dir = RTL.has(language) ? 'rtl' : 'ltr';
}

const reading = () => [
  { id: 'basic', emoji: '🐣', label: say.readingBasic, note: say.readingBasicNote },
  { id: 'ok', emoji: '🙂', label: say.readingOk, note: say.readingOkNote },
  { id: 'fluent', emoji: '🎯', label: say.readingFluent, note: say.readingFluentNote },
];

const known = () => [
  { id: 'new', emoji: '🌱', label: say.knownNew, note: say.knownNewNote },
  { id: 'some', emoji: '🌿', label: say.knownSome, note: say.knownSomeNote },
  { id: 'working', emoji: '🌳', label: say.knownWorking, note: say.knownWorkingNote },
];

const minutes = () => [
  { id: 5, emoji: '⚡', label: `5 ${say.minutes}`, note: say.minutes5Note },
  { id: 10, emoji: '🔥', label: `10 ${say.minutes}`, note: say.minutes10Note },
  { id: 20, emoji: '🚀', label: `20 ${say.minutes}`, note: say.minutes20Note },
];

const wanted = { language: '', reading: '', sector: '', own: '', areas: [], tools: [], known: '', minutes: 0 };

const sectorLabel = () => sectorsFor(wanted.language).find((one) => one.id === wanted.sector)?.label || '';

/* The language comes first, and it is the one question asked in every
   language at once — the names are their own.

   Two of them only appear once a sector is known, because they are made of
   it: somebody learning software is asked about cyber security and Rust,
   somebody learning agriculture about irrigation and drones. A sector typed
   in by hand has no such lists, so those two steps are simply not there. */
const steps = () => {
  const inside = hasFields(wanted.sector) ? [
    {
      said: say.askAreas.replace('%s', sectorLabel()),
      note: say.askAreasNote,
      options: areasFor(wanted.sector, wanted.language),
      field: 'areas', pose: 'idea', many: true,
    },
    {
      said: say.askTools,
      note: say.askToolsNote,
      options: toolsFor(wanted.sector, wanted.language),
      field: 'tools', pose: 'cool', many: true,
    },
  ] : [];

  return [
    { said: say.askLang, options: LANGUAGES, field: 'language', pose: 'wave' },
    { said: say.askReading, options: reading(), field: 'reading', pose: 'idea' },
    { said: say.askSector, options: sectorsFor(wanted.language), field: 'sector', pose: 'laptop', own: true },
    ...inside,
    { said: say.askKnown, options: known(), field: 'known', pose: 'cheer' },
    { said: say.askTime, options: minutes(), field: 'minutes', pose: 'rocket' },
  ];
};

let step = 0;

function drawAsk() {
  drawRail();

  const STEPS = steps();
  const here = STEPS[step];
  const app = $('app');
  app.replaceChildren();

  const body = el('div', { class: 'ask__body' });

  body.append(el('div', { class: 'ask__said' }, [
    mascot(here.pose, 'Vlipy'),
    el('div', { class: 'bubble' }, [
      el('span', { text: here.said }),
      here.note ? el('em', { class: 'bubble__note', text: here.note }) : null,
    ]),
  ]));

  const own = el('input', {
    id: 'ownTrade',
    placeholder: say.ownHint,
    maxlength: 60,
    value: wanted.own,
    oninput: (event) => {
      wanted.own = event.target.value;
      $('askNext').disabled = !event.target.value.trim();
    },
    onkeydown: (event) => { if (event.key === 'Enter' && wanted.own.trim()) next(); },
  });

  const ownField = el('div', { class: 'ownfield', id: 'ownField', hidden: wanted.sector !== 'own' }, [own]);

  const holding = (option) => (here.many
    ? wanted[here.field].includes(option.id)
    : wanted[here.field] === option.id);

  const picks = el('div', { class: `picks${here.many ? ' picks--many' : ''}` }, here.options.map((option) => el('button', {
    class: `pick${holding(option) ? ' is-on' : ''}`,
    type: 'button',
    'data-id': String(option.id),
    onclick: () => {
      // A question that takes several answers toggles; the rest replace.
      if (here.many) {
        const held = wanted[here.field];
        const at = held.indexOf(option.id);
        if (at >= 0) held.splice(at, 1);
        else held.push(option.id);
      } else {
        wanted[here.field] = option.id;
      }

      // Picking the language changes every word after this one.
      if (here.field === 'language') speak(option.id);

      // And picking a different sector throws away what was ticked inside
      // the old one, which belonged to it.
      if (here.field === 'sector') { wanted.areas = []; wanted.tools = []; }

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

  // Ticking nothing is an answer too: it means the whole sector.
  if (here.many) {
    body.append(el('p', {
      class: 'ask__tally',
      text: wanted[here.field].length ? `${wanted[here.field].length} ${say.picked}` : say.allOfIt,
    }));
  }

  const ready = here.many
    || (Boolean(wanted[here.field]) && (here.field !== 'sector' || wanted.sector !== 'own' || wanted.own.trim()));

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
          text: step === STEPS.length - 1 ? say.build : say.next,
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
  if (step < steps().length - 1) {
    step += 1;
    return drawAsk();
  }

  return build();
}

/* ---------- the panel down the left ---------- */

/* The studio's own menu, drawn here too. Vlipy is a page of the workspace as
   far as anybody using it is concerned, so it shows the workspace's rail
   rather than a second menu with different words in it — the list comes from
   the studio itself, so the two cannot drift apart. Every entry but this one
   leaves for the studio. */

const FOLD_ARROW = '<svg viewBox="0 0 24 24" fill="none"><path d="M8 10l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const railIcon = (path) => `<svg viewBox="0 0 24 24" fill="none"><path d="${path}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function drawRail() {
  const rail = $('rail');
  if (!rail) return;

  rail.replaceChildren();

  rail.append(el('a', { class: 'vrail__top', href: '/' }, [
    el('img', { class: 'vrail__mark', src: 'assets/img/vlipa-ai-96.png', alt: '', width: 26, height: 26 }),
    el('b', { text: 'vlipa' }),
  ]));

  const items = el('div', { class: 'vrail__items' });

  for (const item of PAGES) {
    const here = item.id === 'vlipy';

    items.append(el('a', {
      class: `vrail__item${here ? ' is-on' : ''}`,
      href: here ? '/vlipy' : `/studio#/${item.id}`,
      title: item.label,
      'aria-current': String(here),
    }, [
      el('span', { class: 'vrail__ico', html: railIcon(item.icon) }),
      el('span', { class: 'vrail__label', text: item.label }),
      here && company?.mayManage ? el('span', { class: 'vrail__fold', html: FOLD_ARROW }) : null,
    ]));

    // Vlipy's own entry folds open where the studio's does, and holds the
    // same two things: the course, and building one for the company.
    if (here && company?.mayManage) {
      items.append(el('div', { class: 'vrail__sub' }, [
        el('button', {
          class: 'vrail__subitem', type: 'button', text: say.railLearn,
          onclick: () => { if (save.course) drawPath(); else drawHello(); },
        }),
        el('button', {
          class: 'vrail__subitem', type: 'button', text: say.coSetup,
          onclick: drawCompany,
        }),
      ]));
    }
  }

  rail.append(items);

  rail.append(el('div', { class: 'vrail__foot' }, [
    who
      ? el('span', { class: 'vrail__who', text: who })
      : el('a', { class: 'vrail__item', href: '/login?next=%2Fvlipy' }, [
          el('span', { class: 'vrail__ico', html: railIcon('M12 12.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM4.8 20c0-3.6 3.2-6 7.2-6s7.2 2.4 7.2 6') }),
          el('span', { class: 'vrail__label', text: say.signIn }),
        ]),
  ]));
}

/* ---------- what you have done so far ---------- */

function drawProgress() {

  const app = $('app');
  app.replaceChildren();

  const units = save.course?.units || [];
  const total = units.reduce((count, unit) => count + unit.lessons.length, 0);
  const done = save.done.length;

  app.append(el('div', { class: 'sheetpage' }, [
    el('div', { class: 'sheetpage__inner' }, [
      el('h2', { text: say.railProgress }),

      el('div', { class: 'tally tally--wide' }, [
        el('div', {}, [el('b', { class: 'is-fire', text: `🔥 ${save.streak || 0}` }), el('span', { text: say.streak })]),
        el('div', {}, [el('b', { class: 'is-xp', text: `⭐ ${save.xp || 0}` }), el('span', { text: say.xp })]),
        el('div', {}, [el('b', { text: `${done}/${total || 0}` }), el('span', { text: say.lessons })]),
      ]),

      el('div', { class: 'card' }, [
        el('h4', { text: say.today }),
        el('div', { class: 'goal' }, [
          el('div', { class: 'goal__bar' }, [
            el('i', { style: `width:${Math.min(100, ((save.todayXp || 0) / save.goal) * 100)}%` }),
          ]),
          el('span', { text: `${save.todayXp || 0} / ${save.goal} XP` }),
        ]),
      ]),

      units.length
        ? el('div', { class: 'card' }, [
            el('h4', { text: save.course.title }),
            el('ul', { class: 'unitlist' }, units.map((unit, index) => {
              const inside = unit.lessons.filter((lesson, at) => save.done.includes(tag(index, at))).length;

              return el('li', { class: inside === unit.lessons.length ? 'is-done' : '' }, [
                el('span', { text: `${say.unit} ${index + 1} · ${unit.title}` }),
                el('b', { text: `${inside}/${unit.lessons.length}` }),
              ]);
            })),
          ])
        : el('p', { class: 'muted', text: say.noCourse }),

      el('button', { class: 'vbtn vbtn--ghost', type: 'button', text: say.backToPath, onclick: () => { if (save.course) drawPath(); else drawHello(); } }),
    ]),
  ]));
}

/* ---------- the company's own course ---------- */

/* Two screens in one. Whoever runs the company sets it up: names the
   departments and hands over the material Vlipy should teach from. Everybody
   else picks their department and gets a course written out of it — twenty
   lessons about this company rather than about the trade in general. */

function drawCompany() {
  drawRail();

  const app = $('app');
  app.replaceChildren();

  const inner = el('div', { class: 'sheetpage__inner' });

  inner.append(
    el('h2', { text: company.name }),
    el('p', { class: 'muted', text: company.mayManage ? say.coOwnerNote : say.coNote }),
  );

  if (company.departments.length) {
    inner.append(el('div', { class: 'card' }, [
      el('h4', { text: say.coPick }),
      el('div', { class: 'picks picks--many' }, company.departments.map((name) => el('button', {
        class: 'pick',
        type: 'button',
        'data-id': name,
        onclick: () => buildForCompany(name),
      }, [
        el('span', { class: 'pick__emoji', text: '🏢' }),
        el('span', { class: 'pick__text' }, [el('b', { text: name })]),
      ]))),
    ]));
  } else {
    inner.append(el('p', { class: 'muted', text: say.coEmpty }));
  }

  if (company.mayManage) inner.append(setupCard());

  inner.append(el('button', {
    class: 'vbtn vbtn--ghost', type: 'button', text: say.backToPath,
    onclick: () => { if (save.course) drawPath(); else drawHello(); },
  }));

  app.append(el('div', { class: 'sheetpage' }, [inner]));
}

/* The owner's half: the departments, and the material. */
function setupCard() {
  let names = [...company.departments];
  let material = '';
  let picked = [];

  const chips = el('div', { class: 'deptchips' });

  const drawChips = () => {
    chips.replaceChildren(...names.map((name) => el('span', { class: 'deptchip' }, [
      el('b', { text: name }),
      el('button', {
        class: 'deptchip__x', type: 'button', title: 'Remove', text: '×',
        onclick: () => { names = names.filter((one) => one !== name); drawChips(); },
      }),
    ])));
  };

  const entry = el('input', {
    class: 'deptinput',
    placeholder: say.coDeptHint,
    maxlength: 40,
    onkeydown: (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();

      const name = event.target.value.trim();
      if (!name || names.includes(name) || names.length >= 12) return;

      names.push(name);
      event.target.value = '';
      drawChips();
    },
  });

  const held = el('p', { class: 'muted', text: company.letters
    ? say.coHeld.replace('%n', String(company.letters)).replace('%f', String(company.files?.length || 0))
    : say.coNothingHeld });

  const drop = el('input', {
    id: 'coFiles',
    type: 'file',
    multiple: true,
    accept: '.pdf,.txt,.md,.csv,text/plain,application/pdf',
    onchange: async (event) => {
      const files = [...event.target.files];
      if (!files.length) return;

      held.textContent = say.coReading;

      const result = await textOfAll(files);
      material = result.text;
      picked = result.read;

      held.textContent = result.read.length
        ? say.coRead.replace('%f', result.read.join(', ')).replace('%n', String(material.length))
        : '';

      if (result.failed.length) toast(result.failed[0], 'bad');
    },
  });

  const typed = el('textarea', {
    class: 'comaterial',
    rows: 5,
    maxlength: 60000,
    placeholder: say.coPasteHint,
  });

  const site = el('input', {
    class: 'deptinput',
    type: 'url',
    maxlength: 400,
    value: company.site || '',
    placeholder: 'https://sirketiniz.com/hakkimizda',
  });

  drawChips();

  return el('div', { class: 'card card--setup' }, [
    el('h4', { text: say.coSetup }),
    el('p', { class: 'muted', text: say.coSetupNote }),

    el('label', { class: 'colabel', text: say.coDepartments }),
    chips,
    entry,

    el('label', { class: 'colabel', text: say.coMaterial }),
    held,
    drop,
    typed,

    el('label', { class: 'colabel', text: say.coSite }),
    site,

    el('button', {
      class: 'vbtn vbtn--wide', type: 'button', text: say.coSave,
      onclick: async (event) => {
        const stray = entry.value.trim();
        if (stray && !names.includes(stray) && names.length < 12) names.push(stray);

        if (!names.length) return toast(say.coNeedDept, 'bad');

        const button = event.currentTarget;
        button.disabled = true;

        try {
          const both = [material, typed.value.trim()].filter(Boolean).join('\n\n');
          const address = site.value.trim();

          if (address) button.textContent = say.coReadingSite;

          const answer = await ask({
            action: 'company',
            set: true,
            companyId: company.id,
            departments: names,
            // Sending nothing leaves what is already there alone, so an owner
            // adding a department does not wipe last month's handbook.
            material: both || undefined,
            site: address && address !== company.site ? address : undefined,
            files: picked,
          });

          Object.assign(company, answer.company);
          toast(say.coSaved);
          drawCompany();
        } catch (error) {
          toast(error.message, 'bad');
        } finally {
          button.disabled = false;
          button.textContent = say.coSave;
        }
      },
    }),
  ]);
}

async function buildForCompany(department) {
  drawBusy(say.busyCourse, say.coBusyNote);

  try {
    const answer = await ask({
      action: 'companyPlan',
      companyId: company.id,
      companyName: company.name,
      department,
      language: wanted.language || save.course?.language || 'English',
      reading: wanted.reading || 'ok',
      known: wanted.known || 'new',
      minutes: wanted.minutes || 10,
    });

    save.course = answer.course;
    save.done = [];
    keep();
    drawPath();
  } catch (error) {
    toast(error.message, 'bad');
    drawCompany();
  }
}

/* ---------- the front page ---------- */

function drawHello() {
  drawRail();
  const app = $('app');
  app.replaceChildren();

  app.append(el('div', { class: 'hello' }, [
    el('div', { class: 'hello__inner' }, [
      el('img', { class: 'hello__mascot', src: 'assets/img/vlipy/hero.png', alt: 'Vlipy', width: 460, height: 460 }),
      el('h1', { text: say.heroTitle }),
      el('p', { text: say.heroBlurb }),
      el('div', { class: 'hello__acts' }, [
        el('button', {
          class: 'vbtn vbtn--big vbtn--wide', type: 'button', text: say.start,
          onclick: () => { step = 0; drawAsk(); },
        }),
        save.course
          ? el('button', {
              class: 'vbtn vbtn--big vbtn--wide vbtn--ghost', type: 'button', text: say.carryOn,
              onclick: drawPath,
            })
          : null,
      ]),
      company
        ? el('button', {
            class: 'vbtn vbtn--big vbtn--wide vbtn--ghost', type: 'button',
            text: say.coStart.replace('%c', company.name),
            onclick: drawCompany,
          })
        : null,
      googleOn && !who ? el('div', { class: 'hello__google' }, [googleButton()]) : null,
      el('p', { class: 'hello__home' }, [
        `${say.partOf} `,
        el('a', { class: 'vlink', href: '/', text: 'vlipa' }),
        ` · ${say.noAccount}`,
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

  drawBusy(say.busyCourse, say.busyCourseNote);

  try {
    const answer = await ask({
      action: 'plan',
      sector: SECTOR_NAMES[sector] || sector,
      areas: namesOf(wanted.sector, 'areas', wanted.areas),
      tools: namesOf(wanted.sector, 'tools', wanted.tools),
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
  drawRail();
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
          el('b', { text: `${say.unit} ${index + 1}` }),
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
      el('h4', { text: say.allDone }),
      el('p', { style: 'margin:0 0 12px; color:var(--ink-2); font-weight:700', text: say.allDoneNote }),
      el('button', { class: 'vbtn', type: 'button', text: say.another, onclick: () => { step = 0; drawAsk(); } }),
    ]));
  }

  app.append(el('div', {}, [
    el('div', { class: 'learn' }, [
      el('div', {}, [
        el('div', { class: 'learn__head' }, [
          el('div', {}, [
            el('b', { text: `${save.done.length} / ${total} ${say.lessons}` }),
            el('h2', { text: save.course.title }),
          ]),
          el('a', { class: 'vbtn vbtn--ghost', href: '/', text: 'vlipa' }),
        ]),
        path,
      ]),

      el('div', { class: 'rail' }, [
        el('div', { class: 'card' }, [
          el('div', { class: 'tally' }, [
            el('div', {}, [el('b', { class: 'is-fire', text: `🔥 ${save.streak || 0}` }), el('span', { text: say.streak })]),
            el('div', {}, [el('b', { class: 'is-xp', text: `⭐ ${save.xp || 0}` }), el('span', { text: say.xp })]),
          ]),
          el('button', { class: 'cardlink', type: 'button', text: say.railProgress, onclick: drawProgress }),
        ]),

        company
          ? el('div', { class: 'card card--co' }, [
              el('h4', { text: company.name }),
              el('p', { style: 'margin:0 0 10px; color:var(--ink-2); font-size:13px; font-weight:700', text: company.mayManage ? say.coOwnerShort : say.coShort }),
              el('button', { class: 'vbtn vbtn--wide', type: 'button', text: say.railCompany, onclick: drawCompany }),
            ])
          : null,

        el('div', { class: 'card' }, [
          el('h4', { text: say.today }),
          el('div', { class: 'goal' }, [
            el('div', { class: 'goal__bar' }, [
              el('i', { style: `width:${Math.min(100, ((save.todayXp || 0) / save.goal) * 100)}%` }),
            ]),
            el('span', { text: `${save.todayXp || 0} / ${save.goal} XP` }),
          ]),
        ]),

        save.course.note
          ? el('div', { class: 'card' }, [el('h4', { text: say.about }), el('p', { style: 'margin:0; color:var(--ink-2); font-size:13.5px; font-weight:700; line-height:1.55', text: save.course.note })])
          : null,

        who
          ? el('div', { class: 'card card--kept' }, [
              el('h4', { text: say.saved }),
              el('p', { style: 'margin:0; color:var(--ink-2); font-size:13px; font-weight:700', text: say.savedNote }),
            ])
          : el('div', { class: 'card card--nudge' }, [
              el('h4', { text: say.keep }),
              el('p', { style: 'margin:0 0 10px; color:var(--ink-2); font-size:13px; font-weight:700', text: say.keepNote }),
              googleButton(),
              el('a', { class: 'vbtn vbtn--wide', href: '/signup?next=%2Fvlipy', text: say.profile, style: googleOn ? 'margin-top:8px' : '' }),
              el('a', { class: 'vbtn vbtn--wide vbtn--ghost', href: '/login?next=%2Fvlipy', text: say.signIn, style: 'margin-top:8px' }),
            ]),

        el('div', { class: 'card' }, [
          el('h4', { text: say.startOver }),
          el('p', { style: 'margin:0 0 10px; color:var(--ink-2); font-size:13px; font-weight:700', text: say.startOverNote }),
          el('button', {
            class: 'vbtn vbtn--ghost vbtn--wide', type: 'button', text: say.newCourse,
            onclick: () => {
              if (!window.confirm(say.confirmNew)) return;
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

  drawBusy(which.title, say.busyLesson, 'idea');

  try {
    const answer = await ask({
      action: 'lesson',
      companyId: course.companyId,
      sector: course.sector,
      areas: course.areas || [],
      tools: course.tools || [],
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
        onclick: () => { if (window.confirm(say.leave)) drawPath(); },
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
          el('b', { text: say.onJob }),
          el('span', { text: card.example }),
        ]) : null,
      ]),
    ]),

    el('div', { class: 'lesson__foot' }, [
      el('div', {}, [
        el('span', { class: 'lesson__kind', text: last ? say.thenQuestions : say.readFirst }),
        el('button', {
          class: 'vbtn vbtn--big', type: 'button',
          text: last ? say.startQuestions : say.gotIt,
          onclick: () => { run.card += 1; if (run.card >= run.teach.length) drawQuestion(); else drawTeach(); },
        }),
      ]),
    ]),
  ]));
}

const kindOf = (kind) => ({ choice: say.kindChoice, truefalse: say.kindTruefalse, gap: say.kindGap }[kind] || say.kindChoice);

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
              el('b', { text: right ? say.correct : `${say.answerIs} ${question.options[question.answer]}` }),
              question.why ? el('span', { text: question.why }) : null,
            ]),
          ])
        : el('span', { class: 'lesson__kind', text: kindOf(question.kind) }),

      el('button', {
        class: `vbtn vbtn--big${run.checked ? (right ? ' vbtn--green' : '') : ''}`,
        type: 'button',
        text: run.checked ? (run.at === run.questions.length - 1 ? say.finish : say.continue) : say.check,
        disabled: !run.checked && run.picked === null,
        onclick: run.checked ? onwards : check,
      }),
    ]),
  ]);

  app.append(el('div', { class: 'lesson' }, [
    el('div', { class: 'lesson__top' }, [
      el('button', {
        class: 'ask__back', type: 'button', title: say.leave, text: '✕',
        onclick: () => { if (window.confirm(say.leave)) drawPath(); },
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
      el('h2', { text: say.outTitle }),
      el('p', { style: 'margin:0; color:var(--ink-2); font-weight:700', text: say.outNote }),
      el('button', { class: 'vbtn vbtn--big', type: 'button', text: say.tryAgain, onclick: () => openLesson(run.unit, run.lesson) }),
      el('button', { class: 'vbtn vbtn--big vbtn--ghost', type: 'button', text: say.backToPath, onclick: drawPath }),
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
      el('h2', { text: say.doneTitle }),
      el('div', { class: 'scores' }, [
        el('div', { class: 'score' }, [el('b', { class: 'is-xp', text: `+${xp}` }), el('span', { text: say.xp })]),
        el('div', { class: 'score' }, [el('b', { text: `${run.right}/${run.questions.length}` }), el('span', { text: say.right })]),
        el('div', { class: 'score' }, [el('b', { class: 'is-fire', text: `🔥 ${save.streak}` }), el('span', { text: say.streak })]),
      ]),
      el('button', { class: 'vbtn vbtn--big vbtn--green', type: 'button', text: say.carry, onclick: drawPath }),
    ]),
  ]));
}

/* ---------- go ---------- */

read();

// A course that is already going says which language to speak.
if (save.course?.language) {
  speak(save.course.language);
  wanted.language = save.course.language;
}

// Draw what this browser knows straight away, then let the account correct it.
drawRail();
if (save.course) drawPath();
else drawHello();

/* The studio's menu can send somebody straight to the course builder. */
const wantsCourse = () => window.location.hash === '#course';

Promise.all([askGoogle(), pull()]).then(() => {
  if (save.course?.language) {
    speak(save.course.language);
    wanted.language = save.course.language;
  }

  drawRail();

  if (company && wantsCourse()) return drawCompany();
  if (save.course) return drawPath();
  return drawHello();
});
