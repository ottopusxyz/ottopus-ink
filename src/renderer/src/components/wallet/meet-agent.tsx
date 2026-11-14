import type { AgentId, AgentStatus } from '../../../../shared/ipc'
import { AgentMark } from '@/components/chat/agent-picker'
import { ArrowRightIcon } from '@/components/shell/icons'
import { Badge, Button, TokenLogo } from '@/components/ui'
import { agentInfo, describeAgent, LATER_AGENTS } from '@/lib/agents'
import { WalletHeading, WalletPanel, type Guide } from './wallet-panel'

/** Things to ask first, each with the token it's about. */
const TRY: readonly { text: string; symbol: string; chain: 'near' | 'ethereum' }[] = [
  { text: 'What’s my NEAR address?', symbol: 'NEAR', chain: 'near' },
  { text: 'How much USDC do I have?', symbol: 'USDC', chain: 'ethereum' },
]

function guideFor(found: number): Guide {
  return {
    pose: 'confirmed',
    title: 'We’re all set!',
    text:
      found === 0
        ? 'Your wallet is ready. Install an agent and sign in to it, then tell it what you want, and I’ll hold up a plan for you to check.'
        : `I found ${found === 1 ? 'an agent' : `${found} agents`} on this computer. Tell one what you want, and I’ll hold up a plan for you to check.`,
  }
}

/**
 * The last setup step, once the wallet is saved: the agents Ink found, which
 * one new chats use, and a first thing to ask. Nothing here touches the wallet.
 */
export function MeetAgent({
  agents,
  selected,
  onSelect,
  onStart,
}: {
  /** What detection found; null while the first check runs. */
  agents: readonly AgentStatus[] | null
  selected: AgentId | null
  onSelect: (id: AgentId) => void
  /** Leaves setup for Home, with a first message in the composer if one was picked. */
  onStart: (text?: string) => void
}) {
  const found = (agents ?? []).filter((agent) => agent.state !== 'missing')
  return (
    <WalletPanel guide={guideFor(found.length)} step={3}>
      <div className="flex flex-col gap-2">
        <Badge tone="ok" className="font-bold">
          <span className="ink-status-dot" aria-hidden />
          Wallet ready
        </Badge>
        <WalletHeading title="Meet your agent">
          {agents === null
            ? 'Looking for Claude Code, Codex and Grok on this computer…'
            : 'Ink found these on this computer. It uses your agent’s own login, and never asks for an API key.'}
        </WalletHeading>
      </div>

      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Agents on this computer">
        {found.map((agent) => {
          const copy = describeAgent(agent)
          const on = agent.id === selected
          return (
            <li key={agent.id} className={on ? 'ink-meet-agent ink-meet-agent--on' : 'ink-meet-agent'}>
              <AgentMark id={agent.id} />
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="text-[15px]">{agentInfo(agent.id).name}</b>
                <span className="text-[12px] text-[var(--ot-text-3)]">{agent.state === 'ready' ? `Found on PATH · ${copy.label.toLowerCase()}` : copy.hint}</span>
              </span>
              {on ? (
                <Badge tone="navy">Default</Badge>
              ) : agent.state === 'ready' ? (
                <Button size="sm" onClick={() => onSelect(agent.id)}>
                  Make default
                </Button>
              ) : (
                <Badge tone="warn">{copy.label}</Badge>
              )}
            </li>
          )
        })}
        {agents !== null && found.length === 0 ? (
          <li className="ink-meet-agent">
            <span className="min-w-0 flex-1 text-[13px] text-[var(--ot-text-2)]">
              No agent yet. Install Claude Code, Codex or Grok and sign in, then check again from Settings.
            </span>
          </li>
        ) : null}
        <li className="ink-meet-agent ink-meet-agent--later">
          <span className="text-[12.5px] text-[var(--ot-text-3)]">
            {LATER_AGENTS.slice(0, -1).join(', ')} and {LATER_AGENTS.at(-1)} come later.
          </span>
        </li>
      </ul>

      {selected ? (
        <div className="ink-form-card flex flex-col gap-2 px-3.5 py-3">
          <b className="text-[13px]">Try saying</b>
          <div className="flex flex-wrap gap-1.5">
            {TRY.map((item) => (
              <button key={item.text} type="button" className="ink-suggestion" onClick={() => onStart(item.text)}>
                <TokenLogo symbol={item.symbol} chain={item.chain} size="sm" />
                {item.text}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <Button variant="primary" size="lg" className="self-end" onClick={() => onStart()}>
        Start chatting
        <ArrowRightIcon />
      </Button>
    </WalletPanel>
  )
}
