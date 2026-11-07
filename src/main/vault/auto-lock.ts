/** How long the app can go without input before it locks. */
export const IDLE_LIMIT_MS = 10 * 60_000
const CHECK_EVERY_MS = 15_000

export interface AutoLockOptions {
  isUnlocked: () => boolean
  lock: () => void
  idleLimitMs?: number
  now?: () => number
}

/**
 * Locks after no input reaches Ink's own windows for a while. This counts input to
 * the app rather than the computer's idle time, which isn't dependable on Wayland:
 * a check that quietly never fires is worse than locking while you work elsewhere.
 */
export function createAutoLock({ isUnlocked, lock, idleLimitMs = IDLE_LIMIT_MS, now = Date.now }: AutoLockOptions) {
  let lastInput = now()
  let timer: NodeJS.Timeout | null = null

  const check = () => {
    if (isUnlocked() && now() - lastInput >= idleLimitMs) lock()
  }

  return {
    noteInput: () => {
      lastInput = now()
    },
    check,
    start() {
      timer ??= setInterval(check, CHECK_EVERY_MS)
      timer.unref()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
