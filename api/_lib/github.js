/* GitHub, on behalf of the person signed in.

   This is a GitHub App acting as the user: they authorise it once, GitHub
   hands back a token for their account, and every call afterwards is made as
   them. So the app can only ever see what they can see, and a commit it makes
   is a commit with their name on it — not a bot's.

   The token never reaches a browser. It is kept beside the account under its
   own key and read on the server for each call, which means a stolen page or
   a leaked localStorage hands nobody a way into somebody's repositories.

   Nothing here works unless the app's credentials are set. Either spelling is
   accepted — GITHUB_APP_CLIENT_ID or GITHUB_CLIENT_ID, and the matching
   secret — because both are the obvious name to reach for and being told a
   working key is missing is a bad half-hour. Without them the whole feature is
   invisible rather than broken. */

import crypto from 'node:crypto';

const AUTH_URL = process.env.GITHUB_AUTH_URL || 'https://github.com/login/oauth/authorize';
const TOKEN_URL = process.env.GITHUB_TOKEN_URL || 'https://github.com/login/oauth/access_token';
const API_URL = process.env.GITHUB_API_URL || 'https://api.github.com';

/* A project the editor can hold, not a repository mirror. Some repositories
   are a gigabyte; the point here is the handful of files somebody is actually
   working on, so the import stops well before a browser would. */
export const MAX_FILES = 120;
export const MAX_FILE_BYTES = 180 * 1024;
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

/* Anything that is not text is not something this editor can show, and
   pulling a PNG through as mangled UTF-8 helps nobody. */
const SKIP_PATH = /(^|\/)(node_modules|\.git|dist|build|vendor|\.next|coverage)(\/|$)/i;
const SKIP_EXT = /\.(png|jpe?g|gif|webp|avif|ico|svgz|pdf|zip|gz|tar|rar|7z|mp[34]|mov|avi|webm|wav|ogg|ttf|otf|woff2?|eot|so|dylib|dll|exe|bin|wasm|class|jar|psd|ai|sketch|db|sqlite3?)$/i;

const clientId = () => process.env.GITHUB_APP_CLIENT_ID || process.env.GITHUB_CLIENT_ID || '';
const clientSecret = () => process.env.GITHUB_APP_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET || '';

export function githubReady() {
  return Boolean(clientId() && clientSecret());
}

/* Which half is absent, so a page can say so rather than "not switched on". */
export function githubMissing() {
  return [
    clientId() ? '' : 'GITHUB_CLIENT_ID',
    clientSecret() ? '' : 'GITHUB_CLIENT_SECRET',
  ].filter(Boolean);
}

export const randomState = () => crypto.randomBytes(18).toString('hex');

/* Compared in constant time: a state check that leaks its answer through
   timing is not much of a check. */
export function sameState(a, b) {
  const one = Buffer.from(String(a || ''));
  const two = Buffer.from(String(b || ''));

  return one.length > 0 && one.length === two.length && crypto.timingSafeEqual(one, two);
}

/* The address to come back to.

   Deliberately the host the visitor is actually on, not PUBLIC_URL. A site
   answering on both vlipa.dev and www.vlipa.dev is two origins as far as a
   browser is concerned: start the handshake on www, come back to the apex,
   and the cookie holding the state was never sent — the sign-in fails with
   nothing obviously wrong. Staying on whichever host they arrived at keeps
   the cookie with them.

   The cost is that both addresses have to be registered on the app. GitHub
   allows several callback URLs, so that is a box to fill in rather than a
   problem. */
function siteUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';

  if (host) {
    const protocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0]
      || (String(host).startsWith('localhost') ? 'http' : 'https');

    return `${protocol}://${host}`;
  }

  return String(process.env.PUBLIC_URL || 'https://vlipa.dev').trim().replace(/\/+$/, '');
}

export const callbackUrl = (req) => `${siteUrl(req)}/api/github/callback`;

export function authUrl({ req, state }) {
  const query = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: callbackUrl(req),
    state,
  });

  return `${AUTH_URL}?${query}`;
}

export async function tokenFromCode({ req, code }) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId(),
      client_secret: clientSecret(),
      code,
      redirect_uri: callbackUrl(req),
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    return { error: data.error_description || data.error || 'GitHub would not complete the sign-in.' };
  }

  return { token: data.access_token };
}

/* ---------- talking to the API ---------- */

async function call(token, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'vlipa',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));

    const message = response.status === 401
      ? 'Your GitHub connection has expired. Connect it again.'
      : response.status === 403
        ? (detail.message || 'GitHub refused that (403). The app may not have access to this repository.')
        : response.status === 404
          ? 'GitHub could not find that. The app may not be installed on this repository.'
          : response.status === 409
            ? 'That repository is empty — push a first commit to it on GitHub, then come back.'
            : detail.message || `GitHub answered ${response.status}.`;

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return response.status === 204 ? null : response.json();
}

export async function whoAmI(token) {
  const me = await call(token, '/user');
  return { login: me.login, name: me.name || me.login, avatar: me.avatar_url };
}

/* The repositories this installation can reach, newest touched first. Only
   the ones the person can actually write to are offered: a list you cannot
   commit to is a list of disappointments. */
export async function listRepos(token) {
  const seen = new Map();

  const take = (repo) => {
    if (!repo?.full_name || !repo.permissions?.push) return;

    seen.set(repo.full_name, {
      fullName: repo.full_name,
      name: repo.name,
      owner: repo.owner?.login || '',
      private: Boolean(repo.private),
      branch: repo.default_branch || 'main',
      updatedAt: repo.pushed_at || repo.updated_at || '',
    });
  };

  // A GitHub App sees repositories through its installations; a plain OAuth
  // token sees them through /user/repos. Asking both ways means this works
  // whichever way the app was set up.
  const installed = await call(token, '/user/installations?per_page=20').catch(() => null);

  for (const one of installed?.installations || []) {
    const repos = await call(token, `/user/installations/${one.id}/repositories?per_page=100`).catch(() => null);
    for (const repo of repos?.repositories || []) take(repo);
  }

  if (!seen.size) {
    const mine = await call(token, '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator').catch(() => []);
    for (const repo of mine || []) take(repo);
  }

  return [...seen.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function listBranches(token, fullName) {
  const branches = await call(token, `/repos/${fullName}/branches?per_page=100`);
  return (branches || []).map((one) => one.name);
}

/* Where a branch currently points, and the tree hanging off it. */
async function headOf(token, fullName, branch) {
  const ref = await call(token, `/repos/${fullName}/git/ref/heads/${encodeURIComponent(branch)}`);
  const commit = await call(token, `/repos/${fullName}/git/commits/${ref.object.sha}`);

  return { commit: ref.object.sha, tree: commit.tree.sha };
}

/* The files, as a project the editor can open.

   One request gets the whole tree, then each file is fetched by its blob sha.
   Anything binary, generated or too big is skipped and counted, so the person
   is told what was left behind rather than quietly handed a partial project. */
export async function readProject(token, fullName, branch) {
  const head = await headOf(token, fullName, branch);
  const tree = await call(token, `/repos/${fullName}/git/trees/${head.tree}?recursive=1`);

  const wanted = [];
  const skipped = { binary: 0, big: 0, extra: 0 };

  for (const entry of tree.tree || []) {
    if (entry.type !== 'blob') continue;

    if (SKIP_PATH.test(entry.path) || SKIP_EXT.test(entry.path)) { skipped.binary += 1; continue; }
    if (entry.size > MAX_FILE_BYTES) { skipped.big += 1; continue; }

    wanted.push(entry);
  }

  // Smallest first, so a project of many small files arrives whole rather
  // than one enormous file eating the whole allowance.
  wanted.sort((a, b) => (a.size || 0) - (b.size || 0));

  const files = [];
  let bytes = 0;

  for (const entry of wanted) {
    if (files.length >= MAX_FILES || bytes + (entry.size || 0) > MAX_TOTAL_BYTES) { skipped.extra += 1; continue; }

    const blob = await call(token, `/repos/${fullName}/git/blobs/${entry.sha}`).catch(() => null);
    if (!blob?.content) { skipped.binary += 1; continue; }

    const text = Buffer.from(blob.content, blob.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');

    // A file carrying a null byte was never text, whatever its extension said.
    if (text.includes('\u0000')) { skipped.binary += 1; continue; }

    files.push({ path: entry.path, content: text });
    bytes += entry.size || text.length;
  }

  return { files, skipped, head, truncated: Boolean(tree.truncated) };
}

/* One commit holding every changed file.

   The tree endpoint takes file contents inline, so this is four calls rather
   than one per file: build a tree on top of the current one, commit it, and
   move the branch. A deletion is an entry with a null sha. */
export async function commitFiles(token, fullName, branch, { message, files = [], deleted = [] }) {
  const head = await headOf(token, fullName, branch);

  const entries = [
    ...files.map((file) => ({ path: file.path, mode: '100644', type: 'blob', content: file.content })),
    ...deleted.map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
  ];

  if (!entries.length) {
    const error = new Error('Nothing has changed, so there is nothing to commit.');
    error.status = 400;
    throw error;
  }

  const tree = await call(token, `/repos/${fullName}/git/trees`, {
    method: 'POST',
    body: { base_tree: head.tree, tree: entries },
  });

  // A tree identical to the one already on the branch means the files came
  // back the same as they went out. Committing that is noise in the history.
  if (tree.sha === head.tree) {
    const error = new Error('Those files are identical to what is already on the branch.');
    error.status = 400;
    throw error;
  }

  const commit = await call(token, `/repos/${fullName}/git/commits`, {
    method: 'POST',
    body: { message, tree: tree.sha, parents: [head.commit] },
  });

  await call(token, `/repos/${fullName}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: { sha: commit.sha },
  });

  return {
    sha: commit.sha,
    short: commit.sha.slice(0, 7),
    url: `https://github.com/${fullName}/commit/${commit.sha}`,
    files: files.length,
    deleted: deleted.length,
  };
}
