/* A visitor's saved sites: list, save, delete, publish, unpublish. */

import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { fail, json, methodGuard, parseCookies, readBody } from './_lib/http.js';
import * as store from './_lib/store.js';

const MAX_SITES = 25;
const MAX_BYTES = 3_000_000;
const RESERVED = ['www', 'api', 'app', 'studio', 'admin', 'mail', 'blog', 'docs', 'dev',
                  'vlipa', 'status', 'cdn', 'assets', 'shop', 'store', 'test'];

function slugOk(slug) {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/.test(slug)) {
    return 'Use 3 to 30 characters: lowercase letters, numbers and dashes.';
  }
  if (RESERVED.includes(slug)) return 'That name is reserved.';
  return null;
}

function trim(site) {
  return {
    id: site.id, name: site.name, brand: site.brand, theme: site.theme,
    slug: site.slug || '', published: Boolean(site.published),
    sections: (site.sections || []).length, updatedAt: site.updatedAt,
  };
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST', 'DELETE'])) return;

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Sign in to use the studio.');

  const key = (id) => `site:${id}`;
  const own = `sites:${user.id}`;

  try {
    if (req.method === 'GET') {
      const id = req.query.id;

      if (id) {
        const site = await store.get(key(id));
        if (!site || site.ownerId !== user.id) return fail(res, 404, 'No such site.');
        return json(res, 200, { ok: true, site });
      }

      const ids = await store.members(own);
      const sites = [];

      for (const each of ids) {
        const site = await store.get(key(each));
        if (site && site.ownerId === user.id) sites.push(trim(site));
      }

      sites.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return json(res, 200, { ok: true, sites });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '');
      const site = await store.get(key(id));
      if (!site || site.ownerId !== user.id) return fail(res, 404, 'No such site.');

      if (site.slug) await store.del(`slug:${site.slug}`);
      await store.del(key(id));
      await store.removeFrom(own, id);
      return json(res, 200, { ok: true });
    }

    const body = await readBody(req);

    /* ---- publish / unpublish ---- */
    if (body.action === 'publish' || body.action === 'unpublish') {
      const site = await store.get(key(body.id));
      if (!site || site.ownerId !== user.id) return fail(res, 404, 'No such site.');

      if (body.action === 'unpublish') {
        if (site.slug) await store.del(`slug:${site.slug}`);
        site.published = false;
        await store.set(key(site.id), site);
        return json(res, 200, { ok: true, site: trim(site) });
      }

      const slug = String(body.slug || '').trim().toLowerCase();
      const problem = slugOk(slug);
      if (problem) return fail(res, 400, problem, { field: 'slug' });

      const taken = await store.get(`slug:${slug}`);
      if (taken && taken !== site.id) return fail(res, 409, 'That address is taken.', { field: 'slug' });

      if (site.slug && site.slug !== slug) await store.del(`slug:${site.slug}`);

      site.slug = slug;
      site.published = true;
      site.updatedAt = new Date().toISOString();

      await store.set(`slug:${slug}`, site.id);
      await store.set(key(site.id), site);

      const host = process.env.PUBLISH_DOMAIN || 'vlipa.dev';
      return json(res, 200, { ok: true, site: trim(site), url: `https://${slug}.${host}` });
    }

    /* ---- save ---- */
    const incoming = body.site;
    if (!incoming || typeof incoming !== 'object') return fail(res, 400, 'Nothing to save.');

    const size = Buffer.byteLength(JSON.stringify(incoming));
    if (size > MAX_BYTES) {
      return fail(res, 413, 'This site is too heavy to save. Remove a few photographs or use smaller ones.');
    }

    const ids = await store.members(own);
    const existing = incoming.id ? await store.get(key(incoming.id)) : null;

    if (existing && existing.ownerId !== user.id) return fail(res, 403, 'That site belongs to someone else.');
    if (!existing && ids.length >= MAX_SITES) return fail(res, 429, `You can keep ${MAX_SITES} sites at a time.`);

    const site = {
      ...(existing || {}),
      id: existing ? existing.id : (globalThis.crypto?.randomUUID?.() || `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`),
      ownerId: user.id,
      name: String(incoming.name || 'Untitled').slice(0, 60),
      brand: String(incoming.brand || incoming.name || 'Store').slice(0, 60),
      description: String(incoming.description || '').slice(0, 200),
      theme: String(incoming.theme || 'aurora').slice(0, 30),
      heroLayout: incoming.heroLayout ? String(incoming.heroLayout).slice(0, 20) : undefined,
      lang: String(incoming.lang || 'en').slice(0, 8),
      sections: Array.isArray(incoming.sections) ? incoming.sections.slice(0, 24) : [],
      assets: incoming.assets && typeof incoming.assets === 'object' ? incoming.assets : {},
      slug: existing ? existing.slug || '' : '',
      published: existing ? Boolean(existing.published) : false,
      updatedAt: new Date().toISOString(),
    };

    await store.set(key(site.id), site);
    await store.addTo(own, site.id);

    if (site.published && site.slug) await store.set(`slug:${site.slug}`, site.id);

    json(res, 200, { ok: true, site: trim(site), id: site.id });
  } catch (error) {
    console.error('sites', error);
    fail(res, 500, 'The studio could not reach its storage.');
  }
}
