/* The handful of DOM helpers every view uses. */

export const $ = (id) => document.getElementById(id);

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'value') node.value = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value);
  }

  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  return node;
}

export function clear(node) {
  node.innerHTML = '';
  return node;
}

let toastTimer = null;

export function toast(message, kind = '') {
  const node = $('toast');

  node.textContent = message;
  node.className = `toast is-on${kind ? ` toast--${kind}` : ''}`;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = 'toast'; }, 3200);
}

export function when(stamp) {
  if (!stamp) return '';

  const date = new Date(stamp);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);

  if (days === 0) return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;

  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* A small modal, since several views need one. */
export function dialog({ title, body, confirm = 'Save', onConfirm }) {
  const host = $('modal');

  // A dialog may open another one from its confirm handler (Vlipa's proposals
  // are reviewed that way). Closing the first must not wipe the second, so a
  // dialog only clears the stage while it is still the one standing on it.
  const close = () => {
    if (!host.contains(form)) return;
    host.hidden = true;
    clear(host);
  };

  const form = el('form', {
    class: 'modal__box',
    onsubmit: async (event) => {
      event.preventDefault();
      const button = form.querySelector('[type=submit]');
      button.disabled = true;

      try {
        await onConfirm(new FormData(form));
        close();
      } catch (error) {
        toast(error.message || 'That did not work.', 'bad');
      } finally {
        button.disabled = false;
      }
    },
  }, [
    el('h3', { text: title }),
    el('div', { class: 'modal__body' }, body),
    el('div', { class: 'modal__foot' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', text: 'Cancel', onclick: close }),
      el('button', { class: 'btn', type: 'submit', text: confirm }),
    ]),
  ]);

  clear(host).appendChild(form);
  host.hidden = false;
  host.onclick = (event) => { if (event.target === host) close(); };

  form.querySelector('input, select, textarea')?.focus();
  return close;
}

export function field(label, control, hint) {
  return el('label', { class: 'field' }, [
    el('span', { text: label }),
    control,
    hint ? el('small', { text: hint }) : null,
  ]);
}

/* A dropdown that stays on the page.

   A native <select> on a phone takes over the whole screen, which is the wrong
   gesture for picking a model mid-sentence. This is a button and a small list
   anchored under it, and it closes on the next click, Escape or scroll. */
export function menu({ label, value, options, onPick, className = '', keepLabel = false }) {
  // An option may carry a picture of its own — a model's logo, say.
  const badge = (option) => (option?.icon
    ? el('img', { class: 'pick__logo', src: option.icon, alt: '', width: 16, height: 16, loading: 'lazy' })
    : null);

  const chosen = options.find((option) => option.id === value);

  const button = el('button', {
    class: `pick ${className}`.trim(),
    type: 'button',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
  }, [
    badge(chosen),
    el('span', { class: 'pick__label', text: (keepLabel ? label : chosen?.label) || label }),
    el('span', { class: 'pick__caret', html: '<svg viewBox="0 0 24 24" fill="none"><path d="M8 10l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
  ]);

  const list = el('div', { class: 'pickmenu', role: 'listbox', hidden: true });

  const close = () => {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', away, true);
    document.removeEventListener('keydown', escape, true);
  };

  const away = (event) => { if (!wrap.contains(event.target)) close(); };
  const escape = (event) => { if (event.key === 'Escape') close(); };

  const draw = (picked) => {
    clear(list);

    for (const option of options) {
      list.appendChild(el('button', {
        class: `pickmenu__item${option.icon ? ' pickmenu__item--logo' : ''}${option.id === picked ? ' is-on' : ''}`,
        type: 'button',
        role: 'option',
        'aria-selected': String(option.id === picked),
        onclick: () => {
          // A picker keeps showing what was picked; a list of actions has
          // nothing to keep, so its button says the same thing afterwards.
          if (!keepLabel) {
            const shown = button.querySelector('.pick__logo');
            if (option.icon && shown) shown.src = option.icon;
            else if (option.icon) button.prepend(badge(option));
            else shown?.remove();

            button.querySelector('.pick__label').textContent = option.label;
            draw(option.id);
          }

          close();
          onPick(option.id);
        },
      }, [
        badge(option),
        el('span', { class: 'pickmenu__label', text: option.label }),
        option.note ? el('small', { text: option.note }) : null,
      ]));
    }
  };

  button.addEventListener('click', () => {
    if (!list.hidden) return close();

    // Which way it opens depends on where the button is. The model picker
    // sits at the bottom of the screen and has to go up; the table's toolbar
    // sits at the top, and going up put the list off the top of the window.
    const box = button.getBoundingClientRect();
    list.classList.toggle('pickmenu--down', box.top < window.innerHeight / 2);
    list.classList.toggle('pickmenu--right', box.left > window.innerWidth - 260);

    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', away, true);
    document.addEventListener('keydown', escape, true);
  });

  const wrap = el('div', { class: 'pickwrap' }, [button, list]);
  draw(value);

  return wrap;
}

/* ---------- what the assistant writes ---------- */

/* Models write markdown whether you ask them to or not, so the asterisks are
   turned into what they mean rather than shown to the reader. This is a small
   subset on purpose — bold, italics, inline code, links, lists, headings —
   and everything is built as nodes, never as HTML, so nothing in an answer
   can become markup. */

function inline(text, into) {
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)(?<!\s)\3|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let at = 0;
  let found;

  while ((found = pattern.exec(text))) {
    if (found.index > at) into.appendChild(document.createTextNode(text.slice(at, found.index)));

    if (found[2] !== undefined) into.appendChild(el('strong', { text: found[2] }));
    else if (found[4] !== undefined) into.appendChild(el('em', { text: found[4] }));
    else if (found[5] !== undefined) into.appendChild(el('code', { text: found[5] }));
    else into.appendChild(el('a', { href: found[7], target: '_blank', rel: 'noopener noreferrer', text: found[6] }));

    at = found.index + found[0].length;
  }

  if (at < text.length) into.appendChild(document.createTextNode(text.slice(at)));
  return into;
}

export function prose(text) {
  const host = el('div', { class: 'prose' });
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');

  let list = null;
  let paragraph = null;

  const endList = () => { list = null; };
  const endParagraph = () => { paragraph = null; };

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) { endList(); endParagraph(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^(\d{1,3})[.)]\s+(.*)$/);

    if (heading) {
      endList();
      endParagraph();
      host.appendChild(inline(heading[2], el(heading[1].length <= 2 ? 'h4' : 'h5')));
      continue;
    }

    if (/^([-*_]\s*){3,}$/.test(line)) { endList(); endParagraph(); continue; }

    if (bullet || numbered) {
      endParagraph();

      const want = bullet ? 'ul' : 'ol';
      if (!list || list.tagName.toLowerCase() !== want) {
        list = el(want, { class: 'prose__list' });
        host.appendChild(list);
      }

      list.appendChild(inline(bullet ? bullet[1] : numbered[2], el('li')));
      continue;
    }

    endList();

    // Lines that belong together stay in one paragraph, with their breaks.
    if (!paragraph) {
      paragraph = el('p');
      host.appendChild(paragraph);
    } else {
      paragraph.appendChild(el('br'));
    }

    inline(line, paragraph);
  }

  if (!host.childNodes.length) host.appendChild(el('p', { text: String(text ?? '') }));
  return host;
}

/* The same text with the markers taken out, for somewhere that holds plain
   text — the document in Vlipa Write, or the clipboard. */
export function plain(text) {
  return String(text ?? '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '• ')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^*_])[*_](?!\s)(.+?)(?<!\s)[*_]/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');
}
