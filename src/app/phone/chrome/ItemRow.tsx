import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatMinor } from '@domain/money'
import type { Minor } from '@domain/types'
import { ui } from '../../copy'

// One thing on a list that has an amount: who or what it is, a line under it, a tag when it has
// closed, and the amount over BCPS at the right (Pay & request, History's requests and links).

/** A green icon square for a row that is not a person (a payment link, a split, a top-up). */
export function IconSquare({ icon: Icon, size = 40 }: { icon: LucideIcon; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center bg-green-50 text-green-700"
      style={{ width: size, height: size }}
    >
      <Icon size={20} strokeWidth={1.75} />
    </span>
  )
}

export function ItemRow({
  leading,
  title,
  sub,
  amount,
  tag,
  onPress,
  testId,
}: {
  leading: ReactNode
  title: string
  sub: string
  amount: Minor
  tag?: ReactNode
  onPress: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onPress}
      className="flex min-h-[61px] w-full items-center gap-3 border-b border-line-100 py-2 text-left active:bg-line-100"
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-body font-semibold text-navy-900">{title}</span>
        <span className="block truncate font-body text-body-s text-grey-600">{sub}</span>
      </span>
      {tag}
      <span className="shrink-0 text-right tnum">
        <span className="block font-body text-body font-semibold text-navy-900">{formatMinor(amount)}</span>
        <span className="block font-body text-caption text-grey-600">{ui.common.bcps}</span>
      </span>
    </button>
  )
}
