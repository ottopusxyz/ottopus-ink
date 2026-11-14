import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { ExternalItem } from '../../../../shared/ipc'
import { Badge, Button, Callout, Input } from '@/components/ui'
import { SignInIcon } from './sign-in-icon'
import { agentInfo } from '@/lib/agents'
import { ipcErrorText } from '@/lib/chats'
import { filterExternal, groupExternal, KIND_LABELS, serverFromForm } from '@/lib/external-tools'

export interface ToolsTabProps {
  /** Called with the list whenever it changes, so the composer can say what's on. */
  onChange: (items: ExternalItem[]) => void
}

const EMPTY_FORM = { name: '', target: '', args: '', envNames: '' }

/**
 * Skills, MCP servers and plugins a new chat could use, beyond Ink's own tools.
 * Only what's shipped with Ink starts on. This page can only ask: turning anything
 * else on, or adding one, is decided in a native dialog from the main process.
 */
export function ToolsTab({ onChange }: ToolsTabProps) {
  const [items, setItems] = useState<ExternalItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [signingIn, setSigningIn] = useState<string | null>(null)

  const accept = (next: ExternalItem[]) => {
    setItems(next)
    onChange(next)
  }

  /** Runs one request at a time: a native dialog can be open for as long as it takes. */
  const request = async (ask: () => Promise<ExternalItem[]>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      accept(await ask())
      return true
    } catch (caught) {
      setError(ipcErrorText(caught))
      return false
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let current = true
    window.ink.listExternalTools().then(
      (next) => {
        if (!current) return
        setItems(next)
        onChange(next)
      },
      (caught: unknown) => {
        if (current) setError(ipcErrorText(caught))
      },
    )
    return () => {
      current = false
    }
  }, [onChange])

  const signIn = async (id: string) => {
    setSigningIn(id)
    await request(() => window.ink.signInExternal(id))
    setSigningIn(null)
  }

  const groups = useMemo(() => groupExternal(filterExternal(items ?? [], query)), [items, query])

  const add = async (event: FormEvent) => {
    event.preventDefault()
    const server = serverFromForm(form)
    if (await request(() => window.ink.addExternalServer(server))) setForm(EMPTY_FORM)
  }

  return (
    <>
      <h2 className="m-0 font-display text-[22px] font-bold tracking-[-0.02em]">Tools and skills</h2>
      <p className="mt-1.5 mb-3.5 text-[13px] text-[var(--ot-text-2)]">
        What new chats can use beyond Ottopus tools. Changes apply to new chats, not ones already open.
      </p>

      <Callout severity="caution" title="These can act outside Ink" className="mb-4">
        Ink can't see what an outside tool does. One that holds its own keys could move funds with no review or signature in Ink, and any of them
        could send out what your agent reads. A program runs as you, with your access to this computer. Only turn on what you'd trust as an installed
        program.
      </Callout>

      {error ? (
        <Callout severity="block" title="That didn't work" className="mb-4" compact>
          {error}
        </Callout>
      ) : null}

      {items === null ? (
        <p className="m-0 text-[13px] text-[var(--ot-text-2)]">{error ? null : 'Looking through your agents…'}</p>
      ) : (
        <>
          {items.length > 0 ? (
            <label className="mb-1 block">
              <span className="sr-only">Search tools and skills</span>
              <Input type="search" placeholder="Search tools and skills" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
          ) : (
            <p className="m-0 text-[13px] text-[var(--ot-text-2)]">Ink didn't find any in your agents, and none are added yet.</p>
          )}
          {items.length > 0 && groups.length === 0 ? <p className="mt-3 text-[13px] text-[var(--ot-text-2)]">Nothing matches.</p> : null}
          {groups.map((group) => (
            <section key={group.source} className="mt-4">
              <h3 className="mt-0 mb-2 text-[14px] font-semibold">{group.title}</h3>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {group.items.map((item) => (
                  <ExternalRow
                    key={item.id}
                    item={item}
                    busy={busy}
                    signingIn={signingIn === item.id}
                    onSignIn={() => void signIn(item.id)}
                    onCancelSignIn={() => void window.ink.cancelExternalSignIn()}
                    onSignOut={() => void request(() => window.ink.signOutExternal(item.id))}
                    onToggle={() => void request(() => window.ink.setExternalEnabled(item.id, !item.enabled))}
                    onRemove={() => void request(() => window.ink.removeExternalServer(item.id))}
                  />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      <form className="mt-5 flex flex-col gap-2 border-t border-[var(--ot-border)] pt-4" onSubmit={(event) => void add(event)}>
        <h3 className="m-0 text-[14px] font-semibold">Add an MCP server</h3>
        <p className="m-0 text-[12.5px] leading-[1.45] text-[var(--ot-text-2)]">
          It stays off until you turn it on. Don't write a key into the address or arguments, where it would be saved: give the names of environment variables instead, and Ink reads them from your shell when a chat starts.
        </p>
        <FormField label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} placeholder="near-tools" />
        <FormField
          label="Command or address"
          value={form.target}
          onChange={(target) => setForm({ ...form, target })}
          placeholder="/usr/local/bin/near-mcp or https://…"
          mono
        />
        <FormField label="Arguments" value={form.args} onChange={(args) => setForm({ ...form, args })} placeholder="--network mainnet" mono />
        <FormField
          label="Environment variable names"
          value={form.envNames}
          onChange={(envNames) => setForm({ ...form, envNames })}
          placeholder="NEAR_API_KEY"
          mono
        />
        <div>
          <Button size="sm" type="submit" disabled={busy || !form.name.trim() || !form.target.trim()}>
            Add
          </Button>
        </div>
      </form>
    </>
  )
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  mono = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  mono?: boolean
}) {
  return (
    <label className="flex flex-col gap-1 text-[12.5px] text-[var(--ot-text-2)]">
      {label}
      <Input mono={mono} value={value} placeholder={placeholder} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function ExternalRow({
  item,
  busy,
  signingIn,
  onSignIn,
  onCancelSignIn,
  onSignOut,
  onToggle,
  onRemove,
}: {
  item: ExternalItem
  busy: boolean
  signingIn: boolean
  onSignIn: () => void
  onCancelSignIn: () => void
  onSignOut: () => void
  onToggle: () => void
  onRemove: () => void
}) {
  const detail = item.description ?? item.summary
  return (
    <li className="ink-external">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <b className="text-[14px] font-semibold [overflow-wrap:anywhere]">{item.name}</b>
          <Badge>{KIND_LABELS[item.kind]}</Badge>
          {item.origin ? <Badge>{agentInfo(item.origin).name}</Badge> : null}
          {item.mayMoveFunds ? <Badge tone="warn">May move funds</Badge> : null}
          {item.changed ? <Badge tone="warn">Changed, so turned off</Badge> : null}
          <SignInIcon names={item.needsSignIn ? [item.name] : []} />
        </span>
        {detail ? <span className="selectable mt-1 block text-[12.5px] leading-[1.45] text-[var(--ot-text-2)]">{detail}</span> : null}
        {item.description && item.summary ? (
          <span className="selectable mt-0.5 block text-[12px] leading-[1.45] text-[var(--ot-text-3)]">{item.summary}</span>
        ) : null}
        {item.unavailable ? <span className="mt-1 block text-[12.5px] leading-[1.45] text-[var(--ot-warn-text)]">{item.unavailable}</span> : null}
      </span>
      {signingIn ? (
        <>
          <span className="self-center text-[12.5px] text-[var(--ot-text-2)]" role="status">
            Waiting for your browser…
          </span>
          <Button size="sm" onClick={onCancelSignIn}>
            Cancel
          </Button>
        </>
      ) : item.needsSignIn ? (
        <Button size="sm" disabled={busy} onClick={onSignIn} aria-label={`Sign in to ${item.name}`}>
          Sign in
        </Button>
      ) : item.signedIn ? (
        <Button size="sm" disabled={busy} onClick={onSignOut} aria-label={`Sign out of ${item.name}`}>
          Sign out
        </Button>
      ) : null}
      {item.source === 'added' ? (
        <Button size="sm" disabled={busy} onClick={onRemove} aria-label={`Remove ${item.name}`}>
          Remove
        </Button>
      ) : null}
      <button
        type="button"
        role="switch"
        className="ink-switch"
        aria-checked={item.enabled}
        aria-label={`Use ${item.name} in new chats`}
        disabled={busy || item.unavailable !== null}
        onClick={onToggle}
      >
        <span />
      </button>
    </li>
  )
}
