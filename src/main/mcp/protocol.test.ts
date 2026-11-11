import { describe, expect, it } from 'vitest'
import { ACCOUNT_CHAINS, ACCOUNT_PATHS, type Account } from '../../shared/accounts'
import { INK_TOOLS, type ChatPlan } from '../../shared/ipc'
import type { PlanIntent, PlanTools } from '../../shared/plan'
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

  describe('get_portfolio', () => {
    const ID = 'a'.repeat(64)
    const HOLDING = { accountId: ID, onChain: true, available: '4.99', staked: '5', storage: '0.00182', pools: [{ poolId: 'one.poolv1.near', staked: '5', unstaked: '0' }], stakingComplete: true }
    /** A portfolio with only NEAR read: no prices, no tokens. */
    const read = (near: typeof HOLDING) => ({ ok: true as const, near, nearPrice: null, tokens: [], unpriced: 0, totalUsd: null, readAt: 0, gaps: [] })
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
              'Other chains’ balances aren’t read yet.',
            ].join('\n'),
          },
        ],
        isError: false,
      })
    })

    it('says what is waiting to be withdrawn, and when some pools couldn’t be read', async () => {
      const near = { ...HOLDING, pools: [{ poolId: 'one.poolv1.near', staked: '5', unstaked: '2' }], stakingComplete: false }
      const { content } = await portfolioOf(async () => read(near))
      expect(content[0]!.text).toContain('one.poolv1.near: 5 NEAR, plus 2 NEAR unstaked and waiting to be withdrawn')
      expect(content[0]!.text).toContain('the staked amount may be higher')
    })

    it('explains an implicit account nothing was sent to yet', async () => {
      const { content } = await portfolioOf(async () => read({ ...HOLDING, onChain: false, available: '0', staked: '0', storage: '0', pools: [] }))
      expect(content[0]!.text).toBe(`NEAR account ${ID} holds no NEAR yet. NEAR creates it with the first transfer into it, from any wallet or exchange. Other chains’ balances aren’t read yet.`)
    })

    it('says so while locked, with no wallet, or when NEAR can’t be reached', async () => {
      expect(await portfolioOf(async () => ({ ok: false, reason: 'locked' }))).toMatchObject({ isError: true, content: [{ text: 'Ink is locked. Ask the person to unlock Ink, then try again.' }] })
      expect(await portfolioOf(async () => ({ ok: false, reason: 'no-vault' }))).toMatchObject({ isError: false, content: [{ text: 'The wallet is not set up yet.' }] })
      expect((await portfolioOf(async () => ({ ok: false, reason: 'unavailable' }))).content[0]!.text).toContain('couldn’t reach NEAR')
      expect((await portfolioOf(async () => Promise.reject(new Error('boom')))).content[0]!.text).toContain('couldn’t reach NEAR')
    })

    it('reads nothing when asked about another chain', async () => {
      let reads = 0
      const counted = async () => (reads++, read(HOLDING))
      for (const chain of ['base', 'solana']) expect((await portfolioOf(counted, { chain })).content[0]!.text).toBe('Ink can only read NEAR balances so far.')
      expect((await portfolioOf(counted, { chain: 'NEAR' })).content[0]!.text).toContain('Available to send')
      expect(reads).toBe(1)
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
        content: [{ type: 'text', text: 'Plan plan-1 is made: Swap 0.1 ETH to USDC on base. If Ink can send it (so far, native NEAR on NEAR), Ink shows it to the person in its review window, and nothing is signed unless they approve it there. Anything else stays a draft. Call get_plan to see what became of it.' }],
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
