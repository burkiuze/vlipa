/* The few charts the studio needs, drawn by hand.

   There is no charting library here and there is not going to be: three
   shapes — a bar, a stack and a ring — cover everything the workspace has to
   show, and they come to a few hundred bytes rather than a few hundred
   kilobytes. Every one of them is plain SVG with the page's own colours, so
   they follow the theme without being told to. */

import { clear, el } from './dom.js';

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

/* ---------- a trend over time ---------- */

/* One series, over days: an area chart, which is what a single series over
   time is for. No legend — there is one colour, and the card's own heading
   says what is plotted. The endpoint is labelled and everything else is left
   to the crosshair, because a number on all thirty points is unreadable.

   The curve is a Catmull-Rom spline turned into beziers: straight segments
   between daily counts read as a saw, and nobody is trying to read the exact
   slope between Tuesday and Wednesday off it. */
function smooth(points, tension = 0.5) {
  if (points.length < 2) return '';

  const path = [`M ${points[0].x} ${points[0].y}`];

  for (let at = 0; at < points.length - 1; at += 1) {
    const before = points[Math.max(0, at - 1)];
    const from = points[at];
    const to = points[at + 1];
    const after = points[Math.min(points.length - 1, at + 2)];

    const c1x = from.x + ((to.x - before.x) / 6) * tension * 2;
    const c1y = from.y + ((to.y - before.y) / 6) * tension * 2;
    const c2x = to.x - ((after.x - from.x) / 6) * tension * 2;
    const c2y = to.y - ((after.y - from.y) / 6) * tension * 2;

    path.push(`C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${to.x} ${to.y}`);
  }

  return path.join(' ');
}

let trendCount = 0;

export function trend(points, { colour = '#17845a', unit = '', empty = 'Nothing to show yet.' } = {}) {
  if (points.length < 2) return el('p', { class: 'empty', text: empty });

  const W = 720;
  const H = 190;
  const PAD = { top: 14, right: 14, bottom: 22, left: 14 };

  const top = Math.max(1, ...points.map((point) => point.value));
  const inner = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };

  const placed = points.map((point, at) => ({
    ...point,
    x: PAD.left + (points.length === 1 ? inner.w / 2 : (at / (points.length - 1)) * inner.w),
    y: PAD.top + inner.h - (point.value / top) * inner.h,
  }));

  const line = smooth(placed);
  const last = placed[placed.length - 1];
  const id = `trend${trendCount += 1}`;

  const face = svg({ tag: 'svg', viewBox: `0 0 ${W} ${H}`, class: 'trend__face', preserveAspectRatio: 'none' }, [
    svg({ tag: 'defs' }, [
      svg({ tag: 'linearGradient', id, x1: '0', y1: '0', x2: '0', y2: '1' }, [
        svg({ tag: 'stop', offset: '0%', 'stop-color': colour, 'stop-opacity': '0.18' }),
        svg({ tag: 'stop', offset: '100%', 'stop-color': colour, 'stop-opacity': '0' }),
      ]),
    ]),

    // One recessive line to read heights against, at the average.
    svg({
      tag: 'line',
      x1: PAD.left, x2: W - PAD.right,
      y1: PAD.top + inner.h - (points.reduce((sum, point) => sum + point.value, 0) / points.length / top) * inner.h,
      y2: PAD.top + inner.h - (points.reduce((sum, point) => sum + point.value, 0) / points.length / top) * inner.h,
      stroke: 'var(--line)', 'stroke-width': '1',
    }),

    // The area wash, then the line over it.
    svg({
      tag: 'path',
      d: `${line} L ${last.x} ${PAD.top + inner.h} L ${placed[0].x} ${PAD.top + inner.h} Z`,
      fill: `url(#${id})`,
    }),

    // The box is stretched to the card's width, so the stroke is told not to
    // stretch with it: two pixels means two pixels.
    svg({
      tag: 'path',
      d: line,
      fill: 'none',
      stroke: colour,
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'vector-effect': 'non-scaling-stroke',
    }),

    // The endpoint, ringed in the surface colour so it stays legible over the
    // line, and the only point carrying a label.
    svg({ tag: 'circle', cx: last.x, cy: last.y, r: '7', fill: '#fff', stroke: colour, 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke' }),
  ]);

  // The crosshair: readers aim at a day, never at a two-pixel line.
  const hair = el('div', { class: 'trend__hair', hidden: true });
  const tip = el('div', { class: 'trend__tip', hidden: true });

  const plate = el('div', { class: 'trend__plate' }, [face, hair, tip]);

  const move = (event) => {
    const box = plate.getBoundingClientRect();
    const across = (event.clientX - box.left) / box.width;
    const at = Math.max(0, Math.min(placed.length - 1, Math.round(across * (placed.length - 1))));
    const point = placed[at];

    hair.hidden = false;
    tip.hidden = false;
    hair.style.left = `${(point.x / W) * 100}%`;

    clear(tip).append(
      el('b', { text: `${point.value}${unit ? ` ${unit}` : ''}` }),
      el('span', { text: point.label }),
    );

    // Kept inside the card rather than hanging off its edge.
    const side = (point.x / W) * 100;
    tip.style.left = `${Math.min(88, Math.max(12, side))}%`;
  };

  plate.addEventListener('pointermove', move);
  plate.addEventListener('pointerleave', () => { hair.hidden = true; tip.hidden = true; });

  return el('div', { class: 'trend' }, [
    plate,
    el('div', { class: 'trend__days' }, [
      el('span', { text: points[0].label }),
      el('span', { text: points[points.length - 1].label }),
    ]),
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
