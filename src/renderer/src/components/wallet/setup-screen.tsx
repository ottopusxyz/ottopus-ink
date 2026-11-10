import { useState, type FormEvent } from 'react'
import type { BackupAnswer, NewPhrase, VaultWordCount } from '../../../../shared/vault'
import { Ring } from '@/components/motion/ring'
import { ChatIcon, EyeIcon, KeyIcon } from '@/components/shell/icons'
import { Button, Callout, ChainStack, Input, Segmented } from '@/components/ui'
import { passwordProblem, PHRASE_DROPPED, phraseLost, phraseProblem, phraseWords, typedAnswers, vaultMessage, wrongAnswers } from '@/lib/wallet'
import { Field, FormError, PhraseInput, WalletHeading, WalletPanel, type Guide } from './wallet-panel'

type Step =
  | { kind: 'welcome' }
  | { kind: 'words'; phrase: NewPhrase; shown: boolean }
  | { kind: 'check'; phrase: NewPhrase }
  | { kind: 'password'; phrase: NewPhrase; answers: BackupAnswer[] }
  | { kind: 'restore' }

/** What Otto says on each step. Big and moving to say hello; calm while words and passwords are typed. */
const GUIDE: Record<Step['kind'], Guide> = {
  welcome: {
    pose: 'wave',
    title: 'Hi! I’m Otto.',
    text: 'I keep your keys on this computer and look over everything your agent asks for. A few quick steps and we’re swimming.',
  },
  words: {
    pose: 'heads-up',
    title: 'Paper, not pixels.',
    text: 'Anyone with these words gets everything in this wallet. I can’t reset them for you, so write them down carefully.',
    calm: true,
  },
  check: {
    pose: 'tapping',
    title: 'Let’s test your copy.',
    text: 'Type the words I ask for from your paper. I’ll check each one against the original.',
    calm: true,
  },
  password: {
    pose: 'planning',
    title: 'Now a lock for this computer.',
    text: 'The password opens Ink here. It doesn’t replace your words, so keep the paper safe too.',
    calm: true,
  },
  restore: {
    pose: 'planning',
    title: 'Welcome back.',
    text: 'Type your words in order. They stay on this computer and never reach your agent or the internet.',
    calm: true,
  },
}

/** Where each step sits in the progress above the form. Welcome and restore have none. */
const PROGRESS: Partial<Record<Step['kind'], number>> = { words: 0, check: 1, password: 2 }

/**
 * First launch: make a recovery phrase or bring one. Nothing is saved until the
 * backup check and the password are done; main then reports the vault as
 * unlocked and the app takes over from here.
 */
export function SetupScreen({ phraseWaiting }: { phraseWaiting: boolean }) {
  const [step, setStep] = useState<Step>({ kind: 'welcome' })
  const [size, setSize] = useState<VaultWordCount>(12)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A lock or a stopped signer throws a waiting phrase away without changing the vault's
  // state, so main's phraseWaiting is the only sign. Once it's gone, the words on screen
  // open nothing, and the person must not go on copying them down.
  if (phraseLost(phraseWaiting, step.kind)) {
    setStep({ kind: 'welcome' })
    setError(PHRASE_DROPPED)
  }

  const go = (next: Step) => {
    setError(null)
    setStep(next)
  }

  const startCreate = async () => {
    setBusy(true)
    const result = await window.ink.startVaultCreate(size).finally(() => setBusy(false))
    if (result.ok) go({ kind: 'words', phrase: { words: result.words, check: result.check }, shown: false })
    else setError(vaultMessage(result.reason))
  }

  const cancel = () => {
    void window.ink.cancelVaultCreate()
    go({ kind: 'welcome' })
  }

  return (
    <WalletPanel guide={GUIDE[step.kind]} step={PROGRESS[step.kind]}>
      {step.kind === 'welcome' ? (
        <Welcome size={size} onSize={setSize} busy={busy} error={error} onCreate={startCreate} onRestore={() => go({ kind: 'restore' })} />
      ) : step.kind === 'words' ? (
        <ShowWords
          phrase={step.phrase}
          shown={step.shown}
          onShow={() => setStep({ ...step, shown: true })}
          onDone={() => go({ kind: 'check', phrase: step.phrase })}
          onCancel={cancel}
        />
      ) : step.kind === 'check' ? (
        <CheckWords
          phrase={step.phrase}
          error={error}
          onBack={() => go({ kind: 'words', phrase: step.phrase, shown: false })}
          onDone={(answers) => go({ kind: 'password', phrase: step.phrase, answers })}
        />
      ) : step.kind === 'password' ? (
        <CreatePassword
          busy={busy}
          error={error}
          onBack={() => go({ kind: 'check', phrase: step.phrase })}
          onSubmit={async (password) => {
            setBusy(true)
            setError(null)
            // The person's own words: the signer checks them against the phrase it holds.
            const result = await window.ink.finishVaultCreate(password, step.answers).finally(() => setBusy(false))
            if (result.ok) return
            if (result.reason === 'backup-mismatch') {
              setStep({ kind: 'check', phrase: step.phrase })
              setError(vaultMessage(result.reason))
            } else if (result.reason === 'nothing-pending' || result.reason === 'locked-meanwhile') {
              // Either way the signer no longer holds this phrase.
              setStep({ kind: 'welcome' })
              setError(result.reason === 'locked-meanwhile' ? PHRASE_DROPPED : vaultMessage(result.reason))
            } else setError(vaultMessage(result.reason))
          }}
        />
      ) : (
        <Restore
          busy={busy}
          error={error}
          onCancel={() => go({ kind: 'welcome' })}
          onSubmit={async (words, password) => {
            setBusy(true)
            setError(null)
            const result = await window.ink.restoreVault(words, password).finally(() => setBusy(false))
            if (!result.ok) setError(vaultMessage(result.reason))
          }}
        />
      )}
    </WalletPanel>
  )
}

function Welcome({
  size,
  onSize,
  busy,
  error,
  onCreate,
  onRestore,
}: {
  size: VaultWordCount
  onSize: (size: VaultWordCount) => void
  busy: boolean
  error: string | null
  onCreate: () => void
  onRestore: () => void
}) {
  return (
    <>
      <WalletHeading title="Set up your wallet">
        One recovery phrase gives you an address on NEAR, Ethereum and other EVM chains, Solana, Bitcoin, Tron, Sui and
        Aptos. It’s encrypted with your password and never leaves this computer.
      </WalletHeading>
      <Callout severity="caution" title="Ink is still being built" compact>
        Don’t use a recovery phrase that holds real funds yet.
      </Callout>
      <ul className="m-0 grid list-none grid-cols-3 gap-2.5 p-0" aria-label="How Ink works">
        <li className="ink-form-card flex flex-col gap-2 p-3">
          <span className="text-[var(--ot-plan)]">
            <ChatIcon size={20} />
          </span>
          <b className="text-[14px]">Your agent drafts</b>
          <span className="text-[12.5px] text-[var(--ot-text-3)]">You ask in a chat.</span>
        </li>
        <li className="ink-form-card flex flex-col gap-2 p-3">
          <Ring size={20} tone="plan" />
          <b className="text-[14px]">Ink checks it</b>
          <span className="text-[12.5px] text-[var(--ot-text-3)]">It builds the transaction.</span>
        </li>
        <li className="ink-form-card flex flex-col gap-2 p-3">
          <span className="text-[var(--ot-coral-text)]">
            <KeyIcon size={20} />
          </span>
          <b className="text-[14px]">You sign</b>
          <span className="text-[12.5px] text-[var(--ot-text-3)]">Only you can approve.</span>
        </li>
      </ul>
      <FormError message={error} />
      <div className="ink-form-card ink-form-card--hero flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <b className="text-[15px]">Create a new wallet</b>
            <span className="text-[12.5px] text-[var(--ot-text-3)]">One recovery phrase covers all seven chains.</span>
          </div>
          <Segmented
            label="Recovery phrase length"
            value={String(size)}
            onChange={(value) => onSize(value === '24' ? 24 : 12)}
            options={[
              ['12', '12 words'],
              ['24', '24 words'],
            ]}
          />
        </div>
        <ChainStack chains={['near', 'ethereum', 'solana', 'bitcoin', 'tron', 'sui', 'aptos']} />
        <Button variant="primary" size="lg" fullWidth disabled={busy} onClick={onCreate}>
          {busy ? 'Making your phrase…' : 'Create my wallet'}
        </Button>
      </div>
      <Button variant="secondary" disabled={busy} onClick={onRestore} className="self-start">
        I already have a recovery phrase
      </Button>
    </>
  )
}

function ShowWords({
  phrase,
  shown,
  onShow,
  onDone,
  onCancel,
}: {
  phrase: NewPhrase
  shown: boolean
  onShow: () => void
  onDone: () => void
  onCancel: () => void
}) {
  return (
    <>
      <WalletHeading title="Write down your recovery phrase">
        These {phrase.words.length} words are your wallet. With them you can restore it here or in another wallet.
      </WalletHeading>
      <Callout severity="caution" title="Keep them on paper, somewhere safe" compact>
        Anyone who has these words can take everything in the wallet. Don’t photograph them or store them online. Ink
        can’t show them to you again.
      </Callout>
      <div className="relative">
        <ol
          aria-label="Recovery phrase"
          aria-hidden={!shown}
          className={`ink-form-card m-0 grid list-none grid-cols-3 gap-2 p-4 ${shown ? '' : 'select-none blur-[6px]'}`}
        >
          {phrase.words.map((word, index) => (
            <li key={index} className="flex items-baseline gap-2 rounded-[8px] bg-[var(--ot-surface-2)] px-2.5 py-1.5">
              <span className="w-5 text-right font-mono text-[11px] text-[var(--ot-text-3)]">{index + 1}</span>
              <span className="font-mono text-[14px] text-[var(--ot-text)]">{shown ? word : '•••••'}</span>
            </li>
          ))}
        </ol>
        {shown ? null : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Button variant="primary" onClick={onShow}>
              <EyeIcon />
              Show the words
            </Button>
          </div>
        )}
      </div>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!shown} onClick={onDone}>
          I’ve written them down
        </Button>
      </div>
    </>
  )
}

function CheckWords({
  phrase,
  error,
  onBack,
  onDone,
}: {
  phrase: NewPhrase
  error: string | null
  onBack: () => void
  onDone: (answers: BackupAnswer[]) => void
}) {
  const [typed, setTyped] = useState<Record<number, string>>({})
  const [wrong, setWrong] = useState<number[]>([])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const asked = Object.fromEntries(phrase.check.map((index) => [index, typed[index] ?? '']))
    const mistakes = wrongAnswers(phrase.words, asked)
    setWrong(mistakes)
    if (mistakes.length === 0) onDone(typedAnswers(phrase.check, typed))
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <WalletHeading title="Check your backup">Type these words from what you wrote down, so you know your copy is right.</WalletHeading>
      <FormError message={error} />
      <div className="ink-form-card flex flex-col gap-4 p-4">
        {phrase.check.map((index, n) => (
          <Field key={index} label={`Word ${index + 1}`} error={wrong.includes(index) ? 'That’s not this word. Check your copy.' : null}>
            <Input
              mono
              autoFocus={n === 0}
              autoComplete="off"
              spellCheck={false}
              invalid={wrong.includes(index)}
              value={typed[index] ?? ''}
              onChange={(event) => setTyped({ ...typed, [index]: event.target.value })}
            />
          </Field>
        ))}
      </div>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          See the words again
        </Button>
        <Button variant="primary" type="submit" disabled={phrase.check.some((index) => !phraseWords(typed[index] ?? '').length)}>
          Continue
        </Button>
      </div>
    </form>
  )
}

function PasswordFields({ password, confirm, onPassword, onConfirm, shownError }: {
  password: string
  confirm: string
  onPassword: (value: string) => void
  onConfirm: (value: string) => void
  shownError: string | null
}) {
  return (
    <>
      <Field label="Password" hint="At least 12 characters. Ink asks for it every time it unlocks.">
        <Input type="password" autoComplete="new-password" value={password} onChange={(event) => onPassword(event.target.value)} />
      </Field>
      <Field label="Type it again" error={shownError}>
        <Input type="password" autoComplete="new-password" invalid={Boolean(shownError)} value={confirm} onChange={(event) => onConfirm(event.target.value)} />
      </Field>
    </>
  )
}

function CreatePassword({
  busy,
  error,
  onBack,
  onSubmit,
}: {
  busy: boolean
  error: string | null
  onBack: () => void
  onSubmit: (password: string) => void
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [tried, setTried] = useState(false)
  const problem = passwordProblem(password, confirm)

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        setTried(true)
        if (!problem) onSubmit(password)
      }}
    >
      <WalletHeading title="Choose a password">
        It encrypts the wallet on this computer. Nobody can reset it, but your recovery phrase can always restore the wallet.
      </WalletHeading>
      <FormError message={error} />
      <div className="ink-form-card flex flex-col gap-4 p-4">
        <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} shownError={tried ? problem : null} />
      </div>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" disabled={busy} onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? 'Encrypting your wallet…' : 'Create wallet'}
        </Button>
      </div>
    </form>
  )
}

function Restore({
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  busy: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (words: string, password: string) => void
}) {
  const [words, setWords] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [tried, setTried] = useState(false)
  const wordsProblem = phraseProblem(words)
  const problem = passwordProblem(password, confirm)

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        setTried(true)
        if (!wordsProblem && !problem) onSubmit(words, password)
      }}
    >
      <WalletHeading title="Restore your wallet">
        Type your 12 or 24 word recovery phrase, with a space between words. You’ll get the same addresses as other
        wallets that use the same paths, which most do. Some use another path for Solana and show a different address.
      </WalletHeading>
      <FormError message={error} />
      <div className="ink-form-card flex flex-col gap-4 p-4">
        <Field
          label="Recovery phrase"
          error={tried ? wordsProblem : null}
          hint={`${phraseWords(words).length} words`}
        >
          <PhraseInput autoFocus value={words} onChange={(event) => setWords(event.target.value)} aria-invalid={tried && Boolean(wordsProblem)} />
        </Field>
        <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} shownError={tried ? problem : null} />
      </div>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? 'Restoring…' : 'Restore wallet'}
        </Button>
      </div>
    </form>
  )
}
