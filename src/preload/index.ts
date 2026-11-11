import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type ChatEvent, type InkBridge, type SignerStatus } from '../shared/ipc'
import type { VaultStatus } from '../shared/vault'

/**
 * The renderer's only door to the app. Each method maps to one IPC channel;
 * ipcRenderer itself is never exposed, and listeners get the value, never the
 * IPC event.
 */
const bridge: InkBridge = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  detectAgents: (options) => ipcRenderer.invoke(IPC.detectAgents, { refresh: options?.refresh === true }),
  startChat: (agent) => ipcRenderer.invoke(IPC.startChat, agent),
  sendToChat: (chatId, text) => ipcRenderer.invoke(IPC.sendToChat, chatId, text),
  stopChatTurn: (chatId) => ipcRenderer.invoke(IPC.stopChatTurn, chatId),
  closeChat: (chatId) => ipcRenderer.invoke(IPC.closeChat, chatId),
  listExternalTools: () => ipcRenderer.invoke(IPC.listExternalTools),
  signInExternal: (id) => ipcRenderer.invoke(IPC.signInExternal, id),
  cancelExternalSignIn: () => ipcRenderer.invoke(IPC.cancelExternalSignIn),
  signOutExternal: (id) => ipcRenderer.invoke(IPC.signOutExternal, id),
  addExternalServer: (server) => ipcRenderer.invoke(IPC.addExternalServer, server),
  removeExternalServer: (id) => ipcRenderer.invoke(IPC.removeExternalServer, id),
  setExternalEnabled: (id, enabled) => ipcRenderer.invoke(IPC.setExternalEnabled, id, enabled),
  onChatEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, chatId: string, event: ChatEvent) => listener(chatId, event)
    ipcRenderer.on(IPC.chatEvent, handler)
    return () => {
      ipcRenderer.removeListener(IPC.chatEvent, handler)
    }
  },
  onSignerStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: SignerStatus) => listener(status)
    ipcRenderer.on(IPC.signerStatus, handler)
    return () => {
      ipcRenderer.removeListener(IPC.signerStatus, handler)
    }
  },
  vaultStatus: () => ipcRenderer.invoke(IPC.vaultStatus),
  startVaultCreate: (words) => ipcRenderer.invoke(IPC.startVaultCreate, words),
  finishVaultCreate: (password, answers) => ipcRenderer.invoke(IPC.finishVaultCreate, password, answers),
  cancelVaultCreate: () => ipcRenderer.invoke(IPC.cancelVaultCreate),
  restoreVault: (words, password) => ipcRenderer.invoke(IPC.restoreVault, words, password),
  unlockVault: (password) => ipcRenderer.invoke(IPC.unlockVault, password),
  lockVault: () => ipcRenderer.invoke(IPC.lockVault),
  vaultAccounts: () => ipcRenderer.invoke(IPC.vaultAccounts),
  copyAddress: (chain) => ipcRenderer.invoke(IPC.copyAddress, chain),
  portfolio: (options) => ipcRenderer.invoke(IPC.portfolio, { fresh: options?.fresh === true }),
  zerionKeyStatus: () => ipcRenderer.invoke(IPC.zerionKeyStatus),
  saveZerionKey: (key) => ipcRenderer.invoke(IPC.saveZerionKey, key),
  removeZerionKey: () => ipcRenderer.invoke(IPC.removeZerionKey),
  onVaultStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: VaultStatus) => listener(status)
    ipcRenderer.on(IPC.vaultStatusChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC.vaultStatusChanged, handler)
    }
  },
}

contextBridge.exposeInMainWorld('ink', bridge)
