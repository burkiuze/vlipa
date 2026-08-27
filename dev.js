/* Local development server.

   Serves the static files and runs the functions in api/ the way Vercel does:

     OPENROUTER_API_KEY=... node dev.js      then open http://localhost:3000

   Without the key the studio loads and says so; everything else works. */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};

function decorate(req, res, url) {
  req.query = Object.fromEntries(url.searchParams);

  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (body) => {
    if (body === undefined || body === null) return res.end();
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
}

async function serveStatic(pathname, res) {
  // /invite/<anything> is one page that reads the name out of the address.
  const invite = pathname.startsWith('/invite/') ? '/invite.html' : null;
  const clean = invite || (pathname === '/' ? '/index.html' : pathname);

  for (const candidate of [clean, `${clean}.html`, path.join(clean, 'index.html')]) {
    const file = path.join(root, candidate);
    if (!file.startsWith(root)) break;

    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
      return true;
    } catch { /* try the next shape */ }
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    // A published site, the way it is reached without a wildcard domain.
    if (url.pathname.startsWith('/s/')) {
      const [, , name, ...rest] = url.pathname.split('/');
      const { default: handler } = await import(`${path.join(root, 'api', 'site.js')}?v=${Date.now()}`);

      decorate(req, res, url);
      req.query = { name, path: rest.join('/') || 'index.html' };
      await handler(req, res);
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/\/$/, '');

      // /api/auth/login and friends live in one file with a dynamic segment.
      const file = name.startsWith('auth/')
        ? path.join(root, 'api', 'auth', '[action].js')
        : path.join(root, 'api', `${name}.js`);

      try {
        await fs.access(file);
      } catch {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: `No function for /api/${name}` }));
      }

      const { default: handler } = await import(`${file}?v=${Date.now()}`);
      decorate(req, res, url);
      if (name.startsWith('auth/')) req.query.action = name.slice('auth/'.length);
      await handler(req, res);
      return;
    }

    if (await serveStatic(url.pathname, res)) return;

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
});

server.listen(port, () => {
  console.log(`vlipa dev server on http://localhost:${port}`);
  console.log(process.env.OPENROUTER_API_KEY
    ? 'OpenRouter key found: Vlipa is live.'
    : 'No OPENROUTER_API_KEY: the studio will load but Vlipa cannot answer.');
});
