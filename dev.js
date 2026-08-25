/* Local development server.

   Serves the static files and runs the functions in api/ the way Vercel does,
   so the studio can be tried without deploying:

     node dev.js            then open http://localhost:3000

   Without KV credentials the store keeps everything in memory, so accounts and
   sites disappear when this process stops. */

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
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function decorate(req, res, url) {
  req.query = Object.fromEntries(url.searchParams);

  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (body) => {
    if (body === undefined || body === null) return res.end();
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  res.json = (body) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };

  return { req, res };
}

async function runFunction(name, req, res, url) {
  const candidates = [
    path.join(root, 'api', `${name}.js`),
    path.join(root, 'api', name, 'index.js'),
  ];

  if (name.startsWith('auth/')) {
    candidates.unshift(path.join(root, 'api', 'auth', '[action].js'));
    req.query = { ...req.query, action: name.slice('auth/'.length) };
  }

  for (const file of candidates) {
    try {
      await fs.access(file);
    } catch {
      continue;
    }

    const module = await import(`${file}?v=${Date.now()}`);
    const handler = module.default;
    const decorated = decorate(req, res, url);

    if (name.startsWith('auth/')) decorated.req.query.action = name.slice('auth/'.length);
    await handler(decorated.req, decorated.res);
    return true;
  }

  return false;
}

async function serveStatic(pathname, res) {
  const clean = pathname === '/' ? '/index.html' : pathname;
  const candidates = [clean, `${clean}.html`, path.join(clean, 'index.html')];

  for (const candidate of candidates) {
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
  req.query = Object.fromEntries(url.searchParams);

  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/\/$/, '');
      const handled = await runFunction(name, req, res, url);

      if (!handled) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `No function for /api/${name}` }));
      }

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
    ? 'OpenRouter key found: the AI parts are live.'
    : 'No OPENROUTER_API_KEY: the AI parts will answer with an error until you set one.');
});
