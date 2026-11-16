<div align="center">

<img src="resources/icon.svg" width="84" height="84" alt="Ottopus Ink's icon: Otto's face" />

<h1>Ottopus Ink</h1>

<p><strong>Every crypto move, one ask away.</strong></p>

<p>
A desktop wallet for Mac and Linux, driven by the agent already on your computer.<br />
Ask it to pay, swap or send. It works out which wallet, chain and asset to use,<br />
NEAR Intents carries it across chains, and Ink's review window shows you the exact bytes.<br />
<em>The agent proposes. You sign. Your keys never leave your computer.</em>
</p>

<p>
<a href="https://ink.ottopus.xyz">Website</a> ·
<a href="https://x.com/rajkoshik/status/2121727647701254646">Demo video</a> ·
<a href="https://github.com/ottopusxyz/ottopus-ink/releases/latest">Download</a> ·
<a href="#how-it-works">How it works</a> ·
<a href="#what-works-today">Features</a> ·
<a href="#architecture">Architecture</a> ·
<a href="#run-it-locally">Run it locally</a> ·
<a href="#contributing">Contributing</a>
</p>

<p>
<a href="https://github.com/ottopusxyz/ottopus-ink/actions/workflows/ci.yml"><img src="https://github.com/ottopusxyz/ottopus-ink/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
<a href="https://github.com/ottopusxyz/ottopus-ink/releases/latest"><img src="https://img.shields.io/github/v/release/ottopusxyz/ottopus-ink?color=F58A6A" alt="Latest release" /></a>
<img src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Linux-16213E" alt="macOS and Linux" />
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license" /></a>
</p>

<p>Built at the <strong>NEAR hackathon</strong>. <a href="https://x.com/rajkoshik/status/2121727647701254646">Watch the demo</a>.</p>

<a href="https://x.com/rajkoshik/status/2121727647701254646"><img src=".github/assets/hero.svg" width="860" alt="Watch the Ottopus Ink demo. Under water, Otto sits on Ink's chat window: asked to pay an invoice, Claude Code reads it, checks the wallet and plans a payment of 250 USDC on Base from two balances, 180 from NEAR Intents and 70 from Solana, which is approved in the review window and lands." /></a>

</div>

## Why

Agents run our daily work, but they haven't made our crypto life any easier. One payment can still mean choosing a wallet, finding a chain with enough of the right token, bridging, swapping and pasting addresses by hand.

Ottopus Ink hands that work to the agent you already use. Ask for an outcome, such as "pay this invoice", and the agent reads what you hold and proposes a plan. Ink builds the exact transactions, routes them through [NEAR Intents](https://near.org/intents) when the token or chain changes, and shows you every byte in its own review window before anything is signed.

The agent never gets a key. It can read and propose; signing happens in a separate process on your computer, and only after you approve.

## How it works

1. **Set up a wallet.** Make a new recovery phrase or restore one, and pick a password. The seed is encrypted on your computer and only ever decrypted in Ink's signer process.
2. **Meet your agent.** Ink finds the coding agent you already have and are signed in to, and starts each chat locked to Ink's own tools: no shell, files or web.
3. **Ask.** *"Pay this invoice"*, with the PDF attached. The agent reads it, checks your balances on every chain, and proposes a plan. Ink builds it, finds the route, and opens the review window: a money map of what leaves where and what lands where, every fee, and each transaction decoded from its bytes. You approve with a real click, and Ink signs, sends and follows the money until it lands.

## Download

| You have | Download |
|---|---|
| A Mac with Apple Silicon (M1 or later) | `ottopus-ink-<version>-mac-arm64.dmg` |
| A Mac with an Intel chip | `ottopus-ink-<version>-mac-x64.dmg` |
| Ubuntu, Debian or another Debian-based Linux (Intel or AMD) | `ottopus-ink-<version>-linux-amd64.deb` |
| Any other 64-bit Linux (Intel or AMD) | `ottopus-ink-<version>-linux-x86_64.AppImage` |

Get them from the [latest release](https://github.com/ottopusxyz/ottopus-ink/releases/latest), with a `SHA256SUMS` file to check them against. The builds aren't signed with a developer certificate yet (the Mac app is ad-hoc signed), so the first launch needs a step or two: [docs/install.md](docs/install.md) has them.

Chats run on [Claude Code](https://claude.com/claude-code), so install it and sign in first. Ink finds it by itself.

> [!WARNING]
> Ink is a hackathon build. Nothing has been audited: don't give it a recovery phrase that holds more than you can afford to lose.

## What works today

- **Chats with your own agent.** Claude Code runs each chat, locked to Ink's tools, with Ink's payments skill in its prompt. Chats are kept across restarts, sealed by the system keyring, and can be continued.
- **Send** a chain's own coin or a token on NEAR, on EVM chains (Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche and more) and on Solana.
- **Swap and bridge through NEAR Intents,** paid from the wallet on NEAR, an EVM chain or Solana, or from your NEAR Intents balance. The plan's hash holds a binding 1Click quote, and Ink follows the swap until it pays out or refunds.
- **Pay an exact amount from several balances.** When no one balance covers a payment, Ink combines up to three, from the NEAR Intents balance and the wallet's EVM and Solana addresses (any dollar stablecoin counts for another), and pays the recipient once they land. One approval.
- **Pay an invoice.** Attach a PDF, text, CSV or JSON file. The agent reads who to pay, how much and where; the review window marks an address from the file in amber so you check it against the sender.
- **Receive on any chain,** NEAR Intents first: a deposit address that lands in your NEAR Intents balance, or the wallet's own address, with its QR code. Ink watches it and says when the money arrives.
- **One portfolio** across NEAR, EVM chains, Solana, Tron and the NEAR Intents balance, priced, with the last read shown while a new one runs.
- **A review window that's a security boundary:** its own page and preload, decoded bytes rather than the agent's words, a pause before Approve arms, and approval only from a real press, bound to the plan's hash.
- **Activity and notifications.** Every plan's journey, from review to the money landing, with a notification if it ends while Ink is in the background.
- **Outside tools, only when you say so.** Settings lists the MCP servers, skills and plugins your agent already has. Each stays off until you agree in a native dialog, and a chat using one says so.
- **Installers** for macOS (Apple Silicon and Intel) and Linux (`.deb` and AppImage), published by CI from a version tag, with checksums.

Not there yet:

- **Codex and Grok.** Ink finds them and reads their sign-in, but only Claude Code runs chats so far.
- **Staking.** The agent can ask for a stake, but Ink doesn't build one yet, so the plan stays a draft.
- **Bitcoin, Tron, Sui and Aptos.** Ink derives these addresses and reads Tron balances, but doesn't sign on them yet. NEAR Intents still reaches them through its deposit addresses.
- **Signing and audits.** No Apple Developer ID signing or notarization, no audit, and no Windows or Linux on ARM.

## Architecture

```mermaid
flowchart LR
    You(["You"])
    Agent["Your agent<br/>Claude Code"]

    subgraph Ink["Ottopus Ink · on your computer"]
        Page["App page<br/>React · sandboxed"]
        Review["Review window<br/>its own page and preload"]
        Main["Main<br/>chats · plans · routes · RPCs"]
        Shim["Tool bridge<br/>MCP over stdio"]
        Signer["Signer<br/>the only place the seed lives"]
    end

    subgraph Net["Network"]
        Intents["NEAR Intents<br/>1Click · bridge"]
        Chains["NEAR · EVM · Solana RPCs"]
        Service["Ink service<br/>Cloudflare Worker · Zerion"]
    end

    You -- "ask" --> Page
    Page -- "window.ink" --> Main
    Agent -- "get_portfolio · create_plan …" --> Shim
    Shim -- "socket + token" --> Main
    Main -- "plan" --> Review
    You -- "approve" --> Review
    Main -- "approved plan" --> Signer
    Main --> Intents
    Main -- "signed bytes" --> Chains
    Main --> Service
```

Main never holds a seed, the signer never touches the network, and the page only draws what main sends it. The agent reaches Ink through one MCP server, the tool bridge, which Ink's own binary runs in Node mode and which proves itself to main with a token made for that chat.

### Rules that never change

1. **No agent wallet.** The agent can read and propose. It has no tool that signs, approves or touches keys.
2. **The review window shows decoded bytes, not the agent's words.** The signer re-checks the plan hash before it signs.
3. **Keys stay on the device.** No Ottopus server, no custody.
4. **Each dependent step gets its own review** once its exact bytes are known.
5. **Chats started by the app are locked to Ottopus Ink tools,** with no shell, file or web access, unless you turn on an outside tool or skill in Settings. Each stays off until you agree in a dialog, and the chat then says it isn't Ottopus tools only. Ink can't see what an outside tool does: one that holds its own keys could move funds outside Ink's review. A remote server that needs a sign-in stays out of chats until you sign in from Settings. Ink keeps that sign-in encrypted and sends it only to that server's address, and the agent in a chat using the tool can read it while the chat runs.

### Who may touch what

| Path | Process | Trusted |
|---|---|---|
| `src/main` | Electron main: windows, IPC, agent drivers, plan engine | Yes |
| `src/preload` | The only bridge the renderer gets (`window.ink`) | Yes |
| `src/renderer` | React UI. Display only: no Node, sandboxed, strict CSP | No |
| `src/renderer/review.html`, `src/preload/review.ts` | The review window's own page and preload, the only place a plan is approved | Yes |
| `src/signer` | Separate utility process; the only place the decrypted seed lives | Yes |
| `src/shared` | Types and pure helpers used by more than one process | n/a |

The renderer may import only from `src/shared` and its own files; a lint rule enforces it.

**[docs/architecture.md](docs/architecture.md)** goes through each part in detail: the vault and its encryption, the accounts on each chain, the agent's tools, how a plan is hashed and moves between statuses, the review window's checks, the routes through NEAR Intents, and how each chain is signed and sent.

## Run it locally

You need Node 22.12 or newer (CI uses 24) on Linux or macOS, and [Claude Code](https://claude.com/claude-code) signed in to chat.

```bash
git clone https://github.com/ottopusxyz/ottopus-ink.git
cd ottopus-ink
npm ci
npm start          # the app in dev mode, with hot reload
```

Ink works on mainnet. Use a fresh recovery phrase and small amounts while you develop.

npm 11 runs only approved install scripts. Electron's, which downloads its binary, is approved in `package.json` under `allowScripts`.

On Linux, run `npm run desktop-entry` once to give a checkout its icon in the dock and app grid. GNOME on Wayland shows the icon of the desktop entry named after the app (`ottopus-ink.desktop`), which this writes to `~/.local/share/applications`, pointing at the checkout. It does nothing once the `.deb` is installed, because that ships its own entry with the same name and one in your home folder would hide it.

Useful commands:

```bash
npm test           # Vitest
npm run lint
npm run typecheck
npm run build      # production bundle in out/
npm run dist       # installers for this OS in dist/ (dist:linux or dist:mac for one)
```

CI runs lint, typecheck, tests and a build on Ubuntu and macOS for every pull request and on `main`.

### Packaging and releases

`npm run dist` packages with [electron-builder](https://www.electron.build) (config in `electron-builder.yml`): an AppImage and a `.deb` on Linux, and a `.dmg` for Apple Silicon and Intel on macOS, which can only be built on a Mac.

To publish a release, set `version` in `package.json` and push a matching tag (`v0.1.0`). The Release workflow builds every package, writes `SHA256SUMS`, and publishes a GitHub release with [docs/install.md](docs/install.md) as its notes. A tag with a suffix (`v0.2.0-beta.1`) becomes a prerelease, which the website skips.

### The website and the service

- [`site/`](site/README.md) is the landing page at [ink.ottopus.xyz](https://ink.ottopus.xyz): static files with no build step (`python3 -m http.server 4173 --directory site`). Its download buttons link the latest release's files.
- [`service/`](service/README.md) is the Ink service, a Cloudflare Worker that reads Zerion with Ottopus's key so the app ships none. It sees only public data, and Ink works without it.

## Project layout

```
src/
  main/          Electron main
    agents         finding agents, running Claude Code, Ink's skill
    mcp            the tool bridge and the tools the agent gets
    plans          the plan store, statuses, recipients, Activity
    review         the review window, decoding, input checks
    routes         NEAR Intents quotes, swaps and payments
    intents        deposit addresses, and watching them
    near, evm, solana   each chain's RPC and transaction building
    portfolio      balances and prices on every chain
    vault          the vault as main sees it
    external       outside MCP servers, skills and plugins
  preload/       window.ink, and the review window's own preload
  renderer/      the React app and the review page
  signer/        the signer process: vault crypto, keys, signing
  shared/        types and pure helpers: plans, transactions, chains
service/         the Ink service (Cloudflare Worker)
site/            the landing page
docs/            install steps, and how Ink works
scripts/         the desktop entry, and the README's hero
resources/       the app icon
build/icons/     Linux icons at each size
```

## Contributing

Issues and pull requests are welcome. [AGENTS.md](AGENTS.md) has the conventions in full; in short:

- **Read the rules first.** The [five rules](#rules-that-never-change) define the product, and the [layout table](#who-may-touch-what) says which process may touch what. A change that works around either needs to say so.
- **Branch from `main`** as `<type>/m<milestone>-<issue>-<slug>`, for example `feat/m2-60-receive-addresses`.
- **Commit small:** one feature or fix per commit, each building and passing on its own, with a type prefix such as `feat:`, `fix:`, `docs:`, `test:` or `refactor:`.
- **Describe the pull request** in two parts: a summary of what changed and why, and numbered manual tests someone can follow in `npm start`, including an edge case.
- **Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`** before you open it, and add tests for anything that touches the vault, the signer, plan hashing or the review window.
- **Never commit secrets:** no API keys, real quote IDs or recovery phrases, not even in tests.

The hero at the top of this page is made by `python3 scripts/readme-hero.py` from the landing page's fonts, logos and colours. Run it again after changing them.

## Prior work

Ported from [ottopusxyz/ottopus](https://github.com/ottopusxyz/ottopus) (MIT, built for BNB Hack):

- the design tokens and water and Otto styles in `src/renderer/src/styles` (`tokens.css`, `dialog.css`, `water.css`, `otto.css`)
- the UI primitives in `src/renderer/src/components/ui`
- Otto and his badge in `src/renderer/src/components/brand`, apart from the `wave` pose, which is Ink's own
- the stillness in `src/renderer/src/components/motion`, and the tentacle ring, step list and ink hold there (`ring.tsx`, `loaders.tsx`), redrawn from the Ottopus loader family
- the Claude and Codex marks in `src/renderer/src/assets/agents`, which came from [Simple Icons](https://simpleicons.org) (CC0). The marks stay the trademarks of their owners and are used only to show which agent a chat runs on

The chain and token marks in `src/renderer/src/assets/crypto` are from [web3icons](https://web3icons.io) (MIT, by 0xa3k5); its README there lists each one.

Copied from [BoardUI](https://github.com/BoardUI/boardui) 0.5.9 (MIT, Copyright (c) 2026 Mertcan Dundar Esmergul (BoardUI)):

- Agent Thinking in `src/renderer/src/vendor/boardui`, with its licence
- the keyframes and label shimmer in `src/renderer/src/styles/boardui-bridge.css`, which carries them over onto our tokens

The README's hero uses the landing page's copies of the Claude, Codex and Grok marks and the NEAR, Base, Solana and USDC marks, and its Quicksand, Figtree and JetBrains Mono fonts (SIL Open Font License).

Everything else here is new.

## Licence

[MIT](LICENSE)
