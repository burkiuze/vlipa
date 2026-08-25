/* Server-issued captcha.

   The challenge is drawn on the server and the answer never reaches the
   browser: the client gets an SVG and an opaque token that carries an HMAC of
   the answer. Verification recomputes the HMAC, so nothing has to be stored.

   The glyphs are drawn as stroked polylines rather than <text>, so the answer
   is not sitting in the markup for a script to read. */

import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 5;
const TTL_MS = 10 * 60 * 1000;

/* Each glyph is a set of polylines on a 5 x 14 grid. */
const GLYPHS = {
  'A': '0,14 2.5,0 5,14|1,9 4,9',
  'B': '0,0 0,14|0,0 3.5,1 3.5,6 0,7|0,7 4,8 4,13 0,14',
  'C': '5,2 2.5,0 0,4 0,10 2.5,14 5,12',
  'D': '0,0 0,14|0,0 4,3 4,11 0,14',
  'E': '5,0 0,0 0,14 5,14|0,7 3.5,7',
  'F': '5,0 0,0 0,14|0,7 3.5,7',
  'G': '5,2 2.5,0 0,4 0,10 2.5,14 5,11 5,8 3,8',
  'H': '0,0 0,14|5,0 5,14|0,7 5,7',
  'J': '5,0 5,11 2.5,14 0,11',
  'K': '0,0 0,14|5,0 0,7 5,14',
  'L': '0,0 0,14 5,14',
  'M': '0,14 0,0 2.5,6 5,0 5,14',
  'N': '0,14 0,0 5,14 5,0',
  'P': '0,14 0,0 4,1 4,6 0,7',
  'Q': '2.5,0 0,4 0,10 2.5,14 5,10 5,4 2.5,0|3,10 5.5,14',
  'R': '0,14 0,0 4,1 4,6 0,7|2,7 5,14',
  'S': '5,2 2,0 0,4 5,9 3,14 0,12',
  'T': '0,0 5,0|2.5,0 2.5,14',
  'U': '0,0 0,10 2.5,14 5,10 5,0',
  'V': '0,0 2.5,14 5,0',
  'W': '0,0 1,14 2.5,6 4,14 5,0',
  'X': '0,0 5,14|5,0 0,14',
  'Y': '0,0 2.5,7 5,0|2.5,7 2.5,14',
  'Z': '0,0 5,0 0,14 5,14',
  '2': '0,3 2.5,0 5,3 0,14 5,14',
  '3': '0,1 3,0 4,4 1.5,7 4,9 3,14 0,13',
  '4': '4,14 4,0 0,9 5,9',
  '5': '5,0 0,0 0,6 3,5 5,9 2.5,14 0,12',
  '6': '5,1 2,0 0,6 0,11 2.5,14 5,11 4,7 0,8',
  '7': '0,0 5,0 2,14',
  '8': '2.5,0 0,3 2.5,7 0,11 2.5,14 5,11 2.5,7 5,3 2.5,0',
  '9': '0,13 3,14 5,8 5,3 2.5,0 0,3 1,7 5,6',
};

function secret() {
  const value = process.env.AUTH_SECRET;

  if (!value) {
    console.warn('AUTH_SECRET is not set: captcha and sessions use a development fallback.');
    return 'vlipa-development-secret';
  }

  return value;
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function drawGlyph(char, x, y, scale, tilt) {
  const strokes = GLYPHS[char];
  if (!strokes) return '';

  const points = strokes.split('|').map((stroke) => stroke.split(' ').map((pair) => {
    const [px, py] = pair.split(',').map(Number);
    return `${(px * scale).toFixed(1)},${(py * scale).toFixed(1)}`;
  }).join(' '));

  return points.map((line) =>
    `<polyline points="${line}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${tilt.toFixed(1)} 8 10)" />`
  ).join('');
}

export function issueCaptcha() {
  const bytes = crypto.randomBytes(64);
  let cursor = 0;
  const next = () => bytes[cursor++ % bytes.length] / 255;

  let code = '';
  for (let i = 0; i < LENGTH; i += 1) code += ALPHABET[bytes[i] % ALPHABET.length];

  let glyphs = '';
  code.split('').forEach((char, i) => {
    const scale = 1.5 + next() * 0.35;
    const x = 10 + i * 25 + next() * 5;
    const y = 8 + next() * 6;
    glyphs += drawGlyph(char, x, y, scale, next() * 34 - 17);
  });

  let noise = '';
  for (let i = 0; i < 3; i += 1) {
    const y = 6 + next() * 34;
    noise += `<path d="M0 ${y.toFixed(1)} C 45 ${(y + next() * 26 - 13).toFixed(1)}, ` +
      `95 ${(y + next() * 26 - 13).toFixed(1)}, 140 ${(y + next() * 20 - 10).toFixed(1)}" />`;
  }

  for (let i = 0; i < 5; i += 1) {
    noise += `<circle cx="${(next() * 140).toFixed(1)}" cy="${(next() * 46).toFixed(1)}" r="${(1 + next() * 1.6).toFixed(1)}" />`;
  }

  const expires = Date.now() + TTL_MS;
  const payload = `${expires}.${crypto.randomBytes(6).toString('base64url')}`;
  const token = `${payload}.${sign(`${payload}.${code}`)}`;

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="46" viewBox="0 0 140 46" role="img" aria-label="Security code">' +
    '<rect width="140" height="46" rx="10" fill="#f3f2ff"/>' +
    `<g fill="none" stroke="rgba(53,50,246,.28)" stroke-width="1.3">${noise}</g>` +
    `<g fill="none" stroke="#2a27c9" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${glyphs}</g>` +
    '</svg>';

  return { token, svg };
}

export function verifyCaptcha(token, answer) {
  if (typeof token !== 'string' || typeof answer !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [expires, nonce, signature] = parts;
  if (!/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;

  const expected = sign(`${expires}.${nonce}.${answer.trim().toUpperCase()}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
