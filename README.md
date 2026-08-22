# vlipa

Marketing site for vlipa — static HTML, CSS and vanilla JS, no build step.
Light theme only.

## Pages

| File | What it is |
| --- | --- |
| `index.html` | Home page: hero, interactive studio widget, products, developer section, pricing, footer |
| `login.html` | Sign-in page |

## Structure

```
assets/css/styles.css  tokens, typography, buttons, nav, footer (shared)
assets/css/home.css    home page sections
assets/css/auth.css    sign-in card
assets/js/home.js      mobile menu, studio tabs, sample playback
assets/js/auth.js      form validation, password reveal
assets/img/            logo mark, wordmark, favicon
```

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Notes

- Type is Inter (Google Fonts) with a system sans-serif fallback.
- The studio widget on the home page swaps sample copy per tab and animates a
  waveform — it does not generate audio yet. Wire `assets/js/home.js` to the
  real API when there is one.
- The sign-in form validates locally and then reports that no backend is
  connected; replace the `setTimeout` in the submit handler and the
  `[data-provider]` handlers in `assets/js/auth.js` with real auth calls.
- Copy and stats on the home page are placeholders.
