import { useId, useRef, type CSSProperties } from 'react'
import type { AgentId, AgentStatus } from '../../../../shared/ipc'
import claudeLogo from '@/assets/agents/claude.svg'
import codexLogo from '@/assets/agents/codex.svg'
import grokLogo from '@/assets/agents/grok.svg'
import { ChevronDownIcon } from '@/components/shell/icons'
import { agentInfo, describeAgent } from '@/lib/agents'

export interface AgentPickerProps {
  /** Null while the first detection runs. */
  agents: readonly AgentStatus[] | null
  selected: AgentId | null
  onSelect: (id: AgentId) => void
}

/**
 * Which agent a chat goes to. Lists every supported agent with what detection
 * found: ready ones can be picked, the rest say what's wrong and show the
 * command that fixes it.
 *
 * A native popover anchored to the button: the browser handles Escape, a click
 * outside and the top layer.
 */
export function AgentPicker({ agents, selected, onSelect }: AgentPickerProps) {
  const id = useId()
  const popoverId = `ink-agents-${id}`
  const anchor = `--ink-agents-${id.replace(/[^\w-]/g, '')}`
  const popover = useRef<HTMLDivElement>(null)
  const current = selected ? agentInfo(selected) : null
  const label = agents === null ? 'Checking agents…' : (current?.name ?? 'No agent ready')

  return (
    <>
      <button
        type="button"
        className="ink-picker"
        popoverTarget={popoverId}
        disabled={agents === null}
        style={{ anchorName: anchor } as CSSProperties}
      >
        {current ? <AgentMark id={current.id} small /> : null}
        {label}
        <ChevronDownIcon size={12} />
      </button>
      <div
        ref={popover}
        id={popoverId}
        popover="auto"
        className="ink-popover"
        style={{ positionAnchor: anchor } as CSSProperties}
      >
        <div className="ink-eyebrow px-2.5 pt-1.5 pb-1">Agents on this computer</div>
        {(agents ?? []).map((agent) => {
          const info = agentInfo(agent.id)
          const copy = describeAgent(agent)
          const body = (
            <>
              <AgentMark id={agent.id} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <b className="text-[13.5px] font-semibold">{info.name}</b>
                  <span className="text-[12px] text-[var(--ot-text-3)]">{copy.label}</span>
                </span>
                <span className="mt-0.5 block text-[12px] leading-[1.45] text-[var(--ot-text-2)]">{copy.hint}</span>
                {copy.command ? <code className="ink-command">{copy.command}</code> : null}
              </span>
            </>
          )
          return agent.state === 'ready' ? (
            <button
              key={agent.id}
              type="button"
              className="ink-agent-option"
              aria-current={agent.id === selected ? 'true' : undefined}
              onClick={() => {
                onSelect(agent.id)
                popover.current?.hidePopover()
              }}
            >
              {body}
            </button>
          ) : (
            <div key={agent.id} className="ink-agent-option">
              {body}
            </div>
          )
        })}
      </div>
    </>
  )
}

const LOGOS: Partial<Record<AgentId, string>> = {
  'claude-code': claudeLogo,
  codex: codexLogo,
  grok: grokLogo,
}

/**
 * An agent's logo on a cream tile, or its two-letter mark in its colours where we
 * have no logo. The tile stays cream in both themes because the logos are drawn for
 * a light ground.
 */
export function AgentMark({ id, small = false }: { id: AgentId; small?: boolean }) {
  const info = agentInfo(id)
  const logo = LOGOS[id]
  const size = small ? { width: 18, height: 18, fontSize: 9 } : {}
  if (logo) {
    return (
      <span aria-hidden className="ink-agent-mark ink-agent-mark--logo" style={size}>
        <img src={logo} alt="" draggable={false} />
      </span>
    )
  }
  return (
    <span aria-hidden className="ink-agent-mark" style={{ background: info.fill, color: info.ink, ...size }}>
      {info.mark}
    </span>
  )
}
