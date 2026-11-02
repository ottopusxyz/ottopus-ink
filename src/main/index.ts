import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, ipcMain, Menu, session, shell } from 'electron'
import { IPC, type AppInfo } from '../shared/ipc'
import { appMenuTemplate } from './menu'
import { isAppUrl, isSafeExternalUrl, secureWebPreferences } from './security'
import { SignerHost } from './signer-host'

const devServerUrl = process.env.ELECTRON_RENDERER_URL
const rendererIndex = join(import.meta.dirname, '../renderer/index.html')
/** The page the window loads; navigations and IPC are checked against it. */
const appEntry = devServerUrl ?? pathToFileURL(rendererIndex).href
const signer = new SignerHost(join(import.meta.dirname, 'signer.js'), (status) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(IPC.signerStatus, status)
  }
})

app.enableSandbox()

// A second launch only hands focus to the first. app.quit() does not stop
// whenReady from firing, so startup is gated on the lock below, not on quit.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

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

function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, (event): AppInfo => {
    if (!isAppUrl(event.senderFrame?.url ?? '', appEntry)) {
      throw new Error('IPC from an unexpected frame')
    }
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      signer: signer.getStatus(),
    }
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
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => signer.stop())
