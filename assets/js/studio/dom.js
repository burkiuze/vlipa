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

  if (days === 0) return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'dün';
  if (days < 7) return `${days} gün önce`;

  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

/* A small modal, since several views need one. */
export function dialog({ title, body, confirm = 'Kaydet', onConfirm }) {
  const host = $('modal');

  const close = () => { host.hidden = true; clear(host); };

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
        toast(error.message || 'Olmadı.', 'bad');
      } finally {
        button.disabled = false;
      }
    },
  }, [
    el('h3', { text: title }),
    el('div', { class: 'modal__body' }, body),
    el('div', { class: 'modal__foot' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', text: 'Vazgeç', onclick: close }),
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
