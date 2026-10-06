import { ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { SwitchTrack } from './Switch'

// List rows (hubs and lists): an icon square (or a custom leading element), a bold label, a grey
// sub-line and a chevron. 53 px tall, hairline between rows.

export function ListRow({
  icon: Icon,
  leading,
  label,
  sub,
  right,
  onPress,
  testId,
}: {
  icon?: LucideIcon
  /** Replaces the icon square (an avatar). */
  leading?: ReactNode
  label: ReactNode
  sub?: ReactNode
  /** Amount and status at the right, before the chevron. */
  right?: ReactNode
  onPress: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onPress}
      className="flex min-h-[53px] w-full items-center gap-3 border-b border-line-100 py-2 text-left active:bg-line-100"
    >
      {leading ??
        (Icon && (
          <span className="flex size-10 shrink-0 items-center justify-center bg-green-50 text-green-700">
            <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
          </span>
        ))}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-body font-semibold text-navy-900">{label}</span>
        {sub && <span className="block truncate font-body text-caption text-grey-600">{sub}</span>}
      </span>
      {right}
      <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink" />
    </button>
  )
}

/** A list section heading: small caps over a 24 × 3 green bar ("TO PAY", "TODAY"). */
export function ListSection({ children }: { children: ReactNode }) {
  return (
    <div className="pt-3 pb-1">
      <h2 className="font-display text-[13px] leading-4 font-semibold uppercase tracking-[0.14em] text-navy-900">
        {children}
      </h2>
      <span aria-hidden="true" className="mt-1.5 block h-[3px] w-6 bg-green-600" />
    </div>
  )
}

const ICON_SQUARE = 'flex size-10 shrink-0 items-center justify-center bg-green-50 text-green-700'

/** A row that opens nothing: an icon square, a label, a grey line under it and what stands at the right. */
export function StaticRow({
  icon: Icon,
  label,
  sub,
  right,
  testId,
}: {
  icon: LucideIcon
  label: ReactNode
  sub?: ReactNode
  right?: ReactNode
  testId?: string
}) {
  return (
    <div data-testid={testId} className="flex min-h-[53px] w-full items-center gap-3 border-b border-line-100 py-2">
      <span className={ICON_SQUARE}>
        <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-body font-semibold text-navy-900">{label}</span>
        {sub && <span className="block truncate font-body text-caption text-grey-600">{sub}</span>}
      </span>
      {right}
    </div>
  )
}

/** A row with an on/off switch at the right; the whole row is the button. */
export function SwitchRow({
  icon: Icon,
  label,
  on,
  onChange,
  testId,
}: {
  icon: LucideIcon
  label: string
  on: boolean
  onChange: (on: boolean) => void
  testId: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className="flex min-h-[53px] w-full items-center gap-3 border-b border-line-100 py-2 text-left"
    >
      <span className={ICON_SQUARE}>
        <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate font-body text-body font-semibold text-navy-900">{label}</span>
      <SwitchTrack on={on} />
    </button>
  )
}
