import type { InkNote } from '../../../../shared/ipc'
import { Otto, type PoseName } from '@/components/brand/otto'
import { Callout } from '@/components/ui'

const POSE: Record<InkNote['tone'], PoseName> = { ok: 'confirmed', block: 'ink', info: 'heads-up' }

/**
 * How a plan ended, in Ink's own words: main wrote every value from the plan's fixed
 * terms and what NEAR and NEAR Intents reported, so the agent can't forge or change it.
 */
export function InkNoteCard({ note }: { note: InkNote }) {
  return (
    <Callout severity={note.tone} title={`From Ink · ${note.title}`} icon={<Otto pose={POSE[note.tone]} size={44} />} compact>
      {note.lines.map((line, index) => (
        <span key={index} className="selectable block [overflow-wrap:anywhere]">
          {line}
        </span>
      ))}
      {note.links.length > 0 ? (
        <span className="mt-1 flex flex-wrap gap-3">
          {note.links.map((link) => (
            <a key={link.url} className="underline" href={link.url} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          ))}
        </span>
      ) : null}
    </Callout>
  )
}
