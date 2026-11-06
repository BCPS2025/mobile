import { describe, expect, it } from 'vitest'
import { errorText } from '@app/errors'
import { mustParseMinor as m } from '@domain/money'
import type { DomainError } from '@domain/types'
import { content } from './helpers'

// The words of the refusals that requests, links, splits, top-ups, cash-outs and refunds can meet. The
// same refusal reads differently for a payment code, a request, a link or the shares of a split.

const refusal = (code: DomainError['code'], rest: Omit<DomainError, 'code'> = {}): DomainError => ({ code, ...rest })

describe('the words of the refusals of everyday money', () => {
  it('a request: not to yourself, not to a business, and a cancelled one cannot be paid', () => {
    expect(errorText(refusal('self-payment'), { about: 'request' })).toBe("You can't request from yourself.")
    expect(errorText(refusal('not-allowed'), { about: 'request' })).toBe('Businesses pay by invoice')
    expect(errorText(refusal('invalid-state', { status: 'cancelled' }), { about: 'request' })).toBe(
      'This request was cancelled.',
    )
    // Paid or declined, a request reads as the general "already" line, not as a code.
    expect(errorText(refusal('invalid-state', { status: 'paid' }), { about: 'request' })).toBe('This was already paid.')
    expect(errorText(refusal('invalid-state', { status: 'declined' }), { about: 'request' })).toBe(
      'This was already declined.',
    )
    expect(errorText(refusal('invalid-amount', { max: m('999.99') }), { about: 'request' })).toBe(
      'The maximum is 999.99 BCPS.',
    )
  })

  it('a link: "This link has already been paid." and "This is your own link."', () => {
    expect(errorText(refusal('invalid-state', { status: 'paid' }), { about: 'link' })).toBe(
      'This link has already been paid.',
    )
    expect(errorText(refusal('self-payment'), { about: 'link' })).toBe('This is your own link.')
    expect(errorText(refusal('invalid-state', { status: 'closed' }), { about: 'link' })).toBe(
      'This was already closed.',
    )
  })

  it('the shares of a split: "The shares add up to more than 26.40."', () => {
    expect(errorText(refusal('invalid-amount', { max: m('26.40') }), { about: 'shares' })).toBe(
      'The shares add up to more than 26.40.',
    )
    // The same refusal elsewhere is the general limit.
    expect(errorText(refusal('invalid-amount', { max: m('26.40') }))).toBe('The maximum is 26.40 BCPS.')
  })

  it('a top-up and a cash-out: the limit in whole euros and the minimum', () => {
    expect(errorText(refusal('invalid-amount', { maxEur: 10_000 }))).toBe('The maximum top-up is €10,000.')
    expect(errorText(refusal('invalid-amount', { maxEur: 100_000 }))).toBe('The maximum top-up is €100,000.')
    expect(errorText(refusal('invalid-amount', { min: m('1.10') }))).toBe('The minimum is 1.10 BCPS.')
    // The figures come from the refusal, so the words follow the content and not a literal.
    expect(errorText(refusal('invalid-amount', { min: m('2.20') }))).toBe('The minimum is 2.20 BCPS.')
  })

  it('a refund: a second attempt shows the time; too little to refund names what it needs', () => {
    expect(errorText(refusal('already-refunded'), { time: 'Fri 14:15' })).toBe('Refunded ✓ · Fri 14:15')
    expect(errorText(refusal('insufficient-funds', { have: m('16.00'), short: m('10.40') }), { about: 'refund' })).toBe(
      'You have 16.00 BCPS. The refund needs 26.40 BCPS.',
    )
    expect(errorText(refusal('insufficient-funds', { have: m('16.00'), short: m('10.40') }))).toBe(
      'You have 16.00 BCPS. Top up 10.40 BCPS to pay.',
    )
  })

  it('a payment code keeps its words when nothing says otherwise', () => {
    expect(errorText(refusal('invalid-state', { status: 'cancelled' }))).toBe('This code was cancelled')
    expect(errorText(refusal('invalid-state', { status: 'paid' }), { about: 'code' })).toBe(
      'This code was already paid.',
    )
    expect(errorText(refusal('self-payment'))).toBe("You can't pay yourself.")
  })

  it('every error line the content has is used by one of the refusals above', () => {
    const lines = Object.keys(content.copy.errors).sort()
    const used = [
      'insufficientFunds',
      'unknownRecipient',
      'selfPayment',
      'selfRequest',
      'payByInvoice',
      'invalidAmount',
      'maxAmount',
      'maxTopUp',
      'minCashOut',
      'sharesOver',
      'invalidState',
      'notAllowed',
      'quoteChanged',
      'expired',
      'cancelled',
      'paid',
      'requestCancelled',
      'linkPaid',
      'ownLink',
      'alreadyRefunded',
      'refundShort',
      'sessionFull',
      'generic',
    ].sort()
    expect(lines).toEqual(used)
  })
})
