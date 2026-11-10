# BoardUI parts

Copied from the free, MIT-licensed part of [BoardUI](https://www.boardui.com), so
they're covered by the [LICENSE](LICENSE) next to this file. Keep it with them.

| File | Registry item | Source version | Local changes |
| --- | --- | --- | --- |
| `agent-thinking.tsx` | `agent-thinking` | `boardui@0.5.9` | None |

To get it again, run this in an empty folder outside this repo, then copy the
file across:

```bash
BOARDUI_TELEMETRY_DISABLED=1 npx boardui@0.5.9 add agent-thinking --yes
```

Never run `boardui init` or `boardui skill` in this repo. Init rewrites `AGENTS.md`,
adds Cursor rules and replaces the global CSS. BoardUI Pro source can't go here
either, because this repo is public.

## What they get from Ink instead of BoardUI

- `@/utils/cx` is our `cn`.
- `@/components/foundations/template-copy/template-copy` is a stub that returns
  what it's given.
- `styles/boardui-bridge.css` maps the tokens and classes in use onto `--ot-*` and
  carries the keyframes from BoardUI's `globals.css`. BoardUI's `theme.css`,
  `globals.css` and `typography.css` are not imported.
