/* Faces.

   Somebody's picture where their name is, and the initial on a coloured disc
   where there is no picture. The colour is worked out from the name rather
   than stored, so the same person is the same colour on every screen without
   anything having to remember it.

   Uploading one never leaves the browser as a file: it is drawn into a canvas
   at 128 square, cropped to the middle, and handed over as a data URL. That
   is small enough to keep beside the account, which means no file store to
   run, nothing to serve, and no orphaned images when somebody leaves. */

import { el } from './dom.js';

const SHADES = ['#3532f6', '#6b4dff', '#17845a', '#b7791f', '#c8372d', '#0f8ea8', '#8a3ffc', '#5a6472'];

function shadeOf(seed) {
  let sum = 0;
  for (const letter of String(seed || '?')) sum = (sum * 31 + letter.charCodeAt(0)) % 9973;
  return SHADES[sum % SHADES.length];
}

const initialOf = (name) => String(name || '?').trim().charAt(0).toUpperCase() || '?';

export function avatar(person, size = 34) {
  const name = person?.name || person?.email || '';

  if (person?.photo) {
    return el('img', {
      class: 'face',
      src: person.photo,
      alt: '',
      width: size,
      height: size,
      style: `width:${size}px;height:${size}px`,
    });
  }

  return el('span', {
    class: 'face face--letter',
    style: `width:${size}px;height:${size}px;background:${shadeOf(name)};font-size:${Math.round(size * 0.42)}px`,
    text: initialOf(name),
    'aria-hidden': 'true',
  });
}

/* The chosen file, shrunk to a square and handed back as a data URL. */
export function shrink(file, side = 128) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) {
      reject(new Error('Pick an image.'));
      return;
    }

    const url = URL.createObjectURL(file);
    const picture = new Image();

    picture.onload = () => {
      URL.revokeObjectURL(url);

      // The middle of the picture, squared off: a face is nearly always there,
      // and a squashed portrait is worse than a cropped one.
      const cut = Math.min(picture.width, picture.height);
      const left = (picture.width - cut) / 2;
      const top = (picture.height - cut) / 2;

      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;

      const paint = canvas.getContext('2d');
      paint.imageSmoothingQuality = 'high';
      paint.drawImage(picture, left, top, cut, cut, 0, 0, side, side);

      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };

    picture.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be opened as a picture.'));
    };

    picture.src = url;
  });
}
