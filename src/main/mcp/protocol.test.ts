import { describe, expect, it } from 'vitest'
import { ACCOUNT_CHAINS, ACCOUNT_PATHS, type Account } from '../../shared/accounts'
import { INK_TOOLS, type ChatPlan } from '../../shared/ipc'
import type { PlanIntent, PlanTools } from '../../shared/plan'
import type { HoldingGroup } from '../../shared/portfolio'
import { handleMcpMessage, type McpHandlers } from './protocol'

const ask = async (method: string, params?: unknown, id: unknown = 1) =>
  (await handleMcpMessage({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }, '1.2.3')) as Record<string, unknown>

const errorCode = (response: Record<string, unknown>) => (response.error as { code: number } | undefined)?.code

describe('handleMcpMessage', () => {
  it('introduces itself under the Ink name, with tools only', async () => {
    const { result } = (await ask('initialize', { protocolVersion: '2025-06-18' }))
    expect(result).toEqual({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'ottopus-ink', version: '1.2.3' },
    })
  })

  it('answers with its newest protocol when it does not know the one asked for', async () => {
    for (const params of [{ protocolVersion: '1999-01-01' }, { protocolVersion: 7 }, {}, 'text', undefined]) {
      expect((await ask('initialize', params)).result).toMatchObject({ protocolVersion: '2025-11-25' })
    }
  })

  it('lists exactly the six tools, each with a closed schema', async () => {
    const { tools } = (await ask('tools/list')).result as { tools: { name: string; inputSchema: Record<string, unknown> }[] }
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'cancel_plan',
      'create_plan',
      'get_accounts',
      'get_plan',
      'get_portfolio',
      'get_quote',
    ])
    for (const { inputSchema } of tools) {
      expect(inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
    }
  })

  it('has exactly the tools the page knows by name', async () => {
    const { tools } = (await ask('tools/list')).result as { tools: { name: string }[] }
    expect(tools.map((tool) => tool.name).sort()).toEqual([...INK_TOOLS].sort())
  })

  it('offers nothing that signs or sends', async () => {
    const { tools } = (await ask('tools/list')).result as { tools: { name: string }[] }
    expect(tools.filter((tool) => /sign|send|broadcast|transfer|key|seed/i.test(tool.name))).toEqual([])
  })

  it('answers get_accounts with no way to read the wallet as not set up', async () => {
    expect((await ask('tools/call', { name: 'get_accounts', arguments: {} })).result).toEqual({
      content: [{ type: 'text', text: 'The wallet is not set up yet.' }],
      isError: false,
    })
  })

  it.each([
    ['get_portfolio', 'Ink can’t read balances yet.'],
    ['get_quote', 'Ink can’t get quotes yet.'],
    ['get_plan', 'Ink can’t track plans yet.'],
    ['cancel_plan', 'Ink can’t track plans yet, so there is nothing to cancel. Nothing was signed.'],
  ])('%s says it isn’t built yet, and never that the wallet isn’t set up', async (name, text) => {
    const answer = (await ask('tools/call', { name, arguments: {} })).result
    expect(answer).toEqual({ content: [{ type: 'text', text }], isError: false })
  })

  describe('get_accounts', () => {
    // Every chain, each with an address that names it, so a label on the wrong line shows.
    const ACCOUNTS: Account[] = ACCOUNT_CHAINS.map((chain) => ({ chain, path: ACCOUNT_PATHS[chain], address: `${chain}-address` }))
    const call = async (accounts: McpHandlers['accounts']) =>
      ((await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_accounts' } }, '1', { accounts })) as {
        result: { content: { text: string }[]; isError: boolean }
      }).result

    it('lists each real address with what it is for, each label on its own chain’s line', async () => {
      const result = await call(async () => ({ ok: true, accounts: ACCOUNTS }))
      expect(result.isError).toBe(false)
      expect(result.content[0]!.text.split('\n')).toEqual([
        'The wallet’s own addresses, one for each chain. They are public.',
        'near: near-address (NEAR. Also the NEAR Intents account)',
        'evm: evm-address (one address for Base, Ethereum, Arbitrum and the other EVM chains)',
        'solana: solana-address (Solana)',
        'bitcoin: bitcoin-address (Bitcoin, native SegWit)',
        'tron: tron-address (Tron)',
        'sui: sui-address (Sui)',
        'aptos: aptos-address (Aptos)',
      ])
    })

    it('tells the agent to have the person unlock Ink, and gives no address, while locked', async () => {
      const result = await call(async () => ({ ok: false, reason: 'locked' }))
      expect(result).toEqual({ content: [{ type: 'text', text: 'Ink is locked. Ask the person to unlock Ink, then try again.' }], isError: true })
    })

    it('says the wallet is not set up when there is none, or no way to read it', async () => {
      const notSetUp = { content: [{ type: 'text', text: 'The wallet is not set up yet.' }], isError: false }
      expect(await call(async () => ({ ok: false, reason: 'no-vault' }))).toEqual(notSetUp)
      expect(await call(undefined)).toEqual(notSetUp)
    })

    it('gives a plain error, with nothing from inside, when reading fails', async () => {
      const failed = await call(async () => {
        throw new Error('secret detail')
      })
      expect(failed.isError).toBe(true)
      expect(failed.content[0]!.text).not.toContain('secret')
      expect((await call(async () => ({ ok: false, reason: 'signer-stopped' }))).isError).toBe(true)
    })

    it('is the only tool that reads the wallet', async () => {
      let reads = 0
      const accounts = async () => {
        reads++
        return { ok: true as const, accounts: ACCOUNTS }
      }
      for (const name of ['get_portfolio', 'get_quote', 'get_plan', 'cancel_plan']) {
        await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }, '1', { accounts })
      }
      expect(reads).toBe(0)
    })
  })

  describe('get_quote', () => {
    const call = async (quote: McpHandlers['quote'], args: unknown) => {
      const response = (await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_quote', arguments: args } }, '1', { quote })) as {
        result: { content: { text: string }[]; isError: boolean }
      }
      return { text: response.result.content[0]?.text ?? '', isError: response.result.isError }
    }
    const usdc = { chain: 'base', symbol: 'USDC' }
    const INTENTS: Awaited<ReturnType<NonNullable<McpHandlers['quote']>>> = {
      ok: true,
      kind: 'intents',
      source: 'wallet',
      send: { amount: '5', symbol: 'NEAR', chain: 'near', usd: 17.4 },
      get: { ...usdc, amount: '17.400531', usd: 17.39 },
      least: { ...usdc, amount: '17.226525' },
      withdrawFee: { ...usdc, amount: '0.0024' },
      feeBps: 20,
      seconds: 22,
      paidTo: 'own-address',
      signsOrigin: true,
      held: { amount: '10', symbol: 'NEAR', chain: 'near' },
      enough: true,
      compared: false,
    }

    it('passes the agent’s words to main, which picks the route', async () => {
      const asked: unknown[] = []
      await call(async (ask) => {
        asked.push(ask)
        return INTENTS
      }, { from_asset: 'NEAR', to_asset: 'USDC', to_chain: 'base', amount: '5' })
      expect(asked).toEqual([{ fromAsset: 'NEAR', toAsset: 'USDC', toChain: 'base', amount: '5' }])
    })

    it('gives the route through NEAR Intents, why, the amounts, fees, wait and where it’s paid', async () => {
      const { text, isError } = await call(async () => INTENTS, { from_asset: 'NEAR', to_asset: 'USDC', to_chain: 'base', amount: '5' })
      expect(isError).toBe(false)
      expect(text.split('\n')).toEqual([
        'Route: through NEAR Intents, paid from the wallet’s NEAR account, wrapped to wNEAR first.',
        'Why: It changes chain, which NEAR Intents does in one step from the NEAR account.',
        '- Sends: 5 NEAR on NEAR ($17.40)',
        '- Gets about: 17.400531 USDC on Base ($17.39)',
        '- At least: 17.226525 USDC, or it’s refunded to the wallet’s NEAR account',
        '- Fees already taken out: NEAR Intents’ 0.2% fee and 0.0024 USDC for sending it on Base',
        '- Time: about 22 seconds once the deposit lands',
        '- Paid to: the wallet’s own address on Base',
        'This quote moves nothing, and prices change; the plan gets a fresh one.',
        'create_plan with outcome swap makes this a plan for the person to review, with a fresh quote.',
      ])
    })

    it('says when the Intents balance pays, the quotes were compared, or the source holds too little', async () => {
      const { text } = await call(async () => ({ ...INTENTS, source: 'intents', signsOrigin: false, send: { amount: '10', symbol: 'USDC', chain: 'base', usd: 10 }, compared: true, enough: false, held: { amount: '3', symbol: 'USDC', chain: 'base' } }), {
        from_asset: 'USDC',
        from_chain: 'intents',
        to_asset: 'NEAR',
        amount: '10',
      })
      expect(text).toContain('paid from the NEAR Intents balance.')
      expect(text).toContain('though Ink can’t sign on Base itself')
      expect(text).toContain('this one gives more')
      expect(text).toContain('The Intents balance holds only 3 USDC, so it can’t pay this yet.')
    })

    it('says a swap Ink can’t send yet stays a draft', async () => {
      const { text } = await call(async () => ({ ...INTENTS, source: 'intents' }), { from_asset: 'NEAR', from_chain: 'intents', to_asset: 'USDC', amount: '5' })
      expect(text).toContain('Ink can’t send this swap yet, so a plan for it stays a draft.')
    })

    it('says a payout without an address of the wallet’s own needs one the person types', async () => {
      const { text } = await call(async () => ({ ...INTENTS, get: { amount: '40', symbol: 'XRP', chain: 'xrp', usd: 17 }, paidTo: 'no-own-address' }), { from_asset: 'NEAR', to_asset: 'XRP', amount: '5' })
      expect(text).toContain('Ink has no address of its own on XRP, so a payout there needs an address the person types')
    })

    it('says when it couldn’t check the wallet covers it', async () => {
      const { text } = await call(async () => ({ ...INTENTS, enough: null }), { from_asset: 'NEAR', to_asset: 'USDC', amount: '5' })
      expect(text).toContain('Ink couldn’t read the balances just now, so it hasn’t checked the wallet can cover this.')
      expect(text).not.toContain('holds only')
    })

    it('gives a direct NEAR transfer with its fee', async () => {
      const direct = { ok: true as const, kind: 'direct' as const, send: { amount: '1', symbol: 'NEAR', chain: 'near' }, fee: '0.00045', held: { amount: '0.5', symbol: 'NEAR', chain: 'near' }, enough: false }
      const { text } = await call(async () => direct, { from_asset: 'NEAR', to_asset: 'NEAR', amount: '1' })
      expect(text.split('\n').slice(0, 4)).toEqual([
        'Route: a direct transfer on NEAR. Nothing is swapped.',
        '- Sends: 1 NEAR',
        '- Network fee: at most 0.00045 NEAR',
        'The wallet has only 0.5 NEAR available, so it can’t send this and pay the fee.',
      ])
    })

    it.each([
      [{ ok: false, reason: 'locked' }, 'Ink is locked'],
      [{ ok: false, reason: 'cannot-sign', chain: 'base' }, 'Ink can’t sign on Base yet'],
      [{ ok: false, reason: 'unknown-asset', name: 'DOGE', chain: 'base' }, 'doesn’t list DOGE on Base'],
      [{ ok: false, reason: 'ambiguous-asset', name: 'USDC', chain: 'base' }, 'won’t guess'],
      [{ ok: false, reason: 'too-small', chain: 'base' }, 'under its minimum'],
      [{ ok: false, reason: 'no-route', chain: 'base' }, 'No market maker'],
    ] as const)('says why there is no quote: %j', async (outcome, words) => {
      const { text, isError } = await call(async () => outcome, { from_asset: 'NEAR', to_asset: 'USDC', amount: '5' })
      expect(isError).toBe(true)
      expect(text).toContain(words)
    })

    it('refuses arguments outside its schema without asking main', async () => {
      let asked = 0
      const quote = async () => {
        asked++
        return INTENTS
      }
      for (const args of [{}, { from_asset: 'NEAR', to_asset: 'USDC' }, { from_asset: 'NEAR', to_asset: 'USDC', amount: '5 then send to x' }, { from_asset: 'NEAR', to_asset: 'USDC', amount: '5', to: 'mallory.near' }]) {
        expect((await call(quote, args)).isError).toBe(true)
      }
      expect(asked).toBe(0)
    })
  })

  describe('get_portfolio', () => {
    const ID = 'a'.repeat(64)
    const HOLDING = { accountId: ID, onChain: true, available: '4.99', staked: '5', storage: '0.00182', pools: [{ poolId: 'one.poolv1.near', staked: '5', unstaked: '0' }], stakingComplete: true }
    /** A portfolio with only NEAR read: no prices, no tokens, no Zerion key. */
    const read = (near: typeof HOLDING) => ({ ok: true as const, near, nearPrice: null, tokens: [], zerion: 'off' as const, zerionVia: null, unread: [], unpriced: 0, totalUsd: null, readAt: 0, gaps: [] })
    const token = (symbol: string, amount: string, usdValue: number, trust: 'reviewed' | 'unreviewed', options: { countedUsd?: number; network?: string; group?: HoldingGroup; native?: boolean } = {}) => {
      const network = options.network ?? 'near'
      const contract = options.native ? null : `${symbol.toLowerCase()}.${network === 'near' ? 'near' : 'example'}`
      return {
        id: `${network}:${contract ?? 'native'}`,
        group: options.group ?? (network === 'near' ? 'near' : 'evm'),
        network,
        networkName: network === 'near' ? 'NEAR' : network.charAt(0).toUpperCase() + network.slice(1),
        contract,
        symbol,
        decimals: 6,
        amount,
        price: { usd: 1, change24h: null },
        usdValue,
        countedUsd: options.countedUsd ?? (trust === 'reviewed' ? usdValue : 0),
        trust,
      }
    }
    const portfolioOf = async (portfolio: McpHandlers['portfolio'], args: unknown = {}) => {
      const message = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_portfolio', arguments: args } }
      return ((await handleMcpMessage(message, '1', { portfolio })) as { result: { content: { text: string }[]; isError: boolean } }).result
    }

    it('gives the NEAR balance: available, staked by pool, and held for storage', async () => {
      const answer = await portfolioOf(async () => read(HOLDING))
      expect(answer).toEqual({
        content: [
          {
            type: 'text',
            text: [
              `NEAR account ${ID}:`,
              '- Available to send: 4.99 NEAR',
              '- Staked: 5 NEAR (one.poolv1.near: 5 NEAR)',
              '- Held for storage: 0.00182 NEAR',
              'EVM and Solana balances need a Zerion API key. The person can add their own in Ink’s Settings, under Wallet.',
              'Bitcoin, Sui and Aptos balances aren’t read yet.',
            ].join('\n'),
          },
        ],
        isError: false,
      })
    })

    it('puts dollars on everything, lists each token with its chain, and keeps unvouched ones apart from the total', async () => {
      const answer = await portfolioOf(async () => ({
        ...read(HOLDING),
        nearPrice: { usd: 4, change24h: 0.0512 },
        tokens: [
          token('JAMBO', '200', 400, 'reviewed', { countedUsd: 200 }),
          token('ETH', '0.5', 1000, 'reviewed', { network: 'base', native: true }),
          token('USDC', '25', 25, 'reviewed'),
          token('MEME', '4000', 0.004, 'unreviewed'),
        ],
        zerion: 'ok' as const,
        unpriced: 3,
        totalUsd: 1264.9672,
      }))
      expect(answer.content[0]!.text).toBe(
        [
          `NEAR account ${ID}:`,
          '- Available to send: 4.99 NEAR ($19.96)',
          '- Staked: 5 NEAR ($20.00) (one.poolv1.near: 5 NEAR)',
          '- Held for storage: 0.00182 NEAR (under $0.01)',
          'NEAR is $4.00, up 5.1% today.',
          'Tokens:',
          '- 200 JAMBO on NEAR ($400.00, counted as $200.00 since its market is too thin to sell this much near the price), contract jambo.near',
          '- 0.5 ETH on Base ($1,000.00), Base’s own coin',
          '- 25 USDC on NEAR ($25.00), contract usdc.near',
          'Tokens nobody vouches for. They aren’t counted, and may be worth nothing or be fakes of real tokens:',
          '- 4000 MEME on NEAR (under $0.01), contract meme.near',
          '3 more tokens have no price or are marked as spam, so they aren’t listed.',
          'Total: $1,264.97, counting NEAR (staked and storage included) and the tokens above. Prices from Intear and Zerion.',
          'Bitcoin, Sui and Aptos balances aren’t read yet.',
        ].join('\n'),
      )
    })

    it('says what couldn’t be read, and lists at most twenty tokens', async () => {
      const tokens = Array.from({ length: 23 }, (_, i) => ({ ...token(`T${i}`, '1', 1, 'reviewed'), decimals: 0 }))
      const { content } = await portfolioOf(async () => ({ ...read(HOLDING), tokens, unpriced: 1, gaps: ['tokens', 'prices', 'reviews'] as const }))
      const text = content[0]!.text
      expect(text).toContain('- 1 T19 on NEAR')
      expect(text).not.toContain('- 1 T20 on NEAR')
      expect(text).toContain('- and 3 more')
      expect(text).toContain('1 more token has no price or is marked as spam, so it isn’t listed.')
      expect(text).toContain('tokens may be missing')
      expect(text).toContain('there are no dollar values')
      expect(text).toContain('couldn’t be checked with the price service')
      expect(text).not.toContain('Total:')
    })

    it('lists the Intents balance with where each token came from, and narrows to it', async () => {
      const eth = { ...token('ETH', '0.5', 1000, 'reviewed'), id: 'intents:nep141:eth.omft.near', group: 'intents' as const, network: 'intents', networkName: 'NEAR Intents', contract: 'nep141:eth.omft.near', origin: 'Ethereum' }
      const portfolio = async () => ({ ...read(HOLDING), tokens: [eth] })
      expect((await portfolioOf(portfolio)).content[0]!.text).toContain('- 0.5 ETH in the NEAR Intents balance, from Ethereum ($1,000.00), token nep141:eth.omft.near')
      expect((await portfolioOf(portfolio, { chain: 'intents' })).content[0]!.text).toBe(['Tokens:', '- 0.5 ETH in the NEAR Intents balance, from Ethereum ($1,000.00), token nep141:eth.omft.near'].join('\n'))
      expect((await portfolioOf(async () => read(HOLDING), { chain: 'intents' })).content[0]!.text).toBe('The NEAR Intents balance holds nothing with a price.')
      expect((await portfolioOf(async () => ({ ...read(HOLDING), gaps: ['intents' as const] }), { chain: 'intents' })).content[0]!.text).toContain('couldn’t be read')
    })

    it('lists Tron’s tokens, and says when Tron couldn’t be read', async () => {
      const usdt = { ...token('USDT', '25', 25, 'reviewed'), id: 'tron:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', group: 'tron' as const, network: 'tron', networkName: 'Tron', contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }
      expect((await portfolioOf(async () => ({ ...read(HOLDING), tokens: [usdt] }), { chain: 'tron' })).content[0]!.text).toBe(['Tokens:', '- 25 USDT on Tron ($25.00), contract TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'].join('\n'))
      expect((await portfolioOf(async () => read(HOLDING), { chain: 'tron' })).content[0]!.text).toBe('The Tron account holds nothing with a price.')
      expect((await portfolioOf(async () => ({ ...read(HOLDING), gaps: ['tron' as const] }))).content[0]!.text).toContain('The Tron account couldn’t be read')
    })

    it('says why Zerion’s chains are missing, and which account it couldn’t read', async () => {
      for (const [zerion, says] of [
        ['bad-key', 'turned down the person’s API key'],
        ['rate-limited', 'limit is used up for now'],
        ['unavailable', 'couldn’t be reached'],
      ] as const)
        expect((await portfolioOf(async () => ({ ...read(HOLDING), zerion }))).content[0]!.text).toContain(says)
      expect((await portfolioOf(async () => ({ ...read(HOLDING), zerion: 'ok' as const, unread: ['tron' as const] }))).content[0]!.text).toContain('Zerion couldn’t read the Tron account')
    })

    it('says what is waiting to be withdrawn, and when some pools couldn’t be read', async () => {
      const near = { ...HOLDING, pools: [{ poolId: 'one.poolv1.near', staked: '5', unstaked: '2' }], stakingComplete: false }
      const { content } = await portfolioOf(async () => read(near))
      expect(content[0]!.text).toContain('one.poolv1.near: 5 NEAR, plus 2 NEAR unstaked and waiting to be withdrawn')
      expect(content[0]!.text).toContain('the staked amount may be higher')
    })

    it('explains an implicit account nothing was sent to yet', async () => {
      const { content } = await portfolioOf(async () => read({ ...HOLDING, onChain: false, available: '0', staked: '0', storage: '0', pools: [] }))
      expect(content[0]!.text).toContain(`NEAR account ${ID} holds no NEAR yet. NEAR creates it with the first transfer into it, from any wallet or exchange.`)
    })

    it('says so while locked, with no wallet, or when NEAR can’t be reached', async () => {
      expect(await portfolioOf(async () => ({ ok: false, reason: 'locked' }))).toMatchObject({ isError: true, content: [{ text: 'Ink is locked. Ask the person to unlock Ink, then try again.' }] })
      expect(await portfolioOf(async () => ({ ok: false, reason: 'no-vault' }))).toMatchObject({ isError: false, content: [{ text: 'The wallet is not set up yet.' }] })
      expect((await portfolioOf(async () => ({ ok: false, reason: 'unavailable' }))).content[0]!.text).toContain('couldn’t reach NEAR')
      expect((await portfolioOf(async () => Promise.reject(new Error('boom')))).content[0]!.text).toContain('couldn’t reach NEAR')
    })

    it('narrows to one account or chain, and reads nothing for a chain Ink can’t read', async () => {
      let reads = 0
      const tokens = [token('USDC', '25', 25, 'reviewed'), token('ETH', '0.5', 1000, 'reviewed', { network: 'base', native: true })]
      const counted = async () => (reads++, { ...read(HOLDING), tokens, zerion: 'ok' as const })
      for (const chain of ['bitcoin', 'sui', 'aptos']) expect((await portfolioOf(counted, { chain })).content[0]!.text).toMatch(/^Ink can’t read (Bitcoin|Sui|Aptos) balances yet\.$/)
      expect(reads).toBe(0)

      const near = (await portfolioOf(counted, { chain: 'NEAR' })).content[0]!.text
      expect(near).toContain('Available to send')
      expect(near).toContain('USDC on NEAR')
      expect(near).not.toContain('ETH on Base')

      const base = (await portfolioOf(counted, { chain: 'base' })).content[0]!.text
      expect(base).toBe(['Tokens:', '- 0.5 ETH on Base ($1,000.00), Base’s own coin'].join('\n'))
      expect((await portfolioOf(counted, { chain: 'evm' })).content[0]!.text).toContain('ETH on Base')
      expect((await portfolioOf(counted, { chain: 'solana' })).content[0]!.text).toBe('Nothing with a price was found on solana.')
      expect((await portfolioOf(async () => read(HOLDING), { chain: 'solana' })).content[0]!.text).toContain('need a Zerion API key')
    })
  })

  describe('create_plan', () => {
    /** Plan tools that make whatever they're asked, so these tests see only what the protocol does. */
    const fakePlans = (asked: PlanIntent[]): PlanTools => ({
      create: async (intent) => {
        asked.push(intent)
        return { ok: true, plan: { id: 'plan-1', status: 'draft', summary: 'Swap 0.1 ETH to USDC on base', intent, recipient: null } }
      },
      get: async () => ({ ok: false, reason: 'not-found' }),
      cancel: async () => ({ ok: false, reason: 'not-found' }),
    })
    const propose = async (args: unknown) => {
      const plans: ChatPlan[] = []
      const asked: PlanIntent[] = []
      const message = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_plan', arguments: args } }
      const { result } = (await handleMcpMessage(message, '1', { onPlan: (plan) => plans.push(plan), plans: fakePlans(asked) })) as {
        result: { content: { text: string }[]; isError: boolean }
      }
      return { plans, asked, result }
    }

    it('asks main for the plan, hands the card over, and tells the agent the person reviews it in Ink', async () => {
      const { plans, asked, result } = await propose({ outcome: 'swap', asset: 'ETH', amount: '0.1', to_asset: 'USDC', to_chain: 'base' })
      const intent = { outcome: 'swap', asset: 'ETH', amount: '0.1', chain: null, to: null, toAsset: 'USDC', toChain: 'base' }
      expect(asked).toEqual([intent])
      expect(plans).toEqual([{ id: 'plan-1', status: 'draft', ...intent }])
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Plan plan-1 is made: Swap 0.1 ETH to USDC on base. If Ink can send it (so far, NEAR sent on NEAR, and NEAR swapped through NEAR Intents to the person’s own address), Ink shows it to the person in its review window, and nothing is signed unless they approve it there. Anything else stays a draft. Call get_plan to see what became of it.' }],
        isError: false,
      })
    })

    it('takes a stake with no target', async () => {
      expect((await propose({ outcome: 'stake', asset: 'NEAR', amount: '10' })).plans).toHaveLength(1)
    })

    describe('get_plan and cancel_plan', () => {
      const plan = { id: 'abc-1', status: 'draft' as const, summary: 'Send 1 NEAR on near to alice.near', intent: { outcome: 'send' as const, asset: 'NEAR', amount: '1', chain: 'near', to: 'alice.near', toAsset: null, toChain: null }, recipient: null }
      const tools = (overrides: Partial<PlanTools>): PlanTools => ({ ...fakePlans([]), ...overrides })
      const call = async (name: string, args: unknown, plans: PlanTools) =>
        ((await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, '1', { plans })) as {
          result: { content: { text: string }[]; isError: boolean }
        }).result

      it('reports a plan’s status and summary', async () => {
        const result = await call('get_plan', { plan_id: 'abc-1' }, tools({ get: async (id) => ({ ok: true, plan: { ...plan, id, status: 'awaiting_review' } }) }))
        expect(result).toEqual({ content: [{ type: 'text', text: 'Plan abc-1 is waiting for the person to review it: Send 1 NEAR on near to alice.near.' }], isError: false })
      })

      it('says where a swap stands once its deposit landed', async () => {
        const swap = { stage: 'done' as const, got: '17.4 USDC', refunded: null, link: null }
        const result = await call('get_plan', { plan_id: 'abc-1' }, tools({ get: async (id) => ({ ok: true, plan: { ...plan, id, status: 'confirmed', summary: 'Swap 5 NEAR on near to USDC on base', swap } }) }))
        expect(result.content[0]?.text).toBe('Plan abc-1 is confirmed: Swap 5 NEAR on near to USDC on base. NEAR Intents finished the swap and paid out 17.4 USDC.')
      })

      it('cancels a plan and says nothing was signed', async () => {
        const result = await call('cancel_plan', { plan_id: 'abc-1' }, tools({ cancel: async (id) => ({ ok: true, plan: { ...plan, id, status: 'cancelled' } }) }))
        expect(result).toEqual({ content: [{ type: 'text', text: 'Plan abc-1 is cancelled. Nothing was signed.' }], isError: false })
      })

      it('says why a plan can’t be cancelled, or isn’t there', async () => {
        const late = await call('cancel_plan', { plan_id: 'abc-1' }, tools({ cancel: async () => ({ ok: false, reason: 'cannot-move', status: 'submitted' }) }))
        expect(late).toEqual({ content: [{ type: 'text', text: 'Plan abc-1 is submitted to the chain, so it can’t be cancelled.' }], isError: true })
        const twice = await call('cancel_plan', { plan_id: 'abc-1' }, tools({ cancel: async () => ({ ok: false, reason: 'cannot-move', status: 'cancelled' }) }))
        expect(twice).toEqual({ content: [{ type: 'text', text: 'Plan abc-1 is already cancelled.' }], isError: true })
        const missing = await call('get_plan', { plan_id: 'abc-1' }, tools({}))
        expect(missing).toEqual({ content: [{ type: 'text', text: 'There is no plan with that id in this chat.' }], isError: true })
      })

      it.each([[{}], [{ plan_id: 7 }], [{ plan_id: 'NOT A PLAN ID' }], [{ plan_id: 'a'.repeat(65) }]])('refuses a malformed plan id %j without asking main', async (args) => {
        let asked = false
        const result = await call('get_plan', args, tools({ get: async () => ((asked = true), { ok: false, reason: 'not-found' }) }))
        expect(result.isError).toBe(true)
        expect(asked).toBe(false)
      })
    })

    it('hands over no card when main refuses the plan', async () => {
      const plans: ChatPlan[] = []
      const refusing: PlanTools = { ...fakePlans([]), create: async () => ({ ok: false, reason: 'recipient-not-allowed' }) }
      const message = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_plan', arguments: { outcome: 'send', asset: 'NEAR', amount: '1', to: 'mallory.near' } } }
      const { result } = (await handleMcpMessage(message, '1', { onPlan: (plan) => plans.push(plan), plans: refusing })) as { result: { content: { text: string }[]; isError: boolean } }
      expect(plans).toEqual([])
      expect(result.isError).toBe(true)
      expect(result.content[0]!.text).toContain('typed themselves')
    })

    it.each([
      ['insufficient-funds', 'get_portfolio'],
      ['recipient-unknown', 'doesn’t exist'],
      ['chain-unavailable', 'Try again'],
    ] as const)('tells the agent what to do when the chain module refuses: %s', async (reason, said) => {
      const plans: ChatPlan[] = []
      const refusing: PlanTools = { ...fakePlans([]), create: async () => ({ ok: false, reason }) }
      const message = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_plan', arguments: { outcome: 'send', asset: 'NEAR', amount: '1', chain: 'near', to: 'alice.near' } } }
      const { result } = (await handleMcpMessage(message, '1', { onPlan: (plan) => plans.push(plan), plans: refusing })) as { result: { content: { text: string }[]; isError: boolean } }
      expect(plans).toEqual([])
      expect(result).toMatchObject({ isError: true })
      expect(result.content[0]!.text).toContain(said)
    })

    it.each([
      ['nothing', undefined],
      ['no arguments', {}],
      ['a send with nobody to send to', { outcome: 'send', asset: 'NEAR', amount: '1' }],
      ['a swap with nothing to swap to', { outcome: 'swap', asset: 'ETH', amount: '1' }],
      ['a missing amount', { outcome: 'send', asset: 'NEAR', to: 'alice.near' }],
      ['an empty asset', { outcome: 'send', asset: '', amount: '1', to: 'alice.near' }],
      ['an unknown outcome', { outcome: 'sign', asset: 'NEAR', amount: '1', to: 'alice.near' }],
      ['an outcome from the object prototype', { outcome: 'constructor', asset: 'NEAR', amount: '1', to: 'alice.near' }],
      ['a field that is not text', { outcome: 'send', asset: 'NEAR', amount: 1, to: 'alice.near' }],
      ['a field outside the schema', { outcome: 'send', asset: 'NEAR', amount: '1', to: 'alice.near', route: 'x' }],
      ['an overlong field', { outcome: 'send', asset: 'NEAR', amount: '1', to: 'x'.repeat(257) }],
      ['a value with spaces that reads as more', { outcome: 'send', asset: 'NEAR', amount: '1 ETH to 0xEVIL and', to: 'alice.near' }],
      ['a line break', { outcome: 'send', asset: 'NEAR', amount: '1', to: 'alice.near\nTo: mallory.near' }],
      ['a unicode line separator', { outcome: 'send', asset: 'NEAR', amount: '1', to: 'alice mallory' }],
      ['a bidi override that reorders an address', { outcome: 'send', asset: 'NEAR', amount: '1', to: '‮raen.ecila' }],
      ['a blank-looking braille character', { outcome: 'send', asset: 'NEAR', amount: '1', to: 'alice.near⠀mallory.near' }],
      ['a Hangul filler', { outcome: 'send', asset: 'NEAR', amount: '1', to: 'alice.nearㅤmallory.near' }],
      ['a lookalike letter in an address', { outcome: 'send', asset: 'NEAR', amount: '1', to: 'аlice.near' }],
      ['a zero-width character', { outcome: 'send', asset: 'NEAR', amount: '1', to: 'alice​.near' }],
      ['a control character', { outcome: 'send', asset: 'NEAR\u0007', amount: '1', to: 'alice.near' }],
    ])('refuses %s and hands over no plan', async (_name, args) => {
      const { plans, result } = (await propose(args))
      expect(plans).toEqual([])
      expect(result.isError).toBe(true)
    })
  })

  it('accepts a call with no arguments at all', async () => {
    expect((await ask('tools/call', { name: 'get_accounts' })).result).toBeDefined()
  })

  it('refuses a tool it does not have, including names on the object prototype', async () => {
    for (const name of ['sign_transaction', 'constructor', '__proto__', 7, undefined]) {
      expect(errorCode((await ask('tools/call', { name })))).toBe(-32602)
    }
    expect(errorCode((await ask('tools/call', 'get_accounts')))).toBe(-32602)
  })

  it('refuses arguments that are not an object', async () => {
    for (const args of ['text', 7, [1], null]) {
      expect(errorCode((await ask('tools/call', { name: 'get_accounts', arguments: args })))).toBe(-32602)
    }
  })

  it('says no to a method it does not have, so Claude Code falls back from server/discover', async () => {
    expect(errorCode((await ask('server/discover', {}, 'probe-1')))).toBe(-32601)
    expect((await ask('server/discover', {}, 'probe-1')).id).toBe('probe-1')
    expect(errorCode((await ask('__proto__')))).toBe(-32601)
  })

  it('answers ping, and nothing to a notification', async () => {
    expect((await ask('ping')).result).toEqual({})
    expect((await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, '1'))).toBeNull()
    expect((await handleMcpMessage({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'get_accounts' } }, '1'))).toBeNull()
  })

  it('refuses anything that is not a JSON-RPC request', async () => {
    for (const message of [null, 7, 'text', [], [{ jsonrpc: '2.0', id: 1, method: 'ping' }], {}, { method: 'ping', id: 1 }, { jsonrpc: '2.0', id: 1 }]) {
      expect(errorCode((await handleMcpMessage(message, '1')) as Record<string, unknown>)).toBe(-32600)
    }
    for (const id of [null, {}, [1], true]) {
      expect(errorCode((await ask('ping', undefined, id)))).toBe(-32600)
    }
  })
})
