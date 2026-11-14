import { useEffect, useState } from 'react'
import type { Activity } from '../../../shared/ipc'

const NONE: Activity = { plans: [], earlier: [] }

/**
 * What Ink has done lately, read again whenever a plan or a swap moves on, or Ink locks or
 * unlocks. Main gives nothing while Ink is locked. `loaded` is false until the first read.
 */
export function useActivity(): { activity: Activity; loaded: boolean } {
  const [state, setState] = useState<{ activity: Activity; loaded: boolean }>({ activity: NONE, loaded: false })
  useEffect(() => {
    let live = true
    const read = () =>
      void window.ink.activity().then(
        (activity) => {
          if (live) setState({ activity, loaded: true })
        },
        () => {
          if (live) setState((before) => ({ ...before, loaded: true }))
        },
      )
    read()
    const offActivity = window.ink.onActivityChanged(read)
    const offSwaps = window.ink.onSwapsChanged(read)
    const offVault = window.ink.onVaultStatus(read)
    return () => {
      live = false
      offActivity()
      offSwaps()
      offVault()
    }
  }, [])
  return state
}

/** When a plan was made, as Activity shows it: the time today, else the day and time. */
export function whenMade(iso: string, now = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return at.toDateString() === now.toDateString() ? time : `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`
}
