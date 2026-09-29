import { asMinor, formatMinor } from '@domain/money'
import type { DomainError } from '@domain/types'
import type { StoreRefusal } from '@store/runtime'
import { fill, ui } from './copy'

// The words for a refused command (feature copy `errors.*`): what the error line above the dock
// says. A repeated command (`duplicate`) is silent.

export type Refusal = DomainError | StoreRefusal

/** The error line for a refusal, or null when nothing should be said. */
export function errorText(err: Refusal, opts: { name?: string } = {}): string | null {
  const e = ui.errors
  switch (err.code) {
    case 'duplicate':
      return null
    case 'insufficient-funds':
      return fill(e.insufficientFunds, {
        have: formatMinor((err as DomainError).have ?? asMinor(0)),
        short: formatMinor((err as DomainError).short ?? asMinor(0)),
      })
    case 'unknown-recipient':
      return fill(e.unknownRecipient, { handle: (err as DomainError).handle ?? '' })
    case 'self-payment':
      return e.selfPayment
    case 'invalid-amount': {
      const max = (err as DomainError).max
      return max === undefined
        ? fill(e.invalidAmount, { min: formatMinor(asMinor(0)) })
        : fill(e.maxAmount, { max: formatMinor(max) })
    }
    case 'invalid-state': {
      const status = (err as DomainError).status
      if (status === 'paid') return e.paid
      if (status === 'cancelled') return e.cancelled
      if (status === 'expired') return e.expired
      return fill(e.invalidState, { status: status ?? '' })
    }
    case 'not-allowed':
      return opts.name ? fill(e.notAllowed, { name: opts.name }) : e.generic
    case 'quote-changed':
      return e.quoteChanged
    case 'session-full':
      return e.sessionFull
    default:
      return e.generic
  }
}
