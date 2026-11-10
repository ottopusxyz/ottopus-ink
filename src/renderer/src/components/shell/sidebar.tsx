import { useMemo, useState, type Ref } from 'react'
import type { SignerStatus } from '../../../../shared/ipc'
import { AgentMark } from '@/components/chat/agent-picker'
import { Badge, Button, ChainStack, TokenLogo, Tooltip } from '@/components/ui'
import { agentInfo } from '@/lib/agents'
import { filterChats, isWorking, type Chat } from '@/lib/chats'
import { ACCOUNT_CHAIN_MARK } from '@/lib/logos'
import {
  ActivityIcon,
  CheckIcon,
  ChevronDownIcon,
  ReceiveIcon,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  SlidersIcon,
  WalletIcon,
} from './icons'
import { PAGES, shortcutLabel, type PageId, type View } from './nav'

/** How many chats the list shows before All chats opens the rest. */
const RECENT_CHATS = 8

const PAGE_ICONS: Record<PageId, typeof WalletIcon> = {
  portfolio: WalletIcon,
  receive: ReceiveIcon,
  activity: ActivityIcon,
}

export interface SidebarProps {
  view: View
  chats: readonly Chat[]
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
  const [all, setAll] = useState(false)
  const shown = useMemo(() => filterChats(chats, query), [chats, query])
  // A search shows every match; otherwise the newest few, until All chats opens the rest.
  const listed = query || all ? shown : shown.slice(0, RECENT_CHATS)

  return (
    <nav className="ink-sidebar" aria-label="Chats and pages">
      <button type="button" className="ink-side-item ink-side-item--strong" onClick={onNewChat}>
        <span className="ink-new-tile" aria-hidden>
          <PlusIcon size={13} />
        </span>
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

      <div className="ink-side-heading">Chats</div>
      <ul className="m-0 flex min-h-0 list-none flex-col gap-0.5 overflow-auto p-0">
        {listed.map((chat) => (
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
        {!query && shown.length > RECENT_CHATS ? (
          <li>
            <button type="button" className="ink-side-item ink-side-item--more" aria-expanded={all} onClick={() => setAll(!all)}>
              <span className={all ? 'ink-chevron ink-chevron--up' : 'ink-chevron'} aria-hidden>
                <ChevronDownIcon size={14} />
              </span>
              <span className="ink-side-item__label">{all ? 'Fewer chats' : `All chats (${shown.length})`}</span>
            </button>
          </li>
        ) : null}
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

      <VaultCard signer={signer} lockKey={shortcutLabel('lock', mac)} onLock={onLock} />
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

/**
 * The wallet's state, at the foot of the sidebar: unlocked, when it locks
 * itself, and Lock. While the signer isn't up, that's what it says instead,
 * since nothing can be signed then.
 */
function VaultCard({ signer, lockKey, onLock }: { signer: SignerStatus | null; lockKey: string; onLock: () => void }) {
  const tone = signer === 'ready' ? 'ok' : signer === 'stopped' ? 'block' : 'plan'
  const line = signer === 'ready' ? 'locks after 10 min idle' : signer === 'stopped' ? 'signer stopped' : 'signer starting'
  const hint =
    signer === 'ready'
      ? 'Ink locks itself after 10 minutes without use. Signing runs in its own process, apart from this window and your agent.'
      : signer === 'stopped'
        ? "The signing process isn't running, so nothing can be signed."
        : 'The signing process is starting.'
  return (
    <div className="ink-vault">
      <Tooltip text={hint} className="min-w-0 flex-1">
        <div className="flex w-full items-center gap-2.5" role="status" tabIndex={0}>
          <span className={`ink-vault__tile ink-vault__tile--${tone}`} aria-hidden>
            <ShieldIcon size={14} />
          </span>
          <span className="min-w-0 flex-1 leading-[1.3]">
            <b className="font-bold text-[var(--ot-text)]">Unlocked</b>
            <br />
            {line}
          </span>
        </div>
      </Tooltip>
      <Tooltip text={`Lock now (${lockKey})`}>
        <Button size="sm" className="h-7 px-2.5" onClick={onLock}>
          Lock
        </Button>
      </Tooltip>
    </div>
  )
}
