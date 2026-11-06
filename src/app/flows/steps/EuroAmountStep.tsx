import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react'
import { ui } from '../../copy'
import { groupedInt } from '../../format'
import { AmountKeys, EURO_KEYS, keypadKeyOf } from './AmountStep'

// The euro amount step of Top up: whole euros only ("€50", with a "00" key and no decimal point),
// the BCPS it gives under it and a grey line under that ("No top-up fee"). Keys from a physical
// keyboard work while the step has focus: digits, Backspace, and Enter for the dock's primary action.
// The value is a plain digit string ("50").

/** Digits the keypad accepts: enough for the largest limit (€100,000) and one more, so a figure over the limit is typed and then refused in words. */
const MAX_DIGITS = 6

/** Applies one key to the digits typed so far, or returns them unchanged when the key does not fit. */
export function euroInput(value: string, key: string): string {
  if (key === 'del') return value.slice(0, -1)
  if (key !== '00' && !/^[0-9]$/.test(key)) return value
  // No leading zero: an empty field takes no 0 or 00.
  if (value === '' && /^0+$/.test(key)) return value
  const next = value + key
  return next.length > MAX_DIGITS ? value : next
}

/** The whole euros a digit string stands for (0 for an empty one). */
export const parseEuros = (value: string): number => (value === '' ? 0 : Number.parseInt(value, 10))

export function EuroAmountStep({
  title,
  value,
  onChange,
  youGet,
  hint,
  error,
  onEnter,
}: {
  title: string
  value: string
  onChange: (value: string) => void
  /** "You get 55.00 BCPS". */
  youGet: string
  /** The grey line over the keypad ("No top-up fee"). */
  hint: string
  /** An error line under the figure (over the limit). */
  error?: ReactNode
  /** Enter on the step (the dock's primary, when it is enabled). */
  onEnter?: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Take the keyboard when the step opens (a phone the presenter clicked in keeps it).
    root.current?.focus({ preventScroll: true })
  }, [])

  const press = (key: string) => onChange(euroInput(value, key))
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const key = keypadKeyOf(e)
    if (key !== null) press(key)
    else if (e.key === 'Enter' && e.target === e.currentTarget && !e.ctrlKey && !e.metaKey && !e.altKey) onEnter?.()
    else return
    e.preventDefault()
  }

  const eur = parseEuros(value)
  return (
    // biome-ignore lint/a11y/useSemanticElements: a keypad region that takes keyboard input; a fieldset would draw a box
    <div
      ref={root}
      role="group"
      aria-label={ui.steps.keypad}
      tabIndex={-1}
      data-keypad
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 flex-col px-5 outline-none"
    >
      <h2 className="pt-4 font-display text-display-m text-navy-900">{title}</h2>
      <div className="flex min-h-28 flex-1 flex-col items-center justify-center">
        <p
          data-testid="amount-value"
          className={`font-display text-[52px] leading-[56px] font-semibold tracking-[-0.02em] tnum ${
            value === '' ? 'text-line-300' : 'text-navy-900'
          }`}
        >
          €{groupedInt(eur)}
        </p>
        <p data-testid="top-up-get" className="mt-0.5 font-body text-body text-grey-600 tnum">
          {youGet}
        </p>
        {error && <div className="mt-2 w-full">{error}</div>}
      </div>
      <div className="flex min-h-[53px] items-center border-t border-line-100" data-testid="amount-hint">
        <p className="font-body text-body-s text-grey-600">{hint}</p>
      </div>
      <AmountKeys onPress={press} keys={EURO_KEYS} />
    </div>
  )
}
