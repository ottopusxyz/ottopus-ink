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

/** Past what anyone reads in a tool call's details. */
const MAX_TOOL_INPUT_CHARS = 20_000

/**
 * A tool call's input as text. Made here because the agent chooses its shape: nested
 * deep enough it can't be serialized or sent to the page, which would hide the call
 * from the person. Hence a string that always crosses, whatever came in.
 */
function inputText(input: unknown): string {
  if (input === undefined || input === null) return ''
  try {
    const text = JSON.stringify(input, null, 2)
    return text.length > MAX_TOOL_INPUT_CHARS ? `${text.slice(0, MAX_TOOL_INPUT_CHARS)}…` : text
  } catch {
    return 'Ink could not show this input: it is nested too deeply.'
  }
}

/** The names in a report's list, or null if it isn't one: a report that can't be read mustn't look like an empty one. */
function namesOf(value: unknown, keep: (entry: Fields) => boolean = () => true): string[] | null {
  if (!Array.isArray(value)) return null
  const entries = value.filter(isFields)
  if (entries.length !== value.length) return null
  const names: string[] = []
  for (const entry of entries) {
    if (typeof entry.name !== 'string') return null
    if (keep(entry)) names.push(entry.name)
  }
  return names
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

    // A locked session has no way to start a subagent, so one at work is for the lock check to see.
    if (typeof event.parent_tool_use_id === 'string') return [{ type: 'subagent' }]

    if (event.type === 'system' && event.subtype === 'init') {
      const { tools } = event
      return [
        {
          type: 'session',
          tools: Array.isArray(tools) && tools.every((tool) => typeof tool === 'string') ? tools : null,
          servers: namesOf(event.mcp_servers),
          // Every session lists Claude Code's own plugins, whatever its settings say.
          plugins: namesOf(event.plugins, (plugin) => plugin.path !== 'builtin'),
          model: typeof event.model === 'string' ? event.model : null,
        },
      ]
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
          ? [{ type: 'tool-call', id: block.id, name: block.name, input: inputText(block.input) }]
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
