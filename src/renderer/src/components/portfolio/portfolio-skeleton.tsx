import { Otto } from '@/components/brand/otto'
import { cn } from '@/lib/cn'

/** A grey shape where a figure will be. */
export function Bone({ className }: { className?: string }) {
  return <span className={cn('ink-skeleton', className)} aria-hidden />
}

const ROWS = [0, 1, 2, 3, 4]

/**
 * The Portfolio screen while its first read runs, shaped like the real thing so
 * nothing jumps when the figures land: the total with Otto counting coins, the
 * share bar, and a few asset rows.
 */
export function PortfolioSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-live="polite" aria-busy>
      <span className="sr-only">Reading your balances</span>
      <div className="flex flex-wrap items-stretch gap-3.5 pt-5">
        <section className="ink-review-card ink-review-card--stk relative min-w-0 flex-[2_1_420px] px-5 py-[18px]">
          <span className="pointer-events-none absolute -top-9 right-3.5">
            <Otto pose="planning" size={104} animated label="Otto counting your coins" />
          </span>
          <span className="ink-eyebrow">Everything you hold</span>
          <div className="mt-2.5 mb-3.5 flex flex-wrap items-center gap-3">
            <Bone className="h-10 w-[210px]" />
            <span className="text-[12.5px] text-[var(--ot-text-3)]">Otto is counting your coins…</span>
          </div>
          <Bone className="ink-skeleton--round h-3.5 w-full" />
          <div className="mt-3 flex gap-3">
            {[64, 56, 72, 48].map((width) => (
              <span key={width} style={{ width }}>
                <Bone className="ink-skeleton--round h-3" />
              </span>
            ))}
          </div>
        </section>
        <section className="ink-glance flex-[1_1_220px] gap-2.5 p-4">
          <span className="ink-eyebrow">Ask your agent</span>
          <Bone className="ink-skeleton--round h-9 w-full" />
          <Bone className="ink-skeleton--round h-9 w-full" />
          <Bone className="ink-skeleton--round mt-auto h-9 w-full" />
        </section>
      </div>
      <div className="flex gap-1.5">
        {[96, 78, 70, 88].map((width) => (
          <span key={width} style={{ width }}>
            <Bone className="ink-skeleton--round h-[34px]" />
          </span>
        ))}
      </div>
      <section className="ink-review-card overflow-hidden p-0">
        <div className="border-b-[1.5px] border-[var(--ot-border)] px-4 py-2.5">
          <Bone className="h-3 w-40" />
        </div>
        {ROWS.map((row) => (
          <div key={row} className="flex items-center gap-3 border-b border-[var(--ot-border)] px-4 py-3 last:border-b-0" style={{ opacity: 1 - row * 0.15 }}>
            <Bone className="ink-skeleton--round size-8 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Bone className="h-3.5 w-20" />
              <Bone className="h-3 w-28" />
            </span>
            <Bone className="h-3.5 w-24" />
            <Bone className="h-3.5 w-20" />
            <Bone className="ink-skeleton--round h-[30px] w-[130px]" />
          </div>
        ))}
      </section>
    </div>
  )
}
