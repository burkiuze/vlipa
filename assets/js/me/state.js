/* What a personal account is, in the browser.

   The business studio keeps a company, a role and a team; none of that exists
   here. One person has three things — their conversations, their skills, and
   a couple of settings — and all three come back from /api/me in one request
   so the app opens on one round trip. */

import { api } from '../studio/api.js';

export const me = {
  user: null,
  skills: [],
  settings: { model: 'vlipa', mode: 'fast' },
  chats: [],
};

export const call = (body) => api('/api/me', { method: 'POST', body });

/* The shell draws your name and face down the left, and Settings is where
   both are changed. Rather than have Settings reach into the shell — or the
   shell poll for a change — the shell leaves the way to redraw itself here. */
export const shell = { redraw: () => {} };

export async function load() {
  const data = await call({ action: 'load' });

  me.user = data.user;
  me.skills = data.skills || [];
  me.settings = data.settings || me.settings;
  me.chats = data.chats || [];

  return data;
}

/* The skills that are switched on, in the shape the server wants them: a name
   and the words, nothing else. A skill that is off is still yours — it simply
   is not sent. */
export const liveSkills = () => me.skills
  .filter((skill) => skill.on !== false)
  .map((skill) => ({ name: skill.name, text: skill.text }));
