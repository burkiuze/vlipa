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
