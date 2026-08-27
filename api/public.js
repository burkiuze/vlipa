/* The three endpoints that answer without a session, behind one function.

   They have little in common beyond that — a captcha, the deployment's status,
   and the public side of an invitation link — but a Hobby deployment may hold
   twelve serverless functions, and three separate files for three small
   handlers is not how that budget is best spent. Each still lives in its own
   module; this only routes.

   The old addresses still work: vercel.json rewrites /api/captcha,
   /api/status and /api/invite here. */

import captcha from './_lib/route-captcha.js';
import invite from './_lib/route-invite.js';
import status from './_lib/route-status.js';
import { fail } from './_lib/http.js';

const ROUTES = { captcha, invite, status };

export default async function handler(req, res) {
  // Under a rewrite the path is this file's; the original one arrives as a
  // query parameter. Falling back to the URL keeps direct calls working.
  const wanted = String(req.query?.what || '').toLowerCase()
    || (req.url || '').split('?')[0].split('/').filter(Boolean).pop();

  const route = ROUTES[wanted];
  if (!route) return fail(res, 404, 'No such endpoint.');

  return route(req, res);
}
