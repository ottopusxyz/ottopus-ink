import { contextBridge, ipcRenderer } from 'electron'
import { REVIEW_IPC, type ReviewBridge, type ReviewState } from '../shared/review'

/**
 * The review window's only door to the app. It has the review channels and
 * nothing else: no chat, vault or settings, and main answers these channels
 * only for this window's own page.
 */
const bridge: ReviewBridge = {
  state: () => ipcRenderer.invoke(REVIEW_IPC.state),
  approve: (id, hash) => ipcRenderer.invoke(REVIEW_IPC.approve, id, hash),
  reject: (id) => ipcRenderer.invoke(REVIEW_IPC.reject, id),
  dismiss: (id) => ipcRenderer.invoke(REVIEW_IPC.dismiss, id),
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ReviewState | null) => listener(state)
    ipcRenderer.on(REVIEW_IPC.changed, handler)
    return () => {
      ipcRenderer.removeListener(REVIEW_IPC.changed, handler)
    }
  },
}

contextBridge.exposeInMainWorld('inkReview', bridge)
