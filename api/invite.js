/* Paylaşılabilir davet linki: vlipa.dev/invite/<link-adı>

   GET  ?slug=elma    → şirketin adı ve link açık mı (giriş gerekmez)
   POST { slug }      → linkle katıl (giriş gerekir) */

import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { callerKey, fail, json, methodGuard, parseCookies, readBody, withinLimit } from './_lib/http.js';
import { companyBySlug, membership, seat } from './_lib/org.js';

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
      return fail(res, 429, 'Biraz yavaş.');
    }

    const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
    if (!user) return fail(res, 401, 'Önce giriş yap.');

    const body = await readBody(req);
    const company = await companyBySlug(body.slug);

    if (!company || !company.linkOpen) return fail(res, 404, 'Bu davet linki kapalı ya da yok.');

    const already = await membership(company.id, user.id);
    if (already) return json(res, 200, { ok: true, company, role: already.role, already: true });

    const record = await seat(company.id, user, company.linkRole || 'member');
    return json(res, 201, { ok: true, company, role: record.role });
  } catch (error) {
    console.error('[vlipa] invite:', error);
    return fail(res, 500, 'Davet servisi şu an cevap veremiyor.');
  }
}
