import { Button, EmptyState } from '@/components/ui'
import { Sea } from '@/components/motion/sea'
import { SEA_LIFE } from '@/components/motion/sea-life'
import type { PageId } from '@/components/shell/nav'

/** Receive has a view of its own. */
export type PlaceholderPage = Exclude<PageId, 'receive'>

const COPY: Record<PlaceholderPage, { title: string; empty: string; description: string }> = {
  portfolio: {
    title: 'Portfolio',
    empty: 'No balances yet',
    description: 'Balances on every chain and what you hold in NEAR Intents show here as each chain lands.',
  },
  activity: {
    title: 'Activity',
    empty: 'Nothing yet',
    description: 'Every plan you approve and every step of it, tracked until it lands.',
  },
}

/** The pages that are not a chat. Each fills in with its milestone. */
export function PageView({ page, onReceive }: { page: PlaceholderPage; onReceive: () => void }) {
  const copy = COPY[page]
  return (
    <main className="ink-panel" id="main">
      <Sea creatures={SEA_LIFE} shafts={false} />
      <div className="ink-panel__scroll flex flex-col gap-6 px-7 py-6">
        <h1 className="m-0 font-display text-[26px] font-bold tracking-[-0.02em]">{copy.title}</h1>
        <EmptyState
          className="mt-6"
          title={copy.empty}
          description={copy.description}
          action={
            page === 'portfolio' ? (
              <Button variant="secondary" onClick={onReceive}>
                Your addresses
              </Button>
            ) : undefined
          }
        />
      </div>
    </main>
  )
}
