import { useState, type KeyboardEvent, type ReactNode } from 'react'
import type { AgentId, AgentState, AgentStatus, ExternalItem } from '../../../../shared/ipc'
import { Otto } from '@/components/brand/otto'
import { AgentMark } from '@/components/chat/agent-picker'
import { Badge, Button, Callout, Dialog, Tooltip, type Tone } from '@/components/ui'
import { BotIcon, CloseIcon, PlugIcon, RefreshIcon, ShieldIcon, SlidersIcon, WalletIcon } from '@/components/shell/icons'
import { agentInfo, describeAgent, LATER_AGENTS } from '@/lib/agents'
import { stepIndex } from '@/lib/roving'
import { ToolsTab } from './tools-tab'

/** Each section with its glyph on a pastel tile, the same tints as the tools in a chat. */
const TABS = [
  { id: 'general', label: 'General', Icon: SlidersIcon, tint: '#FFF0DC' },
  { id: 'agent', label: 'Agent', Icon: BotIcon, tint: '#FFD2C2' },
  { id: 'tools', label: 'Tools and skills', Icon: PlugIcon, tint: '#CFE0FF' },
  { id: 'wallet', label: 'Wallet and backup', Icon: WalletIcon, tint: '#C9F2DD' },
  { id: 'security', label: 'Security', Icon: ShieldIcon, tint: '#DDE2F0' },
  { id: 'updates', label: 'Updates', Icon: RefreshIcon, tint: '#FDD3D4' },
] as const

type TabId = (typeof TABS)[number]['id']

export interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  /** What detection found; null until the first check ends. */
  agents: readonly AgentStatus[] | null
  /** The agent new chats use. */
  selectedAgent: AgentId | null
  /** True while a check runs. */
  checking: boolean
  onCheckAgain: () => void
  /** Called with the external tools list whenever the tab reads or changes it. */
  onExternalChange: (items: ExternalItem[]) => void
}

/**
 * Settings as a dialog over the window, the way HyperFrames does it, with the
 * agent and model choices on their own tab. It is the shared Dialog, sized
 * and laid out for two columns by .ink-settings in shell.css.
 *
 * The agent list is real. The choices below it are not saved yet: there is
 * no settings store until the vault lands (issue #12), and the tabs say so
 * rather than pretend.
 */
export function SettingsDialog({ open, onClose, agents, selectedAgent, checking, onCheckAgain, onExternalChange }: SettingsDialogProps) {
  const [tab, setTab] = useState<TabId>('agent')

  return (
    <Dialog open={open} onClose={onClose} title="Settings" hideTitle className="ink-settings">
      <div className="flex items-center border-b border-[var(--ot-border)] py-3.5 pr-3.5 pl-[22px]">
        {/* The dialog's own title names it for screen readers; this is the
            visible one, in the header row beside the close button. */}
        <span aria-hidden className="flex-1 text-[15px] font-semibold">
          Settings
        </span>
        <button
          type="button"
          className="grid h-7 w-[30px] cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent text-[var(--ot-text-2)] hover:bg-[var(--ot-surface-3)]"
          aria-label="Close settings"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="ink-settings-nav" aria-label="Settings sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => setTab(item.id)}
            >
              <span className="ink-tool__glyph ink-settings-nav__glyph" style={{ background: item.tint }} aria-hidden>
                <item.Icon size={13} />
              </span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-auto pt-[18px] pr-7 pb-6 pl-[18px]">
          {tab === 'agent' ? (
            <AgentTab agents={agents} selectedAgent={selectedAgent} checking={checking} onCheckAgain={onCheckAgain} />
          ) : tab === 'tools' ? (
            // Only while open, so reopening Settings reads the list afresh.
            open ? <ToolsTab onChange={onExternalChange} /> : null
          ) : tab === 'wallet' ? (
            <WalletTab />
          ) : (
            <EmptyTab />
          )}
        </div>
      </div>
    </Dialog>
  )
}

function NotSavedYet() {
  return (
    <Callout severity="info" title="A preview" className="mb-4">
      The choices below are not saved yet. They start working as agents and the vault are connected.
    </Callout>
  )
}

const STATE_TONE: Record<AgentState, Tone> = {
  ready: 'ok',
  'signed-out': 'warn',
  outdated: 'warn',
  broken: 'block',
  missing: 'neutral',
}

function AgentTab({
  agents,
  selectedAgent,
  checking,
  onCheckAgain,
}: Omit<SettingsDialogProps, 'open' | 'onClose' | 'onExternalChange'>) {
  const [send, setSend] = useState('queue')
  return (
    <>
      <h2 className="m-0 font-display text-[22px] font-bold tracking-[-0.02em]">Agent</h2>
      <p className="mt-1.5 mb-3.5 text-[13px] text-[var(--ot-text-2)]">
        The agents Ink found on this computer, and how new chats use them.
      </p>

      <section className="flex flex-col gap-2 border-t border-[var(--ot-border)] py-4" aria-busy={checking}>
        <div className="mb-1 flex items-center gap-3">
          <h3 className="m-0 flex-1 text-[14px] font-semibold">Agents on this computer</h3>
          <Button size="sm" onClick={onCheckAgain} disabled={checking}>
            {checking ? 'Checking…' : 'Check again'}
          </Button>
        </div>
        {agents === null ? (
          <p className="m-0 text-[13px] text-[var(--ot-text-2)]">Looking for Claude Code, Codex and OpenCode…</p>
        ) : (
          agents.map((agent) => {
            const copy = describeAgent(agent)
            return (
              <div key={agent.id} className={agent.id === selectedAgent ? 'ink-agent-card ink-agent-card--on' : 'ink-agent-card'}>
                <AgentMark id={agent.id} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <b className="text-[14px] font-semibold">{agentInfo(agent.id).name}</b>
                    <Badge tone={STATE_TONE[agent.state]}>{copy.label}</Badge>
                    {agent.id === selectedAgent ? <Badge tone="plan">New chats</Badge> : null}
                  </span>
                  <span className="mt-1 block text-[12.5px] leading-[1.45] text-[var(--ot-text-2)]">{copy.hint}</span>
                  {copy.command ? <code className="ink-command">{copy.command}</code> : null}
                  {agent.path ? (
                    <span className="selectable mt-1 block font-mono text-[11px] text-[var(--ot-text-3)]">
                      {agent.path}
                    </span>
                  ) : null}
                </span>
              </div>
            )
          })
        )}
        <p className="m-0 pl-0.5 text-[12px] text-[var(--ot-text-3)]">
          {LATER_AGENTS.join(', ')} come later. Ink uses your own agent login; it never asks for an API key.
        </p>
      </section>

      <NotSavedYet />

      <Setting
        title="While the agent works, Send"
        description="Queue runs your words next. Steer stops the run and starts again with them. Ctrl+Enter does the other."
      >
        <Segmented
          label="While the agent works"
          value={send}
          onChange={setSend}
          options={[
            ['queue', 'Queue'],
            ['steer', 'Steer'],
          ]}
        />
      </Setting>
      <Setting
        title="Use Ink from my terminal too"
        description="Adds the ottopus-ink server to your agent's own config, so you can ask from any project. Off until you turn it on."
      >
        <Tooltip text="This isn't available yet.">
          <Button size="sm" aria-disabled>
            Set up
          </Button>
        </Tooltip>
      </Setting>
    </>
  )
}

const NEEDS_WALLET = 'This isn’t built yet.'

function WalletTab() {
  const [confirm, setConfirm] = useState('above')
  const [lock, setLock] = useState('15')
  return (
    <>
      <h2 className="m-0 font-display text-[22px] font-bold tracking-[-0.02em]">Wallet and backup</h2>
      <p className="mt-1.5 mb-3.5 text-[13px] text-[var(--ot-text-2)]">
        Your keys live on this device, encrypted with your password.
      </p>
      <NotSavedYet />
      <div className="ink-backup-card">
        <Otto pose="heads-up" size={62} />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[15px] font-bold text-[var(--ot-warn-text)]">Back up your recovery phrase</h3>
          <p className="m-0 mt-0.5 text-[12.5px] leading-[1.45]">See your 12 or 24 words again, after entering your password.</p>
        </div>
        <Tooltip text={NEEDS_WALLET}>
          <Button size="sm" variant="primary" aria-disabled>
            Back up now
          </Button>
        </Tooltip>
      </div>
      <Setting
        title="Restore a different wallet"
        description="Replace this wallet with one from a 12 or 24 word recovery phrase."
      >
        <Tooltip text={NEEDS_WALLET}>
          <Button size="sm" aria-disabled>
            Restore
          </Button>
        </Tooltip>
      </Setting>
      <Setting title="Ledger, Trezor or Safe" description="Connected wallets come after the hackathon build.">
        <Badge>Later</Badge>
      </Setting>
      <Setting
        title="Ask for my password before signing"
        description="The review window always opens. This decides when it also asks for your password."
      >
        <Segmented
          label="Ask for my password"
          value={confirm}
          onChange={setConfirm}
          options={[
            ['always', 'Every time'],
            ['above', 'Above $500'],
            ['unlock', 'Only on unlock'],
          ]}
        />
      </Setting>
      <Setting title="Lock after" description="Locked, the agent can't read balances or propose plans.">
        <Segmented
          label="Lock after"
          value={lock}
          onChange={setLock}
          options={[
            ['5', '5 min'],
            ['15', '15 min'],
            ['60', '1 hour'],
          ]}
        />
      </Setting>
    </>
  )
}

function EmptyTab() {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Otto pose="base" size={96} />
      <p className="m-0 text-[13px] text-[var(--ot-text-2)]">Nothing to set here yet.</p>
    </div>
  )
}

function Setting({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="ink-setting">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {children}
    </div>
  )
}

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly (readonly [string, string])[]
}) {
  // A radio group is one tab stop: Tab reaches the chosen option and the arrow
  // keys move the choice, as the role promises a screen reader.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = stepIndex(event.key, index, options.length)
    const option = next === null ? undefined : options[next]
    if (next === null || !option) return
    event.preventDefault()
    onChange(option[0])
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <div className="ink-segmented" role="radiogroup" aria-label={label}>
      {options.map(([id, text], index) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          tabIndex={value === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
