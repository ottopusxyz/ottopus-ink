import { useMemo, useState, type Ref } from 'react'
import type { SignerStatus } from '../../../../shared/ipc'
import { AgentMark } from '@/components/chat/agent-picker'
import { SignInIcon } from '@/components/settings/sign-in-icon'
import { Badge, ChainStack, TokenLogo, Tooltip } from '@/components/ui'
import { agentInfo } from '@/lib/agents'
import { filterChats, isWorking, lockStatus, type Chat } from '@/lib/chats'
import { ACCOUNT_CHAIN_MARK } from '@/lib/logos'
import {
  ActivityIcon,
  CheckIcon,
  LockIcon,
  PlugIcon,
  ReceiveIcon,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  SlidersIcon,
  WalletIcon,
} from './icons'
import { PAGES, shortcutLabel, type PageId, type View } from './nav'

const PAGE_ICONS: Record<PageId, typeof WalletIcon> = {
  portfolio: WalletIcon,
  receive: ReceiveIcon,
  activity: ActivityIcon,
}

export interface SidebarProps {
  view: View
  chats: readonly Chat[]
  version: string | undefined
  signer: SignerStatus | null
  mac: boolean
  searchRef: Ref<HTMLInputElement>
  onNewChat: () => void
  onOpenChat: (id: string) => void
  onPage: (page: PageId) => void
  onSettings: () => void
  onLock: () => void
}

/**
 * Chats first, the way the design pass drew it: new chat and search at the
 * top, recent chats under them, and the few pages that are not a chat pushed
 * to the bottom with the signer's state.
 */
export function Sidebar({
  view,
  chats,
  version,
  signer,
  mac,
  searchRef,
  onNewChat,
  onOpenChat,
  onPage,
  onSettings,
  onLock,
}: SidebarProps) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => filterChats(chats, query), [chats, query])
  const openChat = view.kind === 'chat' ? chats.find((chat) => chat.id === view.chatId) : undefined

  return (
    <nav className="ink-sidebar" aria-label="Chats and pages">
      <button type="button" className="ink-side-item ink-side-item--strong" onClick={onNewChat}>
        <PlusIcon />
        <span className="ink-side-item__label">New chat</span>
        <kbd className="ink-kbd">{shortcutLabel('new-chat', mac)}</kbd>
      </button>

      <label className="ink-search">
        <SearchIcon size={14} />
        <span className="sr-only">Search chats</span>
        <input
          ref={searchRef}
          type="search"
          placeholder="Search chats"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('')
          }}
        />
        <kbd className="ink-kbd">{shortcutLabel('search', mac)}</kbd>
      </label>

      <div className="ink-side-heading">Recent</div>
      <ul className="m-0 flex min-h-0 list-none flex-col gap-0.5 overflow-auto p-0">
        {shown.map((chat) => (
          <li key={chat.id}>
            <button
              type="button"
              className="ink-side-item ink-side-item--chat"
              aria-current={view.kind === 'chat' && view.chatId === chat.id ? 'page' : undefined}
              onClick={() => onOpenChat(chat.id)}
            >
              <ChatMark chat={chat} />
              <span className="ink-side-item__label">{chat.title}</span>
              {chat.status === 'live' && chat.step ? (
                <Badge tone="plan">{chat.step}</Badge>
              ) : chat.plan?.status === 'awaiting_review' ? (
                <Badge tone="plan">To review</Badge>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {chats.length === 0 ? (
        <p className="m-0 px-2.5 py-1.5 text-[12.5px] leading-[1.45] text-[var(--ot-text-3)]">
          Your chats show up here.
        </p>
      ) : shown.length === 0 ? (
        <p className="m-0 px-2.5 py-1.5 text-[12.5px] text-[var(--ot-text-3)]">No chat matches.</p>
      ) : null}

      <div className="flex-1" />

      {PAGES.map((page) => {
        const Icon = PAGE_ICONS[page.id]
        return (
          <button
            key={page.id}
            type="button"
            className="ink-side-item ink-side-item--page"
            aria-current={view.kind === 'page' && view.page === page.id ? 'page' : undefined}
            onClick={() => onPage(page.id)}
          >
            <Icon />
            <span className="ink-side-item__label">{page.label}</span>
            {page.id === 'receive' ? <ChainStack chains={RECEIVE_CHAINS} size="xs" /> : null}
          </button>
        )
      })}
      <button type="button" className="ink-side-item ink-side-item--page" onClick={onSettings}>
        <SlidersIcon />
        <span className="ink-side-item__label">Settings</span>
        <kbd className="ink-kbd">{shortcutLabel('settings', mac)}</kbd>
      </button>
      <button type="button" className="ink-side-item ink-side-item--page" onClick={onLock}>
        <LockIcon />
        <span className="ink-side-item__label">Lock</span>
        <kbd className="ink-kbd">{shortcutLabel('lock', mac)}</kbd>
      </button>

      {openChat ? <LockIndicator chat={openChat} /> : null}
      <SignerIndicator status={signer} version={version} />
    </nav>
  )
}

/** The chains Receive covers, for the marks beside it. */
const RECEIVE_CHAINS = Object.values(ACCOUNT_CHAIN_MARK)

/** A chat's mark: the token its plan moves once it has one, its agent before that. */
function ChatMark({ chat }: { chat: Chat }) {
  return (
    <span className="ink-chat-mark">
      {chat.plan ? <TokenLogo symbol={chat.plan.asset} chain={chat.plan.chain} size="sm" /> : <AgentMark id={chat.agent} small />}
      <span className="sr-only">{agentInfo(chat.agent).name}</span>
      <ChatStatusMark chat={chat} />
    </span>
  )
}

function ChatStatusMark({ chat }: { chat: Chat }) {
  if (chat.status === 'live') return <span className="ink-live-dot" role="img" aria-label="In progress" />
  if (isWorking(chat)) return <span className="ink-live-dot" role="img" aria-label="Your agent is working" />
  if (chat.status === 'settled') {
    return (
      <span className="ink-chat-mark__settled">
        <CheckIcon size={9} aria-label="Settled" />
      </span>
    )
  }
  return null
}

const LOCK_COLOURS = {
  ok: 'var(--ot-ok)',
  plan: 'var(--ot-plan)',
  block: 'var(--ot-block-solid)',
  neutral: 'var(--ot-text-3)',
} as const

/** Whether the open chat's agent is held to Ottopus tools. Each chat has its own session, so each has its own answer. */
function LockIndicator({ chat }: { chat: Chat }) {
  const { text, hint, tone } = lockStatus(chat)
  // Side by side rather than nested, so each shows only its own tooltip.
  return (
    <div className="ink-signer">
      <Tooltip text={hint} className="min-w-0 flex-1">
        <div className="flex w-full items-center gap-2" role="status" tabIndex={0}>
          <span style={{ color: LOCK_COLOURS[tone] }}>
            <PlugIcon />
          </span>
          <span className="flex-1">{text}</span>
        </div>
      </Tooltip>
      {chat.phase !== 'ended' && chat.lock === 'locked' ? <SignInIcon names={chat.needsSignIn} /> : null}
    </div>
  )
}

/**
 * Where the vault's lock timer goes once the vault exists (issue #12). Until
 * then it reports the one thing that is real: the signer process is up and
 * isolated from this window.
 */
function SignerIndicator({ status, version }: { status: SignerStatus | null; version: string | undefined }) {
  const copy =
    status === 'ready' ? 'Signer isolated' : status === 'stopped' ? 'Signer stopped' : 'Signer starting'
  const colour =
    status === 'ready' ? 'var(--ot-ok)' : status === 'stopped' ? 'var(--ot-block-solid)' : 'var(--ot-plan)'
  const hint =
    status === 'ready'
      ? 'Signing runs in its own process, apart from this window and your agent.'
      : status === 'stopped'
        ? "The signing process isn't running, so nothing can be signed."
        : 'The signing process is starting.'
  return (
    <Tooltip text={hint} className="ink-tip--block">
      <div className="ink-signer" role="status" tabIndex={0}>
        <span style={{ color: colour }}>
          <ShieldIcon />
        </span>
        <span className="flex-1">{copy}</span>
        <span className="font-mono text-[11px] text-[var(--ot-text-3)]">v{version ?? '…'}</span>
      </div>
    </Tooltip>
  )
}
