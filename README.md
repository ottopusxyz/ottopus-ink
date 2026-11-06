# Ottopus Ink

A desktop universal wallet whose brain is the coding agent you already have installed (Claude Code, Codex or OpenCode). The agent proposes plans; you review and sign them in the app. Cross-chain value moves through NEAR Intents.

> Work in progress for the NEAR hackathon. Nothing here holds keys yet.

## Rules that never change

1. **No agent wallet.** The agent can read and propose. It has no tool that signs, approves or touches keys.
2. **The review window shows decoded bytes, not the agent's words.** The signer re-checks the plan hash before it signs.
3. **Keys stay on the device.** No Ottopus server, no custody.
4. **Each dependent step gets its own review** once its exact bytes are known.
5. **Chats started by the app are locked to Ottopus Ink tools,** with no shell, file or web access, unless you turn on an outside tool or skill in Settings. Each stays off until you agree in a dialog, and the chat then says it isn't Ottopus tools only. Ink can't see what an outside tool does: one that holds its own keys could move funds outside Ink's review. A remote server that needs a sign-in stays out of chats until you sign in from Settings. Ink keeps that sign-in encrypted and sends it only to that server's address, and the agent in a chat using the tool can read it while the chat runs.

## Run it

Requires Node 22.12+ (CI uses 24) on Linux or macOS.

```bash
npm ci
npm start        # dev mode with hot reload
npm test
npm run lint
npm run typecheck
npm run build    # production bundle in out/
```

npm 11 runs only approved install scripts. Electron's (which downloads its binary) is approved in `package.json` under `allowScripts`.

## Layout

| Path | Process | Trusted |
|---|---|---|
| `src/main` | Electron main: windows, IPC, agent drivers, plan engine | Yes |
| `src/preload` | The only bridge the renderer gets (`window.ink`) | Yes |
| `src/renderer` | React UI. Display only: no Node, sandboxed, strict CSP | No |
| `src/signer` | Separate utility process; the only place keys will live | Yes |
| `src/shared` | Types and pure helpers used by more than one process | n/a |

The renderer may import only from `src/shared` and its own files; a lint rule enforces it.

## Prior work

Ported from [ottopusxyz/ottopus](https://github.com/ottopusxyz/ottopus) (MIT, built for BNB Hack):

- the design tokens and water, sea-life and Otto styles in `src/renderer/src/styles` (`tokens.css`, `dialog.css`, `water.css`, `sea-life.css`, `otto.css`)
- the UI primitives in `src/renderer/src/components/ui`
- Otto and his badge in `src/renderer/src/components/brand`
- the bubbles, sea life and stillness in `src/renderer/src/components/motion` (everything there except `sea.tsx`)
- the Claude and Codex marks in `src/renderer/src/assets/agents`, which came from [Simple Icons](https://simpleicons.org) (CC0). The marks stay the trademarks of their owners and are used only to show which agent a chat runs on

Copied from [BoardUI](https://github.com/BoardUI/boardui) 0.5.9 (MIT, Copyright (c) 2026 Mertcan Dundar Esmergul (BoardUI)):

- Agent Thinking and Composer Loader in `src/renderer/src/vendor/boardui`, with their licence and the changes made
- the keyframes and label shimmer in `src/renderer/src/styles/boardui-bridge.css`, which carries them over onto our tokens

Everything else here is new.

## Licence

MIT
