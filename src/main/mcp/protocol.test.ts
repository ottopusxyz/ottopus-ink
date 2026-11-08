import { describe, expect, it } from 'vitest'
import type { Account } from '../../shared/accounts'
import { INK_TOOLS, type ChatPlan } from '../../shared/ipc'
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
    const ACCOUNTS: Account[] = [
      { chain: 'near', path: "m/44'/397'/0'", address: 'a'.repeat(64) },
      { chain: 'evm', path: "m/44'/60'/0'/0/0", address: '0xBbEC2620Cb01adae3f96e1fa39f997f06BFb7Ca0' },
      { chain: 'bitcoin', path: "m/84'/0'/0'/0/0", address: 'bc1qg6ucjz7kgdedam7v5yarecy54uqw82yym06z3q' },
    ]
    const call = async (accounts: McpHandlers['accounts']) =>
      ((await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_accounts' } }, '1', { accounts })) as {
        result: { content: { text: string }[]; isError: boolean }
      }).result

    it('lists each real address with what it is for', async () => {
      const result = await call(async () => ({ ok: true, accounts: ACCOUNTS }))
      expect(result.isError).toBe(false)
      const text = result.content[0]!.text
      for (const { chain, address } of ACCOUNTS) expect(text).toContain(`${chain}: ${address}`)
      expect(text).toContain('NEAR Intents account')
      expect(text).toContain('Base, Ethereum, Arbitrum')
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

  describe('create_plan', () => {
    const propose = async (args: unknown) => {
      const plans: ChatPlan[] = []
      const message = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_plan', arguments: args } }
      const { result } = (await handleMcpMessage(message, '1', { onPlan: (plan) => plans.push(plan) })) as { result: { content: { text: string }[]; isError: boolean } }
      return { plans, result }
    }

    it('hands over a draft plan and tells the agent it is a placeholder', async () => {
      const { plans, result } = (await propose({ outcome: 'swap', asset: 'ETH', amount: '0.1', to_asset: 'USDC', to_chain: 'base' }))
      expect(plans).toEqual([
        {
          id: expect.any(String) as string,
          status: 'draft',
          outcome: 'swap',
          asset: 'ETH',
          amount: '0.1',
          chain: null,
          to: null,
          toAsset: 'USDC',
          toChain: 'base',
        },
      ])
      expect(result.isError).toBe(false)
      expect(result.content[0]?.text).toContain(plans[0]?.id)
      expect(result.content[0]?.text).toBe(`Plan ${plans[0]?.id} is a placeholder: Ink can’t review or sign plans yet.`)
    })

    it('takes a stake with no target', async () => {
      expect((await propose({ outcome: 'stake', asset: 'NEAR', amount: '10' })).plans).toHaveLength(1)
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
