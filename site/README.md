# Ottopus Ink's landing page

A static page: `index.html`, `styles.css`, `site.js` and `assets/`. There is no build step and nothing to install.

## See it

```bash
python3 -m http.server 4173 --directory site
```

Then open http://localhost:4173.

## What moves

- **The hero's chat** loops through two short chats: a deposit with Claude Code, then an invoice paid from two balances with Codex. It is a small copy of the app's chat window, built from the same pieces: the tentacle rail and ring, the plan ticket, the composer's rim.
- **How it works** replays the demo's conversation in five beats. On a wide screen the section pins under the bar and scroll moves through the beats; left alone, it moves the page on by itself. On a phone, or with reduced motion on, it stays in place and plays (or stands still).
- **Smooth scroll** is [Lenis](https://github.com/darkroomengineering/lenis), with the Ottopus site's settings. It is a copy in `assets/vendor/`, so the page still loads nothing from anywhere else.
- **The download cards** ask GitHub for the latest release and link straight to its `.dmg` and `.AppImage` (or `.deb`) once one is published. Until then they say a build is on the way and point to the releases page.

Both chats are drawn by steps. An element says when it shows with `data-at` (for example `2-5,8-`), when it's lit with `data-on`, and a tracker's step when it lands with `data-land`; `site.js` holds how long each step lasts. Without JavaScript the page still reads: the story shows its conversation as it ended.

## Where things come from

Fonts are the latin files of the `@fontsource` packages the app uses. Lenis is the minified build of the `lenis` package, with its licence beside it. Logos are copies of `src/renderer/src/assets`, and the icon is `resources/icon.svg`. Colours, radii and motion follow `src/renderer/src/styles` (`tokens.css`, `water.css`, `otto.css`).

## Publishing

Any static host works: point it at this folder. Nothing here depends on the path it is served from.
