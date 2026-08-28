/* Does every address the browser calls actually go somewhere?

   Twice now a feature has worked locally and returned 404 in production, both
   times for the same reason: the development server resolves /api/<name> by
   looking for a file, and Vercel resolves it by matching vercel.json. A path
   with no file and no rewrite is fine in one and a dead end in the other, and
   nothing says so until somebody opens the page.

   So this walks the client code for the addresses it really asks for, and
   checks each one lands: a function file, the auth handler, or a rewrite.

     node tools/check-routes.mjs

   It exits 1 and names the path when one does not. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function walk(dir) {
  const found = [];

  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const here = path.join(dir, entry.name);

    if (entry.isDirectory()) found.push(...await walk(here));
    else if (/\.(js|html)$/.test(entry.name)) found.push(here);
  }

  return found;
}

/* Every /api/... written as a literal in the browser's code. Anything built
   from a variable is out of reach here and is left to the tests. */
async function called() {
  const files = [
    ...await walk(path.join(root, 'assets', 'js')),
    ...(await fs.readdir(root)).filter((name) => name.endsWith('.html')).map((name) => path.join(root, name)),
  ];

  const seen = new Map();

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');

    for (const found of text.matchAll(/['"`](\/api\/[a-z0-9/_\][-]*)(\$\{)?/gi)) {
      // The query string is not part of what has to resolve.
      let clean = found[1].split('?')[0].replace(/\/+$/, '');

      // `/api/auth/${action}` is a prefix, not an address: the literal stops
      // at the interpolation. Stand a segment in for what the code fills in,
      // so what gets checked is a path that could really be requested.
      if (found[2]) clean += '/x';

      if (!seen.has(clean)) seen.set(clean, path.relative(root, file));
    }
  }

  return seen;
}

/* A rewrite source matches a path when every segment lines up, treating
   :name as one segment and :name* as the rest. */
function matches(source, url) {
  const want = source.split('/').filter(Boolean);
  const got = url.split('/').filter(Boolean);

  for (let at = 0; at < want.length; at += 1) {
    const part = want[at];

    if (part.startsWith(':')) {
      if (part.endsWith('*')) return true;          // takes whatever is left
      if (got[at] === undefined) return false;      // needs a segment, got none
      continue;
    }

    if (part !== got[at]) return false;
  }

  return want.length === got.length;
}

const vercel = JSON.parse(await fs.readFile(path.join(root, 'vercel.json'), 'utf8'));
const rewrites = (vercel.rewrites || []).filter((one) => !one.has);   // host-conditional ones are not this

const asked = await called();
const bad = [];

for (const [url, from] of asked) {
  // A function file of its own.
  const name = url.slice('/api/'.length);
  const asFile = path.join(root, 'api', `${name}.js`);

  let ok = await fs.access(asFile).then(() => true, () => false);

  // The auth handler answers everything under /api/auth/.
  if (!ok && name.startsWith('auth/')) {
    ok = await fs.access(path.join(root, 'api', 'auth', '[action].js')).then(() => true, () => false);
  }

  if (!ok) ok = rewrites.some((one) => matches(one.source, url));

  if (!ok) bad.push({ url, from });
}

for (const [url] of asked) console.log(`  ${url}`);
console.log(`\n${asked.size} addresses called from the browser.`);

if (bad.length) {
  console.error('\nThese have no function file and no rewrite, so Vercel answers 404:');
  for (const one of bad) console.error(`  ${one.url}   — called from ${one.from}`);
  console.error('\nAdd a rewrite in vercel.json, or a file under api/.');
  process.exit(1);
}

console.log('Every one of them resolves.');
