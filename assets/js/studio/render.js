/* Turns a site object into one standalone HTML document.

   The same function is used for the preview in the editor, for the ZIP export
   and for the published page, so what you see is what gets shipped. */

import { themeById } from './themes.js';

const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[&<>"']/g, (char) => escapeMap[char]);
}

function image(ref, resolve) {
  if (!ref) return '';
  return resolve ? resolve(ref) : ref;
}

function pictureOrBlank(ref, resolve, alt, className) {
  const src = image(ref, resolve);
  if (!src) return `<div class="${className} ph" aria-hidden="true"></div>`;
  return `<img class="${className}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" />`;
}

function section(block, site, resolve) {
  const p = block.props || {};

  switch (block.type) {
    case 'hero':
      return `
<section class="hero hero--${esc(site.heroLayout || themeById(site.theme).hero)}">
  <div class="hero__text">
    ${p.eyebrow ? `<span class="eyebrow">${esc(p.eyebrow)}</span>` : ''}
    <h1>${esc(p.title)}</h1>
    ${p.text ? `<p>${esc(p.text)}</p>` : ''}
    <div class="row">
      ${p.primary ? `<a class="btn" href="#">${esc(p.primary)}</a>` : ''}
      ${p.secondary ? `<a class="btn btn--ghost" href="#">${esc(p.secondary)}</a>` : ''}
    </div>
  </div>
  ${pictureOrBlank(p.image, resolve, p.title || '', 'hero__img')}
</section>`;

    case 'features':
      return `
<section class="band">
  ${p.title ? `<h2>${esc(p.title)}</h2>` : ''}
  <div class="cards cards--${Math.min((p.items || []).length || 3, 4)}">
    ${(p.items || []).map((item) => `
    <article class="card">
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.text)}</p>
    </article>`).join('')}
  </div>
</section>`;

    case 'products':
      return `
<section class="band">
  ${p.title ? `<h2>${esc(p.title)}</h2>` : ''}
  <div class="grid">
    ${(p.items || []).map((item) => `
    <article class="product">
      ${pictureOrBlank(item.image, resolve, item.name || '', 'product__img')}
      <div class="product__row">
        <h3>${esc(item.name)}</h3>
        <b>${esc(item.price)}</b>
      </div>
      ${item.note ? `<span class="product__note">${esc(item.note)}</span>` : ''}
    </article>`).join('')}
  </div>
</section>`;

    case 'gallery':
      return `
<section class="band">
  ${p.title ? `<h2>${esc(p.title)}</h2>` : ''}
  <div class="gallery">
    ${(p.images || []).map((ref, i) => pictureOrBlank(ref, resolve, `Photo ${i + 1}`, 'gallery__img')).join('')}
  </div>
</section>`;

    case 'about':
      return `
<section class="band split">
  <div>
    <h2>${esc(p.title)}</h2>
    <p class="lede">${esc(p.text)}</p>
  </div>
  ${pictureOrBlank(p.image, resolve, p.title || '', 'about__img')}
</section>`;

    case 'quote':
      return `
<section class="band quote">
  <blockquote>${esc(p.text)}</blockquote>
  ${p.author ? `<cite>${esc(p.author)}</cite>` : ''}
</section>`;

    case 'faq':
      return `
<section class="band">
  ${p.title ? `<h2>${esc(p.title)}</h2>` : ''}
  <div class="faq">
    ${(p.items || []).map((item) => `
    <details>
      <summary>${esc(item.q)}</summary>
      <p>${esc(item.a)}</p>
    </details>`).join('')}
  </div>
</section>`;

    case 'cta':
      return `
<section class="band cta">
  <h2>${esc(p.title)}</h2>
  ${p.text ? `<p>${esc(p.text)}</p>` : ''}
  ${p.button ? `<a class="btn" href="#">${esc(p.button)}</a>` : ''}
</section>`;

    default:
      return '';
  }
}

export function styles(site) {
  const theme = themeById(site.theme);
  const c = theme.palette;

  return `
:root{
  --bg:${c.bg};--surface:${c.surface};--text:${c.text};--muted:${c.muted};
  --line:${c.line};--accent:${c.accent};--accent-text:${c.accentText};--dark:${c.dark};
  --radius:${theme.radius};--display:${theme.fonts.display};--body:${theme.fonts.body};
}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--body);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
h1,h2,h3{margin:0;font-family:var(--display);font-weight:600;letter-spacing:-.03em;line-height:1.1}
p{margin:0}
img{max-width:100%;display:block}
.ph{background:linear-gradient(135deg,var(--line),var(--surface));border-radius:var(--radius);min-height:220px}
.wrap{max-width:1120px;margin:0 auto;padding:0 clamp(18px,5vw,40px)}
.topbar{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.topbar__in{display:flex;align-items:center;justify-content:space-between;gap:20px;max-width:1120px;margin:0 auto;padding:16px clamp(18px,5vw,40px)}
.brand{font-family:var(--display);font-size:19px;font-weight:600;letter-spacing:-.02em;text-decoration:none;color:var(--text)}
.topbar nav{display:flex;gap:20px}
.topbar nav a{color:var(--muted);font-size:14px;text-decoration:none}
.topbar nav a:hover{color:var(--text)}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 26px;border:1px solid var(--accent);border-radius:999px;background:var(--accent);color:var(--accent-text);font-size:14px;font-weight:600;text-decoration:none;transition:opacity .2s ease}
.btn:hover{opacity:.88}
.btn--ghost{background:transparent;color:var(--text);border-color:var(--line)}
.row{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.eyebrow{display:inline-block;margin-bottom:18px;color:var(--accent);font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase}
.hero{max-width:1120px;margin:0 auto;padding:clamp(56px,9vw,110px) clamp(18px,5vw,40px)}
.hero h1{font-size:clamp(32px,5.4vw,62px)}
.hero p{margin-top:22px;max-width:52ch;color:var(--muted);font-size:17px}
.hero--split{display:grid;grid-template-columns:1.05fr 1fr;gap:clamp(28px,5vw,64px);align-items:center}
.hero--split .hero__img,.hero--split .ph{border-radius:var(--radius);width:100%;height:100%;min-height:340px;object-fit:cover}
.hero--center{text-align:center}
.hero--center .hero__text{max-width:24ch;margin:0 auto}
.hero--center p{margin-left:auto;margin-right:auto}
.hero--center .row{justify-content:center}
.hero--center .hero__img,.hero--center .ph{margin-top:48px;border-radius:var(--radius);width:100%;max-height:520px;object-fit:cover}
.hero--full .hero__img,.hero--full .ph{margin-top:48px;border-radius:var(--radius);width:100%;max-height:560px;object-fit:cover}
.band{max-width:1120px;margin:0 auto;padding:clamp(44px,7vw,88px) clamp(18px,5vw,40px)}
.band h2{font-size:clamp(24px,3.4vw,40px)}
.lede{margin-top:20px;color:var(--muted);font-size:17px;max-width:60ch}
.cards{display:grid;gap:20px;margin-top:36px}
.cards--3{grid-template-columns:repeat(3,1fr)}
.cards--4{grid-template-columns:repeat(4,1fr)}
.cards--2{grid-template-columns:repeat(2,1fr)}
.cards--1{grid-template-columns:1fr}
.card{padding:26px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
.card h3{font-size:18px}
.card p{margin-top:10px;color:var(--muted);font-size:15px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:36px}
.product__img,.product .ph{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--radius)}
.product__row{display:flex;justify-content:space-between;gap:14px;margin-top:16px;align-items:baseline}
.product__row h3{font-size:17px;font-weight:500}
.product__note{display:block;margin-top:4px;color:var(--muted);font-size:14px}
.gallery{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:36px}
.gallery__img,.gallery .ph{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--radius);min-height:0}
.split{display:grid;grid-template-columns:1fr 1fr;gap:clamp(28px,5vw,64px);align-items:center}
.about__img,.split .ph{width:100%;border-radius:var(--radius);object-fit:cover;min-height:320px}
.quote{text-align:center;max-width:900px}
.quote blockquote{margin:0;font-family:var(--display);font-size:clamp(22px,3.2vw,34px);line-height:1.3;letter-spacing:-.02em}
.quote cite{display:block;margin-top:20px;color:var(--muted);font-size:14px;font-style:normal}
.faq{margin-top:30px;border-top:1px solid var(--line)}
.faq details{border-bottom:1px solid var(--line);padding:18px 0}
.faq summary{cursor:pointer;font-weight:600;list-style:none}
.faq summary::-webkit-details-marker{display:none}
.faq p{margin-top:10px;color:var(--muted)}
.cta{text-align:center;padding-top:clamp(56px,8vw,104px);padding-bottom:clamp(56px,8vw,104px)}
.cta p{margin:18px auto 0;max-width:52ch;color:var(--muted)}
.cta .btn{margin-top:30px}
.foot{border-top:1px solid var(--line);margin-top:20px}
.foot__in{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;max-width:1120px;margin:0 auto;padding:26px clamp(18px,5vw,40px) 40px;color:var(--muted);font-size:13px}
@media(max-width:900px){
  .hero--split,.split{grid-template-columns:1fr}
  .cards--3,.cards--4,.cards--2,.grid{grid-template-columns:repeat(2,1fr)}
  .gallery{grid-template-columns:repeat(3,1fr)}
}
@media(max-width:600px){
  .cards--3,.cards--4,.cards--2,.grid{grid-template-columns:1fr}
  .gallery{grid-template-columns:repeat(2,1fr)}
  .topbar nav{display:none}
}`.trim();
}

export function renderSite(site, options = {}) {
  const resolve = options.resolve;
  const theme = themeById(site.theme);
  const brand = site.brand || site.name || 'Store';
  const nav = (site.sections || [])
    .filter((block) => ['products', 'about', 'faq', 'gallery'].includes(block.type))
    .map((block) => `<a href="#${esc(block.id)}">${esc(block.type === 'products' ? 'Shop' :
      block.type === 'about' ? 'About' : block.type === 'faq' ? 'Help' : 'Gallery')}</a>`)
    .join('');

  const body = (site.sections || [])
    .map((block) => `<div id="${esc(block.id)}">${section(block, site, resolve)}</div>`)
    .join('\n');

  const fontLink = theme.fonts.display.includes('Fraunces')
    ? '<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" />'
    : '<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />';

  const css = options.stylesheet
    ? '<link rel="stylesheet" href="styles.css" />'
    : `<style>${styles(site)}</style>`;

  return `<!doctype html>
<html lang="${esc(site.lang || 'en')}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(brand)}</title>
<meta name="description" content="${esc(site.description || brand)}" />
${fontLink}
${css}
</head>
<body>
<header class="topbar">
  <div class="topbar__in">
    <a class="brand" href="#">${esc(brand)}</a>
    <nav>${nav}</nav>
  </div>
</header>
<main>
${body}
</main>
<footer class="foot">
  <div class="foot__in">
    <span>© ${new Date().getFullYear()} ${esc(brand)}</span>
    <span>Built with vlipa</span>
  </div>
</footer>
</body>
</html>`;
}
