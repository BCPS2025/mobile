import { Check, ScanFace } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { ui } from '../../copy'
import { useReducedMotion } from '../../state/motion'

// The dock: the bottom 84 px of a task screen, never scrolling away. Variants (D27):
//   single button · text link + button · two buttons (outline + fill) · three stacked.
// Button states: default, pressed, disabled and "Sending…" (with the biometric glyph inside the
// button while a payment is pending; a static tick with reduced motion). Green means money moves
// (and the café's Charge); navy is every other primary; white on navy docks.
//
// A flow step's dock (`settle`) ignores presses for a moment after it appears (SETTLE_MS): the
// next step's button sits where the last one was, so the second tap of a double tap (or a
// repeated Enter) would otherwise press it, for example paying straight past a review. The
// buttons look the same meanwhile and read as aria-disabled. The flow gives its dock a new `key`
// whenever the dock's buttons start doing something else, so the guard starts again and focus
// never carries over.

/** How long a new dock ignores presses. */
export const SETTLE_MS = 450

/** With `settle`, false for the first SETTLE_MS after the dock mounts; otherwise always true. */
function useSettled(settle: boolean): boolean {
  const [settled, setSettled] = useState(!settle)
  useEffect(() => {
    if (!settle) return
    const id = window.setTimeout(() => setSettled(true), SETTLE_MS)
    return () => window.clearTimeout(id)
  }, [settle])
  return settled
}

/** Props that hold a button still while its dock settles. */
function settleProps(settled: boolean, onPress: () => void) {
  return {
    'aria-disabled': settled ? undefined : (true as const),
    onClick: () => {
      if (settled) onPress()
    },
  }
}

export type ButtonTone = 'money' | 'navy' | 'white' | 'outline'

export interface DockPrimary {
  label: string
  tone: ButtonTone
  /** Default true. */
  enabled?: boolean
  /** A commit is in flight: the label reads "Sending…" and the button does not react. */
  sending?: boolean
  /** While `sending`, keep the label instead of "Sending…" (the glyph still shows: Log in with biometrics). */
  keepLabel?: boolean
  onPress: () => void
  icon?: ReactNode
}

export interface DockSecondary {
  /** `link`: a text link beside the button; `outline`: an outline button beside it. */
  kind: 'link' | 'outline'
  label: string
  onPress: () => void
  disabled?: boolean
  /** An outline button as wide as its label, leaving the rest to the primary (a long primary label). */
  fit?: boolean
}

export interface StackItem {
  label: string
  kind: 'white' | 'outline'
  onPress: () => void
  icon?: ReactNode
  disabled?: boolean
  sending?: boolean
  /** While `sending`, keep the label instead of "Sending…". */
  keepLabel?: boolean
}

const BASE =
  'flex h-13 min-h-13 w-full min-w-0 items-center justify-center gap-2.5 px-4 font-display text-button transition-[filter,background-color] duration-(--dur-press)'

const TONES: Record<ButtonTone, string> = {
  money:
    'bg-green-500 text-navy-900 active:ring-[3px] active:ring-navy-900 active:ring-inset disabled:bg-line-200 disabled:text-grey-500 disabled:ring-0',
  navy: 'bg-navy-900 text-white active:bg-navy-700 disabled:bg-line-200 disabled:text-grey-500',
  // White buttons sit on navy docks: disabled, they sink into the dock (navy-700, grey text).
  white: 'bg-white text-navy-900 active:bg-line-100 disabled:bg-navy-700 disabled:text-grey-400',
  // A bordered button on a navy dock (the café's Cancel).
  outline: 'border border-line-300 text-white active:bg-navy-800 disabled:opacity-40',
}

/** A button that is sending keeps its own colours, a little faded (the disabled colours would grey it out). */
const SENDING: Record<ButtonTone, string> = {
  money: 'bg-green-500 text-navy-900 opacity-80',
  navy: 'bg-navy-900 text-white opacity-80',
  white: 'bg-white text-navy-900 opacity-80',
  outline: 'border border-line-300 text-white opacity-80',
}

/** The glyph shown inside a button while its payment is pending. */
function SendingGlyph() {
  const reduced = useReducedMotion()
  return reduced ? (
    <Check size={20} strokeWidth={2.5} aria-hidden="true" />
  ) : (
    <ScanFace size={20} strokeWidth={1.75} aria-hidden="true" className="anim-pending" />
  )
}

export function DockButton({
  primary,
  testId = 'dock-primary',
  onNavy = false,
  settled = true,
}: {
  primary: DockPrimary
  testId?: string
  onNavy?: boolean
  /** False while the dock around it settles: presses are ignored. */
  settled?: boolean
}) {
  const { label, tone, enabled = true, sending = false, keepLabel = false, onPress, icon } = primary
  return (
    <button
      type="button"
      data-testid={testId}
      aria-busy={sending || undefined}
      disabled={!enabled || sending}
      {...settleProps(settled, onPress)}
      className={`${BASE} ${sending ? SENDING[tone] : TONES[tone]} ${
        onNavy && tone === 'money' && !sending ? 'disabled:bg-navy-700 disabled:text-grey-400' : ''
      }`}
    >
      {sending ? (
        <SendingGlyph />
      ) : icon ? (
        icon
      ) : tone === 'money' ? (
        <span aria-hidden="true" className="inline-block size-2 bg-navy-900" />
      ) : null}
      {sending && !keepLabel ? ui.common.sending : label}
    </button>
  )
}

export function Dock({
  tone = 'light',
  primary,
  secondary,
  stack,
  settle = false,
}: {
  tone?: 'light' | 'navy' | 'navy800'
  primary?: DockPrimary
  secondary?: DockSecondary
  stack?: StackItem[]
  /** Ignore presses for SETTLE_MS after the dock appears (a flow step's dock). */
  settle?: boolean
}) {
  const navy = tone !== 'light'
  const settled = useSettled(settle)
  return (
    <div
      className={`shrink-0 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] ${
        navy ? `on-navy ${tone === 'navy800' ? 'bg-navy-800' : 'bg-navy-900'}` : 'border-t border-line-200 bg-bg'
      }`}
    >
      {stack ? (
        <div className="flex flex-col gap-2.5">
          {stack.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled || item.sending}
              {...settleProps(settled, item.onPress)}
              aria-busy={item.sending || undefined}
              className={`${BASE} ${
                item.kind === 'white'
                  ? 'bg-white text-navy-900 active:bg-line-100 disabled:bg-navy-700 disabled:text-grey-400'
                  : 'border border-line-300 text-white active:bg-navy-800'
              } ${item.disabled && !item.sending ? 'opacity-50' : ''}`}
            >
              {item.sending ? <SendingGlyph /> : item.icon}
              {item.sending && !item.keepLabel ? ui.common.sending : item.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-stretch gap-3">
          {secondary?.kind === 'link' && (
            <button
              type="button"
              data-testid="dock-secondary"
              disabled={secondary.disabled}
              {...settleProps(settled, secondary.onPress)}
              className={`inline-flex min-h-12 shrink-0 items-center py-3.5 pr-3 font-body text-body font-semibold underline underline-offset-2 disabled:opacity-40 ${
                navy ? 'text-green-500' : 'text-green-700'
              }`}
            >
              {secondary.label}
            </button>
          )}
          {secondary?.kind === 'outline' && (
            <button
              type="button"
              data-testid="dock-secondary"
              disabled={secondary.disabled}
              {...settleProps(settled, secondary.onPress)}
              className={`${BASE} ${secondary.fit ? 'w-auto! shrink-0 px-5' : ''} ${
                navy
                  ? 'border border-line-300 text-white active:bg-navy-800'
                  : 'border border-line-300 bg-surface text-navy-900 active:bg-line-100'
              }`}
            >
              {secondary.label}
            </button>
          )}
          {primary && <DockButton primary={primary} onNavy={navy} settled={settled} />}
        </div>
      )}
    </div>
  )
}
