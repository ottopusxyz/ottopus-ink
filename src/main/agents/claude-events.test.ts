import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '../../shared/ipc'
import { claudeEventReader } from './claude-events'

/** Recordings of a real Claude Code 2.1.318 locked session, with local details scrubbed. */
function replay(fixture: string): ChatEvent[] {
  const read = claudeEventReader()
  return readFileSync(join(import.meta.dirname, 'fixtures', fixture), 'utf8').trim().split('\n').flatMap(read)
}

/** Joins the text deltas, so a test doesn't depend on where a recording happened to split them. */
function joined(events: ChatEvent[]): ChatEvent[] {
  const out: ChatEvent[] = []
  for (const event of events) {
    const last = out.at(-1)
    if (event.type === 'text' && last?.type === 'text') out[out.length - 1] = { type: 'text', text: last.text + event.text }
    else out.push(event)
  }
  return out
}

const tool = 'mcp__ottopus-ink__get_accounts'

describe('claudeEventReader on recorded sessions', () => {
  it('follows a tool call, an interrupted turn and a follow-up', () => {
    const session = { type: 'session', tools: [tool], servers: ['ottopus-ink'], plugins: [], model: 'claude-haiku-5-5' }
    expect(joined(replay('claude-session.ndjson'))).toEqual([
      session,
      { type: 'tool-call', id: 'toolu_fixture1', name: tool, input: '{}' },
      { type: 'tool-result', id: 'toolu_fixture1', text: 'near: probe.near', isError: false },
      { type: 'text', text: 'get_accounts returned one account: `near: probe.near`.' },
      { type: 'turn-end', outcome: 'done', error: null },
      session,
      expect.objectContaining({ type: 'text' }),
      { type: 'turn-end', outcome: 'failed', error: null },
      session,
      { type: 'text', text: 'Your first request was to call get_accounts and tell you the result in one short line.' },
      { type: 'turn-end', outcome: 'done', error: null },
    ])
  })

  it('reports a denied tool as an error result, not a failed turn', () => {
    const events = replay('claude-tool-denied.ndjson')
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool-result', isError: true }))
    expect(events.at(-1)).toEqual({ type: 'turn-end', outcome: 'done', error: null })
  })

  it('reports being signed out once, as a failure, even though its subtype says success', () => {
    const events = replay('claude-signed-out.ndjson')
    expect(events.filter((event) => event.type === 'text')).toEqual([])
    expect(events.at(-1)).toEqual({ type: 'turn-end', outcome: 'failed', error: 'Not logged in · Please run /login' })
  })
})

describe('claudeEventReader on anything else', () => {
  const line = (event: unknown) => JSON.stringify(event)

  it('skips lines that are not JSON objects or that it does not know', () => {
    const read = claudeEventReader()
    for (const text of ['not json', '', '[1,2]', 'null', '"text"', line({ type: 'rate_limit_event' }), line({ type: 'future' })]) {
      expect(read(text)).toEqual([])
    }
  })

  it('skips fields of the wrong type rather than passing them on', () => {
    const read = claudeEventReader()
    expect(read(line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 1, name: 'x' }] } }))).toEqual([])
    expect(read(line({ type: 'assistant', message: { content: 'text' } }))).toEqual([])
    expect(read(line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 1 } } }))).toEqual([])
  })

  it('passes on what a session reports, leaving out only built-in plugins', () => {
    const read = claudeEventReader()
    const init = {
      type: 'system',
      subtype: 'init',
      tools: ['Bash'],
      mcp_servers: [{ name: 'ottopus-ink', status: 'connected' }, { name: 'other', status: 'failed' }],
      plugins: [
        { name: 'cc-plugin-privacy', path: 'builtin', source: 'cc-plugin-privacy@builtin' },
        { name: 'dropped-in', path: '/home/someone/plugin', source: 'dropped-in@inline' },
      ],
      model: 7,
    }
    expect(read(line(init))).toEqual([
      { type: 'session', tools: ['Bash'], servers: ['ottopus-ink', 'other'], plugins: ['dropped-in'], model: null },
    ])
  })

  it('marks a list it cannot read as null, so it never looks empty', () => {
    const read = claudeEventReader()
    const lists = (fields: object) => read(line({ type: 'system', subtype: 'init', ...fields }))
    expect(lists({})).toEqual([{ type: 'session', tools: null, servers: null, plugins: null, model: null }])
    expect(lists({ tools: ['Bash', 7], mcp_servers: ['ottopus-ink'], plugins: [{ path: '/x' }] })).toEqual([
      { type: 'session', tools: null, servers: null, plugins: null, model: null },
    ])
  })

  it('gives a tool call with no input an empty input', () => {
    const read = claudeEventReader()
    expect(read(line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'x' }] } }))).toEqual([
      { type: 'tool-call', id: 'a', name: 'x', input: '' },
    ])
  })

  it('cuts what it keeps from a huge line, so the page never has to receive it all', () => {
    const big = 'x'.repeat(300_000)
    const read = claudeEventReader()
    expect(read(line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: big } } }))).toEqual([
      { type: 'text', text: `${'x'.repeat(200_000)}…` },
    ])
    expect(read(line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: big }] } }))).toEqual([
      { type: 'tool-result', id: 'a', text: `${'x'.repeat(200_000)}…`, isError: false },
    ])
    expect(read(line({ type: 'result', is_error: true, result: big }))).toEqual([
      { type: 'turn-end', outcome: 'failed', error: `${'x'.repeat(200_000)}…` },
    ])
    const [call] = read(line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: big }] } }))
    expect(call).toMatchObject({ name: `${'x'.repeat(1000)}…` })
  })

  it('reports the work of a subagent instead of reading it as the reply', () => {
    const read = claudeEventReader()
    const delta = { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hidden' } }
    expect(read(line({ type: 'stream_event', parent_tool_use_id: 'toolu_1', event: delta }))).toEqual([{ type: 'subagent' }])
    expect(read(line({ type: 'stream_event', parent_tool_use_id: null, event: delta }))).toEqual([{ type: 'text', text: 'hidden' }])
  })

  it('reports a tool call made by a subagent, which would otherwise go unseen', () => {
    const read = claudeEventReader()
    const call = { type: 'assistant', parent_tool_use_id: 'toolu_1', message: { content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: {} }] } }
    expect(read(line(call))).toEqual([{ type: 'subagent' }])
  })

  it('turns any tool input into text that is safe to send to the page', () => {
    const called = (input: string) => claudeEventReader()(`{"type":"assistant","message":{"content":[{"type":"tool_use","id":"a","name":"x","input":${input}}]}}`)
    expect(called('{"to":"alice.near"}')).toEqual([{ type: 'tool-call', id: 'a', name: 'x', input: '{\n  "to": "alice.near"\n}' }])
    expect(called(`"${'x'.repeat(30_000)}"`)).toEqual([{ type: 'tool-call', id: 'a', name: 'x', input: `"${'x'.repeat(19_999)}…` }])

    const deep = `${'{"x":'.repeat(10_000)}0${'}'.repeat(10_000)}`
    expect(called(deep)).toEqual([{ type: 'tool-call', id: 'a', name: 'x', input: expect.any(String) as string }])
  })

  it('takes the reply from the result only when the turn streamed none', () => {
    const result = line({ type: 'result', is_error: false, result: 'the reply' })
    const end = { type: 'turn-end', outcome: 'done', error: null }

    const unstreamed = claudeEventReader()
    expect(unstreamed(result)).toEqual([{ type: 'text', text: 'the reply' }, end])

    const streamed = claudeEventReader()
    streamed(line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'the reply' } } }))
    expect(streamed(result)).toEqual([end])
    // The next turn starts over.
    expect(streamed(result)).toEqual([{ type: 'text', text: 'the reply' }, end])
  })
})
