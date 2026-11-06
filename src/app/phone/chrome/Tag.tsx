import type { ReactNode } from 'react'

// Two small status marks. `Tag` is the bordered, spaced capitals that sit in a row (PENDING,
// DECLINED); `StatusChip` is the filled line under an amount on a detail ("Waiting",
// "Paid by @marko ✓").

type Tone = 'warning' | 'danger' | 'neutral' | 'success'

const TAG: Record<Tone, string> = {
  warning: 'border-warning text-warning',
  danger: 'border-danger text-danger',
  neutral: 'border-grey-500 text-grey-600',
  success: 'border-green-700 text-green-700',
}

export function Tag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`shrink-0 border bg-surface px-[7px] py-[3px] font-body text-[11px] leading-[14px] font-semibold tracking-[0.08em] ${TAG[tone]}`}
    >
      {children}
    </span>
  )
}

const CHIP: Record<Exclude<Tone, 'warning'>, string> = {
  neutral: 'bg-line-100 text-ink',
  success: 'bg-green-50 text-green-700',
  danger: 'bg-line-100 text-danger',
}

export function StatusChip({
  tone,
  children,
  testId = 'status-chip',
}: {
  tone: Exclude<Tone, 'warning'>
  children: ReactNode
  testId?: string
}) {
  return (
    <p
      data-testid={testId}
      className={`inline-flex min-h-7 w-fit items-center px-2.5 font-body text-caption font-semibold ${CHIP[tone]}`}
    >
      {children}
    </p>
  )
}

/** A soft green tag without a border: "REFUNDED ✓" on a sale that was refunded. */
export function DoneTag({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 bg-green-50 px-[7px] py-[3px] font-body text-[11px] leading-[14px] font-semibold tracking-[0.08em] text-green-700">
      {children}
    </span>
  )
}
