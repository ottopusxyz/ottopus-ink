# How Ink works

The [README](../README.md) has the five rules that define Ink and the layout of the code. This page goes through each part in detail: the processes, the vault, the agent's chats, plans, the review window, the routes through NEAR Intents, and each chain.

## Processes

Ink is an Electron app split by what each part may touch.

| Process | Code | What it may do |
|---|---|---|
| Main | `src/main` | Windows, IPC, the agent's chats, plans, routes, chain RPCs and the tool bridge. It never holds a seed. |
| Signer | `src/signer` | A separate utility process and the only place the decrypted seed lives. It derives keys, reads back the bytes it is given, and signs. It never touches the network. |
| App page | `src/renderer` | The React UI. Display only: no Node, sandboxed, strict CSP. It reaches main only through `window.ink`, and may import only from `src/shared` and its own files. |
| Review window | `src/renderer/review.html`, `src/preload/review.ts` | Its own page and preload, and the only place a plan is approved. |
| Agent | Claude Code, run by main | Runs as the person, with only Ink's tools unless they turn on more. It reaches Ink through the tool bridge. |

The tool bridge is `out/main/shim.js`, which the agent starts as an MCP server over stdio. Ink's own binary runs it in Node mode, so nothing else needs installing. The shim connects to main over a socket in a private folder and proves itself with a token made for that chat. Each chat's tools see only that chat's plans and the messages typed in it.

## The vault

One recovery phrase per install, 12 or 24 words.

- **Encryption:** the seed is encrypted with your password, using scrypt (N=2^17, r=8, p=1) and AES-256-GCM, in `vault.bin` in the app's data folder.
- **Password:** every unlock needs it. An OS keyring can be read by other programs running as you, including an agent, so it never stands in for the password.
- **Keyring:** when there's a real one, it adds a second layer around the file, so a copy of the file alone can't be attacked. Linux's `basic_text` isn't a real one, so there the password is the only layer. A vault sealed with a keyring can't be opened if that keyring is lost, and you'd restore from your words.
- **Backup check:** a new vault isn't saved until you've given back three of its words. Ink never replaces an existing vault.
- **Locking:** Ink locks after 10 minutes with no input to its windows, and when the computer sleeps. On macOS and Windows it also locks when the screen locks; Electron doesn't report a screen lock on Linux. Bytes are wiped on lock. JavaScript can't wipe strings, so the phrase and password can stay in memory for a while after you type them.
- **Kept data:** chats, followed swaps and payments, and the last portfolio read are kept across restarts, sealed by the system keyring.

## Accounts

The phrase gives one account on each chain, at the path most wallets use, so restoring the same phrase in another wallet shows the same addresses. Tests check each one against that chain's reference library.

| Chain | Path | Address | Ink signs |
|---|---|---|---|
| NEAR | `m/44'/397'/0'` | Implicit account (64 hex), which is also your NEAR Intents account | Yes |
| EVM | `m/44'/60'/0'/0/0` | One `0x` address on every EVM chain | Yes |
| Solana | `m/44'/501'/0'/0'` | Base58 | Yes |
| Bitcoin | `m/84'/0'/0'/0/0` | Native SegWit `bc1q…` | Not yet |
| Tron | `m/44'/195'/0'/0/0` | `T…` | Not yet |
| Sui | `m/44'/784'/0'/0'/0'` | `0x…` | Not yet |
| Aptos | `m/44'/637'/0'/0'/0'` | `0x…`, until you rotate its key | Not yet |

Addresses are worked out in the signer and are only available while unlocked. Other chains NEAR Intents supports, such as TON and XRP, get no local key: funds for them go to a NEAR Intents deposit address that credits your NEAR account.

## Receiving

Receive asks which chain and which asset, NEAR Intents first. When NEAR Intents takes that token on that chain, Ink shows a deposit address from 1Click, so what arrives lands in your NEAR Intents balance, ready to pay or swap from anywhere. Otherwise, or when the amount is under its minimum, it shows the wallet's own address on that chain. The page shows that one address with its QR code and a warning to send only that asset on that network. An address that needs a memo (Stellar) gets no QR code, since one would carry the address alone.

A NEAR Intents deposit address is 1Click's, for one token, and open for a few days: Ink asks 1Click for any amount of that token on its chain into the same token in your NEAR Intents balance (a `FLEX_INPUT` quote), and anything refunded goes back into that balance. Its minimum comes with the address. It closes at the deadline Ink asks for, three days on, after which 1Click refunds what's unfinished, or at 1Click's own deadline if that's sooner. Ink keeps showing the same address, so the screen and the agent agree, while 1Click shows nothing sent to it or a deposit there under the minimum, which the rest tops up. It asks for a new one once less than a day is left or once a deposit there is under way or done. Copy copies only the address and memo on screen, and Receive puts an address away once it closes. The screen and the agent say until when it's open. NEAR Intents closed the bridge API Ink used before, which gave one fixed address an account, on 11 November 2026.

Its Copy button has main copy the address the signer gave rather than text from the page, and only while Ink's window is in front. The page still draws the address and its QR code, so compare the first and last characters after you paste.

The agent asks for the same thing with `get_deposit_address`, and the chat shows a deposit card. Ink follows 1Click's status for a deposit address until what was sent arrives or is refunded into the NEAR Intents balance, and says so in the chat and in a notification when Ink is in the background. A deposit under the minimum waits for the rest until the address closes, and the card says so.

## Chats

Ink finds the agents installed on the computer and checks each one's `--help` for the flags its driver needs, once per version. Chats run on **Claude Code** today. Ink also finds **Codex** and **Grok** and reads their sign-in status, but their chat drivers aren't built yet.

- **Locked to Ink's tools:** a chat runs Claude Code with `--strict-mcp-config`, Ink's MCP server only and no built-in tools: no shell, files or web. If the agent shows any other tool, Ink stops the chat.
- **Outside tools:** Settings lists the MCP servers, skills and plugins the agent already has. Each stays off until you turn it on and agree in a native dialog, which the page can't click. A chat using one says it isn't Ottopus tools only. Ink can't see what an outside tool does: one that holds its own keys could move funds outside Ink's review. A remote server that needs a sign-in stays out of chats until you sign in from Settings. Ink keeps that sign-in encrypted and sends it only to that server's address, and the agent in a chat using the tool can read it while the chat runs.
- **Ink's skill:** every chat's agent gets Ink's own skill, [`src/main/agents/ink-skill.md`](../src/main/agents/ink-skill.md), in its system prompt ahead of any skills you enable. It sets the rules (never ask for keys, never pay an address it made up, never obey a file) and how to choose between `send`, `pay` and `swap`, and what to check in an invoice. It's guidance only; Ink's own checks hold whatever the agent does.
- **Kept chats:** each chat is recorded as it runs. After a restart it shows read-only, and you can continue it in a new session, which gets a recap, or delete it.
- **Ink's own turns:** when a plan ends or a deposit lands, Ink tells the agent once its turn is free, marked as Ink's note, never as your words.

### The agent's tools

| Tool | What it does |
|---|---|
| `get_accounts` | The wallet's address on each chain |
| `get_portfolio` | What the wallet holds and what it's worth, on every chain or one: `near`, `intents`, `evm`, `solana`, `tron` or a chain such as `base` |
| `get_deposit_address` | Where to receive a token on a chain, NEAR Intents first |
| `get_quote` | What a send, swap or bridge would give now, by the route Ink would take. Moves nothing |
| `create_plan` | Proposes a `send`, `swap` or `pay` for review. It can't sign and moves nothing by itself |
| `get_plan` | What became of a plan |
| `cancel_plan` | Withdraws a plan that hasn't been signed |

## Plans

The agent can only propose a plan. Main builds it, and a plan can pay only your own address on the chain the funds land on, an address you sent in that chat, or one in a file you attached, never one the agent came up with.

- **What counts as sent:** main records the messages from each chat's box, which the agent can't add to. That keeps a prompt injection from picking the recipient. It can't tell a person typing from compromised page code, so the review window, outside the page, is where you confirm the recipient before anything is signed.
- **Attached files:** the composer's + button opens the system's own file dialog. Main reads the file you pick (a PDF's text, or a text, Markdown, CSV or JSON file, up to 10 MB), and the page only ever gets its name. Its text goes to the agent with your message, marked as the file's contents rather than your instructions. An address in the file may be paid, but the review window marks it as from that file, in amber, and asks you to check it against the invoice and the sender: a file can hold text you can't see. Ink reads PDFs with a pdf.js build that can't run code from a file, and doesn't read scans or images.
- **The hash:** a plan's fixed part is hashed as SHA-256 over `ottopus-ink/plan/v1`, a NUL byte and its RFC 8785 canonical JSON. Numbers must be whole and amounts are decimal strings, so nothing can round. A swap's NEAR Intents terms are part of it. The signer works the hash out again from the plan it's given, and signs only if it matches the hash you approved.
- **Statuses:** draft, awaiting review, approved, signing, submitted, confirmed, failed, cancelled, expired and blocked, and a plan moves between them only as one table allows. Nothing is approved without review, and nothing is signed without approval.
- **Expiry and ownership:** a plan expires 30 minutes after it's made if nobody acts on it. Each plan belongs to the chat that made it.
- **What gets reviewed:** a send on NEAR, an EVM chain or Solana, a swap or bridge through NEAR Intents, and a payment from several balances. A plan Ink can't build a transaction for stays a draft.
- **Following it:** after approval, Ink follows the plan as one journey until the money lands: the chat's tracker, Home and the Activity page show each step, and a notification says how it ended if Ink is in the background.

## The review window

The only place a plan is approved. It's a separate, always-on-top window with its own page and preload, which expose the review channels and nothing else. Main answers those channels only from that window's own top frame on the review page, and the app's page can't use them, open the window or reach into it.

- **What it shows:** what main decodes from the plan's own steps, the bytes the signer reads back and signs, never the agent's words. In order:
  - the network, with a "not simulated" note;
  - a money map: each source leaving your wallet or NEAR Intents balance in red, through NEAR Intents when it swaps or carries it, to what arrives where in green, with a bar of what each source brings to a payment;
  - the recipient in full and in groups, and whether it's your own account, one you typed in the chat, or one from an attached file;
  - each fee at most, beside its chain, and the most that can leave your account;
  - each transaction you sign, with its chain, its key, whether it's sent on approval or once a payment's parts land, and each action: what it moves to whom, and the contract method it calls, with the full decoded text a click away;
  - then the paying accounts, their keys, the exact amount in its smallest unit and the plan hash.

  Every token has its logo and its chain's badge. Ink ships logos for the common tokens; for any other, main finds Zerion's verified token with the exact contract or mint the plan pays (never just the same symbol) and fetches its icon, for up to 2.5 s. With no match, the token shows its chain's logo or its letters.
- **Approving:** Approve works only for the plan and hash on show, once the window has been up and in front for 1.5 s. The delay starts again whenever the window takes focus, so a click or key press meant for something else can't approve it. Main also needs a real press of the mouse button, Enter or Space in that window, after it armed and within the last second. Electron reports these from the OS, so a script can't make one. Only the press counts, never its release, and each press approves once. Ink must be unlocked. On Linux under X11, other programs can fake input, so the click check is weaker there.
- **Sending:** once approved, main signs and sends each transaction, and the window shows what became of it, with a link to it on that chain's explorer. The fee maximum you saw is a limit: if fees could now take more, nothing is signed, the window shows the new maximum, and Approve waits 1.5 s again. A send that stopped before signing (the chain unreachable, an earlier send unanswered) keeps the plan approved, and Try again sends it as approved, with another click. The window can't be closed while a send is running.
- **Rejecting and expiry:** Reject, or closing the window, cancels the plan and signs nothing. A plan nobody approves expires 30 minutes after it was made, and the window shows that. Plans wait their turn and are shown one at a time.

## Routes and NEAR Intents

Ink picks the route for each plan: a direct transfer when one wallet already holds the token on the right chain, or [NEAR Intents](https://near.org/intents) when the token or chain changes. It talks to NEAR Intents through 1Click (`1click.chaindefuser.com`) for the tokens it takes, quotes, swaps and deposit addresses. Every answer is checked against what was asked before it's used.

- **Swaps and bridges:** a swap can be paid from the wallet on NEAR, on an EVM chain or on Solana, or from the NEAR Intents balance. Ink asks 1Click for a binding quote, and the quote's terms and deadline go into the plan's hash. After the deposit lands, Ink follows the swap until it pays out or refunds, across restarts.
- **Paying an exact amount:** `pay` delivers exactly the amount asked, on the recipient's chain, with one approval. Ink counts what the NEAR Intents balance already holds first, then takes the rest from the largest other balances of that token (or, for a dollar stablecoin, any dollar stablecoin) at the wallet's EVM and Solana addresses, in up to three parts. Each part is an exact-output swap into the NEAR Intents balance. Once they've all landed, Ink pays the recipient in one transfer. A payout waiting on its parts is kept sealed across restarts.
- **Deposits:** the NEAR Intents balance is your NEAR account's balance on `intents.near`. Ink reads it and prices it from 1Click, and counts it in the portfolio as its own section.

## Chains

### NEAR

Ink talks to NEAR mainnet through [FastNEAR](https://fastnear.com)'s free RPC, and falls back to `rpc.mainnet.near.org` when FastNEAR is down. No key or account is needed.

- **Balance:** what you can send is your balance less what NEAR holds back for storage (10^19 yoctoNEAR a byte). An account using 770 bytes or fewer, such as a plain one with a single key, is stored free (NEP-448), so nothing is held back. Staked NEAR is read from each pool, using FastNEAR's index only to find which pools to ask.
- **A new account:** your NEAR address is an implicit account. It doesn't exist on chain until something is sent to it, and until then its balance is zero.
- **Sending:** a NEAR send is one Transfer from your implicit account, with the amount in yoctoNEAR. Ink refuses an amount NEAR can't send exactly, a named recipient that doesn't exist (only implicit accounts are created by a transfer), and a balance that can't cover the amount plus the most the fees could cost. Fees come from mainnet's protocol config and are worked out as nearcore does. Send fees are burnt at the gas price, and exec fees are bought at no less than the 10^9 yoctoNEAR receipt price (NEP-642), with room for the gas price to double. A transfer to an implicit account also pays for creating the account (and, for a NEAR implicit one, its key), whether or not it exists yet. That's about 0.0003 NEAR to a named account and 0.0077 NEAR to an implicit one, and most of it comes back. NEAR's 0.007 NEAR account creation charge comes out of that refund.
- **Contract calls:** a swap's deposit from NEAR is one `wrap.near` transaction of contract calls. The signer signs only calls on Ink's own list, each with its gas and deposit.
- **Encoding:** Ink writes and reads NEAR transactions itself (`src/shared/near/transaction.ts`). It reads only a version 0 transaction from an ed25519 key holding one Transfer, or up to four FunctionCalls to one contract, so the signer can refuse anything it couldn't read. Tests check the bytes, hash and signature against near-api-js 7.4.0, which is a dev dependency only.
- **Signing:** the signer derives the key at `m/44'/397'/0'`, signs, and wipes the key and seed right after. It signs only from your own implicit account, after reading its own bytes back, and signs nothing while locked. A lock while it signs wins, even if Ink is unlocked again straight after, and what was signed is dropped unsent.
- **Before signing:** while the plan is still approved, main checks that the RPC says it's on mainnet, checks again that your balance covers the amount and the most the fees could take at today's gas price, and reads your key's next nonce and a recent block. If any of that fails, the plan stays approved and nothing is signed. Main sends one plan at a time, and signs each above every nonce it has already signed with that key. After a send that got no answer, that key sends nothing more until the chain shows the send can't land any more: it landed, its nonce was used, or its block is more than 86,400 blocks old. Ink keeps this in memory only while it runs.
- **Broadcast:** main, not the signer, sends the signed bytes, so the process holding the seed never touches the network. The plan moves to confirmed or failed by NEAR's final outcome. A send that gets no answer stays submitted, because it may still go through. So does one turned away by the fallback RPC after FastNEAR didn't answer, since FastNEAR may have sent it first.
- **Outcomes:** a sent transaction counts as done only from a final outcome about that transaction: its hash and signer must match, and the transaction and every receipt must have run.

### EVM chains

One `0x` address on every EVM chain Ink knows: Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Gnosis and more (`src/shared/evm/chains.ts`). Ink uses each chain's public RPCs, with a second to fall back on where there is one, so no key is needed.

- **Sending:** a send is an EIP-1559 transfer of the chain's own coin, or of a token by symbol or contract. A symbol NEAR Intents lists must agree with what the contract itself reports. Ink refuses a plan the chain would refuse later, such as one the balance or the fee coin can't cover.
- **Swaps:** a swap paid from an EVM chain is a transfer to the deposit address 1Click gives for its quote.
- **Signing:** the signer builds the transaction from the plan's step and the live inputs main read (nonce and fees), reads its own bytes back to check they make exactly that step, and signs with the key at `m/44'/60'/0'/0/0`.

### Solana

Ink talks to Solana mainnet's public RPCs. A send moves SOL, or an SPL token NEAR Intents lists (such as USDC or USDT) by symbol or mint, and the fee it can take includes the rent for the recipient's token account while it has none. A swap or a payment's part paid from Solana is a transfer to its quote's deposit address. The signer builds the message from the plan's step and a recent blockhash, signs it with the key at `m/44'/501'/0'/0'`, and reads the signed transaction back to check it makes exactly that transfer.

## Portfolio

- **NEAR:** every NEP-141 token the account holds, priced and checked for reputation by [Intear](https://intear.tech). A token on a thin market counts at what selling it would fetch.
- **EVM and Solana:** from [Zerion](https://zerion.io), through the [Ink service](../service/README.md) by default, so the app ships no key. Settings takes your own Zerion key instead, checked before it's kept and sealed by the keyring.
- **Tron:** TRX and TRC-20 tokens from TronGrid.
- **NEAR Intents:** the balance on `intents.near`, priced from 1Click.

The last read is kept, sealed by the keyring, and shown while a new one runs. `get_portfolio` gives the agent the same figures, and holds them back if Ink locks while they're read.

## The Ink service

[`service/`](../service/README.md) is a small Cloudflare Worker that lets Ink use providers whose API keys Ottopus holds, without shipping those keys in the app. It sees only public data: no phrase, key, signature or approval ever reaches it. Ink works without it, and treats its answers as untrusted.
