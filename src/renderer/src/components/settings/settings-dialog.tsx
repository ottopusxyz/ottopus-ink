import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Badge, Button, Callout } from '@/components/ui'
import { CloseIcon } from '@/components/shell/icons'
import { AGENTS, LATER_AGENTS } from '@/lib/agents'
import { stepIndex } from '@/lib/roving'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'agent', label: 'Agent' },
  { id: 'wallet', label: 'Wallet and backup' },
  { id: 'security', label: 'Security' },
  { id: 'updates', label: 'Updates' },
] as const

type TabId = (typeof TABS)[number]['id']

export interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * Settings as a dialog over the window, the way HyperFrames does it, with the
 * agent and model choices on their own tab.
 *
 * None of these choices is saved yet: there is no settings store until the
 * vault lands (issue #12), and the agent list waits on detection (#4). The
 * tabs say so at the top rather than pretend.
 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<TabId>('agent')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="ink-settings"
      aria-labelledby="ink-settings-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
    >
      <div className="flex items-center border-b border-[var(--ot-border)] py-3.5 pr-3.5 pl-[22px]">
        <h2 id="ink-settings-title" className="m-0 flex-1 text-[15px] font-semibold">
          Settings
        </h2>
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
              {item.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-auto pt-[18px] pr-7 pb-6 pl-[18px]">
          {tab === 'agent' ? <AgentTab /> : tab === 'wallet' ? <WalletTab /> : <EmptyTab />}
        </div>
      </div>
    </dialog>
  )
}

function NotSavedYet() {
  return (
    <Callout severity="info" title="A preview" className="mb-4">
      These choices are not saved yet. They start working as agents and the vault are connected.
    </Callout>
  )
}

function AgentTab() {
  const [access, setAccess] = useState('ottopus')
  const [send, setSend] = useState('queue')
  return (
    <>
      <h2 className="m-0 text-[16px] font-semibold">Agent</h2>
      <p className="mt-1.5 mb-3.5 text-[13px] text-[var(--ot-text-2)]">The agent and model used for new chats.</p>
      <NotSavedYet />

      <section className="flex flex-col gap-2 border-t border-[var(--ot-border)] py-4">
        <h3 className="m-0 mb-1 text-[14px] font-semibold">Agents on this computer</h3>
        {AGENTS.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center gap-3 rounded-[12px] border border-[var(--ot-border)] bg-[var(--ot-card)] px-3 py-2.5"
          >
            <span className="ink-agent-mark" style={{ background: agent.fill, color: agent.ink }}>
              {agent.mark}
            </span>
            <span className="flex-1">
              <b className="text-[14px] font-semibold">{agent.name}</b>
              <br />
              <span className="text-[12px] text-[var(--ot-text-3)]">Not checked yet</span>
            </span>
          </div>
        ))}
        <p className="m-0 pl-0.5 text-[12px] text-[var(--ot-text-3)]">
          {LATER_AGENTS.join(', ')} come later. Ink uses your own agent login; it never asks for an API key.
        </p>
      </section>

      <Setting
        title="Agent access"
        description="Ottopus tools only, the default: in Ink chats the agent can read balances and propose plans, and nothing else. No shell, no other MCP servers."
      >
        <Segmented
          label="Agent access"
          value={access}
          onChange={setAccess}
          options={[
            ['ottopus', 'Ottopus tools only'],
            ['all', 'Also my tools'],
          ]}
        />
      </Setting>
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
        <Button size="sm" disabled>
          Set up
        </Button>
      </Setting>
    </>
  )
}

function WalletTab() {
  const [confirm, setConfirm] = useState('above')
  const [lock, setLock] = useState('15')
  return (
    <>
      <h2 className="m-0 text-[16px] font-semibold">Wallet and backup</h2>
      <p className="mt-1.5 mb-3.5 text-[13px] text-[var(--ot-text-2)]">
        Your keys live on this device, encrypted with your password.
      </p>
      <NotSavedYet />
      <Setting
        title="Back up your recovery phrase"
        description="Twelve words. You write them down, then pick three back to check."
      >
        <Button size="sm" variant="primary" disabled>
          Back up now
        </Button>
      </Setting>
      <Setting
        title="Restore a different wallet"
        description="Replace this wallet with one from a 12 or 24 word recovery phrase."
      >
        <Button size="sm" disabled>
          Restore
        </Button>
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
  return <p className="m-0 text-[13px] text-[var(--ot-text-2)]">Nothing to set here yet.</p>
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
