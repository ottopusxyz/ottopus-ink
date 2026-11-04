import type { ChatEvent } from '../../shared/ipc'

type Fields = Record<string, unknown>

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function blocksOf(content: unknown): Fields[] {
  return Array.isArray(content) ? content.filter(isFields) : []
}

/** A tool result's content is a plain string or a list of blocks. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  return blocksOf(content)
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
}

/**
 * Reads Claude Code's `--output-format stream-json` output, one line at a time,
 * into chat events. The agent is untrusted and the format isn't a stable API, so
 * every field is checked and anything unrecognised is skipped.
 *
 * What the recordings in ./fixtures show:
 * - `init` comes again on every turn, not just the first.
 * - Text arrives as deltas and again in full on `assistant`, so only the deltas
 *   count. A tool call is taken from `assistant`, where its input is complete.
 * - A failed turn can say `subtype: success`; only `is_error` is reliable. When
 *   signed out, its text is also in a made-up `assistant` message, so that isn't
 *   read as a reply.
 */
export function claudeEventReader(): (line: string) => ChatEvent[] {
  let textInTurn = false

  return (line) => {
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      return []
    }
    if (!isFields(event)) return []

    // A subagent's work, which a locked session can't start anyway.
    if (typeof event.parent_tool_use_id === 'string') return []

    if (event.type === 'system' && event.subtype === 'init') {
      const tools = Array.isArray(event.tools) ? event.tools.filter((tool) => typeof tool === 'string') : []
      return [{ type: 'session', tools, model: typeof event.model === 'string' ? event.model : null }]
    }

    if (event.type === 'stream_event' && isFields(event.event) && event.event.type === 'content_block_delta') {
      const { delta } = event.event
      if (isFields(delta) && delta.type === 'text_delta' && typeof delta.text === 'string') {
        textInTurn = true
        return [{ type: 'text', text: delta.text }]
      }
      return []
    }

    if (event.type === 'assistant' && isFields(event.message)) {
      return blocksOf(event.message.content).flatMap((block): ChatEvent[] =>
        block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string'
          ? [{ type: 'tool-call', id: block.id, name: block.name, input: block.input ?? null }]
          : [],
      )
    }

    if (event.type === 'user' && isFields(event.message)) {
      return blocksOf(event.message.content).flatMap((block): ChatEvent[] =>
        block.type === 'tool_result' && typeof block.tool_use_id === 'string'
          ? [
              {
                type: 'tool-result',
                id: block.tool_use_id,
                text: resultText(block.content),
                isError: block.is_error === true,
              },
            ]
          : [],
      )
    }

    if (event.type === 'result') {
      const said = typeof event.result === 'string' ? event.result : ''
      // The reply, should a version ever finish a turn without streaming it.
      const missedText: ChatEvent[] = event.is_error !== true && !textInTurn && said ? [{ type: 'text', text: said }] : []
      textInTurn = false
      const end: ChatEvent =
        event.is_error === true
          ? { type: 'turn-end', outcome: 'failed', error: said || null }
          : { type: 'turn-end', outcome: 'done', error: null }
      return [...missedText, end]
    }

    return []
  }
}
