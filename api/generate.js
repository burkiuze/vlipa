/* Describe a shop in a sentence, get a site back.

   The reply has to be a section list the editor understands, so the model is
   asked for JSON and the result is checked against the section types before it
   reaches the browser. */

import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { fail, json, methodGuard, parseCookies, readBody } from './_lib/http.js';
import { resolve } from './_lib/models.js';
import { chat } from './_lib/openrouter.js';
import { THEMES, blankSection, starterSite, themeById } from '../assets/js/studio/themes.js';

const ALLOWED = ['hero', 'features', 'products', 'gallery', 'about', 'quote', 'faq', 'cta'];

function clean(sections) {
  const out = [];

  for (const raw of Array.isArray(sections) ? sections.slice(0, 12) : []) {
    const type = String(raw && raw.type || '').toLowerCase();
    if (!ALLOWED.includes(type)) continue;

    const base = blankSection(type);
    const props = { ...base.props };
    const given = (raw && raw.props) || {};

    for (const key of Object.keys(props)) {
      const value = given[key];

      if (Array.isArray(props[key]) && Array.isArray(value)) {
        props[key] = value.slice(0, 8).map((item) => {
          const shape = { ...(props[key][0] || {}) };
          for (const field of Object.keys(shape)) {
            if (typeof item?.[field] === 'string') shape[field] = item[field].slice(0, 400);
          }
          return shape;
        });
      } else if (typeof value === 'string' && typeof props[key] === 'string') {
        props[key] = value.slice(0, 600);
      }
    }

    out.push({ ...base, props });
  }

  return out;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Sign in to use the studio.');

  const body = await readBody(req);
  const brief = String(body.brief || '').trim().slice(0, 1500);
  if (brief.length < 8) return fail(res, 400, 'Tell the studio a little more about the shop.');

  const theme = themeById(body.theme || 'aurora');

  try {
    const { role, model } = await resolve('vlipa-build');

    const system = [
      'You lay out shop websites. Reply with JSON only, no prose, no code fences.',
      'Shape: {"name":string,"brand":string,"description":string,"sections":[{"type":string,"props":object}]}',
      `Allowed section types: ${ALLOWED.join(', ')}.`,
      'Props per type:',
      'hero {eyebrow,title,text,primary,secondary}',
      'features {title, items:[{title,text}]}',
      'products {title, items:[{name,price,note}]}',
      'gallery {title}',
      'about {title,text}',
      'quote {text,author}',
      'faq {title, items:[{q,a}]}',
      'cta {title,text,button}',
      'Between five and eight sections, starting with hero and ending with cta.',
      'Write in the language of the brief. Real sentences, no lorem ipsum, no invented awards or numbers.',
      'Leave every image field out: the owner uploads their own photographs.',
    ].join(' ');

    const answer = await chat({
      model: model.id,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Theme: ${theme.name} (${theme.for}). Brief: ${brief}` },
      ],
      temperature: 0.8,
      maxTokens: 2600,
      json: true,
    });

    let parsed = {};
    try {
      const text = answer.text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    } catch {
      parsed = {};
    }

    const sections = clean(parsed.sections);
    const starter = starterSite(theme.id, parsed.name || brief.slice(0, 40));

    json(res, 200, {
      ok: true,
      site: {
        ...starter,
        name: String(parsed.name || starter.name).slice(0, 60),
        brand: String(parsed.brand || parsed.name || starter.brand).slice(0, 60),
        description: String(parsed.description || '').slice(0, 200),
        sections: sections.length >= 3 ? sections : starter.sections,
      },
      routed: { alias: 'vlipa-build', title: role.title,
                reason: 'A website was asked for, so the build model laid it out.' },
      recovered: sections.length < 3,
      themes: THEMES.map((t) => ({ id: t.id, name: t.name, for: t.for })),
    });
  } catch (error) {
    console.error('generate', error);
    fail(res, error.status || 500, error.message || 'The studio could not draft that site.');
  }
}
