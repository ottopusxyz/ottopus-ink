# Ottopus Ink service

A small Cloudflare Worker that lets Ink use providers whose API keys Ottopus holds, without shipping those keys in the app. Any key inside a desktop build can be pulled out of it, so the keys live here, as Worker secrets, and Ink asks the service instead.

## What it may and may not do

- **Public data and Ottopus's provider keys only.** No recovery phrase, private key, signature or plan approval ever reaches it. Review and signing stay in Ink, on the person's computer.
- **Ink works without it.** Each route has a fallback (for Zerion, the person's own key in Settings) or Ink says what's missing.
- **Ink treats its answers as untrusted.** Ink parses and checks them the same way it checks the provider's own answers.
- **Anonymous.** No accounts. Limits are per IP address and per Ink install. The install id is random, made on Ink's first run, and names nobody.
- **Nothing kept about people.** It logs no addresses and stores nothing beyond a 60-second cache of each address's answer.
- **One narrow route per provider.** It isn't a general proxy: each route sets its own query and takes only what it needs.

## Routes

| Route | What it does |
|---|---|
| `GET /v1/health` | `{ ok, zerion: 'ready' \| 'off' }` |
| `GET /v1/zerion/wallets/{address}/positions/` | An EVM, Solana or Tron address's wallet balances from Zerion, with Zerion's spam filter on. Zerion's shape, cut down to what Ink reads. Cached 60 s per address. |

Zerion's wallet endpoint doesn't read Tron addresses today (checked 13 Nov against the live service): those answer `503`, and Ink shows Tron as not read while the other accounts still count.

Answers Ink already understands: `200` with `{ data, links: { next: null } }`, `400` for an address Zerion doesn't read, `429` with `retry-after` when a limit is reached, `503` when Zerion can't answer (including when it refuses the key, which callers never hear about). Requests may carry `x-ink-install`.

## Develop

```sh
npm install
npm test
npm run typecheck
npm run build
```

`npm run dev` runs it locally with `cf dev`. Put a key for local runs in `.dev.vars` as `ZERION_API_KEY=…`; that file is ignored by git.

## Deploy

The project uses the `cf` CLI (`cloudflare.config.ts`), not Wrangler.

1. Sign in: `cf auth login`.
2. The two rate limiters need namespace ids unique in the account. `7101` and `7102` are in `cloudflare.config.ts`; change them if those are taken.
3. Deploy: `npm run deploy`.
4. Set Ottopus's Zerion key as a secret. `cf` can't set a single secret yet, so use Wrangler for that one command: `npx wrangler secret put ZERION_API_KEY --name ottopus-ink-service`. Never put the key in this repo.
5. Check it: `curl https://<the Worker's URL>/v1/health` should say `"zerion": "ready"`.
6. Ink uses Ottopus's deployment, `https://api.ink.ottopus.xyz`, by default. To point a build elsewhere, build the app with `MAIN_VITE_INK_SERVICE_URL=https://<another address>`; set it empty to turn the service off, and Ink then reads Zerion only with the person's own key.

In Zerion's dashboard, set a spending alert or limit on the key: the per-IP and per-install limits slow abuse, but the service can't prove a caller is Ink.
