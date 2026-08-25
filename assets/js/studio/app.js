/* The studio: sites, the editor, AI teams and the ask box. */

import { SECTION_TYPES, THEMES, blankSection, starterSite, themeById } from './themes.js';
import { renderSite, styles } from './render.js';
import { download, fromDataUrl, makeZip } from './zip.js';

const state = {
  user: null,
  sites: [],
  site: null,
  selected: null,
  teams: [],
  library: [],
  team: null,
  dirty: false,
};

const $ = (id) => document.getElementById(id);
const publishHost = 'vlipa.dev';

/* ---------- plumbing ---------- */

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

let toastTimer = null;

function toast(text) {
  const node = $('toast');
  node.textContent = text;
  node.classList.add('is-on');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-on'), 2600);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }

  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  return node;
}

function showView(name) {
  for (const view of ['sites', 'build', 'editor', 'team', 'ask']) {
    $(`view-${view}`).classList.toggle('hidden', view !== name);
  }

  document.querySelectorAll('#tabs button').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset.view === name));
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- sites ---------- */

function renderSiteList() {
  const box = $('siteList');
  box.innerHTML = '';

  if (!state.sites.length) {
    box.appendChild(el('h3', { text: 'Nothing here yet' }));
    box.appendChild(el('p', { class: 'note', text: 'Start from a theme above, or describe the shop in "Build with AI" and let the studio draft it.' }));
    return;
  }

  box.appendChild(el('h3', { text: `${state.sites.length} site${state.sites.length > 1 ? 's' : ''}` }));

  const grid = el('div', { class: 'cols', style: 'margin-top:18px' });

  for (const site of state.sites) {
    const theme = themeById(site.theme);

    grid.appendChild(el('div', { class: 'tile' }, [
      el('h4', { text: site.name }),
      el('span', { class: 'sub', text: `${theme.name} · ${site.sections} section${site.sections === 1 ? '' : 's'}` }),
      el('div', { class: 'swatch' }, [
        el('span', { style: `background:${theme.palette.accent}` }),
        el('span', { style: `background:${theme.palette.bg}` }),
        el('span', { style: `background:${theme.palette.dark}` }),
      ]),
      site.published
        ? el('span', { class: 'sub', text: `Live at ${site.slug}.${publishHost}` })
        : el('span', { class: 'sub', text: 'Not published' }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn btn--sm', text: 'Open', onclick: () => loadSite(site.id) }),
        el('button', {
          class: 'btn btn--danger btn--sm',
          text: 'Delete',
          onclick: async () => {
            if (!window.confirm(`Delete "${site.name}"? This cannot be undone.`)) return;
            await api(`/api/sites?id=${encodeURIComponent(site.id)}`, { method: 'DELETE' });
            await loadSites();
            toast('Site deleted.');
          },
        }),
      ]),
    ]));
  }

  box.appendChild(grid);
}

function renderThemeGrid() {
  const grid = $('themeGrid');
  grid.innerHTML = '';

  for (const theme of THEMES) {
    grid.appendChild(el('div', { class: 'tile' }, [
      el('h4', { text: theme.name }),
      el('span', { class: 'sub', text: theme.for }),
      el('div', { class: 'swatch' }, [
        el('span', { style: `background:${theme.palette.accent}` }),
        el('span', { style: `background:${theme.palette.bg}` }),
        el('span', { style: `background:${theme.palette.text}` }),
        el('span', { style: `background:${theme.palette.dark}` }),
      ]),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn btn--sm',
          text: 'Use this theme',
          onclick: () => openSite({ ...starterSite(theme.id, `${theme.name} store`), assets: {} }),
        }),
      ]),
    ]));
  }
}

async function loadSites() {
  const data = await api('/api/sites');
  state.sites = data.sites || [];
  renderSiteList();
}

async function loadSite(id) {
  const data = await api(`/api/sites?id=${encodeURIComponent(id)}`);
  openSite(data.site);
}

function openSite(site) {
  state.site = { assets: {}, sections: [], ...site };
  state.selected = state.site.sections[0]?.id || null;
  state.dirty = false;

  $('siteName').value = state.site.name || '';
  $('siteTheme').value = state.site.theme || 'aurora';
  $('siteLang').value = state.site.lang || 'en';
  $('slug').value = state.site.slug || '';

  updatePublishState();
  renderSections();
  renderProps();
  refreshPreview();
  showView('editor');
}

/* ---------- editor ---------- */

function renderSections() {
  const list = $('sectionList');
  list.innerHTML = '';

  const sections = state.site.sections;

  sections.forEach((block, index) => {
    const label = SECTION_TYPES.find((type) => type.type === block.type);
    const title = block.props?.title || block.props?.text || label?.note || '';

    list.appendChild(el('div', {
      class: 'sect',
      'aria-current': String(block.id === state.selected),
      onclick: () => { state.selected = block.id; renderSections(); renderProps(); },
    }, [
      el('div', {}, [
        el('b', { text: label ? label.label : block.type }),
        el('span', { text: String(title).slice(0, 42) }),
      ]),
      el('div', { class: 'tools' }, [
        el('button', {
          class: 'icon-btn', title: 'Move up', text: '↑',
          onclick: (event) => { event.stopPropagation(); move(index, -1); },
        }),
        el('button', {
          class: 'icon-btn', title: 'Move down', text: '↓',
          onclick: (event) => { event.stopPropagation(); move(index, 1); },
        }),
        el('button', {
          class: 'icon-btn', title: 'Remove', text: '×',
          onclick: (event) => {
            event.stopPropagation();
            sections.splice(index, 1);
            if (state.selected === block.id) state.selected = sections[0]?.id || null;
            touched();
          },
        }),
      ]),
    ]));
  });

  if (!sections.length) {
    list.appendChild(el('p', { class: 'note', text: 'No sections yet. Add one below.' }));
  }
}

function move(index, direction) {
  const sections = state.site.sections;
  const target = index + direction;
  if (target < 0 || target >= sections.length) return;

  [sections[index], sections[target]] = [sections[target], sections[index]];
  touched();
}

function touched() {
  state.dirty = true;
  renderSections();
  renderProps();
  refreshPreview();
}

function fieldRow(label, value, onInput, long) {
  const input = long
    ? el('textarea', { oninput: (event) => onInput(event.target.value) })
    : el('input', { type: 'text', value, oninput: (event) => onInput(event.target.value) });

  if (long) input.value = value;

  return el('div', { class: 'field' }, [el('label', { text: label }), input]);
}

function imageField(label, current, onPick) {
  const preview = current
    ? el('figure', {}, [
        el('img', { src: state.site.assets[current] || current, alt: '' }),
        el('button', { type: 'button', title: 'Remove', text: '×', onclick: () => onPick('') }),
      ])
    : null;

  const input = el('input', {
    type: 'file',
    accept: 'image/*',
    onchange: async (event) => {
      const file = event.target.files[0];
      if (!file) return;

      try {
        const ref = await addImage(file);
        onPick(ref);
      } catch (error) {
        toast(error.message);
      }

      event.target.value = '';
    },
  });

  return el('div', { class: 'field' }, [
    el('label', { text: label }),
    input,
    preview ? el('div', { class: 'thumbs' }, [preview]) : null,
  ]);
}

async function addImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('That is not an image.');

  const dataUrl = await shrink(file);
  const bytes = Math.ceil((dataUrl.length * 3) / 4);
  if (bytes > 900_000) throw new Error('That photograph is still too large. Try a smaller one.');

  const total = Object.values(state.site.assets).reduce((sum, value) => sum + value.length, 0);
  if (total + dataUrl.length > 3_600_000) throw new Error('This site is carrying as many photographs as it can hold.');

  const ref = `asset:${Math.random().toString(36).slice(2, 10)}`;
  state.site.assets[ref] = dataUrl;
  return ref;
}

function shrink(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const image = new Image();

      image.onload = () => {
        const max = 1600;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');

        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);

        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };

      image.onerror = () => reject(new Error('That image could not be read.'));
      image.src = reader.result;
    };

    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

function renderProps() {
  const box = $('props');
  box.innerHTML = '';

  const block = state.site.sections.find((section) => section.id === state.selected);

  if (!block) {
    box.appendChild(el('h3', { text: 'Section' }));
    box.appendChild(el('p', { class: 'note', text: 'Pick a section to edit its text and photographs.' }));
    return;
  }

  const label = SECTION_TYPES.find((type) => type.type === block.type);
  box.appendChild(el('h3', { text: label ? label.label : block.type }));
  box.appendChild(el('p', { class: 'note', text: label ? label.note : '' }));

  const props = block.props;

  for (const [key, value] of Object.entries(props)) {
    if (key === 'image') {
      box.appendChild(imageField('Photograph', value, (ref) => { props.image = ref; touched(); }));
      continue;
    }

    if (key === 'images') {
      const thumbs = el('div', { class: 'thumbs' }, (value || []).map((ref, index) =>
        el('figure', {}, [
          el('img', { src: state.site.assets[ref] || ref, alt: '' }),
          el('button', {
            type: 'button', text: '×', title: 'Remove',
            onclick: () => { props.images.splice(index, 1); touched(); },
          }),
        ])));

      box.appendChild(el('div', { class: 'field' }, [
        el('label', { text: 'Photographs' }),
        el('input', {
          type: 'file', accept: 'image/*', multiple: 'multiple',
          onchange: async (event) => {
            for (const file of Array.from(event.target.files).slice(0, 8)) {
              try {
                props.images = props.images || [];
                props.images.push(await addImage(file));
              } catch (error) {
                toast(error.message);
                break;
              }
            }
            event.target.value = '';
            touched();
          },
        }),
        (value || []).length ? thumbs : null,
      ]));

      continue;
    }

    if (Array.isArray(value)) {
      box.appendChild(el('label', { class: 'note', text: 'Items', style: 'display:block;margin:18px 0 8px' }));

      value.forEach((item, index) => {
        const wrap = el('div', { class: 'panel', style: 'padding:14px;margin-bottom:10px' });

        for (const [field, fieldValue] of Object.entries(item)) {
          if (field === 'image') {
            wrap.appendChild(imageField('Photograph', fieldValue, (ref) => { item.image = ref; touched(); }));
          } else {
            wrap.appendChild(fieldRow(
              field === 'q' ? 'Question' : field === 'a' ? 'Answer' : field[0].toUpperCase() + field.slice(1),
              fieldValue,
              (next) => { item[field] = next; state.dirty = true; refreshPreview(); },
              field === 'a' || field === 'text',
            ));
          }
        }

        wrap.appendChild(el('button', {
          class: 'btn btn--danger btn--sm', text: 'Remove item',
          onclick: () => { value.splice(index, 1); touched(); },
        }));

        box.appendChild(wrap);
      });

      box.appendChild(el('button', {
        class: 'btn btn--ghost btn--sm', text: 'Add item',
        onclick: () => {
          const template = value[0] ? Object.fromEntries(Object.keys(value[0]).map((k) => [k, ''])) : { title: '', text: '' };
          value.push(template);
          touched();
        },
      }));

      continue;
    }

    box.appendChild(fieldRow(
      key[0].toUpperCase() + key.slice(1),
      value,
      (next) => { props[key] = next; state.dirty = true; refreshPreview(); renderSections(); },
      key === 'text',
    ));
  }
}

function refreshPreview() {
  const html = renderSite(state.site, { resolve: (ref) => state.site.assets[ref] || '' });
  $('preview').srcdoc = html;
  $('editorName').textContent = state.site.name || 'Untitled';
  $('previewAddr').textContent = state.site.slug ? `${state.site.slug}.${publishHost}` : 'preview';
}

function updatePublishState() {
  const site = state.site;
  const live = Boolean(site.published && site.slug);

  $('publishState').textContent = live
    ? `Live at ${site.slug}.${publishHost}`
    : 'Not published yet.';

  $('unpublish').classList.toggle('hidden', !live);
  $('slugHint').textContent = `${$('slug').value || 'your-shop'}.${publishHost}`;
}

async function saveSite(quiet) {
  const data = await api('/api/sites', { method: 'POST', body: { site: state.site } });
  state.site.id = data.id;
  state.dirty = false;

  await loadSites();
  if (!quiet) toast('Saved.');
  return data;
}

function zipName() {
  return (state.site.name || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site';
}

function buildZip() {
  const files = [];
  const names = {};

  for (const [ref, dataUrl] of Object.entries(state.site.assets)) {
    const decoded = fromDataUrl(dataUrl);
    if (!decoded) continue;

    const name = `assets/${ref.replace('asset:', 'img-')}.${decoded.extension}`;
    names[ref] = name;
    files.push({ name, content: decoded.bytes });
  }

  const html = renderSite(state.site, { resolve: (ref) => names[ref] || '', stylesheet: true });

  files.unshift({ name: 'index.html', content: html });
  files.push({ name: 'styles.css', content: styles(state.site) });
  files.push({
    name: 'README.txt',
    content: [
      `${state.site.name || 'Your site'} — exported from vlipa studio`,
      '',
      'Everything here is a plain static site: index.html, styles.css and your',
      'photographs. Open index.html in a browser to check it, or drop this whole',
      'folder onto any static host (Vercel, Netlify, GitHub Pages, your own server).',
      '',
      'The code is yours. Nothing phones home.',
    ].join('\n'),
  });

  return makeZip(files);
}

/* ---------- teams ---------- */

function renderRoleGrid() {
  const grid = $('roleGrid');
  grid.innerHTML = '';

  for (const role of state.library) {
    const tile = el('button', {
      class: 'tile', type: 'button', 'aria-pressed': 'false',
      onclick: () => {
        const on = tile.getAttribute('aria-pressed') === 'true';
        const picked = grid.querySelectorAll('[aria-pressed="true"]').length;

        if (!on && picked >= 4) return toast('Four roles is the most a team can hold.');
        tile.setAttribute('aria-pressed', String(!on));
      },
    }, [
      el('h4', { text: role.title }),
      el('span', { class: 'sub', text: role.brief }),
      el('span', { class: 'sub', style: 'margin-top:12px;color:var(--brand)', text: role.alias }),
    ]);

    tile.dataset.role = role.id;
    grid.appendChild(tile);
  }
}

function renderTeams() {
  const box = $('teamList');
  box.innerHTML = '';

  if (!state.teams.length) {
    box.appendChild(el('h3', { text: 'No teams yet' }));
    box.appendChild(el('p', { class: 'note', text: 'Create one above. A team of two or three roles is usually enough.' }));
    return;
  }

  box.appendChild(el('h3', { text: 'Your teams' }));

  const grid = el('div', { class: 'cols', style: 'margin-top:18px' });

  for (const team of state.teams) {
    grid.appendChild(el('div', { class: 'tile' }, [
      el('h4', { text: team.name }),
      el('span', { class: 'sub', text: team.roles.map((role) => role.title).join(' · ') }),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn btn--sm', text: 'Open',
          onclick: () => {
            state.team = team;
            $('teamRun').classList.remove('hidden');
            $('teamRunName').textContent = team.name;
            $('teamAnswers').innerHTML = '';
            $('teamRun').scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        }),
        el('button', {
          class: 'btn btn--danger btn--sm', text: 'Delete',
          onclick: async () => {
            if (!window.confirm(`Delete the team "${team.name}"?`)) return;
            await api(`/api/teams?id=${encodeURIComponent(team.id)}`, { method: 'DELETE' });
            await loadTeams();
            toast('Team deleted.');
          },
        }),
      ]),
    ]));
  }

  box.appendChild(grid);
}

async function loadTeams() {
  const data = await api('/api/teams');
  state.teams = data.teams || [];
  state.library = data.library || [];

  renderRoleGrid();
  renderTeams();
}

function bubble({ who, text, why, mine }) {
  return el('div', { class: `bubble${mine ? ' bubble--me' : ''}` }, [
    el('div', { class: 'who', text: who }),
    el('div', { class: 'body', text }),
    why ? el('div', { class: 'why', text: why }) : null,
  ]);
}

/* ---------- boot ---------- */

async function boot() {
  let me;

  try {
    me = await api('/api/auth/me');
  } catch {
    window.location.replace('/login');
    return;
  }

  if (!me.user) {
    window.location.replace('/login');
    return;
  }

  state.user = me.user;
  $('who').textContent = me.user.name || me.user.email;

  if (me.storage === 'memory') {
    toast('Storage is not configured, so saved work will not survive. See .env.example.');
  }

  /* selects */
  const themeOptions = THEMES.map((theme) => el('option', { value: theme.id, text: `${theme.name} — ${theme.for}` }));
  themeOptions.forEach((option) => $('briefTheme').appendChild(option.cloneNode(true)));
  themeOptions.forEach((option) => $('siteTheme').appendChild(option));

  SECTION_TYPES.forEach((type) => {
    $('addSection').appendChild(el('option', { value: type.type, text: type.label }));
  });

  renderThemeGrid();

  /* model roster */
  try {
    const data = await api('/api/models');
    const box = $('roster');

    for (const model of data.models) {
      box.appendChild(el('span', { class: 'pill' }, [
        el('b', { text: model.title }),
        el('span', { text: model.blurb }),
      ]));
    }

    if (!data.ready) {
      box.appendChild(el('span', { class: 'error', text: 'No OPENROUTER_API_KEY on the server yet, so the AI parts will not answer.' }));
    }
  } catch { /* the roster is decoration; the studio works without it */ }

  await Promise.all([loadSites(), loadTeams()]);

  /* tabs */
  $('tabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-view]');
    if (button) showView(button.dataset.view);
  });

  $('signOut').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.assign('/');
  });

  /* sites */
  $('newFromTheme').addEventListener('click', () => $('themePicker').classList.toggle('hidden'));
  $('backToSites').addEventListener('click', () => {
    if (state.dirty && !window.confirm('Leave without saving?')) return;
    showView('sites');
  });

  /* editor */
  $('siteName').addEventListener('input', (event) => {
    state.site.name = event.target.value;
    state.site.brand = event.target.value;
    state.dirty = true;
    refreshPreview();
  });

  $('siteTheme').addEventListener('change', (event) => {
    state.site.theme = event.target.value;
    state.dirty = true;
    refreshPreview();
  });

  $('siteLang').addEventListener('change', (event) => {
    state.site.lang = event.target.value;
    state.dirty = true;
    refreshPreview();
  });

  $('addSectionBtn').addEventListener('click', () => {
    const block = blankSection($('addSection').value);
    state.site.sections.push(block);
    state.selected = block.id;
    touched();
  });

  $('saveSite').addEventListener('click', async () => {
    try {
      await saveSite();
    } catch (error) {
      toast(error.message);
    }
  });

  $('downloadZip').addEventListener('click', () => {
    try {
      download(buildZip(), `${zipName()}.zip`);
      toast('Downloaded. The code is yours.');
    } catch (error) {
      toast(error.message);
    }
  });

  $('slug').addEventListener('input', updatePublishState);

  $('publish').addEventListener('click', async () => {
    try {
      if (!state.site.id || state.dirty) await saveSite(true);

      const data = await api('/api/sites', {
        method: 'POST',
        body: { action: 'publish', id: state.site.id, slug: $('slug').value.trim().toLowerCase() },
      });

      state.site.slug = data.site.slug;
      state.site.published = true;

      updatePublishState();
      refreshPreview();
      await loadSites();
      toast(`Published at ${data.url}`);
    } catch (error) {
      toast(error.message);
    }
  });

  $('unpublish').addEventListener('click', async () => {
    try {
      await api('/api/sites', { method: 'POST', body: { action: 'unpublish', id: state.site.id } });
      state.site.published = false;
      updatePublishState();
      await loadSites();
      toast('Taken down.');
    } catch (error) {
      toast(error.message);
    }
  });

  /* build with AI */
  $('generate').addEventListener('click', async () => {
    const brief = $('brief').value.trim();
    if (brief.length < 8) return toast('Say a bit more about the shop.');

    $('generate').disabled = true;
    $('buildStatus').textContent = 'Routing to the build model…';

    try {
      const data = await api('/api/generate', {
        method: 'POST',
        body: { brief, theme: $('briefTheme').value },
      });

      $('buildStatus').textContent = `${data.routed.title}: ${data.routed.reason}`;
      openSite({ ...data.site, assets: {} });
      toast(data.recovered ? 'Drafted a starting point. Edit away.' : 'Draft ready.');
    } catch (error) {
      $('buildStatus').textContent = '';
      toast(error.message);
    } finally {
      $('generate').disabled = false;
    }
  });

  /* teams */
  $('createTeam').addEventListener('click', async () => {
    const name = $('teamName').value.trim();
    const roles = Array.from($('roleGrid').querySelectorAll('[aria-pressed="true"]')).map((tile) => tile.dataset.role);

    if (!name) return toast('Give the team a name.');
    if (!roles.length) return toast('Pick at least one role.');

    try {
      await api('/api/teams', { method: 'POST', body: { name, roles } });
      $('teamName').value = '';
      $('roleGrid').querySelectorAll('[aria-pressed="true"]').forEach((tile) => tile.setAttribute('aria-pressed', 'false'));
      await loadTeams();
      toast('Team created.');
    } catch (error) {
      toast(error.message);
    }
  });

  $('runTeam').addEventListener('click', async () => {
    const goal = $('goal').value.trim();
    if (!state.team) return;
    if (goal.length < 5) return toast('Give the team something to work on.');

    $('runTeam').disabled = true;
    $('teamStatus').textContent = 'The team is working…';
    $('teamAnswers').innerHTML = '';
    $('teamAnswers').appendChild(bubble({ who: 'You', text: goal, mine: true }));

    try {
      const data = await api('/api/teams', { method: 'POST', body: { action: 'run', id: state.team.id, goal } });

      for (const answer of data.answers) {
        $('teamAnswers').appendChild(bubble({
          who: `${answer.role} · ${answer.model}`,
          text: answer.text,
        }));
      }

      $('teamStatus').textContent = '';
    } catch (error) {
      $('teamStatus').textContent = '';
      toast(error.message);
    } finally {
      $('runTeam').disabled = false;
    }
  });

  /* ask */
  const history = [];

  $('askSend').addEventListener('click', async () => {
    const text = $('ask').value.trim();
    if (!text) return;

    history.push({ role: 'user', content: text });
    $('askLog').appendChild(bubble({ who: 'You', text, mine: true }));
    $('ask').value = '';
    $('askSend').disabled = true;
    $('askStatus').textContent = 'Choosing a model…';

    try {
      const data = await api('/api/chat', { method: 'POST', body: { messages: history } });

      history.push({ role: 'assistant', content: data.text });
      $('askLog').appendChild(bubble({ who: data.routed.title, text: data.text, why: data.routed.reason }));
      $('askStatus').textContent = '';
    } catch (error) {
      $('askStatus').textContent = '';
      toast(error.message);
    } finally {
      $('askSend').disabled = false;
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

boot();
