import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentId, AgentStatus, AppInfo, ExternalItem, SignerStatus } from '../../shared/ipc'
import { AgentPicker } from '@/components/chat/agent-picker'
import { ChatView } from '@/components/chat/chat-view'
import { HomeView } from '@/components/home/home-view'
import { ActivityView } from '@/components/pages/activity-view'
import { PortfolioView } from '@/components/portfolio/portfolio-view'
import { SettingsDialog, type SettingsTab } from '@/components/settings/settings-dialog'
import { AppShell } from '@/components/shell/app-shell'
import { actionForShortcut, type View } from '@/components/shell/nav'
import { Sidebar } from '@/components/shell/sidebar'
import { LockScreen } from '@/components/wallet/lock-screen'
import { MeetAgent } from '@/components/wallet/meet-agent'
import { ReceiveView } from '@/components/wallet/receive-view'
import { SetupScreen } from '@/components/wallet/setup-screen'
import { agentInfo, chooseAgent } from '@/lib/agents'
import { HOME_DRAFT, isWorking, waitingPlan, withDraft, type Drafts } from '@/lib/chats'
import { latestOnly } from '@/lib/latest'
import { useChats } from '@/lib/use-chats'
import { useVault } from '@/lib/use-vault'

const mac = navigator.userAgent.includes('Mac')

export function App() {
  const vault = useVault()
  const unlocked = vault?.state === 'unlocked'
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [signer, setSigner] = useState<SignerStatus | null>(null)
  const [view, setView] = useState<View>({ kind: 'home' })
  const [chats, chatActions] = useChats()
  const current = view.kind === 'chat' ? chats.find((chat) => chat.id === view.chatId) : undefined
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
  // True from launch: the first check is running, and Check again waits for it.
  const [checkingAgents, setCheckingAgents] = useState(true)
  const [beginDetection] = useState(latestOnly)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('agent')
  const openSettings = (tab: SettingsTab = 'agent') => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }
  // What new chats get beyond Ink's own tools, for the home composer to say so.
  const [externalItems, setExternalItems] = useState<ExternalItem[]>([])
  // A wallet made or restored in this run gets the last setup step, Meet your
  // agent, before Home. Seen as the vault going from none to unlocked.
  const [meeting, setMeeting] = useState(false)
  /** The chain Receive opens on, when a page asked for one. */
  /** The chain Receive opens on: a wallet account's, or Ink's name for any chain it receives on. */
  const [receiveChain, setReceiveChain] = useState<string | null>(null)
  const [seenState, setSeenState] = useState(vault?.state)
  if (vault?.state !== seenState) {
    setSeenState(vault?.state)
    if (seenState === 'none' && vault?.state === 'unlocked') setMeeting(true)
  }
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

  const detectAgents = useCallback(
    (refresh: boolean) => {
      // Only the newest answer counts: an older check that finishes late must
      // not put back what it saw before, say, a sign-in.
      const isLatest = beginDetection()
      window.ink
        .detectAgents({ refresh })
        .then(
          (found) => {
            if (isLatest()) setAgents(found)
          },
          (error: unknown) => {
            console.error('Could not detect agents', error)
            if (isLatest()) setAgents((current) => current ?? [])
          },
        )
        .finally(() => {
          if (isLatest()) setCheckingAgents(false)
        })
    },
    [beginDetection],
  )

  useEffect(() => detectAgents(false), [detectAgents])

  useEffect(() => {
    window.ink.listExternalTools().then(setExternalItems, (error: unknown) => console.error('Could not read external tools', error))
  }, [])

  const newChat = useCallback(() => {
    setView({ kind: 'home' })
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [])

  useEffect(() => {
    // Shortcuts belong to the unlocked app. While it's locked or not set up, they'd open what's hidden.
    if (!unlocked) return
    const onKey = (event: KeyboardEvent) => {
      const action = actionForShortcut(event)
      if (!action) return
      event.preventDefault()
      if (action === 'new-chat') newChat()
      else if (action === 'search') searchRef.current?.focus()
      else if (action === 'lock') void window.ink.lockVault()
      else {
        setSettingsTab('agent')
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newChat, unlocked])

  const send = () => {
    const text = draft.trim()
    if (!text) return
    if (current) {
      if (current.phase !== 'ready') return
      chatActions.send(current, text)
    } else {
      if (!selectedAgent) return
      setView({ kind: 'chat', chatId: chatActions.start(selectedAgent, text) })
    }
    setDraft('')
  }

  const openChat = (chatId: string) => setView({ kind: 'chat', chatId })

  const openReceive = (chain: string | null = null) => {
    setReceiveChain(chain)
    setView({ kind: 'page', page: 'receive' })
  }

  /** Home, with these words waiting in the composer for the person to send or change. */
  const askOnHome = (text: string) => {
    setDrafts((all) => withDraft(all, HOME_DRAFT, text))
    setView({ kind: 'home' })
    requestAnimationFrame(() => composerRef.current?.focus())
  }

  const page = view.kind === 'page' ? view.page : null
  const agentPicker = <AgentPicker agents={agents} selected={selectedAgent} onSelect={setAgentPick} />

  // Nothing of the app shows until the wallet is set up and unlocked. Chats and
  // drafts live on above this, so unlocking comes back where it was.
  if (!vault) return <AppShell mac={mac}>{null}</AppShell>
  if (vault.state === 'none') return <AppShell mac={mac}><SetupScreen phraseWaiting={vault.phraseWaiting} keyring={vault.keyring} /></AppShell>
  if (vault.state === 'locked') return <AppShell mac={mac}><LockScreen /></AppShell>
  if (meeting) {
    return (
      <AppShell mac={mac}>
        <MeetAgent
          agents={agents}
          selected={selectedAgent}
          onSelect={setAgentPick}
          onStart={(text) => {
            setMeeting(false)
            if (text) setDrafts((all) => withDraft(all, HOME_DRAFT, text))
            setView({ kind: 'home' })
            requestAnimationFrame(() => composerRef.current?.focus())
          }}
        />
      </AppShell>
    )
  }

  return (
    <AppShell
      mac={mac}
      sidebar={
        <Sidebar
          view={view}
          chats={chats}
          signer={signer}
          mac={mac}
          searchRef={searchRef}
          onNewChat={newChat}
          onOpenChat={openChat}
          onPage={(page) => (page === 'receive' ? openReceive() : setView({ kind: 'page', page }))}
          onSettings={() => openSettings()}
          onLock={() => void window.ink.lockVault()}
        />
      }
    >
      {page === 'receive' ? (
        <ReceiveView key={receiveChain ?? 'any'} startChain={receiveChain} />
      ) : page === 'portfolio' ? (
        <PortfolioView onAsk={askOnHome} onReceive={(chain) => openReceive(chain)} onSettings={() => openSettings('wallet')} />
      ) : page === 'activity' ? (
        <ActivityView chats={chats} onOpenChat={openChat} />
      ) : current ? (
        <ChatView
          chat={current}
          draft={draft}
          onDraft={setDraft}
          onSubmit={send}
          onStop={() => chatActions.stop(current)}
          onEnd={() => chatActions.end(current)}
          onContinue={() => chatActions.continue(current)}
          onForget={() => chatActions.forget(current)}
          onToolsSettings={() => openSettings('tools')}
          onOpenReceive={(chain) => openReceive(chain)}
        />
      ) : (
        <HomeView
          draft={draft}
          onDraft={setDraft}
          onSubmit={send}
          live={chats.filter((chat) => chat.status === 'live' || isWorking(chat))}
          onOpenChat={openChat}
          onPortfolio={() => setView({ kind: 'page', page: 'portfolio' })}
          onBackup={() => openSettings('wallet')}
          onToolsSettings={() => openSettings('tools')}
          composerRef={composerRef}
          agentPicker={agentPicker}
          canSend={selectedAgent !== null}
          external={externalItems.filter((item) => item.enabled).map((item) => item.name)}
          waiting={waitingPlan(chats)}
          readyAgent={selectedAgent ? { id: selectedAgent, name: agentInfo(selectedAgent).name } : null}
        />
      )}
      <SettingsDialog
        onExternalChange={setExternalItems}
        onClearChatHistory={chatActions.clearHistory}
        open={settingsOpen}
        startTab={settingsTab}
        version={info?.version}
        onClose={() => setSettingsOpen(false)}
        agents={agents}
        selectedAgent={selectedAgent}
        onSelectAgent={setAgentPick}
        onSeeAddresses={() => {
          setSettingsOpen(false)
          openReceive()
        }}
        checking={checkingAgents}
        onCheckAgain={() => {
          setCheckingAgents(true)
          detectAgents(true)
        }}
      />
    </AppShell>
  )
}
