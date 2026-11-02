import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentId, AgentStatus, AppInfo, SignerStatus } from '../../shared/ipc'
import { AgentPicker } from '@/components/chat/agent-picker'
import { ChatView } from '@/components/chat/chat-view'
import { HomeView } from '@/components/home/home-view'
import { PageView } from '@/components/pages/page-view'
import { SettingsDialog } from '@/components/settings/settings-dialog'
import { AppShell } from '@/components/shell/app-shell'
import { actionForShortcut, type View } from '@/components/shell/nav'
import { Sidebar } from '@/components/shell/sidebar'
import { chooseAgent } from '@/lib/agents'
import { chatTitle, HOME_DRAFT, withDraft, type Chat, type Drafts } from '@/lib/chats'

const mac = navigator.userAgent.includes('Mac')

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [signer, setSigner] = useState<SignerStatus | null>(null)
  const [view, setView] = useState<View>({ kind: 'home' })
  // Chats live in memory until the chat store arrives with the drivers.
  const [chats, setChats] = useState<Chat[]>([])
  // Unsent text for each chat and one for home, so moving between them, or
  // pressing New chat, loses nothing.
  const [drafts, setDrafts] = useState<Drafts>({})
  const draftKey = view.kind === 'chat' ? view.chatId : HOME_DRAFT
  const draft = drafts[draftKey] ?? ''
  const setDraft = (text: string) => setDrafts((all) => withDraft(all, draftKey, text))
  // What detection found (null until the first check ends), and the agent the
  // person picked. New chats use the pick while it is ready.
  const [agents, setAgents] = useState<AgentStatus[] | null>(null)
  const [agentPick, setAgentPick] = useState<AgentId | null>(null)
  const selectedAgent = agents ? chooseAgent(agents, agentPick) : null
  const [settingsOpen, setSettingsOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Subscribe before asking, so a change between the two is not missed. A
    // pushed status wins over the one in the snapshot.
    const unsubscribe = window.ink.onSignerStatus(setSigner)
    window.ink.appInfo().then(
      (next) => {
        setInfo(next)
        setSigner((current) => current ?? next.signer)
      },
      (error: unknown) => console.error('Could not read app info', error),
    )
    return unsubscribe
  }, [])

  useEffect(() => {
    window.ink.detectAgents().then(setAgents, (error: unknown) => {
      console.error('Could not detect agents', error)
      setAgents([])
    })
  }, [])

  const newChat = useCallback(() => {
    setView({ kind: 'home' })
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

  const openChat = (chatId: string) => setView({ kind: 'chat', chatId })

  const agentPicker = <AgentPicker agents={agents} selected={selectedAgent} onSelect={setAgentPick} />

  const current = view.kind === 'chat' ? chats.find((chat) => chat.id === view.chatId) : undefined

  return (
    <AppShell
      mac={mac}
      sidebar={
        <Sidebar
          view={view}
          chats={chats}
          version={info?.version}
          signer={signer}
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
        <ChatView chat={current} draft={draft} onDraft={setDraft} onSubmit={send} agentPicker={agentPicker} />
      ) : (
        <HomeView
          draft={draft}
          onDraft={setDraft}
          onSubmit={send}
          live={chats.filter((chat) => chat.status === 'live')}
          onOpenChat={openChat}
          onPortfolio={() => setView({ kind: 'page', page: 'portfolio' })}
          composerRef={composerRef}
          agentPicker={agentPicker}
        />
      )}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </AppShell>
  )
}
