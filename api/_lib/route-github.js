/* The door between a personal account and somebody's repositories.

   Everything here needs two things to be true: the visitor is signed in to
   vlipa, and they have connected GitHub. The GitHub token is looked up from
   the first and never travels with the second — the browser sends a repository
   name, and gets back files.

   POST { what: 'github' } with:
     action: 'status'      → connected? as whom? which repositories?
     action: 'branches'    → the branches of one repository
     action: 'open'        → a repository's files, as a project
     action: 'commit'      → changed files back onto a branch
     action: 'disconnect'  → forget the token

   The two OAuth legs are GET instead, because a browser is being redirected
   rather than a script being answered:
     /api/github/start     → off to GitHub
     /api/github/callback  → back again */

import { SESSION_COOKIE, userFromToken } from './auth.js';
import {
  authUrl, callbackUrl, commitFiles, githubReady, listBranches, listRepos,
  MAX_FILES, randomState, readProject, sameState, tokenFromCode, whoAmI,
} from './github.js';
import {
  callerKey, clearCookie, fail, json, parseCookies, readBody, redirect, setCookie, withinLimit,
} from './http.js';
import * as store from './store.js';

const LINK = (userId) => `gh:${userId}`;

const HANDSHAKE_COOKIE = 'vlipa_gh';
const HANDSHAKE_SECONDS = 600;

/* Where the browser lands once GitHub has finished with it. */
const HOME = '/me#/github';

const MAX_COMMIT_FILES = 200;
const MAX_COMMIT_BYTES = 4 * 1024 * 1024;

/* A path a commit is allowed to touch. No leading slash, no walking upwards,
   no .git — a browser is asking for this and a browser can ask for anything. */
function cleanPath(value) {
  const path = String(value || '').trim().replace(/^\/+/, '');

  if (!path || path.length > 300) return '';
  if (path.split('/').some((part) => part === '..' || part === '.' || part === '.git')) return '';

  return path;
}

/* The repository name as GitHub writes it, and nothing else. */
function cleanRepo(value) {
  const name = String(value || '').trim();
  return /^[\w.-]+\/[\w.-]+$/.test(name) ? name : '';
}

const cleanBranch = (value) => {
  const branch = String(value || '').trim();
  return branch && branch.length <= 200 && !/[\s~^:?*[\\]/.test(branch) ? branch : '';
};

async function linkFor(userId) {
  const held = await store.get(LINK(userId));
  return held?.token ? held : null;
}

/* ---------- the two redirect legs ---------- */

async function start(req, res, user) {
  const state = randomState();

  setCookie(res, HANDSHAKE_COOKIE, state, HANDSHAKE_SECONDS);
  return redirect(res, authUrl({ req, state }));
}

async function callback(req, res, user) {
  const saved = String(parseCookies(req)[HANDSHAKE_COOKIE] || '');
  clearCookie(res, HANDSHAKE_COOKIE);

  if (req.query?.error) return redirect(res, `${HOME}?github=cancelled`);
  if (!sameState(saved, req.query?.state)) return redirect(res, `${HOME}?github=session`);
  if (!req.query?.code) return redirect(res, `${HOME}?github=failed`);

  // What GitHub actually said, carried through rather than flattened into
  // "failed". Nearly every failure here is one of two setup mistakes, and
  // being told which one is the difference between a fix and an evening.
  const result = await tokenFromCode({ req, code: String(req.query.code) });

  if (result.error) {
    return redirect(res, `${HOME}?github=failed&why=${encodeURIComponent(String(result.error).slice(0, 160))}`);
  }

  const who = await whoAmI(result.token).catch((error) => ({ error: error.message }));

  if (!who || who.error) {
    return redirect(res, `${HOME}?github=failed&why=${encodeURIComponent(String(who?.error || 'GitHub would not say who you are.').slice(0, 160))}`);
  }

  await store.set(LINK(user.id), {
    token: result.token,
    login: who.login,
    name: who.name,
    avatar: who.avatar,
    connectedAt: new Date().toISOString(),
  });

  return redirect(res, `${HOME}?github=connected`);
}

/* ---------- the door ---------- */

export default async function handler(req, res) {
  if (!githubReady()) {
    return req.method === 'GET'
      ? redirect(res, `${HOME}?github=off`)
      : fail(res, 503, 'GitHub is not switched on here: the app credentials are not set on the server.');
  }

  if (!withinLimit(`gh:${callerKey(req)}`, 30)) return fail(res, 429, 'Slow down a moment.');

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);

  if (!user) {
    return req.method === 'GET'
      ? redirect(res, `/login?next=${encodeURIComponent('/me')}`)
      : fail(res, 401, 'Sign in first.');
  }

  // Which leg of the handshake, if this is one. Under the rewrite the action
  // arrives as a query parameter; a direct call carries it in the path.
  const leg = String(req.query?.action || '').toLowerCase()
    || (req.url || '').split('?')[0].split('/').filter(Boolean).pop();

  if (req.method === 'GET') {
    if (leg === 'start') return start(req, res, user);
    if (leg === 'callback') return callback(req, res, user);

    return redirect(res, HOME);
  }

  if (req.method !== 'POST') return fail(res, 405, 'Use POST.');

  const body = await readBody(req);
  const link = await linkFor(user.id);

  try {
    if (body.action === 'status') {
      if (!link) return json(res, 200, { ok: true, connected: false, redirect: callbackUrl(req) });

      // The repository list is the expensive part, so it is only fetched when
      // asked for: opening the page should not cost four GitHub calls.
      const repos = body.repos ? await listRepos(link.token) : undefined;

      return json(res, 200, {
        ok: true,
        connected: true,
        account: { login: link.login, name: link.name, avatar: link.avatar },
        repos,
      });
    }

    if (!link) return fail(res, 428, 'Connect GitHub first.');

    if (body.action === 'branches') {
      const repo = cleanRepo(body.repo);
      if (!repo) return fail(res, 400, 'That is not a repository name.');

      return json(res, 200, { ok: true, branches: await listBranches(link.token, repo) });
    }

    if (body.action === 'open') {
      const repo = cleanRepo(body.repo);
      const branch = cleanBranch(body.branch);

      if (!repo) return fail(res, 400, 'That is not a repository name.');
      if (!branch) return fail(res, 400, 'Say which branch.');

      const project = await readProject(link.token, repo, branch);

      return json(res, 200, {
        ok: true,
        repo,
        branch,
        files: project.files,
        skipped: project.skipped,
        truncated: project.truncated,
        limit: MAX_FILES,
      });
    }

    if (body.action === 'commit') {
      const repo = cleanRepo(body.repo);
      const branch = cleanBranch(body.branch);

      if (!repo) return fail(res, 400, 'That is not a repository name.');
      if (!branch) return fail(res, 400, 'Say which branch.');

      const message = String(body.message || '').trim().slice(0, 500);
      if (!message) return fail(res, 400, 'A commit needs a message.');

      const files = [];
      let bytes = 0;

      for (const file of Array.isArray(body.files) ? body.files : []) {
        const path = cleanPath(file?.path);
        if (!path || typeof file.content !== 'string') continue;

        bytes += file.content.length;
        if (files.length >= MAX_COMMIT_FILES || bytes > MAX_COMMIT_BYTES) {
          return fail(res, 413, 'That is more than one commit should carry. Commit fewer files at a time.');
        }

        files.push({ path, content: file.content });
      }

      const deleted = (Array.isArray(body.deleted) ? body.deleted : [])
        .map(cleanPath)
        .filter(Boolean)
        .slice(0, MAX_COMMIT_FILES);

      if (!files.length && !deleted.length) return fail(res, 400, 'There is nothing to commit.');

      return json(res, 200, { ok: true, commit: await commitFiles(link.token, repo, branch, { message, files, deleted }) });
    }

    if (body.action === 'disconnect') {
      await store.del(LINK(user.id));
      return json(res, 200, { ok: true, connected: false });
    }

    return fail(res, 400, 'Unknown action.');
  } catch (error) {
    // An expired or revoked token is worth clearing rather than leaving to
    // fail the same way on every request afterwards.
    if (error.status === 401) await store.del(LINK(user.id)).catch(() => {});

    if (error.status) return fail(res, error.status, error.message);

    console.error('[vlipa] github:', error);
    return fail(res, 502, 'GitHub could not be reached. Try again in a moment.');
  }
}
