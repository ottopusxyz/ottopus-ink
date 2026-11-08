import type { ChatPlan } from '../../../../shared/ipc'
import { Card, StatusChip } from '@/components/ui'
import { planHeadline } from '@/lib/chats'

/**
 * A plan an agent proposed. It says plainly that it can't go anywhere yet: the
 * review window and signer come with the wallet, so there is nothing to press.
 *
 * The agent wrote every value here, and they're shown as written. That includes
 * the address in full, since a shortened one hides what a person needs to compare.
 */
export function PlanCard({ plan }: { plan: ChatPlan }) {
  const details = [
    ['On', plan.chain],
    ['To', plan.to],
    ['Arriving on', plan.toChain],
  ].filter((row): row is [string, string] => row[1] !== null)

  return (
    <Card className="ink-plan-card">
      <div className="flex items-center justify-between gap-2">
        <span className="ink-eyebrow">Plan</span>
        <StatusChip status={plan.status} />
      </div>
      <p className="selectable m-0 text-[15px] leading-[1.35] font-semibold [overflow-wrap:anywhere]">{planHeadline(plan)}</p>
      {details.length > 0 ? (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
          {details.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-[var(--ot-text-3)]">{label}</dt>
              <dd className="selectable m-0 min-w-0 font-mono [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="m-0 text-[12.5px] leading-[1.45] text-[var(--ot-text-2)]">
        A placeholder: Ink can’t review or sign plans yet.
      </p>
    </Card>
  )
}
