/* Serves a published site. The subdomain middleware rewrites
   elma.vlipa.dev to /api/render?slug=elma. */

import { json, methodGuard } from './_lib/http.js';
import * as store from './_lib/store.js';
import { renderSite } from '../assets/js/studio/render.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  const slug = String(req.query.slug || '').trim().toLowerCase();
  if (!slug) return json(res, 400, { ok: false, error: 'No address given.' });

  const id = await store.get(`slug:${slug}`);
  const site = id ? await store.get(`site:${id}`) : null;

  if (!site || !site.published) {
    res.status(404);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.send(`<!doctype html><meta charset="utf-8" />
<title>Nothing here yet</title>
<body style="font:16px/1.6 Inter,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#101014">
<div style="text-align:center">
  <h1 style="font-size:22px;font-weight:600">Nothing published at this address.</h1>
  <p style="color:#62626f;margin-top:8px">The shop may have been taken down, or the name is free to claim.</p>
</div>`);
  }

  const assets = site.assets || {};
  const html = renderSite(site, { resolve: (ref) => assets[ref] || '' });

  res.status(200);
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=60, s-maxage=300');
  res.send(html);
}
