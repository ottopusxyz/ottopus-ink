import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { REVIEW_IPC, type ReviewState } from '../../shared/review'
import { isAppUrl, secureWebPreferences } from '../security'
import type { ReviewBroker } from './broker'
import { isApprovalClick, isApprovalKey, isExplorerUrl } from './input'

export interface ReviewWindowOptions {
  /** The review page's preload, which exposes only `window.inkReview`. */
  preload: string
  /** The review page's URL. IPC from any other page is refused. */
  entry: string
  /** Loads the review page into a new window. */
  load: (win: BrowserWindow) => void
  devTools: boolean
}

/** How often the window rechecks the plan, so expiry and arming show without waiting on anything else. */
const REFRESH_MS = 250

/**
 * The review window: its own always-on-top window, preload and page, and the
 * only place a plan is approved. The chat's page has no handle on it: it can't
 * open windows, can't reach this window's page, and can't call the review
 * channels, which answer only this window's own page.
 *
 * It opens whenever the broker has something to review and closes when it has
 * nothing. It tells the broker when it comes up or takes focus, which restarts
 * the arm delay, and about each real click or key press in it, which Electron
 * reports from the OS, out of any script's reach.
 */
export function createReviewWindow({ preload, entry, load, devTools }: ReviewWindowOptions) {
  let win: BrowserWindow | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let broker: ReviewBroker | null = null

  const open = (): BrowserWindow => {
    const created = new BrowserWindow({
      width: 480,
      height: 760,
      minWidth: 400,
      minHeight: 560,
      show: false,
      alwaysOnTop: true,
      minimizable: false,
      fullscreenable: false,
      title: 'Review · Ottopus Ink',
      backgroundColor: '#F7F2EA',
      webPreferences: secureWebPreferences(preload, { devTools }),
    })
    created.setAlwaysOnTop(true, 'floating')

    created.once('ready-to-show', () => {
      created.show()
      created.focus()
      broker?.shown()
    })
    created.on('focus', () => broker?.shown())

    const contents = created.webContents
    contents.on('input-event', (_event, input) => {
      if (isApprovalClick(input as { type: string; button?: string })) broker?.input()
    })
    contents.on('before-input-event', (_event, input) => {
      if (isApprovalKey(input)) broker?.input()
    })
    // The review page never leaves itself, and opens nothing but a sent transaction on the explorer.
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      if (isExplorerUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    created.on('closed', () => {
      if (timer) clearInterval(timer)
      timer = null
      win = null
      broker?.closed()
    })
    timer = setInterval(() => broker?.refresh(), REFRESH_MS)
    load(created)
    return created
  }

  /** Only the review window's own top frame, on the review page, may call in. */
  const assertReviewFrame = (event: IpcMainInvokeEvent): void => {
    const contents = win?.webContents
    const frame = event.senderFrame
    if (!contents || event.sender !== contents || !frame || frame !== contents.mainFrame || !isAppUrl(frame.url, entry)) {
      throw new Error('IPC from an unexpected frame')
    }
  }

  const text = (value: unknown): string => {
    if (typeof value !== 'string' || value.length > 256) throw new Error('Bad request')
    return value
  }

  return {
    /** Connects the broker, and registers the review channels. Call once. */
    attach(connected: ReviewBroker): void {
      broker = connected
      ipcMain.handle(REVIEW_IPC.state, (event) => {
        assertReviewFrame(event)
        return connected.state()
      })
      ipcMain.handle(REVIEW_IPC.approve, (event, id: unknown, hash: unknown) => {
        assertReviewFrame(event)
        return connected.approve(text(id), text(hash))
      })
      ipcMain.handle(REVIEW_IPC.reject, (event, id: unknown) => {
        assertReviewFrame(event)
        connected.reject(text(id))
      })
      ipcMain.handle(REVIEW_IPC.dismiss, (event, id: unknown) => {
        assertReviewFrame(event)
        connected.dismiss(text(id))
      })
    },

    /** The broker's state changed: opens, updates or closes the window. */
    update(state: ReviewState | null): void {
      if (!state) {
        win?.close()
        return
      }
      if (!win || win.isDestroyed()) {
        win = open()
        return
      }
      win.webContents.send(REVIEW_IPC.changed, state)
    },

    /** Whether these are the review window's contents, which may use no other channel. */
    owns(contents: WebContents): boolean {
      return win !== null && !win.isDestroyed() && contents === win.webContents
    },
  }
}

export type ReviewWindow = ReturnType<typeof createReviewWindow>
