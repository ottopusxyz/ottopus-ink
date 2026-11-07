import type { ReactNode, SVGProps } from 'react'

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number
}

/** A 24-unit stroke icon. Decorative unless given an aria-label. */
function icon(paths: ReactNode, strokeWidth = 1.75) {
  return function Icon({ size = 16, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={props['aria-label'] ? undefined : true}
        role={props['aria-label'] ? 'img' : undefined}
        className="flex-none"
        {...props}
      >
        {paths}
      </svg>
    )
  }
}

export const StopIcon = icon(<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />)
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />, 2)
export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.5-4.5" />
  </>,
)
export const ChatIcon = icon(<path d="M4 5h16v11H9l-5 4z" />)
export const CheckIcon = icon(<path d="m5 12 5 5 9-10" />, 2.25)
export const WalletIcon = icon(
  <>
    <rect x="3" y="6" width="18" height="14" rx="2.5" />
    <path d="M3 10h18M16 15h2" />
  </>,
)
export const ActivityIcon = icon(<path d="M3 12h4l3-7 4 14 3-7h4" />)
export const SlidersIcon = icon(
  <>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </>,
)
export const ShieldIcon = icon(
  <>
    <path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </>,
  2,
)
export const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />, 2)
export const ArrowUpIcon = icon(<path d="M12 19V5M6 11l6-6 6 6" />, 2.25)
export const KeyIcon = icon(
  <>
    <circle cx="8" cy="16" r="4.5" />
    <path d="m11.2 12.8 8.3-8.3M16 8l3 3" />
  </>,
)
export const PlugIcon = icon(<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5" />, 2)
export const SidebarIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M9 4v16" />
  </>,
)
export const SwapIcon = icon(<path d="M4 8h14l-3-3M20 16H6l3 3" />)
export const ArrowRightIcon = icon(<path d="M5 12h14M13 6l6 6-6 6" />)
export const StakeIcon = icon(<path d="M12 3v18M6 9l6-6 6 6" />)
export const CloseIcon = icon(<path d="M7 7l10 10M17 7 7 17" />)
export const ListIcon = icon(<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />)
export const LockIcon = icon(
  <>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>,
)
export const CopyIcon = icon(
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
  </>,
)
export const QrIcon = icon(
  <>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h.01M18 14h2" />
  </>,
)
export const ReceiveIcon = icon(<path d="M12 4v12M6 10l6 6 6-6M5 20h14" />)
export const EyeIcon = icon(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
)
