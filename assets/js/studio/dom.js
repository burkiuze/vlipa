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
export function menu({ label, value, options, onPick, className = '' }) {
  const button = el('button', {
    class: `pick ${className}`.trim(),
    type: 'button',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
  }, [
    el('span', { class: 'pick__label', text: options.find((option) => option.id === value)?.label || label }),
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
        class: `pickmenu__item${option.id === picked ? ' is-on' : ''}`,
        type: 'button',
        role: 'option',
        'aria-selected': String(option.id === picked),
        onclick: () => {
          button.querySelector('.pick__label').textContent = option.label;
          draw(option.id);
          close();
          onPick(option.id);
        },
      }, [
        el('span', { text: option.label }),
        option.note ? el('small', { text: option.note }) : null,
      ]));
    }
  };

  button.addEventListener('click', () => {
    if (!list.hidden) return close();

    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', away, true);
    document.addEventListener('keydown', escape, true);
  });

  const wrap = el('div', { class: 'pickwrap' }, [button, list]);
  draw(value);

  return wrap;
}
