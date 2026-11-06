import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import { formatHundredths } from '@domain/money'
import type { LedgerEvent, PaymentRequest, Tx, UserCommand } from '@domain/types'
import { decodeCommand, encodeCommand } from '@store/log-codec'
import { checkWireCommand } from '@store/record'
import { quoteForRequest } from '@store/selectors'
import { type Headless, headless } from '../support/journey'
import { content, m } from './helpers'

// request.create between people, request.decline, request.cancel of such a request, and what a
// payment against it does (fee from the request's snapshot: the payer pays 1 % on top).

let n = 0
const id = (step = 'review') => `${(++n).toString(16).padStart(16, '0')}:${step}`

const ask = (over: Record<string, unknown> = {}, actor = 'ana'): UserCommand =>
  ({
    type: 'request.create',
    actor,
    cmdId: id('request'),
    channel: 'username',
    payer: '@marko',
    amount: m('13.20'),
    note: 'Lunch',
    ...over,
  }) as UserCommand
const decline = (requestId: string, actor = 'ana', reason?: string): UserCommand => ({
  type: 'request.decline',
  actor,
  cmdId: id('decline'),
  requestId,
  ...(reason !== undefined ? { reason } : {}),
})
const cancel = (requestId: string, actor = 'ana'): UserCommand => ({
  type: 'request.cancel',
  actor,
  cmdId: id('cancel'),
  requestId,
})
const payRequest = (h: Headless, r: PaymentRequest, actor: string, over: Record<string, unknown> = {}): UserCommand => {
  const to = h.node.getState().directory[r.requester]?.handle
  return {
    type: 'pay',
    actor,
    cmdId: id(),
    to,
    amount: r.amount,
    channel: 'request',
    requestId: r.id,
    expect: { senderDebit: quoteForRequest(h.node.getState(), r)?.senderDebit ?? m('0.01') },
    ...over,
  } as UserCommand
}

const fresh = () => headless('2026-09-25')
const run = (h: Headless, c: UserCommand): LedgerEvent[] => {
  const r = h.node.dispatch(c)
  if (!r.ok) throw new Error(`refused ${r.error.code}`)
  return r.value
}
const refusal = (h: Headless, c: UserCommand) => {
  const r = h.node.dispatch(c)
  return r.ok ? 'accepted' : r.error
}
const request = (h: Headless, requestId: string): PaymentRequest => {
  const r = h.node.getState().requests[requestId]
  if (!r) throw new Error(`no request ${requestId}`)
  return r
}
const bal = (h: Headless, a: string) => formatHundredths(h.node.getState().balances[a]?.confirmed ?? Number.NaN)

describe('request.create between people', () => {
  it('Ana asks Marko for 13.20: an open username request with the payer-pays snapshot', () => {
    const h = fresh()
    const events = run(h, ask())
    expect(events.map((e) => e.type)).toEqual(['request.created'])
    const r = request(h, 'R-000001')
    expect(r).toMatchObject({
      requester: 'ana',
      payer: 'marko',
      amount: 1320,
      note: 'Lunch',
      channel: 'username',
      feePayer: 'sender',
      policy: 'transfer',
      status: 'open',
      createdAt: h.node.now(),
    })
    expect(r.cmdId).toMatch(/:request$/)
    expect(h.node.getState().counters.requestSeq).toBe(1)
    // Nothing moved.
    expect(bal(h, 'ana')).toBe('247.50')
    expect(bal(h, 'marko')).toBe('132.98')
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('needs no note; an off-stage person can be asked and stays waiting', () => {
    const h = fresh()
    run(h, ask({ payer: '@marta_k', note: undefined }))
    const r = request(h, 'R-000001')
    expect(r.payer).toBe('@marta_k')
    expect(r.note).toBeUndefined()
    expect(r.status).toBe('open')
  })

  it('Marko pays it: the fee 0.13 is added to what he sends (13.33); Ana receives the full 13.20', () => {
    const h = fresh()
    run(h, ask())
    const r = request(h, 'R-000001')
    run(h, payRequest(h, r, 'marko'))
    h.node.settleDue()
    expect(bal(h, 'marko')).toBe('119.65')
    expect(bal(h, 'ana')).toBe('260.70')
    const paid = request(h, 'R-000001')
    expect(paid.status).toBe('paid')
    const tx = h.node.getState().txs[paid.txId ?? ''] as Tx
    expect(tx).toMatchObject({ kind: 'transfer', channel: 'request', from: 'marko', to: 'ana' })
    expect(tx.links).toEqual({ requestId: 'R-000001' })
    expect(formatHundredths(tx.fee.fee)).toBe('0.13')
    expect(formatHundredths(tx.fee.senderDebit)).toBe('13.33')
    expect(tx.fee.payer).toBe('sender')
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('refuses: a business payer, a business asking, yourself, an unknown handle, bad amounts', () => {
    const h = fresh()
    expect(refusal(h, ask({ payer: '@cafelipa' }))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, ask({ payer: '@pekarnazrno' }))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, ask({}, 'cafe'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, ask({ payer: '@ana' }))).toEqual({ code: 'self-payment' })
    expect(refusal(h, ask({ payer: '@nobody' }))).toEqual({ code: 'unknown-recipient', handle: '@nobody' })
    expect(refusal(h, ask({ amount: 0 }))).toEqual({ code: 'invalid-amount' })
    expect(refusal(h, ask({ amount: Number.NaN }))).toEqual({ code: 'invalid-amount' })
    expect(refusal(h, ask({ amount: m('1000.00') }))).toEqual({ code: 'invalid-amount', max: m('999.99') })
    expect(refusal(h, ask({}, 'nobody'))).toEqual({ code: 'not-allowed' })
    expect(h.node.getState().counters.requestSeq).toBe(0)
    expect(h.node.getState().seq).toBe(0)
  })

  it('accepts exactly the limit, 999.99', () => {
    const h = fresh()
    run(h, ask({ amount: m('999.99') }))
    expect(request(h, 'R-000001').amount).toBe(99999)
  })

  it('a repeated command id is refused as duplicate and changes nothing', () => {
    const h = fresh()
    const c = ask()
    run(h, c)
    expect(refusal(h, c)).toEqual({ code: 'duplicate' })
    expect(h.node.getState().counters.requestSeq).toBe(1)
  })

  it('a request whose payer changes nothing about the fee: 13.20 quotes 13.33 for the payer', () => {
    const h = fresh()
    run(h, ask())
    const q = quoteForRequest(h.node.getState(), request(h, 'R-000001'))
    expect(
      q && [formatHundredths(q.fee), formatHundredths(q.senderDebit), formatHundredths(q.recipientCredit)],
    ).toEqual(['0.13', '13.33', '13.20'])
  })
})

describe('request.decline', () => {
  it('Ana declines the seeded Lunch request: declined with the reason, no money moves', () => {
    const h = fresh()
    const events = run(h, decline('r_seed_lunch', 'ana', 'Not now'))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'request.status',
      requestId: 'r_seed_lunch',
      status: 'declined',
      reason: 'Not now',
    })
    expect(request(h, 'r_seed_lunch')).toMatchObject({ status: 'declined', declineReason: 'Not now' })
    expect(request(h, 'r_seed_lunch').closedAt).toBe(h.node.now())
    expect(bal(h, 'ana')).toBe('247.50')
    expect(bal(h, 'marko')).toBe('132.98')
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('the reason is optional', () => {
    const h = fresh()
    run(h, decline('r_seed_lunch'))
    expect(request(h, 'r_seed_lunch').declineReason).toBeUndefined()
    expect(request(h, 'r_seed_lunch').status).toBe('declined')
  })

  it('refuses: someone who is not the payer, a request that is no longer open, an unknown request, a payment code', () => {
    const h = fresh()
    expect(refusal(h, decline('r_seed_lunch', 'marko'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, decline('r_seed_lunch', 'cafe'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, decline('R-999999'))).toEqual({ code: 'invalid-state' })
    expect(refusal(h, decline('r_seed_lunch', 'ana', ''))).toEqual({ code: 'invalid-state' })
    expect(refusal(h, decline('r_seed_lunch', 'ana', 'x'.repeat(41)))).toEqual({ code: 'invalid-state' })
    run(h, decline('r_seed_lunch'))
    expect(refusal(h, decline('r_seed_lunch'))).toEqual({ code: 'invalid-state', status: 'declined' })
    // A payment code has no payer: nobody can decline it.
    run(h, { type: 'request.create', actor: 'cafe', cmdId: id('items'), channel: 'pos', amount: m('11.00') })
    expect(refusal(h, decline('R-000001', 'ana'))).toEqual({ code: 'not-allowed' })
  })

  it('paying a declined request is refused', () => {
    const h = fresh()
    run(h, decline('r_seed_lunch'))
    const r = request(h, 'r_seed_lunch')
    expect(refusal(h, payRequest(h, r, 'ana', { expect: { senderDebit: m('13.33') } }))).toEqual({
      code: 'invalid-state',
      status: 'declined',
    })
  })
})

describe('request.cancel of a request between people', () => {
  it('the requester cancels; the payer can then no longer pay: "This request was cancelled."', () => {
    const h = fresh()
    run(h, ask())
    const r = request(h, 'R-000001')
    const stale = payRequest(h, r, 'marko')
    expect(refusal(h, cancel('R-000001', 'marko'))).toEqual({ code: 'not-allowed' })
    run(h, cancel('R-000001'))
    expect(request(h, 'R-000001').status).toBe('cancelled')
    expect(refusal(h, stale)).toEqual({ code: 'invalid-state', status: 'cancelled' })
    expect(refusal(h, cancel('R-000001'))).toEqual({ code: 'invalid-state', status: 'cancelled' })
    expect(bal(h, 'marko')).toBe('132.98')
  })

  it('a request paid meanwhile can no longer be cancelled', () => {
    const h = fresh()
    run(h, ask())
    run(h, payRequest(h, request(h, 'R-000001'), 'marko'))
    expect(refusal(h, cancel('R-000001'))).toEqual({ code: 'invalid-state', status: 'paid' })
  })
})

describe('paying a request', () => {
  it('the payer must be the one asked, the amount must equal, and a stale debit is quote-changed', () => {
    const h = fresh()
    run(h, ask())
    const r = request(h, 'R-000001')
    expect(refusal(h, payRequest(h, r, 'studio'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, payRequest(h, r, 'marko', { amount: m('13.21'), expect: { senderDebit: m('13.34') } }))).toEqual({
      code: 'invalid-amount',
    })
    expect(refusal(h, payRequest(h, r, 'marko', { expect: { senderDebit: m('13.20') } }))).toEqual({
      code: 'quote-changed',
      senderDebit: m('13.33'),
    })
    expect(request(h, 'R-000001').status).toBe('open')
  })

  it('a request paid twice is refused the second time (double tap)', () => {
    const h = fresh()
    run(h, ask())
    const r = request(h, 'R-000001')
    run(h, payRequest(h, r, 'marko'))
    expect(refusal(h, payRequest(h, r, 'marko'))).toEqual({ code: 'invalid-state', status: 'paid' })
  })

  it('the seeded Lunch request: Ana pays 13.33, Marko receives 13.20 (Ana 234.17, Marko 146.18)', () => {
    const h = fresh()
    run(h, payRequest(h, request(h, 'r_seed_lunch'), 'ana'))
    h.node.settleDue()
    expect(bal(h, 'ana')).toBe('234.17')
    expect(bal(h, 'marko')).toBe('146.18')
    expect(request(h, 'r_seed_lunch').status).toBe('paid')
  })

  it('the channel of a payment follows what is paid, whatever the caller names', () => {
    const h = fresh()
    const events = run(h, payRequest(h, request(h, 'r_seed_lunch'), 'ana', { channel: 'username' }))
    const tx = (events[0] as Extract<LedgerEvent, { type: 'tx.submitted' }>).tx
    expect(tx.channel).toBe('request')
  })
})

describe('the log form', () => {
  it('request.create, request.decline and a request cancel are stored by handle and by the command that made the request', () => {
    const h = fresh()
    const a = ask()
    run(h, a)
    const s = h.node.getState()
    const wire = encodeCommand(s, a)
    expect(wire).toEqual({
      ok: true,
      value: { type: 'request.create', channel: 'username', payer: '@marko', amount: '13.20', note: 'Lunch' },
    })
    if (!wire.ok) return
    expect(checkWireCommand(wire.value)).toBeNull()
    const back = decodeCommand(s, content, { actor: 'ana', cmdId: a.cmdId, cmd: wire.value })
    expect(back).toEqual({ ok: true, value: a })

    const d = decline('R-000001', 'marko', 'Not now')
    const dw = encodeCommand(s, d)
    expect(dw).toEqual({
      ok: true,
      value: { type: 'request.decline', requestRef: { cmdId: a.cmdId }, reason: 'Not now' },
    })
    if (!dw.ok) return
    expect(checkWireCommand(dw.value)).toBeNull()
    expect(decodeCommand(s, content, { actor: 'marko', cmdId: d.cmdId, cmd: dw.value })).toEqual({ ok: true, value: d })

    // A seeded request is named by its seed key.
    const seeded = decline('r_seed_lunch')
    expect(encodeCommand(s, seeded)).toEqual({
      ok: true,
      value: { type: 'request.decline', requestRef: { seedRow: 'r_seed_lunch' } },
    })
  })

  it('a stored decline or request with a note the record cannot keep is refused by the file rules', () => {
    expect(
      checkWireCommand({ type: 'request.decline', requestRef: { seedRow: 'r_seed_lunch' }, reason: 'x'.repeat(41) }),
    ).not.toBeNull()
    expect(
      checkWireCommand({
        type: 'request.create',
        channel: 'username',
        payer: 'marko' as `@${string}`,
        amount: '13.20',
      }),
    ).not.toBeNull()
  })
})
