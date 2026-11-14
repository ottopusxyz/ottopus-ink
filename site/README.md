# Ottopus Ink's landing page

A static page: `index.html`, `styles.css`, `site.js` and `assets/`. There is no build step and nothing to install.

## See it

```bash
python3 -m http.server 4173 --directory site
```

Then open http://localhost:4173.

## What moves

- **The replay** under "How it works" plays the demo's conversation in steps. Each element in the chat says when it shows with `data-from`, `data-until` and `data-except`; `site.js` holds how long each step lasts. Without JavaScript, or with reduced motion on, the conversation shows as it ended.
- **The download cards** ask GitHub for the latest release and link straight to its `.dmg` and `.AppImage` (or `.deb`) once one is published. Until then they say a build is on the way and point to the releases page.

## Where things come from

Fonts are the latin files of the `@fontsource` packages the app uses. Logos are copies of `src/renderer/src/assets`, and the icon is `resources/icon.svg`. Colours, radii and motion follow `src/renderer/src/styles` (`tokens.css`, `water.css`, `otto.css`).

## Publishing

Any static host works: point it at this folder. Nothing here depends on the path it is served from.
