import { Delete } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react'
import { asMinor, formatMinor, parseMinor } from '@domain/money'
import type { Minor, Rate } from '@domain/types'
import { fill, ui } from '../../copy'
import { approx } from '../../format'
import { keypadInput } from '../../kit/Keypad'

// The amount step: the typed figure, ≈ €, an optional "Available … [Max]" row and the keypad. Keys
// from a physical keyboard work while the step has focus: digits, "." (or ","), Backspace, and
// Enter for the dock's primary action (Space and Enter on a focused key still press that key).
// The value is a plain decimal string ("16.5"), parsed with parseMinor by the flow.

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const

export interface AmountStepProps {
  title: string
  value: string
  onChange: (value: string) => void
  rate: Rate
  /** The most the keypad accepts, in hundredths (the account's limit). */
  maxMinor: number
  /** "Available 247.50 BCPS"; null hides the row. */
  available: Minor | null
  /** What [Max] fills in; null hides the button. */
  max: Minor | null
  /** An error line under the figure (not enough balance). */
  error?: ReactNode
  /** Enter on the step (the dock's primary, when it is enabled). */
  onEnter?: () => void
  /** The keypad does not react (Charge with items chosen). */
  locked?: boolean
  /** Navy body (Charge). */
  onNavy?: boolean
  /** Shown under the keypad row (Charge: the chosen items). */
  children?: ReactNode
}

/** The keypad string for an amount ("16.50"), as [Max] fills it in. */
const toValue = (m: Minor): string => formatMinor(m).replaceAll(',', '')

/** The amount a keypad string stands for: 0 for an empty string ("12." counts as 12). */
export function parseAmount(value: string): Minor {
  const text = value.endsWith('.') ? value.slice(0, -1) : value
  const parsed = text === '' ? null : parseMinor(text)
  return parsed?.ok ? parsed.value : asMinor(0)
}

export function AmountStep(p: AmountStepProps) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Take the keyboard when the step opens (a phone the presenter clicked in keeps it).
    root.current?.focus({ preventScroll: true })
  }, [])

  const press = (key: string) => {
    if (p.locked) return
    p.onChange(keypadInput(p.value, key, p.maxMinor))
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (/^[0-9]$/.test(e.key)) press(e.key)
    else if (e.key === '.' || e.key === ',') press('.')
    else if (e.key === 'Backspace' || e.key === 'Delete') press('del')
    else if (e.key === 'Enter' && e.target === e.currentTarget) p.onEnter?.()
    else return
    e.preventDefault()
  }

  const minor = parseAmount(p.value)
  const onNavy = p.onNavy === true
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
      <h2 className={`pt-4 font-display text-display-m ${onNavy ? 'text-white' : 'text-navy-900'}`}>{p.title}</h2>
      <div className="flex min-h-28 flex-1 flex-col items-center justify-center">
        <p
          data-testid="amount-value"
          className={`font-display text-[52px] leading-[56px] font-semibold tracking-[-0.02em] tnum ${
            p.value === '' ? (onNavy ? 'text-navy-700' : 'text-line-300') : onNavy ? 'text-white' : 'text-navy-900'
          }`}
        >
          {p.value === '' ? '0' : p.value}
          <span
            className={`ml-2 text-[24px] font-medium tracking-normal ${onNavy ? 'text-grey-400' : 'text-grey-600'}`}
          >
            {ui.common.bcps}
          </span>
        </p>
        <p className={`mt-0.5 font-body text-body tnum ${onNavy ? 'text-line-300' : 'text-grey-600'}`}>
          {approx(minor, p.rate)}
        </p>
        {p.error && <div className="mt-2 w-full">{p.error}</div>}
      </div>
      {(p.available !== null || p.max !== null) && (
        <div
          className={`flex min-h-[53px] items-center justify-between border-t ${onNavy ? 'border-navy-700' : 'border-line-100'}`}
        >
          <p className={`font-body text-body-s tnum ${onNavy ? 'text-line-300' : 'text-grey-600'}`}>
            {p.available !== null && fill(ui.steps.available, { amount: formatMinor(p.available) })}
          </p>
          {p.max !== null && (
            <button
              type="button"
              data-testid="amount-max"
              disabled={p.locked}
              onClick={() => p.max !== null && p.onChange(toValue(p.max))}
              className="h-10 border border-navy-900 bg-surface px-4 font-display text-[15px] font-semibold text-navy-900 active:bg-line-100 disabled:opacity-40"
            >
              {ui.steps.max}
            </button>
          )}
        </div>
      )}
      {p.children}
      <div className={`grid grid-cols-3 gap-x-1 gap-y-1 pb-2 ${p.locked ? 'opacity-40' : ''}`}>
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            data-key={k}
            aria-label={k === 'del' ? ui.common.deleteKey : k}
            disabled={p.locked}
            onClick={() => press(k)}
            className={`flex h-12 items-center justify-center font-display text-[24px] font-medium tnum ${
              onNavy ? 'text-white active:bg-navy-800' : 'text-navy-900 active:bg-line-100'
            }`}
          >
            {k === 'del' ? <Delete size={26} strokeWidth={1.75} aria-hidden="true" /> : k}
          </button>
        ))}
      </div>
    </div>
  )
}
