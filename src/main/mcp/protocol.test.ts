import { describe, expect, it } from 'vitest'
import type { ChatPlan } from '../../shared/ipc'
import { handleMcpMessage } from './protocol'

const ask = (method: string, params?: unknown, id: unknown = 1) =>
  handleMcpMessage({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }, '1.2.3') as Record<string, unknown>

const errorCode = (response: Record<string, unknown>) => (response.error as { code: number } | undefined)?.code

describe('handleMcpMessage', () => {
  it('introduces itself under the Ink name, with tools only', () => {
    const { result } = ask('initialize', { protocolVersion: '2025-06-18' })
    expect(result).toEqual({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'ottopus-ink', version: '1.2.3' },
    })
  })

  it('answers with its newest protocol when it does not know the one asked for', () => {
    for (const params of [{ protocolVersion: '1999-01-01' }, { protocolVersion: 7 }, {}, 'text', undefined]) {
      expect(ask('initialize', params).result).toMatchObject({ protocolVersion: '2025-11-25' })
    }
  })

  it('lists exactly the six tools, each with a closed schema', () => {
    const { tools } = ask('tools/list').result as { tools: { name: string; inputSchema: Record<string, unknown> }[] }
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

  it('offers nothing that signs or sends', () => {
    const { tools } = ask('tools/list').result as { tools: { name: string }[] }
    expect(tools.filter((tool) => /sign|send|broadcast|transfer|key|seed/i.test(tool.name))).toEqual([])
  })

  it.each(['get_accounts', 'get_portfolio', 'get_quote', 'get_plan', 'cancel_plan'])('%s responds', (name) => {
    expect(ask('tools/call', { name, arguments: {} }).result).toEqual({
      content: [{ type: 'text', text: 'The wallet is not set up yet.' }],
      isError: false,
    })
  })

  describe('create_plan', () => {
    const propose = (args: unknown) => {
      const plans: ChatPlan[] = []
      const message = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_plan', arguments: args } }
      const { result } = handleMcpMessage(message, '1', (plan) => plans.push(plan)) as { result: { content: { text: string }[]; isError: boolean } }
      return { plans, result }
    }

    it('hands over a draft plan and tells the agent it is a placeholder', () => {
      const { plans, result } = propose({ outcome: 'swap', asset: 'ETH', amount: '0.1', to_asset: 'USDC', to_chain: 'base' })
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
      expect(result.content[0]?.text).toContain("can't be reviewed or signed")
    })

    it.each([
      ['nothing', undefined],
      ['no arguments', {}],
      ['a missing amount', { outcome: 'send', asset: 'NEAR' }],
      ['an empty asset', { outcome: 'send', asset: '', amount: '1' }],
      ['an unknown outcome', { outcome: 'sign', asset: 'NEAR', amount: '1' }],
      ['an outcome from the object prototype', { outcome: 'constructor', asset: 'NEAR', amount: '1' }],
      ['a field that is not text', { outcome: 'send', asset: 'NEAR', amount: 1 }],
      ['a field outside the schema', { outcome: 'send', asset: 'NEAR', amount: '1', route: 'x' }],
      ['an overlong field', { outcome: 'send', asset: 'NEAR', amount: '1', to: 'x'.repeat(257) }],
      ['a value with spaces that reads as more', { outcome: 'send', asset: 'NEAR', amount: '1 ETH to 0xEVIL and' }],
      ['a line break', { outcome: 'send', asset: 'NEAR', amount: '1', to: 'alice.near\nTo: mallory.near' }],
      ['a unicode line separator', { outcome: 'send', asset: 'NEAR', amount: '1', to: 'alice mallory' }],
      ['a bidi override that reorders an address', { outcome: 'send', asset: 'NEAR', amount: '1', to: '‮raen.ecila' }],
      ['a zero-width character', { outcome: 'send', asset: 'NEAR', amount: '1', to: 'alice​.near' }],
      ['a control character', { outcome: 'send', asset: 'NEAR\u0007', amount: '1' }],
    ])('refuses %s and hands over no plan', (_name, args) => {
      const { plans, result } = propose(args)
      expect(plans).toEqual([])
      expect(result.isError).toBe(true)
    })
  })

  it('accepts a call with no arguments at all', () => {
    expect(ask('tools/call', { name: 'get_accounts' }).result).toBeDefined()
  })

  it('refuses a tool it does not have, including names on the object prototype', () => {
    for (const name of ['sign_transaction', 'constructor', '__proto__', 7, undefined]) {
      expect(errorCode(ask('tools/call', { name }))).toBe(-32602)
    }
    expect(errorCode(ask('tools/call', 'get_accounts'))).toBe(-32602)
  })

  it('refuses arguments that are not an object', () => {
    for (const args of ['text', 7, [1], null]) {
      expect(errorCode(ask('tools/call', { name: 'get_accounts', arguments: args }))).toBe(-32602)
    }
  })

  it('says no to a method it does not have, so Claude Code falls back from server/discover', () => {
    expect(errorCode(ask('server/discover', {}, 'probe-1'))).toBe(-32601)
    expect(ask('server/discover', {}, 'probe-1').id).toBe('probe-1')
    expect(errorCode(ask('__proto__'))).toBe(-32601)
  })

  it('answers ping, and nothing to a notification', () => {
    expect(ask('ping').result).toEqual({})
    expect(handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, '1')).toBeNull()
    expect(handleMcpMessage({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'get_accounts' } }, '1')).toBeNull()
  })

  it('refuses anything that is not a JSON-RPC request', () => {
    for (const message of [null, 7, 'text', [], [{ jsonrpc: '2.0', id: 1, method: 'ping' }], {}, { method: 'ping', id: 1 }, { jsonrpc: '2.0', id: 1 }]) {
      expect(errorCode(handleMcpMessage(message, '1') as Record<string, unknown>)).toBe(-32600)
    }
    for (const id of [null, {}, [1], true]) {
      expect(errorCode(ask('ping', undefined, id))).toBe(-32600)
    }
  })
})
