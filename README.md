# vlipa

A single-page site for vlipa, a software studio. Static HTML and CSS, no build
step, no JavaScript. Deploys to Netlify as-is.

```
index.html              the whole site
assets/css/styles.css   the whole stylesheet
assets/img/             logo mark, app icon, favicon
netlify.toml            publish directory, security headers, asset caching
```

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
