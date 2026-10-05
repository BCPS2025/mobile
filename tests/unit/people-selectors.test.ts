import { describe, expect, it } from 'vitest'
import { asMinor, formatMinor, formatSignedMinor } from '@domain/money'
import type { LedgerState, PaymentRequest, SimTime, UserCommand } from '@domain/types'
import { resolveItems } from '@sim/seed'
import { withinHours } from '@store/hours'
import {
  activity,
  isPosRequestOpen,
  openPosRequest,
  posCodeState,
  quoteForRequest,
  scanCandidates,
  txDetail,
} from '@store/selectors'
import { headless } from '../support/journey'
import { content, m } from './helpers'

// The read side of the people screens: the café's POS code and what the phone next to it can scan,
// History (grouped by local day) and the payment detail.

const TZ = content.config.t0.tz
const VALIDITY = content.config.posCodeValidityMin * 60_000
const items = resolveItems(content, 'cafe', [
  { sku: 'flat-white', qty: 2 },
  { sku: 'croissant', qty: 2 },
])

let n = 0
const cmdId = () => `${(++n).toString(16).padStart(16, '0')}:review`
const send = (): UserCommand => ({
  type: 'pay',
  actor: 'ana',
  cmdId: cmdId(),
  to: '@marko',
  amount: m('16.50'),
  channel: 'username',
  note: 'Cinema',
  expect: { senderDebit: m('16.67') },
})

/** A ledger with the café's open POS code (what `request.create` will leave behind). */
function withCode(state: LedgerState, at: SimTime, patch: Partial<PaymentRequest> = {}): LedgerState {
  const request: PaymentRequest = {
    id: 'r_pos_1',
    requester: 'cafe',
    amount: m('11.00'),
    items,
    channel: 'pos',
    feePayer: 'recipient',
    policy: 'merchant',
    status: 'open',
    createdAt: at,
    ...patch,
  }
  return { ...state, requests: { ...state.requests, [request.id]: request } }
}

describe('the café’s POS code', () => {
  const { node } = headless('2026-09-25')
  const now = node.now()
  const s = withCode(node.getState(), now)

  it('is open for five minutes, then expired by time (its status stays open)', () => {
    const r = s.requests.r_pos_1 as PaymentRequest
    expect(isPosRequestOpen(r, now, VALIDITY)).toBe(true)
    expect(isPosRequestOpen(r, (now + VALIDITY - 1) as SimTime, VALIDITY)).toBe(true)
    expect(isPosRequestOpen(r, (now + VALIDITY) as SimTime, VALIDITY)).toBe(false)
    expect(posCodeState(s, 'r_pos_1', now, VALIDITY)).toBe('open')
    expect(posCodeState(s, 'r_pos_1', (now + VALIDITY) as SimTime, VALIDITY)).toBe('expired')
    expect(s.requests.r_pos_1?.status).toBe('open')
  })

  it('reports why a code cannot be paid: paid, cancelled, expired; an unknown or non-POS id is undefined', () => {
    expect(posCodeState(withCode(node.getState(), now, { status: 'paid' }), 'r_pos_1', now, VALIDITY)).toBe('paid')
    expect(posCodeState(withCode(node.getState(), now, { status: 'cancelled' }), 'r_pos_1', now, VALIDITY)).toBe(
      'cancelled',
    )
    expect(posCodeState(s, 'nope', now, VALIDITY)).toBeUndefined()
    expect(posCodeState(s, 'r_seed_lunch', now, VALIDITY)).toBeUndefined()
  })

  it('openPosRequest finds the merchant’s open code, not a closed, expired or other merchant’s one', () => {
    expect(openPosRequest(s, 'cafe', now, VALIDITY)?.id).toBe('r_pos_1')
    expect(openPosRequest(s, 'studio', now, VALIDITY)).toBeUndefined()
    expect(openPosRequest(s, 'cafe', (now + VALIDITY) as SimTime, VALIDITY)).toBeUndefined()
    expect(openPosRequest(withCode(s, now, { status: 'cancelled' }), 'cafe', now, VALIDITY)).toBeUndefined()
    expect(openPosRequest(node.getState(), 'cafe', now, VALIDITY)).toBeUndefined()
  })

  it('a newer open code wins when there are two', () => {
    const two = withCode(s, (now + 1000) as SimTime, { id: 'r_pos_2', amount: m('3.30'), items: [] })
    expect(openPosRequest(two, 'cafe', (now + 2000) as SimTime, VALIDITY)?.id).toBe('r_pos_2')
  })

  it('quotes a payment against it from the request’s snapshot: 11.00 with the café paying the fee', () => {
    const q = quoteForRequest(s, s.requests.r_pos_1 as PaymentRequest)
    expect(q).not.toBeNull()
    expect(formatMinor(q?.senderDebit ?? asMinor(0))).toBe('11.00')
    expect(formatMinor(q?.fee ?? asMinor(0))).toBe('0.11')
    expect(q?.payer).toBe('recipient')
    expect(q?.card).toBeDefined()
    // The sender pays when the snapshot says so.
    const sender = withCode(node.getState(), now, { feePayer: 'sender' })
    expect(
      formatMinor(quoteForRequest(sender, sender.requests.r_pos_1 as PaymentRequest)?.senderDebit ?? asMinor(0)),
    ).toBe('11.11')
  })
})

describe('scanCandidates', () => {
  const { node } = headless('2026-09-25')
  const now = node.now()
  const s = withCode(node.getState(), now)

  it('locks onto the open code of the merchant on the other visible phone', () => {
    const [c] = scanCandidates(s, 'ana', 'cafe', now, VALIDITY)
    expect(c).toMatchObject({ kind: 'pos', requestId: 'r_pos_1', merchant: 'cafe' })
    if (c?.kind !== 'pos') throw new Error('not a payment code')
    expect(formatMinor(c.amount)).toBe('11.00')
    expect(c.items.map((i) => i.qty)).toEqual([2, 2])
    expect(c.expiresAt).toBe(now + VALIDITY)
  })

  it('finds nothing without a code, for the merchant’s own phone, for a person or after expiry', () => {
    expect(scanCandidates(node.getState(), 'ana', 'cafe', now, VALIDITY)).toEqual([])
    expect(scanCandidates(s, 'cafe', 'cafe', now, VALIDITY)).toEqual([])
    expect(scanCandidates(s, 'cafe', 'ana', now, VALIDITY)).toEqual([])
    expect(scanCandidates(s, 'ana', 'marko', now, VALIDITY)).toEqual([])
    expect(scanCandidates(s, 'ana', 'cafe', (now + VALIDITY) as SimTime, VALIDITY)).toEqual([])
    expect(scanCandidates(withCode(s, now, { status: 'paid' }), 'ana', 'cafe', now, VALIDITY)).toEqual([])
  })

  it('a code made out to one payer is offered to that payer only', () => {
    const named = withCode(node.getState(), now, { payer: 'marko' })
    expect(scanCandidates(named, 'ana', 'cafe', now, VALIDITY)).toEqual([])
    expect(scanCandidates(named, 'marko', 'cafe', now, VALIDITY)).toHaveLength(1)
  })
})

describe('activity (History)', () => {
  it('Ana from a fresh start: Yesterday and older days, newest first, signed by direction', () => {
    const { node } = headless('2026-09-25')
    const groups = activity(node.getState(), 'ana', node.now(), TZ)
    expect(groups.map((g) => g.key)).toEqual([
      'yesterday',
      '2026-09-23',
      '2026-09-22',
      '2026-09-21',
      '2026-09-20',
      '2026-09-19',
      '2026-08-26',
    ])
    const yesterday = groups[0]
    expect(yesterday?.rows).toHaveLength(1)
    expect(yesterday?.rows[0]).toMatchObject({ direction: 'out', pending: false })
    expect(formatSignedMinor(yesterday?.rows[0]?.signed ?? asMinor(0))).toBe('−26.40')
    const concert = groups[1]?.rows[0]
    expect(concert?.direction).toBe('in')
    expect(formatSignedMinor(concert?.signed ?? asMinor(0))).toBe('+22.00')
  })

  it('a payment made today opens the Today group, pending until it settles', () => {
    const { node } = headless('2026-09-25')
    expect(node.dispatch(send()).ok).toBe(true)
    let groups = activity(node.getState(), 'ana', node.now(), TZ)
    expect(groups[0]?.key).toBe('today')
    expect(groups[0]?.rows[0]).toMatchObject({ pending: true, direction: 'out' })
    expect(formatSignedMinor(groups[0]?.rows[0]?.signed ?? asMinor(0))).toBe('−16.50')
    node.settleDue()
    groups = activity(node.getState(), 'ana', node.now(), TZ)
    expect(groups[0]?.rows[0]?.pending).toBe(false)
    // Marko sees it as money in.
    const marko = activity(node.getState(), 'marko', node.now(), TZ)
    expect(marko[0]?.key).toBe('today')
    expect(marko[0]?.rows[0]?.direction).toBe('in')
    expect(formatSignedMinor(marko[0]?.rows[0]?.signed ?? asMinor(0))).toBe('+16.50')
  })

  it('the café’s history holds the seeded daily summaries and today’s row', () => {
    const { node } = headless('2026-09-25')
    const groups = activity(node.getState(), 'cafe', node.now(), TZ)
    expect(groups[0]?.key).toBe('today')
    expect(groups[0]?.rows[0]?.tx.summary?.count).toBe(23)
  })
})

describe('txDetail', () => {
  function sent() {
    const { node } = headless('2026-09-25')
    node.dispatch(send())
    node.settleDue()
    const s = node.getState()
    const tx = s.txs[s.txOrder[s.txOrder.length - 1] ?? '']
    if (!tx) throw new Error('no tx')
    return { node, s, tx }
  }

  it('the sender’s view: minus, both parties, fee paid by the sender, settled seconds later', () => {
    const { s, tx } = sent()
    const d = txDetail(s, tx.id, 'ana', content)
    expect(d).toBeDefined()
    expect(d?.role).toBe('from')
    expect(formatSignedMinor(d?.signed ?? asMinor(0))).toBe('−16.50')
    expect(d?.from?.handle).toBe('@ana')
    expect(d?.to?.handle).toBe('@marko')
    expect(d?.feePaidBy).toBe('from')
    expect(d?.settledAt).toBe(tx.confirmedAt)
    expect(d?.merchantSale).toBe(false)
    expect(d?.outsideBankingHours).toBe(false) // Friday 12:15 in Ljubljana
  })

  it('the recipient’s view: plus; an unknown id or a third account', () => {
    const { s, tx } = sent()
    expect(txDetail(s, tx.id, 'marko', content)?.role).toBe('to')
    expect(formatSignedMinor(txDetail(s, tx.id, 'marko', content)?.signed ?? asMinor(0))).toBe('+16.50')
    expect(txDetail(s, tx.id, 'cafe', content)?.role).toBe('other')
    expect(txDetail(s, 'BC-NOPE', 'ana', content)).toBeUndefined()
  })

  it('a sale is a merchant sale for the café and a purchase for Ana (the café pays the fee)', () => {
    const { node } = headless('2026-09-25')
    node.dispatch({
      type: 'pay',
      actor: 'ana',
      cmdId: cmdId(),
      to: '@cafelipa',
      amount: m('11.00'),
      channel: 'qr',
      items,
      expect: { senderDebit: m('11.00') },
    })
    node.settleDue()
    const s = node.getState()
    const id = s.txOrder[s.txOrder.length - 1] ?? ''
    const cafe = txDetail(s, id, 'cafe', content)
    expect(cafe?.merchantSale).toBe(true)
    expect(cafe?.feePaidBy).toBe('to')
    expect(cafe?.tx.fee.card).toBeDefined()
    expect(txDetail(s, id, 'ana', content)?.merchantSale).toBe(false)
    expect(formatSignedMinor(txDetail(s, id, 'ana', content)?.signed ?? asMinor(0))).toBe('−11.00')
  })

  it('flags a payment outside the banking hours of the viewer’s country', () => {
    const { node } = headless('2026-09-25')
    node.clock.jumpTo(resolve('2026-09-26', '21:40'))
    node.dispatch(send())
    node.settleDue()
    const s = node.getState()
    const id = s.txOrder[s.txOrder.length - 1] ?? ''
    expect(txDetail(s, id, 'ana', content)?.outsideBankingHours).toBe(true)
  })
})

function resolve(date: string, time: string): SimTime {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
  const [h, mi] = time.split(':').map(Number) as [number, number]
  // Ljubljana is UTC+2 on these dates.
  return Date.UTC(y, mo - 1, d, h - 2, mi) as SimTime
}

describe('banking hours', () => {
  const si = content.config.bankingHours.SI
  const kr = content.config.bankingHours.KR
  it('Slovenia Monday–Friday 08:00–17:00, Korea 09:00–16:00 in their own zones', () => {
    expect(withinHours(resolve('2026-09-25', '12:15'), si)).toBe(true)
    expect(withinHours(resolve('2026-09-25', '07:59'), si)).toBe(false)
    expect(withinHours(resolve('2026-09-25', '08:00'), si)).toBe(true)
    expect(withinHours(resolve('2026-09-25', '17:00'), si)).toBe(false)
    expect(withinHours(resolve('2026-09-26', '12:00'), si)).toBe(false) // Saturday
    // 09:00 in Seoul is 02:00 in Ljubljana (UTC+2).
    expect(withinHours(Date.UTC(2026, 8, 25, 0, 0) as SimTime, kr)).toBe(true)
    expect(withinHours(Date.UTC(2026, 8, 24, 23, 59) as SimTime, kr)).toBe(false)
  })
})
