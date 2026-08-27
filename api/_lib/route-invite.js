/* The shareable invitation link: vlipa.dev/invite/<link-name>

   GET  ?slug=elma    → the company's name and whether the link is open (no
                        sign-in needed)
   POST { slug }      → join through the link (sign-in needed) */

import { SESSION_COOKIE, userFromToken } from './auth.js';
import { callerKey, fail, json, methodGuard, parseCookies, readBody, withinLimit } from './http.js';
import { companyBySlug, membership, seat } from './org.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;

  try {
    if (req.method === 'GET') {
      const company = await companyBySlug(req.query?.slug);

      // A closed link and a name nobody has taken look the same from outside,
      // so the page cannot be used to find out which companies exist.
      if (!company || !company.linkOpen) {
        return json(res, 200, { ok: true, open: false });
      }

      const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
      const already = user ? await membership(company.id, user.id) : null;

      return json(res, 200, {
        ok: true,
        open: true,
        name: company.name,
        slug: company.slug,
        role: company.linkRole || 'member',
        signedIn: Boolean(user),
        member: Boolean(already),
      });
    }

    if (!withinLimit(`invite:${callerKey(req)}`, 10)) {
      return fail(res, 429, 'Slow down a little.');
    }

    const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
    if (!user) return fail(res, 401, 'Sign in first.');

    const body = await readBody(req);
    const company = await companyBySlug(body.slug);

    if (!company || !company.linkOpen) return fail(res, 404, 'This invitation link is closed, or does not exist.');

    const already = await membership(company.id, user.id);
    if (already) return json(res, 200, { ok: true, company, role: already.role, already: true });

    const record = await seat(company.id, user, company.linkRole || 'member');
    return json(res, 201, { ok: true, company, role: record.role });
  } catch (error) {
    console.error('[vlipa] invite:', error);
    return fail(res, 500, 'The invitation service is not answering right now.');
  }
}
