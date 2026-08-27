/* Serving a published site.

   Reached two ways: <name>.vlipa.dev, which a wildcard rewrite sends here, and
   /s/<name>/<path>, which works anywhere including a laptop with no DNS.

   What is served is somebody's uploaded HTML, so it is served as inertly as
   the web allows: the exact type, no sniffing, no framing of the studio, and
   on its own subdomain where the studio's cookies cannot be read. */

import { fail } from './_lib/http.js';
import * as store from './_lib/store.js';

const TYPES = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
};

function nameFrom(req) {
  if (req.query?.name) return String(req.query.name).toLowerCase();

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
  const parts = host.split('.');

  // <name>.vlipa.dev → the first label, as long as it is not the site itself.
  if (parts.length >= 3 && !['www', 'api'].includes(parts[0])) return parts[0].toLowerCase();
  return '';
}

function pathFrom(req) {
  const raw = String(req.query?.path || req.url || '/').split('?')[0];

  const clean = raw
    .replace(/^\/s\/[^/]+/, '')
    .replace(/^\/api\/site/, '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');

  return clean || 'index.html';
}

export default async function handler(req, res) {
  const name = nameFrom(req);

  if (!name) {
    res.status(404);
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    return res.send('No site here.');
  }

  const site = await store.get(`site:${name}`);

  if (!site) {
    res.status(404);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.send(page('Nothing here', `No site is published at <b>${escape(name)}</b>, or its week is up. Sites published from Vlipa Studio come down after seven days.`));
  }

  const wanted = pathFrom(req);

  const file = site.files.find((entry) => entry.path === wanted)
    || site.files.find((entry) => entry.path === `${wanted}/index.html`)
    || site.files.find((entry) => entry.path === `${wanted}.html`)
    || (wanted === 'index.html' ? null : site.files.find((entry) => entry.path === '404.html'));

  if (!file) {
    res.status(404);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.send(page('Not found', `<b>${escape(wanted)}</b> is not in this site.`));
  }

  const extension = file.path.split('.').pop().toLowerCase();

  res.status(200);
  res.setHeader('content-type', TYPES[extension] || 'text/plain; charset=utf-8');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  res.setHeader('cache-control', 'public, max-age=0, must-revalidate');
  res.send(file.text);
}

function escape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title} — vlipa</title>` +
    `<div style="font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;max-width:32rem;margin:14vh auto;padding:0 24px;color:#14142b">` +
    `<h1 style="font-size:22px;margin:0 0 10px">${title}</h1><p style="color:#5a5a78;margin:0">${body}</p></div>`;
}
