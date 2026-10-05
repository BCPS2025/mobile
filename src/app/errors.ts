import { asMinor, formatMinor } from '@domain/money'
import type { DomainError } from '@domain/types'
import type { StoreRefusal } from '@store/runtime'
import { fill, ui } from './copy'

// The words for a refused command (feature copy `errors.*`): what the error line above the dock
// says. A repeated command (`duplicate`) is silent.

export type Refusal = DomainError | StoreRefusal

/**
 * What the refused command was about. The same refusal reads differently for each: a cancelled
 * payment code is "This code was cancelled", a cancelled request "This request was cancelled."
 * Without it the words are those of a payment code.
 */
export type RefusalAbout = 'code' | 'request' | 'link' | 'shares' | 'refund'

export interface RefusalOptions {
  /** Who can do it, for `not-allowed`. */
  name?: string
  about?: RefusalAbout
  /** When the sale was refunded ("Fri 14:15"), for `already-refunded`. */
  time?: string
}

/** Whole numbers with commas: 10000 → "10,000". */
const grouped = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** The error line for a refusal, or null when nothing should be said. */
export function errorText(err: Refusal, opts: RefusalOptions = {}): string | null {
  const e = ui.errors
  const about = opts.about ?? 'code'
  const d = err as DomainError
  switch (err.code) {
    case 'duplicate':
      return null
    case 'insufficient-funds': {
      const have = d.have ?? asMinor(0)
      const short = d.short ?? asMinor(0)
      if (about === 'refund') {
        return fill(e.refundShort, { have: formatMinor(have), amount: formatMinor(asMinor(have + short)) })
      }
      return fill(e.insufficientFunds, { have: formatMinor(have), short: formatMinor(short) })
    }
    case 'unknown-recipient':
      return fill(e.unknownRecipient, { handle: d.handle ?? '' })
    case 'self-payment':
      if (about === 'link') return e.ownLink
      return about === 'request' ? e.selfRequest : e.selfPayment
    case 'invalid-amount': {
      // The top-up limit is in whole euros; the cash-out minimum and the split total come with the
      // amount that was exceeded or missed.
      if (d.maxEur !== undefined) return fill(e.maxTopUp, { max: grouped(d.maxEur) })
      if (d.min !== undefined) return fill(e.minCashOut, { min: formatMinor(d.min) })
      if (d.max === undefined) return fill(e.invalidAmount, { min: formatMinor(asMinor(0)) })
      return about === 'shares'
        ? fill(e.sharesOver, { total: formatMinor(d.max) })
        : fill(e.maxAmount, { max: formatMinor(d.max) })
    }
    case 'invalid-state': {
      const status = d.status
      if (about === 'code') {
        if (status === 'paid') return e.paid
        if (status === 'cancelled') return e.cancelled
        if (status === 'expired') return e.expired
      }
      if (about === 'request' && status === 'cancelled') return e.requestCancelled
      if (about === 'link' && status === 'paid') return e.linkPaid
      return fill(e.invalidState, { status: status ?? '' })
    }
    case 'already-refunded':
      return fill(e.alreadyRefunded, { time: opts.time ?? '' })
    case 'not-allowed':
      // A request to a business is not made: businesses are paid by invoice.
      if (about === 'request') return e.payByInvoice
      return opts.name ? fill(e.notAllowed, { name: opts.name }) : e.generic
    case 'quote-changed':
      return e.quoteChanged
    case 'session-full':
      return e.sessionFull
    default:
      return e.generic
  }
}
