import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, powerMonitor, safeStorage, session, shell, type IpcMainInvokeEvent } from 'electron'
import { IPC, type AgentStatus, type AppInfo } from '../shared/ipc'
import { closeChat, killChats, sendToChat, startChat, stopChatTurn } from './agents/chats'
import { detectAgents } from './agents/detect'
import { agentEnv, readNamedShellEnv } from './agents/login-env'
import { run, stopRuns } from './agents/run'
import { detectEntries } from './external/detect'
import { createSignIns, type SecretBox } from './external/sign-ins'
import { createExternalTools, type Confirm, type ExternalTools } from './external/tools'
import { startMcpBridge, type McpBridge } from './mcp/bridge'
import { appMenuTemplate } from './menu'
import { isAppUrl, isSafeExternalUrl, secureWebPreferences } from './security'
import { SignerHost } from './signer-host'
import { createAutoLock } from './vault/auto-lock'
import { createVaultService, type VaultService } from './vault/service'
import { createVaultStore } from './vault/store'

const devServerUrl = process.env.ELECTRON_RENDERER_URL
const rendererIndex = join(import.meta.dirname, '../renderer/index.html')
/** The page the window loads; navigations and IPC are checked against it. */
const appEntry = devServerUrl ?? pathToFileURL(rendererIndex).href
const signer = new SignerHost(join(import.meta.dirname, 'signer.js'), (status) => {
  sendToWindows(IPC.signerStatus, status)
  if (status === 'stopped') vault?.signerStopped()
})

function sendToWindows(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

app.enableSandbox()

// A second launch only hands focus to the first. app.quit() does not stop
// whenReady from firing, so startup is gated on the lock below, not on quit.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

/** Moves on when a page goes away, so a chat it asked for that's still starting is refused. */
let pageGeneration = 0

function endPageChats(): void {
  pageGeneration++
  killChats()
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Ottopus Ink',
    backgroundColor: '#F7F2EA',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: secureWebPreferences(join(import.meta.dirname, '../preload/index.cjs'), {
      devTools: Boolean(devServerUrl),
    }),
  })

  win.once('ready-to-show', () => win.show())

  // A page that goes away takes what it knows about its chats with it, leaving
  // nothing that could ever close them.
  win.webContents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (isMainFrame && !isSameDocument) endPageChats()
  })
  win.on('closed', endPageChats)

  // The renderer never opens windows or navigates away. Links go to the OS
  // browser, and only https ones.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, appEntry)) event.preventDefault()
  })

  if (devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(rendererIndex)
  }
  return win
}

/** Every handler starts here: only the app's own page may call in. */
function assertAppFrame(event: IpcMainInvokeEvent): void {
  if (!isAppUrl(event.senderFrame?.url ?? '', appEntry)) {
    throw new Error('IPC from an unexpected frame')
  }
}

/** The last detection, shared by every caller until a refresh asks for a new one. */
let agents: Promise<AgentStatus[]> | null = null

/** Started with the first chat, so the app opens no socket until something needs one. */
let mcpBridge: Promise<McpBridge> | null = null

function getMcpBridge(): Promise<McpBridge> {
  mcpBridge ??= startMcpBridge({
    // Private to the user on Linux. macOS has no such folder, so the app's own data folder.
    parentDir: process.env.XDG_RUNTIME_DIR ?? app.getPath('userData'),
    version: app.getVersion(),
    // Public addresses only, and only while unlocked. The agent's tools get this function, never the vault.
    accounts: async () => {
      const wallet = getVault()
      return wallet.status().state === 'none' ? { ok: false, reason: 'no-vault' } : wallet.accounts()
    },
  }).catch((error: unknown) => {
    mcpBridge = null
    throw error
  })
  return mcpBridge
}

const osSecretBox: SecretBox = {
  // Without a keyring, Linux "encrypts" with a key anyone can look up.
  canKeep: () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
  seal: (text) => safeStorage.encryptString(text),
  open: (data) => safeStorage.decryptString(data),
}

let vault: VaultService | null = null

function getVault(): VaultService {
  vault ??= createVaultService({
    store: createVaultStore({ file: join(app.getPath('userData'), 'vault.bin'), box: osSecretBox }),
    ask: (request) => signer.askVault(request),
    onStatus: (status) => {
      if (status.state === 'unlocked') autoLock.noteInput()
      sendToWindows(IPC.vaultStatusChanged, status)
    },
  })
  return vault
}

const autoLock = createAutoLock({
  isUnlocked: () => vault?.isUnlocked() === true,
  lock: () => void vault?.lock(),
})

let externalTools: ExternalTools | null = null

function getExternalTools(): ExternalTools {
  externalTools ??= createExternalTools({
    file: join(app.getPath('userData'), 'external-tools.json'),
    // Nothing ships yet. Issue #11 chooses what does.
    bundled: [],
    readEnv: readNamedShellEnv,
    signIns: createSignIns({
      file: join(app.getPath('userData'), 'external-sign-ins.bin'),
      box: osSecretBox,
      // oauth.ts has checked the address: https, or this computer for a server that's here too.
      openBrowser: (url) => shell.openExternal(url),
    }),
    detect: async () => {
      const env = await agentEnv()
      agents ??= agentEnv().then(detectAgents)
      const codex = (await agents).find(({ id }) => id === 'codex')?.path
      // This process's own if the login shell couldn't be read.
      const claudeConfig = env.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR
      return detectEntries({
        claudeDir: claudeConfig ?? join(homedir(), '.claude'),
        claudeJson: claudeConfig ? join(claudeConfig, '.claude.json') : join(homedir(), '.claude.json'),
        codexDir: env.CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'),
        codexServers: async () => {
          if (!codex) return null
          const { stdout } = await run(codex, ['mcp', 'list', '--json'], { env: { ...process.env, ...env }, timeoutMs: 5000 })
          return JSON.parse(stdout) as unknown
        },
      })
    },
  })
  return externalTools
}

/**
 * Asks in a native dialog, drawn by the OS and answered by the person. The page
 * asked for this but can't see or click it, which is the point: anything running
 * in the page could otherwise switch on a tool that can move funds.
 */
function nativeConfirm(event: IpcMainInvokeEvent): Confirm {
  return async ({ message, detail, confirm }) => {
    const options = { type: 'warning' as const, buttons: ['Cancel', confirm], defaultId: 0, cancelId: 0, noLink: true, message, detail }
    const win = BrowserWindow.fromWebContents(event.sender)
    const { response } = await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
    return response === 1
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, (event): AppInfo => {
    assertAppFrame(event)
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      signer: signer.getStatus(),
    }
  })

  ipcMain.handle(IPC.detectAgents, (event, options: unknown): Promise<AgentStatus[]> => {
    assertAppFrame(event)
    const refresh = typeof options === 'object' && options !== null && 'refresh' in options && options.refresh === true
    if (!agents || refresh) agents = agentEnv({ refresh }).then(detectAgents)
    return agents
  })

  ipcMain.handle(IPC.startChat, async (event, agent: unknown): Promise<string> => {
    assertAppFrame(event)
    const askedIn = pageGeneration
    agents ??= agentEnv().then(detectAgents)
    const status = (await agents).find(({ id }) => id === agent)
    if (!status) throw new Error('Unknown agent')
    const tools = { bridge: await getMcpBridge(), shim: join(import.meta.dirname, 'shim.js') }
    const env = await agentEnv()
    const external = await getExternalTools().forNewChat()
    // Nothing is left to show or close a chat for a page that went away during those waits.
    if (askedIn !== pageGeneration) throw new Error('The page that asked for this chat has gone')
    return startChat(status, env, tools, external, (chatId, chatEvent) => {
      if (chatEvent.type === 'session') getExternalTools().noteSignIn(external, chatEvent.needsSignIn)
      sendToWindows(IPC.chatEvent, chatId, chatEvent)
    })
  })

  ipcMain.handle(IPC.listExternalTools, (event) => {
    assertAppFrame(event)
    return getExternalTools().list()
  })

  ipcMain.handle(IPC.addExternalServer, (event, server: unknown) => {
    assertAppFrame(event)
    return getExternalTools().add(server, nativeConfirm(event))
  })

  ipcMain.handle(IPC.removeExternalServer, (event, id: unknown) => {
    assertAppFrame(event)
    return getExternalTools().remove(id)
  })

  ipcMain.handle(IPC.setExternalEnabled, (event, id: unknown, enabled: unknown) => {
    assertAppFrame(event)
    return getExternalTools().setEnabled(id, enabled, nativeConfirm(event))
  })

  ipcMain.handle(IPC.signInExternal, (event, id: unknown) => {
    assertAppFrame(event)
    return getExternalTools().signIn(id, nativeConfirm(event))
  })

  ipcMain.handle(IPC.cancelExternalSignIn, (event) => {
    assertAppFrame(event)
    getExternalTools().cancelSignIn()
  })

  ipcMain.handle(IPC.signOutExternal, (event, id: unknown) => {
    assertAppFrame(event)
    return getExternalTools().signOut(id)
  })

  ipcMain.handle(IPC.vaultStatus, (event) => {
    assertAppFrame(event)
    return getVault().status()
  })

  ipcMain.handle(IPC.startVaultCreate, (event, words: unknown) => {
    assertAppFrame(event)
    return getVault().startCreate(words)
  })

  ipcMain.handle(IPC.finishVaultCreate, (event, password: unknown, answers: unknown) => {
    assertAppFrame(event)
    return getVault().finishCreate(password, answers)
  })

  ipcMain.handle(IPC.cancelVaultCreate, (event) => {
    assertAppFrame(event)
    return getVault().cancelCreate()
  })

  ipcMain.handle(IPC.restoreVault, (event, words: unknown, password: unknown) => {
    assertAppFrame(event)
    return getVault().restore(words, password)
  })

  ipcMain.handle(IPC.unlockVault, (event, password: unknown) => {
    assertAppFrame(event)
    return getVault().unlock(password)
  })

  ipcMain.handle(IPC.lockVault, (event) => {
    assertAppFrame(event)
    return getVault().lock()
  })

  ipcMain.handle(IPC.vaultAccounts, (event) => {
    assertAppFrame(event)
    return getVault().accounts()
  })

  ipcMain.handle(IPC.copyAddress, async (event, chain: unknown) => {
    assertAppFrame(event)
    const answer = await getVault().address(chain)
    if (!answer.ok) return answer
    clipboard.writeText(answer.address)
    return { ok: true }
  })

  ipcMain.handle(IPC.sendToChat, (event, chatId: unknown, text: unknown) => {
    assertAppFrame(event)
    if (typeof chatId !== 'string' || typeof text !== 'string') throw new Error('Bad message')
    sendToChat(chatId, text)
  })

  ipcMain.handle(IPC.stopChatTurn, (event, chatId: unknown) => {
    assertAppFrame(event)
    if (typeof chatId !== 'string') throw new Error('Bad chat')
    stopChatTurn(chatId)
  })

  ipcMain.handle(IPC.closeChat, (event, chatId: unknown) => {
    assertAppFrame(event)
    if (typeof chatId !== 'string') throw new Error('Bad chat')
    closeChat(chatId)
  })
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
  // Real input only: a page's script can't raise this to keep the wallet unlocked.
  contents.on('input-event', () => autoLock.noteInput())
})

void app.whenReady().then(() => {
  if (!primary) return

  // No camera, microphone, notifications-by-prompt or anything else a page can
  // ask for. Features that need one are granted from main, not by the page.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  // Dev keeps Electron's default menu, with Reload and DevTools.
  if (!devServerUrl) Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(process.platform)))

  registerIpc()
  signer.start()
  autoLock.start()
  powerMonitor.on('suspend', () => void vault?.lock())
  powerMonitor.on('lock-screen', () => void vault?.lock())
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  signer.stop()
  stopRuns()
  killChats()
  void mcpBridge?.then((bridge) => bridge.close())
})
