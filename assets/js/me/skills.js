/* Skills: the things you only want to say once.

   "Answer me in Turkish." "I write for lawyers, so be precise about terms."
   "When I ask for code, TypeScript, and no comments." Written once, switched
   on, and sent with every question after that.

   A skill is text, not a program. Nothing here reads it, matches on it or
   acts on it — it travels to the model beside the question and that is the
   whole mechanism, which is why it can say anything and why it cannot break
   anything. */

import { $, clear, dialog, el, field, toast, when } from '../studio/dom.js';
import { call, me } from './state.js';

/* Somewhere to start for anybody looking at an empty page. Each is a real
   instruction, not a category: pressing it opens the editor with the words
   already in, to be changed rather than accepted. */
const SUGGESTED = [
  {
    name: 'Answer in Turkish',
    note: 'Whatever language I write in',
    text: 'Always answer me in Turkish, even when I write to you in another language. Keep the technical terms in their original form where the Turkish one would be unclear.',
  },
  {
    name: 'Short answers',
    note: 'No preamble',
    text: 'Keep answers short. No preamble, no restating my question, no summary at the end. If a sentence would do, send a sentence.',
  },
  {
    name: 'How I write code',
    note: 'Your stack, your habits',
    text: 'When you write code for me: TypeScript over JavaScript, no framework unless I name one, and no comments that only restate the line below them. Show the whole file when it is short, and only the changed part when it is long.',
  },
  {
    name: 'About me',
    note: 'So you do not have to explain yourself twice',
    text: 'I run a small business and do most things myself. Assume I am short of time and comfortable with technical detail, and tell me what you would do rather than listing every option.',
  },
];

function editor(existing = {}) {
  const name = el('input', { value: existing.name || '', maxlength: 60, required: true, placeholder: 'Answer in Turkish' });
  const note = el('input', { value: existing.note || '', maxlength: 140, placeholder: 'A few words about when it applies' });

  const text = el('textarea', {
    rows: 7,
    maxlength: 4000,
    required: true,
    placeholder: 'Always answer me in Turkish…',
    text: existing.text || '',
  });

  dialog({
    title: existing.id ? 'Edit skill' : 'New skill',
    confirm: 'Save',
    body: [
      field('Name', name),
      field('When it applies', note, 'Only for you — Vlipa never sees this line.'),
      field('The instruction', text, 'Write it as if you were telling a colleague. It goes with every question while it is on.'),
    ],
    onConfirm: async () => {
      const data = await call({
        action: 'skill.save',
        skill: {
          id: existing.id,
          name: name.value,
          note: note.value,
          text: text.value,
          on: existing.id ? existing.on !== false : true,
        },
      });

      me.skills = data.skills;
      toast('Saved.');
      show();
    },
  });
}

async function setOn(skill, on) {
  const data = await call({ action: 'skill.save', skill: { ...skill, on } }).catch((error) => {
    toast(error.message, 'bad');
    return null;
  });

  if (!data) return show();

  me.skills = data.skills;
  show();
}

function card(skill) {
  const on = skill.on !== false;

  return el('article', { class: `skillcard${on ? ' is-on' : ''}` }, [
    el('div', { class: 'skillcard__top' }, [
      el('div', {}, [
        el('h4', { text: skill.name }),
        skill.note ? el('p', { class: 'muted', text: skill.note }) : null,
      ]),
      el('button', {
        class: 'switch',
        type: 'button',
        role: 'switch',
        'aria-checked': String(on),
        'aria-label': on ? `Switch off ${skill.name}` : `Switch on ${skill.name}`,
        onclick: () => setOn(skill, !on),
      }, [el('span')]),
    ]),

    el('p', { class: 'skillcard__text', text: skill.text }),

    el('div', { class: 'skillcard__foot' }, [
      el('span', { class: 'muted', text: skill.updatedAt ? `Changed ${when(skill.updatedAt)}` : '' }),
      el('span', { class: 'grow' }),
      el('button', { class: 'ghostlink', type: 'button', text: 'Edit', onclick: () => editor(skill) }),
      el('button', {
        class: 'ghostlink ghostlink--bad',
        type: 'button',
        text: 'Delete',
        onclick: async () => {
          if (!window.confirm(`Delete "${skill.name}"?`)) return;

          const data = await call({ action: 'skill.drop', id: skill.id }).catch((error) => {
            toast(error.message, 'bad');
            return null;
          });

          if (!data) return;
          me.skills = data.skills;
          show();
        },
      }),
    ]),
  ]);
}

export async function show() {
  const view = clear($('view'));
  const on = me.skills.filter((skill) => skill.on !== false).length;

  view.appendChild(el('div', { class: 'pagehead' }, [
    el('div', {}, [
      el('h2', { text: 'Skills' }),
      el('p', { class: 'muted', text: 'Standing instructions. Whatever is switched on goes with every question you ask.' }),
    ]),
    el('button', { class: 'btn', type: 'button', text: '+ New skill', onclick: () => editor() }),
  ]));

  if (!me.skills.length) {
    view.appendChild(el('div', { class: 'empty empty--big' }, [
      el('h3', { text: 'Nothing taught yet' }),
      el('p', { text: 'A skill is one thing you would otherwise repeat at the start of every conversation. Start from one of these, or write your own.' }),
    ]));

    view.appendChild(el('div', { class: 'cards' }, SUGGESTED.map((seed) => el('button', {
      class: 'card card--pick', type: 'button', onclick: () => editor(seed),
    }, [
      el('h4', { text: seed.name }),
      el('p', { class: 'muted', text: seed.text.slice(0, 110) + (seed.text.length > 110 ? '…' : '') }),
    ]))));

    return;
  }

  view.appendChild(el('p', {
    class: 'muted',
    text: on
      ? `${on} of ${me.skills.length} switched on.`
      : `${me.skills.length} written, none switched on — Vlipa is answering without them.`,
  }));

  view.appendChild(el('div', { class: 'skillgrid' }, me.skills.map(card)));
}
