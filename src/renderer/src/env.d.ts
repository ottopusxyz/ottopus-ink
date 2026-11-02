import type { InkBridge } from '../../shared/ipc'

declare global {
  interface Window {
    ink: InkBridge
  }
}

export {}
