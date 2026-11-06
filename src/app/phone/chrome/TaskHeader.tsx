import { ChevronLeft, House } from 'lucide-react'
import { ui } from '../../copy'

// The top task header (D27): "‹ Back" left, the title centred, "⌂ Home" right, 48 px targets.
// Light on people's screens; navy on every business screen (the business name in small caps
// under the title) and on Scan, PAID and success screens. Success screens show only the
// overline (PAID, SENT …) at the left and Home at the right.

export type HeaderTone = 'light' | 'navy' | 'business' | 'navy800'

const TARGET = 'inline-flex h-12 items-center gap-1 font-body text-body font-medium disabled:opacity-40'

export interface TaskHeaderProps {
  tone: HeaderTone
  title?: string
  /** Business screens: shown in small caps under the title. */
  businessName?: string
  /** Success screens: replaces Back and the title. */
  overline?: string
  overlineTone?: 'green' | 'muted'
  onBack?: (() => void) | null
  onHome?: (() => void) | null
  backDisabled?: boolean
  homeDisabled?: boolean
}

export function TaskHeader({
  tone,
  title,
  businessName,
  overline,
  overlineTone = 'green',
  onBack,
  onHome,
  backDisabled = false,
  homeDisabled = false,
}: TaskHeaderProps) {
  const navy = tone !== 'light'
  return (
    <header
      className={`grid h-14 shrink-0 grid-cols-[100px_1fr_100px] items-center px-1 ${
        navy
          ? `on-navy text-white ${tone === 'navy800' ? 'bg-navy-800' : 'bg-navy-900'} ${
              tone === 'business' || (tone === 'navy' && !overline) ? 'border-b border-navy-700' : ''
            }`
          : 'border-b border-line-200 bg-bg text-navy-900'
      }`}
    >
      {overline ? (
        <p
          className={`col-span-2 pl-4 font-body text-overline font-semibold uppercase ${
            overlineTone === 'green' ? 'text-green-500' : 'text-line-300'
          }`}
        >
          {overline}
        </p>
      ) : (
        <>
          {onBack ? (
            <button
              type="button"
              data-testid="nav-back"
              onClick={onBack}
              disabled={backDisabled}
              className={`${TARGET} justify-self-start pr-2 pl-1`}
            >
              <ChevronLeft size={22} strokeWidth={1.75} aria-hidden="true" />
              {ui.nav.back}
            </button>
          ) : (
            <span />
          )}
          <div className="min-w-0 text-center">
            <h1 className="truncate font-display text-[17px] leading-[22px] font-semibold">{title}</h1>
            {tone === 'business' && businessName && (
              <p className="truncate font-body text-[11px] leading-[14px] font-semibold uppercase tracking-[0.14em] text-green-500">
                {businessName}
              </p>
            )}
          </div>
        </>
      )}
      {onHome ? (
        <button
          type="button"
          data-testid="nav-home"
          onClick={onHome}
          disabled={homeDisabled}
          className={`${TARGET} justify-self-end pr-1.5 pl-2`}
        >
          <House size={22} strokeWidth={1.75} aria-hidden="true" />
          {ui.nav.home}
        </button>
      ) : (
        <span />
      )}
    </header>
  )
}
