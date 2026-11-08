import { useState } from 'react'
import { Otto } from '@/components/brand/otto'
import { Button, Input } from '@/components/ui'
import { autoLockNote, vaultMessage } from '@/lib/wallet'
import { Field, FormError, WalletHeading, WalletPanel } from './wallet-panel'

/** The whole window while locked. Main reports the unlock, and the app comes back where it was. */
export function LockScreen() {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <WalletPanel>
      <Otto pose="base" size={110} label="Otto" />
      <WalletHeading title="Ink is locked">Enter your password to unlock your wallet.</WalletHeading>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!password) return
          setBusy(true)
          setError(null)
          const result = await window.ink.unlockVault(password).finally(() => setBusy(false))
          if (result.ok) return
          setError(vaultMessage(result.reason))
          if (result.reason === 'wrong-password') setPassword('')
        }}
      >
        <FormError message={error} />
        <Field label="Password">
          <Input type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <Button variant="primary" size="lg" fullWidth type="submit" disabled={busy || !password}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
      </form>
      <p className="m-0 text-[12.5px] leading-[1.5] text-[var(--ot-text-3)]">
        {autoLockNote(navigator.userAgent)}
      </p>
    </WalletPanel>
  )
}
