import type { Account } from '../../shared/accounts'
import type { PlanIntent, PlanSummary, PlanToolResult, PlanTools } from '../../shared/plan'
import type { VaultResult } from '../../shared/vault'
import type { PlanStore, PlanView } from './store'

export interface AgentPlanContext {
  store: PlanStore
  /** The chat's session: only it may see and cancel the plans it made. */
  owner: string
  /** The person's own messages in that chat, as main captured them from the page. */
  typed: () => readonly string[]
  /** The person's own addresses, which need the vault unlocked. */
  accounts: () => Promise<VaultResult<{ accounts: Account[] }>>
}

const summaryOf = ({ id, status, core }: PlanView): PlanSummary => ({
  id,
  status,
  summary: core.summary,
  intent: core.intent,
  recipient: core.recipient,
})

/**
 * The plan tools for one agent chat. Main decides everything that matters here:
 * the plan is marked as the agent's, it belongs to this chat, and only the
 * person's own addresses or ones they typed can be paid.
 */
export function agentPlanTools({ store, owner, typed, accounts }: AgentPlanContext): PlanTools {
  return {
    async create(intent: PlanIntent): Promise<PlanToolResult> {
      let own: VaultResult<{ accounts: Account[] }>
      try {
        own = await accounts()
      } catch {
        return { ok: false, reason: 'unavailable' }
      }
      if (!own.ok) return { ok: false, reason: own.reason === 'no-vault' ? 'no-vault' : own.reason === 'locked' ? 'locked' : 'unavailable' }
      const made = store.create({ intent, createdBy: 'agent', owner, own: own.accounts, typed: typed() })
      return made.ok ? { ok: true, plan: summaryOf(made.plan) } : made
    },

    async get(id: string): Promise<PlanToolResult> {
      const plan = store.get(id, owner)
      return plan ? { ok: true, plan: summaryOf(plan) } : { ok: false, reason: 'not-found' }
    },

    async cancel(id: string): Promise<PlanToolResult> {
      const moved = store.move(id, owner, 'cancelled')
      return moved.ok ? { ok: true, plan: summaryOf(moved.plan) } : moved
    },
  }
}
