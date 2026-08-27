/* Projects in and out of Vlipa Studio, as one archive.

   The browser holds the files; this turns them into a zip and back. Node has
   the compressor, so nothing has to be shipped to the browser to do it. */

import { SESSION_COOKIE, userFromToken } from './auth.js';
import { callerKey, fail, json, methodGuard, parseCookies, readBody, withinLimit } from './http.js';
import { unzip, zipFiles } from './zip.js';

const MAX_FILES = 200;
const MAX_BYTES = 3_000_000;

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Sign in first.');

  if (!withinLimit(`files:${callerKey(req)}`, 30)) {
    return fail(res, 429, 'Slow down: 30 archives a minute.');
  }

  const body = await readBody(req);

  try {
    if (body.action === 'zip') {
      const files = (Array.isArray(body.files) ? body.files : [])
        .filter((file) => file && typeof file.path === 'string')
        .slice(0, MAX_FILES)
        .map((file) => ({ path: safePath(file.path), text: String(file.text ?? '') }));

      if (!files.length) return fail(res, 400, 'There are no files to pack.');

      const total = files.reduce((sum, file) => sum + file.text.length, 0);
      if (total > MAX_BYTES) return fail(res, 413, 'That project is bigger than 3 MB.');

      const archive = zipFiles(files);
      return json(res, 200, { ok: true, zip: archive.toString('base64'), count: files.length });
    }

    if (body.action === 'unzip') {
      const raw = String(body.zip || '');
      if (!raw) return fail(res, 400, 'No archive arrived.');

      const buffer = Buffer.from(raw, 'base64');
      if (buffer.length > MAX_BYTES) return fail(res, 413, 'That archive is bigger than 3 MB.');

      const files = unzip(buffer, { maxFiles: MAX_FILES, maxBytes: MAX_BYTES })
        .map((file) => ({ path: safePath(file.path), text: file.text }));

      return json(res, 200, { ok: true, files });
    }

    return fail(res, 400, 'Unknown action.');
  } catch (error) {
    console.warn('[vlipa] files:', error.message);
    return fail(res, 400, error.message || 'That archive could not be read.');
  }
}

/* Nothing climbs out of the project: no leading slash, no "..", no drive
   letters, and a sane length. */
function safePath(path) {
  return String(path)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
    .slice(0, 200) || 'file.txt';
}
