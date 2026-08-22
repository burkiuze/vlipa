# vlipa

Sign-in page for vlipa — a static, dependency-free front end.

## Structure

```
index.html            sign-in page
assets/css/styles.css design tokens + layout
assets/js/app.js      validation, password reveal, theme toggle
assets/img/           logo mark, wordmark, favicon
```

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Notes

- Light and dark themes: follows the OS setting, and the header toggle overrides
  it (stored in `localStorage` under `vlipa-theme`).
- Type is Inter (Google Fonts) with a system sans-serif fallback.
- The form is front-end only. `assets/js/app.js` validates locally and then
  reports that no backend is wired up — replace the `setTimeout` in the submit
  handler, and the `[data-provider]` click handlers, with real auth calls.
