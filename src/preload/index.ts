import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type InkBridge } from '../shared/ipc'

/**
 * The renderer's only door to the app. Each method maps to one IPC channel;
 * ipcRenderer itself is never exposed.
 */
const bridge: InkBridge = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
}

contextBridge.exposeInMainWorld('ink', bridge)
