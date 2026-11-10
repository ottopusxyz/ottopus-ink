import type { InkBridge } from '../../shared/ipc'
import type { ReviewBridge } from '../../shared/review'

declare global {
  interface Window {
    /** The app's page only. */
    ink: InkBridge
    /** The review window's page only. */
    inkReview: ReviewBridge
  }
}

export {}
