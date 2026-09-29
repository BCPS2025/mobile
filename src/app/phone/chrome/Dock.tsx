import { Check, ScanFace } from 'lucide-react'
import type { ReactNode } from 'react'
import { ui } from '../../copy'
import { useReducedMotion } from '../../state/motion'

// The dock: the bottom 84 px of a task screen, never scrolling away. Variants (D27):
//   single button · text link + button · two buttons (outline + fill) · three stacked.
// Button states: default, pressed, disabled and "Sending…" (with the biometric glyph inside the
// button while a payment is pending; a static tick with reduced motion). Green means money moves
// (and the café's Charge); navy is every other primary; white on navy docks.

export type ButtonTone = 'money' | 'navy' | 'white'

export interface DockPrimary {
  label: string
  tone: ButtonTone
  /** Default true. */
  enabled?: boolean
  /** A commit is in flight: the label reads "Sending…" and the button does not react. */
  sending?: boolean
  onPress: () => void
  icon?: ReactNode
}

export interface DockSecondary {
  /** `link`: a text link beside the button; `outline`: an outline button beside it. */
  kind: 'link' | 'outline'
  label: string
  onPress: () => void
  disabled?: boolean
}

export interface StackItem {
  label: string
  kind: 'white' | 'outline'
  onPress: () => void
  icon?: ReactNode
  disabled?: boolean
  sending?: boolean
}

const BASE =
  'flex h-13 min-h-13 w-full min-w-0 items-center justify-center gap-2.5 px-4 font-display text-button transition-[filter,background-color] duration-(--dur-press)'

const TONES: Record<ButtonTone, string> = {
  money:
    'bg-green-500 text-navy-900 active:ring-[3px] active:ring-navy-900 active:ring-inset disabled:bg-line-200 disabled:text-grey-500 disabled:ring-0',
  navy: 'bg-navy-900 text-white active:bg-navy-700 disabled:bg-line-200 disabled:text-grey-500',
  white: 'bg-white text-navy-900 active:bg-line-100 disabled:bg-line-200 disabled:text-grey-500',
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

export function DockButton({ primary, testId = 'dock-primary' }: { primary: DockPrimary; testId?: string }) {
  const { label, tone, enabled = true, sending = false, onPress, icon } = primary
  return (
    <button
      type="button"
      data-testid={testId}
      aria-busy={sending || undefined}
      disabled={!enabled || sending}
      onClick={onPress}
      className={`${BASE} ${TONES[tone]} ${sending ? 'disabled:bg-green-500 disabled:text-navy-900 opacity-80' : ''}`}
    >
      {sending ? (
        <SendingGlyph />
      ) : icon ? (
        icon
      ) : tone === 'money' ? (
        <span aria-hidden="true" className="inline-block size-2 bg-navy-900" />
      ) : null}
      {sending ? ui.common.sending : label}
    </button>
  )
}

export function Dock({
  tone = 'light',
  primary,
  secondary,
  stack,
}: {
  tone?: 'light' | 'navy' | 'navy800'
  primary?: DockPrimary
  secondary?: DockSecondary
  stack?: StackItem[]
}) {
  const navy = tone !== 'light'
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
              onClick={item.onPress}
              aria-busy={item.sending || undefined}
              className={`${BASE} ${
                item.kind === 'white'
                  ? 'bg-white text-navy-900 active:bg-line-100'
                  : 'border border-line-300 text-white active:bg-navy-800'
              }`}
            >
              {item.sending ? <SendingGlyph /> : item.icon}
              {item.sending ? ui.common.sending : item.label}
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
              onClick={secondary.onPress}
              className={`inline-flex min-h-12 shrink-0 items-center py-3.5 pr-3 font-body text-body font-semibold disabled:opacity-40 ${
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
              onClick={secondary.onPress}
              className={`${BASE} ${
                navy
                  ? 'border border-line-300 text-white active:bg-navy-800'
                  : 'border border-line-300 bg-surface text-navy-900 active:bg-line-100'
              }`}
            >
              {secondary.label}
            </button>
          )}
          {primary && <DockButton primary={primary} />}
        </div>
      )}
    </div>
  )
}
