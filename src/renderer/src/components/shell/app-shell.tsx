import type { ReactNode } from 'react'
import { OttoBadge } from '@/components/brand/otto-badge'
import { Badge } from '@/components/ui'
import { cn } from '@/lib/cn'

export interface AppShellProps {
  mac: boolean
  /** Left out while there's no wallet or it's locked: those screens are the whole window. */
  sidebar?: ReactNode
  children: ReactNode
}

/**
 * The window frame: a brand strip over a floating sidebar and the page. On
 * macOS the strip clears the inset traffic lights and drags the window;
 * elsewhere the OS draws its own title bar above it.
 */
export function AppShell({ mac, sidebar, children }: AppShellProps) {
  return (
    <div className={cn('ink-shell', mac && 'ink-shell--mac')}>
      <header className="ink-brandbar">
        <OttoBadge size={22} />
        <span className="font-display text-[16px] font-bold tracking-[-0.02em]">Ottopus Ink</span>
        <Badge tone="coral" className="px-2 py-[3px] text-[10.5px] font-bold">
          NEAR hackathon build
        </Badge>
      </header>
      <div className="ink-body">
        {sidebar ?? null}
        {children}
      </div>
    </div>
  )
}
