/* The endpoints that answer without a session, behind one function.

   They have little in common beyond that — a captcha, the deployment's status,
   the public side of an invitation link, and Vlipy, which teaches people who
   have not signed up for anything, and a personal account's own things — but
   a Hobby deployment may hold twelve
   serverless functions, and one file each is not how that budget is best
   spent. Each still lives in its own module; this only routes.

   The plain addresses still work: vercel.json rewrites /api/captcha,
   /api/status, /api/invite, /api/vlipy, /api/me and /api/github here. */

import captcha from './_lib/route-captcha.js';
import github from './_lib/route-github.js';
import invite from './_lib/route-invite.js';
import me from './_lib/route-me.js';
import status from './_lib/route-status.js';
import vlipy from './_lib/route-vlipy.js';
import { fail } from './_lib/http.js';

const ROUTES = { captcha, github, invite, me, status, vlipy };

export default async function handler(req, res) {
  // Under a rewrite the path is this file's; the original one arrives as a
  // query parameter. Falling back to the URL keeps direct calls working.
  const wanted = String(req.query?.what || '').toLowerCase()
    || (req.url || '').split('?')[0].split('/').filter(Boolean).pop();

  const route = ROUTES[wanted];
  if (!route) return fail(res, 404, 'No such endpoint.');

  return route(req, res);
}
