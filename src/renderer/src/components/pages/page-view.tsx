import { EmptyState } from '@/components/ui'
import { Sea } from '@/components/motion/sea'
import type { PageId } from '@/components/shell/nav'

/** Receive and Portfolio have views of their own. */
export type PlaceholderPage = Exclude<PageId, 'receive' | 'portfolio'>

const COPY: Record<PlaceholderPage, { title: string; empty: string; description: string }> = {
  activity: {
    title: 'Activity',
    empty: 'Nothing yet',
    description: 'Every plan you approve and every step of it, tracked until it lands.',
  },
}

/** The pages that are not a chat. Each fills in with its milestone. */
export function PageView({ page }: { page: PlaceholderPage }) {
  const copy = COPY[page]
  return (
    <main className="ink-panel" id="main">
      <Sea shafts={false} />
      <div className="ink-panel__scroll flex flex-col gap-6 px-7 py-6">
        <h1 className="m-0 font-display text-[26px] font-bold tracking-[-0.02em]">{copy.title}</h1>
        <EmptyState className="mt-6" title={copy.empty} description={copy.description} />
      </div>
    </main>
  )
}
