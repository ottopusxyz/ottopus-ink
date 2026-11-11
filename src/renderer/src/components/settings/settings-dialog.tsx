import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { AgentId, AgentState, AgentStatus, ExternalItem, ZerionKeyStatus } from '../../../../shared/ipc'
import { Otto } from '@/components/brand/otto'
import { OttoBadge } from '@/components/brand/otto-badge'
import { AgentMark } from '@/components/chat/agent-picker'
import { Badge, Button, Callout, ChainStack, Dialog, Input, Segmented, Tooltip, type Tone } from '@/components/ui'
import { BotIcon, CloseIcon, PlugIcon, RefreshIcon, ShieldIcon, SlidersIcon, WalletIcon } from '@/components/shell/icons'
import { agentInfo, describeAgent, LATER_AGENTS } from '@/lib/agents'
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

export type SettingsTab = (typeof TABS)[number]['id']
type TabId = SettingsTab

export interface SettingsDialogProps {
  open: boolean
  /** The section it opens on. Agent unless something asked for another. */
  startTab?: TabId
  onClose: () => void
  /** Ink's version, for the foot of the nav. */
  version: string | undefined
  /** What detection found; null until the first check ends. */
  agents: readonly AgentStatus[] | null
  /** The agent new chats use. */
  selectedAgent: AgentId | null
  /** Makes a ready agent the one new chats use. */
  onSelectAgent: (id: AgentId) => void
  /** Closes Settings and opens Receive. */
  onSeeAddresses: () => void
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
export function SettingsDialog({
  open,
  startTab = 'agent',
  onClose,
  version,
  agents,
  selectedAgent,
  onSelectAgent,
  onSeeAddresses,
  checking,
  onCheckAgain,
  onExternalChange,
}: SettingsDialogProps) {
  const [tab, setTab] = useState<TabId>(startTab)
  // Each opening starts on the section it was asked for.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setTab(startTab)
  }

  return (
    <Dialog open={open} onClose={onClose} title="Settings" hideTitle className="ink-settings">
      <div className="flex items-center gap-2.5 border-b border-[var(--ot-border)] py-3 pr-3 pl-[18px]">
        <OttoBadge size={30} />
        {/* The dialog's own title names it for screen readers; this is the
            visible one, in the header row beside the close button. */}
        <span aria-hidden className="flex-1 font-display text-[18px] font-bold tracking-[-0.02em]">
          Settings
        </span>
        <kbd className="ink-kbd" aria-hidden>
          Esc
        </kbd>
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
          <span className="ink-settings-nav__foot">Ink {version ?? '…'} · hackathon build</span>
        </nav>
        <div className="min-w-0 flex-1 overflow-auto pt-[18px] pr-7 pb-6 pl-[18px]">
          {tab === 'agent' ? (
            <AgentTab agents={agents} selectedAgent={selectedAgent} onSelectAgent={onSelectAgent} checking={checking} onCheckAgain={onCheckAgain} />
          ) : tab === 'tools' ? (
            // Only while open, so reopening Settings reads the list afresh.
            open ? (
              <>
                <ToolsTab onChange={onExternalChange} />
                <TerminalSetup />
              </>
            ) : null
          ) : tab === 'wallet' ? (
            <WalletTab onSeeAddresses={onSeeAddresses} />
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
  onSelectAgent,
  checking,
  onCheckAgain,
}: Pick<SettingsDialogProps, 'agents' | 'selectedAgent' | 'onSelectAgent' | 'checking' | 'onCheckAgain'>) {
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
          <div className="ink-agent-grid">
            {agents.map((agent) => {
              const copy = describeAgent(agent)
              const on = agent.id === selectedAgent
              return (
                <div key={agent.id} className={on ? 'ink-agent-card ink-agent-card--on' : 'ink-agent-card'}>
                  <div className="flex items-center gap-2.5">
                    <AgentMark id={agent.id} />
                    <span className="min-w-0 flex-1">
                      <b className="block text-[14px] font-semibold">{agentInfo(agent.id).name}</b>
                      <span className="block text-[11.5px] text-[var(--ot-text-3)]">{agent.state === 'ready' ? `${copy.label} · on PATH` : copy.label}</span>
                    </span>
                  </div>
                  {agent.state === 'ready' ? null : (
                    <>
                      <span className="block text-[12px] leading-[1.45] text-[var(--ot-text-2)]">{copy.hint}</span>
                      {copy.command ? <code className="ink-command">{copy.command}</code> : null}
                    </>
                  )}
                  {agent.path ? (
                    <span className="selectable block truncate font-mono text-[11px] text-[var(--ot-text-3)]" title={agent.path}>
                      {agent.path}
                    </span>
                  ) : null}
                  {on ? (
                    <Badge tone="navy">Default</Badge>
                  ) : agent.state === 'ready' ? (
                    <Button size="sm" className="self-start" onClick={() => onSelectAgent(agent.id)}>
                      Make default
                    </Button>
                  ) : (
                    <Badge tone={STATE_TONE[agent.state]}>{copy.label}</Badge>
                  )}
                </div>
              )
            })}
            <div className="ink-agent-card ink-agent-card--later">
              <span className="text-[12px] leading-[1.45] text-[var(--ot-text-3)]">
                {LATER_AGENTS.slice(0, -1).join(', ')} and {LATER_AGENTS.at(-1)} come later. Ink uses your own agent login; it never asks for an API key.
              </span>
            </div>
          </div>
        )}
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
    </>
  )
}

/** Not built yet: giving the agent's own config the ottopus-ink server, outside Ink's chats. */
function TerminalSetup() {
  return (
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
  )
}

const NEEDS_WALLET = 'This isn’t built yet.'

function WalletTab({ onSeeAddresses }: { onSeeAddresses: () => void }) {
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
      <div className="flex items-center gap-2 py-2.5">
        <ChainStack chains={['near', 'ethereum', 'solana', 'bitcoin', 'tron', 'sui', 'aptos']} />
        <span className="text-[12.5px] text-[var(--ot-text-2)]">One phrase covers all seven chains.</span>
        <button type="button" className="ink-text-link ml-auto" onClick={onSeeAddresses}>
          See addresses
        </button>
      </div>
      <ZerionKeySetting />
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

const ZERION_FAILURES = {
  invalid: 'That doesn’t look like a Zerion API key. Copy it again from your Zerion dashboard.',
  'bad-key': 'Zerion turned that key down. Check it in your Zerion dashboard, or make a new one.',
  unavailable: 'Ink couldn’t reach Zerion to check the key. Try again in a moment.',
} as const

/**
 * The person's own Zerion API key, for balances on EVM chains, Solana and Tron. Main
 * checks it with Zerion before keeping it, sealed by the OS keyring; the page can set
 * and remove it but never reads it back.
 */
function ZerionKeySetting() {
  const [status, setStatus] = useState<ZerionKeyStatus | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let live = true
    window.ink.zerionKeyStatus().then(
      (answer) => live && setStatus(answer),
      (error: unknown) => console.error('Could not read the Zerion key status', error),
    )
    return () => {
      live = false
    }
  }, [])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setNote(null)
    try {
      const answer = await window.ink.saveZerionKey(draft)
      if (answer.ok) {
        setStatus((current) => ({ set: true, kept: current?.kept ?? true }))
        setDraft('')
        setNote({ ok: true, text: 'Saved. Portfolio now reads your EVM, Solana and Tron balances.' })
      } else {
        setNote({ ok: false, text: ZERION_FAILURES[answer.reason] })
      }
    } catch {
      setNote({ ok: false, text: ZERION_FAILURES.unavailable })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await window.ink.removeZerionKey()
      setStatus((current) => ({ set: false, kept: current?.kept ?? true }))
      setNote({ ok: true, text: 'Removed. Ink reads only NEAR balances now.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-[var(--ot-border)] py-4">
      <div className="flex items-start gap-5">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[14px] font-semibold">Balances on other chains</h3>
          <p className="m-0 mt-0.5 text-[12.5px] leading-[1.5] text-[var(--ot-text-2)]">
            Ink reads EVM, Solana and Tron balances through Zerion, with your own API key. Get a free one from{' '}
            <a className="ink-text-link" href="https://dashboard.zerion.io" target="_blank" rel="noreferrer">
              dashboard.zerion.io
            </a>
            . Zerion sees those addresses, and the key never leaves this computer except to Zerion.
          </p>
        </div>
        {status?.set ? (
          <span className="flex shrink-0 items-center gap-2">
            <Badge tone="ok">Key saved</Badge>
            <Button size="sm" variant="secondary" onClick={() => void remove()} disabled={busy}>
              Remove
            </Button>
          </span>
        ) : null}
      </div>
      {status && !status.set ? (
        <form className="mt-3 flex gap-2" onSubmit={(event) => void save(event)}>
          <Input
            type="password"
            mono
            autoComplete="off"
            spellCheck={false}
            aria-label="Zerion API key"
            placeholder="Paste your Zerion API key"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            invalid={note !== null && !note.ok}
          />
          <Button type="submit" variant="primary" size="sm" disabled={busy || draft.trim() === ''} className="shrink-0">
            {busy ? 'Checking…' : 'Save key'}
          </Button>
        </form>
      ) : null}
      {status && !status.kept ? (
        <p className="m-0 mt-2 text-[12px] text-[var(--ot-text-3)]">This computer has no keyring, so a key lasts until Ink quits.</p>
      ) : null}
      {note ? (
        <p className={`m-0 mt-2 text-[12.5px] ${note.ok ? 'text-[var(--ot-ok-text)]' : 'text-[var(--ot-block-text)]'}`} role={note.ok ? 'status' : 'alert'}>
          {note.text}
        </p>
      ) : null}
    </div>
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
