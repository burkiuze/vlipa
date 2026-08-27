/* Vlipa Studio's own endpoints: the archive and publishing.

   Two handlers, one function. A Hobby deployment may hold twelve serverless
   functions, and these two belong to the same tool.

   POST { action: 'zip' | 'unzip' }              → a project in and out
   POST { action: 'put' | 'drop' }               → publish it, or take it down
   GET  ?name=                                   → is that name free */

import files from './_lib/route-files.js';
import publish from './_lib/route-publish.js';
import { fail, readBody } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method === 'GET') return publish(req, res);

  const body = await readBody(req);

  // readBody caches on req for the handler that runs next.
  req.body = body;

  if (body.action === 'zip' || body.action === 'unzip') return files(req, res);
  if (body.action === 'put' || body.action === 'drop') return publish(req, res);

  return fail(res, 400, 'Unknown action.');
}
