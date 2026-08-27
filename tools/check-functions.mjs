/* Vercel's Hobby plan allows twelve serverless functions in a deployment, and
   the thirteenth fails the build rather than warning about it. This counts
   them, so the limit is hit here instead of there. */

import fs from 'node:fs';
import path from 'node:path';

const LIMIT = 12;
const root = new URL('../api', import.meta.url).pathname;
const found = [];

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '_lib') continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) found.push(path.relative(root, full));
  }
};

walk(root);
found.sort();

console.log(found.map((name) => `  api/${name}`).join('\n'));
console.log(`\n${found.length} of ${LIMIT} serverless functions.`);

if (found.length > LIMIT) {
  console.error(`\nToo many: a Hobby deployment holds ${LIMIT}. Fold small handlers into api/_lib and route to them.`);
  process.exit(1);
}
