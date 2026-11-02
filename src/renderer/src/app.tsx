import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppInfo } from '../../shared/ipc'
import { ChatView } from '@/components/chat/chat-view'
import { HomeView } from '@/components/home/home-view'
import { PageView } from '@/components/pages/page-view'
import { SettingsDialog } from '@/components/settings/settings-dialog'
import { AppShell } from '@/components/shell/app-shell'
import { actionForShortcut, type View } from '@/components/shell/nav'
import { Sidebar } from '@/components/shell/sidebar'
import { chatTitle, type Chat } from '@/lib/chats'

const mac = navigator.userAgent.includes('Mac')

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [view, setView] = useState<View>({ kind: 'home' })
  // Chats live in memory until the chat store arrives with the drivers.
  const [chats, setChats] = useState<Chat[]>([])
  const [draft, setDraft] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false
    // The signer reports ready shortly after launch; poll briefly so the status
    // settles without a push channel for one value.
    const load = () =>
      window.ink.appInfo().then((next) => {
        if (cancelled) return
        setInfo(next)
        if (next.signer === 'starting') setTimeout(load, 250)
      })
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const newChat = useCallback(() => {
    setView({ kind: 'home' })
    setDraft('')
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = actionForShortcut(event)
      if (!action) return
      event.preventDefault()
      if (action === 'new-chat') newChat()
      else if (action === 'search') searchRef.current?.focus()
      else setSettingsOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newChat])

  const send = () => {
    const text = draft.trim()
    if (!text) return
    const message = { id: crypto.randomUUID(), role: 'user' as const, text }
    if (view.kind === 'chat') {
      setChats((all) =>
        all.map((chat) => (chat.id === view.chatId ? { ...chat, messages: [...chat.messages, message] } : chat)),
      )
    } else {
      const chat: Chat = { id: crypto.randomUUID(), title: chatTitle(text), status: 'idle', messages: [message] }
      setChats((all) => [chat, ...all])
      setView({ kind: 'chat', chatId: chat.id })
    }
    setDraft('')
  }

  const openChat = (chatId: string) => {
    setView({ kind: 'chat', chatId })
    setDraft('')
  }

  const current = view.kind === 'chat' ? chats.find((chat) => chat.id === view.chatId) : undefined

  return (
    <AppShell
      mac={mac}
      sidebar={
        <Sidebar
          view={view}
          chats={chats}
          info={info}
          mac={mac}
          searchRef={searchRef}
          onNewChat={newChat}
          onOpenChat={openChat}
          onPage={(page) => setView({ kind: 'page', page })}
          onSettings={() => setSettingsOpen(true)}
        />
      }
    >
      {view.kind === 'page' ? (
        <PageView page={view.page} />
      ) : current ? (
        <ChatView chat={current} draft={draft} onDraft={setDraft} onSubmit={send} />
      ) : (
        <HomeView
          draft={draft}
          onDraft={setDraft}
          onSubmit={send}
          live={chats.filter((chat) => chat.status === 'live')}
          onOpenChat={openChat}
          onPortfolio={() => setView({ kind: 'page', page: 'portfolio' })}
          composerRef={composerRef}
        />
      )}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </AppShell>
  )
}
