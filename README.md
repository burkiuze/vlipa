# vlipa

Marketing site for vlipa — static HTML, CSS and vanilla JS, no build step.
Light theme only.

## Pages

| File | What it is |
| --- | --- |
| `index.html` | Home page: hero, studio widget, products, developers, open-source teaser, pricing |
| `open-source.html` | Filterable list of open-source speech projects on GitHub |
| `login.html` | Sign-in page: email, password and a captcha |

## Structure

```
assets/css/styles.css   tokens, typography, buttons, nav, footer (shared)
assets/css/home.css     home page + open-source list
assets/css/auth.css     sign-in card and captcha
assets/js/home.js       mobile menu, studio tabs, sample playback
assets/js/oss-data.js   the open-source project dataset
assets/js/oss.js        renders and filters that dataset
assets/js/auth.js       form validation, password reveal, captcha
assets/img/             logo mark and favicon
```

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Notes

- Type is Inter (Google Fonts) with a system sans-serif fallback.
- The studio widget swaps sample copy per tab and animates a waveform. It does
  not generate audio — wire it to a real API when there is one.
- **Sign-in is front-end only.** `assets/js/auth.js` validates the fields, checks
  the captcha and then reports that no backend is connected. Replace the
  `setTimeout` in the submit handler with a real request.
- **The captcha is drawn in the browser**, so it only stops casual scripted
  submissions: the expected answer lives in the page. Anything serious needs a
  challenge issued and verified server-side.
- Open-source figures in `oss-data.js` come from the GitHub API and are a
  snapshot (2026-08-22), not a live feed. Licences vary — several projects are
  AGPL or research-only.
- Copy and stats on the home page are placeholders.
