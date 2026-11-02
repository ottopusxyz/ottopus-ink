import { useEffect, useState } from 'react'
import type { AppInfo } from '../../shared/ipc'

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.ink.appInfo().then(setInfo)
  }, [])

  return (
    <main>
      <h1>Ottopus Ink</h1>
      <p>{info ? `${info.version} on ${info.platform}, signer ${info.signer}` : 'Starting…'}</p>
    </main>
  )
}
