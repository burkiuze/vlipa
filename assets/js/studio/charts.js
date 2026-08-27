/* The few charts the studio needs, drawn by hand.

   There is no charting library here and there is not going to be: three
   shapes — a bar, a stack and a ring — cover everything the workspace has to
   show, and they come to a few hundred bytes rather than a few hundred
   kilobytes. Every one of them is plain SVG with the page's own colours, so
   they follow the theme without being told to. */

import { el } from './dom.js';

export const SHADES = ['#3532f6', '#6b4dff', '#17845a', '#b7791f', '#c8372d', '#0f8ea8', '#8a3ffc', '#5a6472'];

const svg = (attrs, children = []) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', attrs.tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key !== 'tag' && value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
};

/* A row of horizontal bars: a name, a bar, a number. Each row can be split
   into parts — todo, doing, in review — and then the bar is stacked. */
export function bars(rows, { empty = 'Nothing to show yet.' } = {}) {
  if (!rows.length) return el('p', { class: 'empty', text: empty });

  const top = Math.max(1, ...rows.map((row) => row.parts.reduce((sum, part) => sum + part.value, 0)));

  return el('div', { class: 'chart chart--bars' }, rows.map((row) => {
    const total = row.parts.reduce((sum, part) => sum + part.value, 0);

    return el('div', { class: 'bar' }, [
      el('span', { class: 'bar__name', title: row.name, text: row.name }),
      el('div', { class: 'bar__track' }, [
        el('div', { class: 'bar__fill', style: `width:${(total / top) * 100}%` }, row.parts
          .filter((part) => part.value > 0)
          .map((part) => el('span', {
            class: 'bar__part',
            style: `flex:${part.value}; background:${part.colour}`,
            title: `${part.label}: ${part.value}`,
          }))),
      ]),
      el('span', { class: `bar__value${row.warn ? ' is-warn' : ''}`, text: String(total) }),
    ]);
  }));
}

/* A ring, for a handful of slices that add up to a whole — which department
   the work is in, and how much of it has no department at all. */
export function ring(slices, { size = 168, hole = 0.62, middle = '' } = {}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (!total) return el('p', { class: 'empty', text: 'Nothing to show yet.' });

  const half = size / 2;
  const radius = half - 6;
  const width = radius * (1 - hole);
  const line = radius - width / 2;
  const round = 2 * Math.PI * line;

  let turned = 0;

  const parts = slices.filter((slice) => slice.value > 0).map((slice) => {
    const length = (slice.value / total) * round;

    const arc = svg({
      tag: 'circle',
      cx: half, cy: half, r: line,
      fill: 'none',
      stroke: slice.colour,
      'stroke-width': width,
      'stroke-dasharray': `${length} ${round - length}`,
      'stroke-dashoffset': -turned,
      transform: `rotate(-90 ${half} ${half})`,
    }, [svg({ tag: 'title' }, [document.createTextNode(`${slice.name}: ${slice.value}`)])]);

    turned += length;
    return arc;
  });

  const face = svg({ tag: 'svg', viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'ring__face' }, parts);

  return el('div', { class: 'ring' }, [
    el('div', { class: 'ring__plate' }, [
      face,
      middle ? el('div', { class: 'ring__middle' }, [
        el('b', { text: String(total) }),
        el('span', { text: middle }),
      ]) : null,
    ]),
    el('ul', { class: 'ring__keys' }, slices.filter((slice) => slice.value > 0).map((slice) => el('li', {}, [
      el('i', { style: `background:${slice.colour}` }),
      el('span', { text: slice.name }),
      el('b', { text: String(slice.value) }),
    ]))),
  ]);
}

/* One line, split into its states: the whole company's work in a strip. */
export function strip(parts) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (!total) return el('p', { class: 'empty', text: 'Nothing to show yet.' });

  return el('div', { class: 'strip' }, [
    el('div', { class: 'strip__bar' }, parts.filter((part) => part.value > 0).map((part) => el('span', {
      style: `flex:${part.value}; background:${part.colour}`,
      title: `${part.label}: ${part.value}`,
    }))),
    el('ul', { class: 'strip__keys' }, parts.map((part) => el('li', {}, [
      el('i', { style: `background:${part.colour}` }),
      el('span', { text: part.label }),
      el('b', { text: String(part.value) }),
    ]))),
  ]);
}
