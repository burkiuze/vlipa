/* Putting a project on the web for a week.

   A published site lives at <name>.vlipa.dev and disappears on its own after
   seven days: these are for showing somebody, not for hosting. The files stay
   in the same store as everything else, with the expiry the store already
   understands.

   POST { action: 'put' }   → publish or replace a site
   POST { action: 'drop' }  → take it down now
   GET  ?name=              → whether a name is free, and when a site expires */

import { SESSION_COOKIE, userFromToken } from './auth.js';
import { siteOrigin } from './google.js';
import { callerKey, fail, json, methodGuard, parseCookies, readBody, withinLimit } from './http.js';
import * as store from './store.js';

const DAYS = 7;
const TTL = DAYS * 24 * 60 * 60;
const MAX_FILES = 200;
const MAX_BYTES = 2_000_000;

const TAKEN = ['www', 'api', 'studio', 'login', 'signup', 'invite', 'setup', 'admin', 'app', 'mail', 'ftp', 'blog'];

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

function publicUrl(req, name) {
  const origin = siteOrigin(req);

  try {
    const url = new URL(origin);
    const root = url.hostname.replace(/^www\./, '');

    // Locally there is no wildcard to hand out, so the path form is the one
    // that actually works.
    if (url.hostname.endsWith('localhost') || /^\d/.test(url.hostname)) return `${origin}/s/${name}/`;
    return `${url.protocol}//${name}.${root}`;
  } catch {
    return `/s/${name}/`;
  }
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Sign in first.');

  try {
    if (req.method === 'GET') {
      const name = slug(req.query?.name);
      if (!name) return fail(res, 400, 'Which name?');

      const site = await store.get(`site:${name}`);

      return json(res, 200, {
        ok: true,
        name,
        taken: Boolean(site) && site.ownerId !== user.id,
        mine: Boolean(site) && site.ownerId === user.id,
        expiresAt: site?.expiresAt || null,
        url: publicUrl(req, name),
      });
    }

    if (!withinLimit(`publish:${callerKey(req)}`, 12)) {
      return fail(res, 429, 'Slow down: 12 publishes a minute.');
    }

    const body = await readBody(req);
    const name = slug(body.name);

    if (!name || name.length < 3) return fail(res, 400, 'A site name needs at least 3 characters: letters, numbers and dashes.');
    if (TAKEN.includes(name)) return fail(res, 409, 'That name belongs to the studio itself.');

    const existing = await store.get(`site:${name}`);
    if (existing && existing.ownerId !== user.id) return fail(res, 409, 'Somebody else is using that name this week.');

    if (body.action === 'drop') {
      if (!existing) return fail(res, 404, 'Nothing is published under that name.');

      await store.del(`site:${name}`);
      await store.removeFrom(`user-sites:${user.id}`, name);
      return json(res, 200, { ok: true, dropped: name });
    }

    const files = (Array.isArray(body.files) ? body.files : [])
      .filter((file) => file && typeof file.path === 'string')
      .slice(0, MAX_FILES)
      .map((file) => ({
        path: String(file.path).replace(/\\/g, '/').split('/').filter((part) => part && part !== '.' && part !== '..').join('/'),
        text: String(file.text ?? ''),
      }))
      .filter((file) => file.path);

    if (!files.length) return fail(res, 400, 'There are no files to publish.');
    if (!files.some((file) => file.path === 'index.html')) {
      return fail(res, 400, 'A site needs an index.html at the top level.');
    }

    const total = files.reduce((sum, file) => sum + file.text.length, 0);
    if (total > MAX_BYTES) return fail(res, 413, 'A published site can be at most 2 MB.');

    const site = {
      name,
      ownerId: user.id,
      ownerEmail: user.email,
      files,
      bytes: total,
      publishedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + TTL * 1000).toISOString(),
    };

    await store.set(`site:${name}`, site, TTL);
    await store.addTo(`user-sites:${user.id}`, name);

    return json(res, 200, {
      ok: true,
      name,
      url: publicUrl(req, name),
      expiresAt: site.expiresAt,
      days: DAYS,
      files: files.length,
    });
  } catch (error) {
    console.error('[vlipa] publish:', error);
    return fail(res, 500, 'The publish service is not answering right now.');
  }
}
