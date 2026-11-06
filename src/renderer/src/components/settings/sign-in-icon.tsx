import { KeyIcon } from '@/components/shell/icons'
import { Tooltip } from '@/components/ui'
import { signInHint } from '@/lib/external-tools'

/** Marks tools that gave a chat nothing because they're waiting for sign-in, and says how to fix that. Nothing shows if none are. */
export function SignInIcon({ names }: { names: readonly string[] }) {
  if (names.length === 0) return null
  const hint = signInHint(names)
  return (
    <Tooltip text={hint}>
      <span className="inline-flex text-[var(--ot-warn-text)]" role="img" aria-label={hint} tabIndex={0}>
        <KeyIcon size={14} />
      </span>
    </Tooltip>
  )
}
