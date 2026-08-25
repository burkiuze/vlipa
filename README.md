# vlipa

A single-page site for vlipa, a software studio. Static HTML, CSS and a small
script, no build step. Deploys to Netlify as-is.

```
index.html              the whole site
assets/css/styles.css   the whole stylesheet
assets/js/site.js       scroll progress, sticky bar, section spy, reveals
assets/img/             logo mark, app icon, favicon
netlify.toml            publish directory, security headers, asset caching
```

## Sections

Hero, what we do (six practice areas), process, principles, stack and a
closing studio block.

## Spline backgrounds

Two Spline scenes run as section backgrounds: one behind the hero, one behind
the closing studio block. The scene URLs live in `data-scene` attributes in
`index.html`; `assets/js/site.js` loads the viewer module from the Spline CDN
once and mounts a `<spline-viewer>` when the section is about to scroll into
view.

They are treated as decoration, so:

- the layer is skipped below 900px wide, on a data saver, and under
  `prefers-reduced-motion: reduce`;
- if the CDN cannot be reached, the layer is removed and the CSS gradient
  behind it stays as the background;
- `pointer-events` are off, so the canvas never swallows a scroll. Add
  `is-live` to a `.spline` element to make its scene interactive.

A translucent `.spline__veil` sits over each scene to keep the text readable.

The viewer's own badge is taken out twice over: `dropBadge` in `site.js`
removes it from the shadow root when that root is reachable, and the viewer
is sized larger than its frame (`width: calc(100% + 430px)`, offset up and
left) so the bottom right corner it sits in falls outside the clipped area
either way. Spline's free plan asks for that badge to stay, so keep it unless
the account is on a plan that allows removing it.

## Motion

Entrance animation on the hero, a looping capability ticker, reveal-on-scroll
for every section, a scroll progress bar, hover states on the practice cells
and a section highlight in the top bar. Everything is disabled under
`prefers-reduced-motion: reduce`.

## Deploying

The repository root is the publish directory, so there is nothing to build.

- **From Git:** New site → pick this repo → `netlify.toml` is read automatically.
- **Drag and drop:** drop the project folder onto the Netlify dashboard.
- **CLI:** `netlify deploy --prod`.

## Running locally

```bash
python3 -m http.server 8000
```

## Notes

- Type is Inter (Google Fonts) with a system sans-serif fallback.
- The page carries no contact details on purpose: no address, no phone, no
  email. It only describes what the studio does. Add a way to reach you when
  one is decided.
