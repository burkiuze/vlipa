/* vlipa — account endpoints, backed by Netlify Blobs.
 *
 *   POST /api/auth/signup   { email, password, name?, remember? }
 *   POST /api/auth/login    { email, password, remember? }
 *   POST /api/auth/logout
 *   GET  /api/auth/me
 *
 * Blobs needs no setup: on Netlify the store is provisioned with the site.
 * The logic lives in lib/auth-core.mjs so it can be tested without Netlify.
 */

import { handleAuth } from './lib/auth-core.mjs';

/* Imported at call time rather than at module load: if the dependency is
   missing from a deploy, the endpoint answers with a readable error instead of
   the whole function failing to boot. */
async function loadStores() {
  const { getStore } = await import('@netlify/blobs');
  return {
    users: adapt(getStore('vlipa-users')),
    sessions: adapt(getStore('vlipa-sessions'))
  };
}

function adapt(store) {
  return {
    getJSON: (key) => store.get(key, { type: 'json' }),
    setJSON: (key, value) => store.setJSON(key, value),
    delete: (key) => store.delete(key)
  };
}

export default async (request) => {
  let stores;
  try {
    stores = await loadStores();
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Account storage is unavailable on this deploy.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    return await handleAuth(request, stores);
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Something went wrong. Try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
