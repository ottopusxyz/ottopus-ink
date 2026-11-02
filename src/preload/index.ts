import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type InkBridge, type SignerStatus } from '../shared/ipc'

/**
 * The renderer's only door to the app. Each method maps to one IPC channel;
 * ipcRenderer itself is never exposed, and listeners get the value, never the
 * IPC event.
 */
const bridge: InkBridge = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  detectAgents: (options) => ipcRenderer.invoke(IPC.detectAgents, { refresh: options?.refresh === true }),
  onSignerStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: SignerStatus) => listener(status)
    ipcRenderer.on(IPC.signerStatus, handler)
    return () => {
      ipcRenderer.removeListener(IPC.signerStatus, handler)
    }
  },
}

contextBridge.exposeInMainWorld('ink', bridge)
