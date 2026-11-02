import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { IPC, type AppInfo } from '../shared/ipc'
import { isAppUrl, isSafeExternalUrl, secureWebPreferences } from './security'
import { SignerHost } from './signer-host'

const devServerUrl = process.env.ELECTRON_RENDERER_URL
const signer = new SignerHost(join(import.meta.dirname, 'signer.js'))

app.enableSandbox()

if (!app.requestSingleInstanceLock()) {
  app.quit()
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
    webPreferences: secureWebPreferences(join(import.meta.dirname, '../preload/index.cjs')),
  })

  win.once('ready-to-show', () => win.show())

  // The renderer never opens windows or navigates away. Links go to the OS
  // browser, and only https ones.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, devServerUrl)) event.preventDefault()
  })

  if (devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
  return win
}

function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, (event): AppInfo => {
    if (!isAppUrl(event.senderFrame?.url ?? '', devServerUrl)) {
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
  // No camera, microphone, notifications-by-prompt or anything else a page can
  // ask for. Features that need one are granted from main, not by the page.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

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
