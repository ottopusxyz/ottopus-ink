import { useId, type CSSProperties, type ReactNode } from 'react'
import { INK_TOOLS } from '../../../../shared/ipc'
import { PlugIcon, ShieldIcon } from '@/components/shell/icons'
import { Badge, type Tone } from '@/components/ui'
import { externalCount, type InkTool } from '@/lib/chats'
import { cn } from '@/lib/cn'
import { TOOL_COPY } from '@/lib/tool-copy'
import { TOOL_GLYPHS } from './tool-call'

export const TOOLS_HINT = 'Ink starts chats with only its own tools: reading balances and proposing plans. No shell, file or web access.'

/** What a chat can use, for the chip beside the composer and the chat's toolbar. */
export function toolsChip(external: readonly string[]): { text: string; hint: string; open: boolean } {
  if (external.length === 0) return { text: 'Ottopus tools only', hint: TOOLS_HINT, open: false }
  return {
    text: `Ottopus + ${externalCount(external.length)}`,
    hint: `Also on, by your choice: ${external.join(', ')}. These can act outside Ink's review. Change them in Settings.`,
    open: true,
  }
}

/** What each of Ink's tools reaches, in a few words, and what kind of thing it does. */
const ABOUT: Record<InkTool, { text: string; does: 'Read' | 'Propose' | 'Cancel'; tone: Tone }> = {
  get_accounts: { text: 'Your addresses, no keys', does: 'Read', tone: 'ok' },
  get_portfolio: { text: 'Balances on every chain', does: 'Read', tone: 'ok' },
  get_quote: { text: 'Prices through NEAR Intents', does: 'Read', tone: 'ok' },
  create_plan: { text: 'Drafts a plan for you to review', does: 'Propose', tone: 'coral' },
  get_plan: { text: 'What became of a plan', does: 'Read', tone: 'ok' },
  cancel_plan: { text: 'Withdraws a plan it made', does: 'Cancel', tone: 'neutral' },
}

export interface ToolsPopoverProps {
  /** What's on beyond Ink's own tools, by name. */
  external: readonly string[]
  /** For a chat: whether its agent is held to these, as Ink last checked, and any sign-in it waits on. */
  status?: { text: string; hint: string; tone: 'ok' | 'plan' | 'block' | 'neutral' } | undefined
  extra?: ReactNode
  /** Opens Settings on tools and skills, where outside ones are turned on. */
  onSettings?: (() => void) | undefined
  /** A chat's tools were fixed when it started; Home's apply to the next chat. */
  scope: 'chat' | 'new'
}

const STATUS_TONE = { ok: 'ok', plan: 'plan', block: 'block', neutral: 'neutral' } as const

/**
 * The tools chip, and what the agent can reach behind it: Ink's six with what
 * each one does, anything else turned on, and that none of them can sign.
 * Turning outside tools on stays in Settings, where each asks first.
 */
export function ToolsPopover({ external, status, extra, onSettings, scope }: ToolsPopoverProps) {
  const id = useId()
  const popoverId = `ink-tools-${id}`
  const anchor = `--ink-tools-${id.replace(/[^\w-]/g, '')}`
  const chip = toolsChip(external)

  return (
    <>
      <button
        type="button"
        className={cn('ink-connector', chip.open && 'ink-connector--open')}
        popoverTarget={popoverId}
        aria-label={`${chip.text}: what the agent can reach`}
        style={{ anchorName: anchor } as CSSProperties}
      >
        <PlugIcon size={13} />
        {chip.text}
      </button>
      <div id={popoverId} popover="auto" role="dialog" aria-label="Tools in this chat" className="ink-popover ink-popover--up ink-tools-pop" style={{ positionAnchor: anchor } as CSSProperties}>
        <div className="flex items-center gap-2.5 px-2 pt-1.5 pb-2.5">
          <span className="ink-tool__glyph ink-tools-pop__glyph" style={{ background: '#CFE0FF' }} aria-hidden>
            <PlugIcon size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <b className="text-[14px]">What the agent can reach</b>
            <span className="block text-[12px] text-[var(--ot-text-3)]">
              {external.length === 0 ? 'Only these six. No shell, no files, no other servers.' : 'These six, and what you turned on.'}
            </span>
          </span>
        </div>
        {status ? (
          <p className="m-0 mx-2 mb-2 flex items-center gap-2 text-[12px]" title={status.hint}>
            <Badge tone={STATUS_TONE[status.tone]}>{status.text}</Badge>
            {extra}
          </p>
        ) : null}
        <ul className="m-0 flex list-none flex-col gap-px p-0">
          {INK_TOOLS.map((tool) => {
            const Glyph = TOOL_GLYPHS[tool]
            const about = ABOUT[tool]
            return (
              <li key={tool} className="ink-tools-pop__row">
                <span className="ink-tool__glyph" style={{ background: TOOL_COPY[tool].tint }} aria-hidden>
                  <Glyph size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-[12.5px] font-semibold">{tool}</span>
                  <span className="block text-[11.5px] text-[var(--ot-text-3)]">{about.text}</span>
                </span>
                <Badge tone={about.tone} className="px-2 py-[3px] text-[10.5px] font-bold">
                  {about.does}
                </Badge>
              </li>
            )
          })}
          {external.map((name) => (
            <li key={name} className="ink-tools-pop__row">
              <span className="ink-tool__glyph" style={{ background: 'var(--ot-surface-3)' }} aria-hidden>
                <PlugIcon size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-mono text-[12.5px] font-semibold">{name}</span>
                <span className="block text-[11.5px] text-[var(--ot-text-3)]">Turned on by you. Ink can’t see what it does.</span>
              </span>
              <Badge tone="warn" className="px-2 py-[3px] text-[10.5px] font-bold">
                Outside
              </Badge>
            </li>
          ))}
        </ul>
        <div className="ink-tools-pop__foot">
          <ShieldIcon size={15} />
          None of Ink’s tools can sign. Signing happens only in the review window.
        </div>
        {onSettings ? (
          <button type="button" className="ink-tools-pop__settings" onClick={onSettings}>
            {scope === 'chat' ? 'Outside tools for new chats are in Settings' : 'Turn outside tools on or off in Settings'}
          </button>
        ) : null}
      </div>
    </>
  )
}
