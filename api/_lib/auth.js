/* Accounts and sessions.

   Passwords are PBKDF2-HMAC-SHA256 with a per-user salt. A session is a random
   token; only its SHA-256 is stored, so a dump of the store hands out no live
   sessions. */

import crypto from 'node:crypto';
import * as store from './store.js';

const ITERATIONS = 210000;
const KEY_LENGTH = 32;
const SESSION_DAYS = 30;
const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const SESSION_COOKIE = 'vlipa_session';

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256').toString('hex');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function validateCredentials(email, password) {
  if (!EMAIL_RE.test(email)) return 'Enter a valid email address.';
  if (typeof password !== 'string' || password.length < 8) return 'Use at least 8 characters.';
  if (password.length > 200) return 'That password is too long.';
  return null;
}

export async function createUser({ email, password, name }) {
  const key = `user:${email}`;
  if (await store.get(key)) return { error: 'That email already has an account.' };

  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: crypto.randomUUID(),
    email,
    name: String(name || '').trim().slice(0, 60),
    salt,
    hash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
  };

  await store.set(key, user);
  await store.set(`userById:${user.id}`, email);
  return { user };
}

export async function verifyUser(email, password) {
  const user = await store.get(`user:${email}`);

  if (!user) {
    // Spend the same time on unknown addresses so the endpoint does not
    // reveal who has an account.
    hashPassword(password, 'no-such-user');
    return { error: 'Email or password is incorrect.' };
  }

  const locked = await store.get(`lock:${email}`);
  if (locked && locked.until > Date.now()) {
    const minutes = Math.ceil((locked.until - Date.now()) / 60000);
    return { error: `Too many attempts. Try again in ${minutes} minute(s).` };
  }

  const candidate = hashPassword(password, user.salt);
  const ok = crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(user.hash, 'hex'));

  if (!ok) {
    const attempts = ((locked && locked.attempts) || 0) + 1;
    await store.set(`lock:${email}`, {
      attempts,
      until: attempts >= LOCK_AFTER ? Date.now() + LOCK_MINUTES * 60000 : 0,
    }, LOCK_MINUTES * 60);

    return { error: 'Email or password is incorrect.' };
  }

  await store.del(`lock:${email}`);
  return { user };
}

export async function startSession(userId, remember) {
  const token = crypto.randomBytes(32).toString('hex');
  const seconds = (remember ? SESSION_DAYS : 1) * 24 * 60 * 60;

  await store.set(`session:${sha256(token)}`, { userId, createdAt: Date.now() }, seconds);
  return { token, seconds };
}

export async function endSession(token) {
  if (token) await store.del(`session:${sha256(token)}`);
}

export async function userFromToken(token) {
  if (!token) return null;

  const session = await store.get(`session:${sha256(token)}`);
  if (!session) return null;

  const email = await store.get(`userById:${session.userId}`);
  if (!email) return null;

  const user = await store.get(`user:${email}`);
  if (!user) return null;

  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

export function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}
