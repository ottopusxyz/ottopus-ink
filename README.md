# Ottopus Ink

A desktop universal wallet whose brain is the coding agent you already have installed (Claude Code, Codex or OpenCode). The agent proposes plans; you review and sign them in the app. Cross-chain value moves through NEAR Intents.

> Work in progress for the NEAR hackathon. You can set up, lock and unlock the wallet and see your addresses, but nothing signs yet. Don't give it a recovery phrase that holds real funds.

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
| `src/signer` | Separate utility process; the only place the decrypted seed lives | Yes |
| `src/shared` | Types and pure helpers used by more than one process | n/a |

The renderer may import only from `src/shared` and its own files; a lint rule enforces it.

## The vault

One recovery phrase per install, 12 or 24 words.

- **Encryption:** the seed is encrypted with your password, using scrypt (N=2^17, r=8, p=1) and AES-256-GCM, in `vault.bin` in the app's data folder.
- **Password:** every unlock needs it. An OS keyring can be read by other programs running as you, including an agent, so it never stands in for the password.
- **Keyring:** when there's a real one, it adds a second layer around the file, so a copy of the file alone can't be attacked. Linux's `basic_text` isn't a real one, so there the password is the only layer. A vault sealed with a keyring can't be opened if that keyring is lost, and you'd restore from your words.
- **Backup check:** a new vault isn't saved until you've given back three of its words. Ink never replaces an existing vault.
- **Locking:** Ink locks after 10 minutes with no input to its windows, and when the computer sleeps. On macOS and Windows it also locks when the screen locks; Electron doesn't report a screen lock on Linux. Bytes are wiped on lock. JavaScript can't wipe strings, so the phrase and password can stay in memory for a while after you type them.

## Accounts

The phrase gives one account on each chain, at the path most wallets use, so restoring the same phrase in another wallet shows the same addresses. Tests check each one against that chain's reference library.

| Chain | Path | Address |
|---|---|---|
| NEAR | `m/44'/397'/0'` | Implicit account (64 hex), which is also your NEAR Intents account |
| EVM | `m/44'/60'/0'/0/0` | One `0x` address on every EVM chain |
| Solana | `m/44'/501'/0'/0'` | Base58 |
| Bitcoin | `m/84'/0'/0'/0/0` | Native SegWit `bc1q…` |
| Tron | `m/44'/195'/0'/0/0` | `T…` |
| Sui | `m/44'/784'/0'/0'/0'` | `0x…` |
| Aptos | `m/44'/637'/0'/0'/0'` | `0x…`, until you rotate its key |

Addresses are worked out in the signer and are only available while unlocked. The Receive page shows each one with a QR code. Its Copy button has main copy the address the signer gave rather than text from the page, and only while Ink's window is in front. The page still draws the address and its QR code, so compare the first and last characters after you paste. Other chains Intents supports, such as TON and XRP, get no local key. Funds for them go to an Intents deposit address tied to your NEAR account.

## Plans

The agent can only propose a plan. Main builds it, and a plan can pay only your own address on the chain the funds land on, or an address you sent in that chat, never one the agent came up with.

- **What counts as sent:** main records the messages from each chat's box, which the agent can't add to. That keeps a prompt injection from picking the recipient. It can't tell a person typing from compromised page code, so the review window, outside the page, is where you confirm the recipient before anything is signed.
- **The hash:** a plan's fixed part is hashed as SHA-256 over `ottopus-ink/plan/v1`, a NUL byte and its RFC 8785 canonical JSON. Numbers must be whole and amounts are decimal strings, so nothing can round. The signer works the hash out again from the plan it's given, and signs only if it matches the hash you approved.
- **Statuses:** draft, awaiting review, approved, signing, submitted, confirmed, failed, cancelled, expired and blocked, and a plan moves between them only as one table allows. Nothing is approved without review, and nothing is signed without approval.
- **Expiry and ownership:** a plan expires 30 minutes after it's made if nobody acts on it. Each plan belongs to the chat that made it.
- **Not built yet:** a plan stays a draft until the review window (#16) shows it and you approve it, so nothing calls the sign path yet. A NEAR send already holds its exact transfer; other plans hold no transaction yet.

## NEAR

Ink talks to NEAR mainnet through [FastNEAR](https://fastnear.com)'s free RPC, and falls back to `rpc.mainnet.near.org` when FastNEAR is down. No key or account is needed.

- **Balance:** what you can send is your balance less what NEAR holds back for storage (10^19 yoctoNEAR a byte). An account using 770 bytes or fewer, such as a plain one with a single key, is stored free (NEP-448), so nothing is held back. Staked NEAR is read from each pool, using FastNEAR's index only to find which pools to ask. `get_portfolio` gives the agent these figures, and holds them back if Ink locks while they're read.
- **A new account:** your NEAR address is an implicit account. It doesn't exist on chain until something is sent to it, and until then its balance is zero.
- **Sending:** `create_plan` for NEAR on NEAR builds one Transfer from your implicit account, with the amount in yoctoNEAR. It refuses an amount NEAR can't send exactly, a named recipient that doesn't exist (only implicit accounts are created by a transfer), and a balance that can't cover the amount plus the most the fees could cost. Fees come from mainnet's protocol config and are worked out as nearcore does. Send fees are burnt at the gas price, and exec fees are bought at no less than the 10^9 yoctoNEAR receipt price (NEP-642), with room for the gas price to double. A transfer to an implicit account also pays for creating the account (and, for a NEAR implicit one, its key), whether or not it exists yet. That's about 0.0003 NEAR to a named account and 0.0077 NEAR to an implicit one, and most of it comes back. NEAR's 0.007 NEAR account creation charge comes out of that refund.
- **Encoding:** Ink writes and reads NEAR transactions itself, in one small file (`src/shared/near/transaction.ts`). It reads only a version 0 transaction holding one ed25519 Transfer, so the signer can refuse anything it couldn't read. Tests check the bytes, hash and signature against near-api-js 7.4.0, which is a dev dependency only.
- **Signing:** the signer derives the key at `m/44'/397'/0'`, signs, and wipes the key and seed right after. It signs only a transfer from your own implicit account, after reading its own bytes back, and signs nothing while locked. A lock while it signs wins, even if Ink is unlocked again straight after, and what was signed is dropped unsent.
- **Before signing:** while the plan is still approved, main checks that the RPC says it's on mainnet, checks again that your balance covers the amount and the most the fees could take at today's gas price, and reads your key's next nonce and a recent block. If any of that fails, the plan stays approved and nothing is signed. Main sends one plan at a time, and signs each above every nonce it has already signed with that key. After a send that got no answer, that key sends nothing more until the chain shows the send can't land any more: it landed, its nonce was used, or its block is more than 86,400 blocks old. Otherwise a later send could land first and leave the earlier one unable to land. Ink keeps this in memory only while it runs.
- **Broadcast:** main, not the signer, sends the signed bytes, so the process holding the seed never touches the network. The plan moves to confirmed or failed by NEAR's final outcome. A send that gets no answer stays submitted, because it may still go through. So does one turned away by the fallback RPC after FastNEAR didn't answer, since FastNEAR may have sent it first.
- **Outcomes:** a sent transfer counts as done only from a final outcome about that transaction: its hash and signer must match, and the transaction and every receipt must have run.

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
