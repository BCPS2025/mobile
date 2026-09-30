import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import { formatHundredths } from '@domain/money'
import type { LedgerEvent, LedgerState, Minor, PaymentRequest, Split, Tx, UserCommand } from '@domain/types'
import { decodeCommand, encodeCommand } from '@store/log-codec'
import { checkWireCommand } from '@store/record'
import { replay } from '@store/replay'
import { type Headless, headless } from '../support/journey'
import { recordOf } from '../support/records'
import { content, m } from './helpers'

// split.create, split.reask and split.cancel: one request per share, each a transfer the payer
// pays 1 % on top of; the owner keeps the rest.

let n = 0
const id = (step = 'review') => `${(++n).toString(16).padStart(16, '0')}:${step}`

type Share = { party: string; amount: string }
const brunchOf = (s: LedgerState): Tx => {
  const tx = Object.values(s.txs).find((t) => t.seedMeta?.key === 'cafe-thu-brunch')
  if (!tx) throw new Error('no brunch')
  return tx
}
const create = (h: Headless, shares: Share[], over: Record<string, unknown> = {}, actor = 'ana'): UserCommand =>
  ({
    type: 'split.create',
    actor,
    cmdId: id('split'),
    sourceTxId: brunchOf(h.node.getState()).id,
    total: m('26.40'),
    note: 'Brunch for two',
    shares: shares.map((sh) => ({ party: sh.party, amount: m(sh.amount) })),
    ...over,
  }) as UserCommand
const reask = (splitId: string, party: string, actor = 'ana'): UserCommand =>
  ({ type: 'split.reask', actor, cmdId: id('reask'), splitId, party }) as UserCommand
const cancel = (splitId: string, actor = 'ana'): UserCommand => ({
  type: 'split.cancel',
  actor,
  cmdId: id('cancel'),
  splitId,
})
/** What the payer's review shows for a share: the amount and 1 % on top, round half-up. */
const withFee = (amount: number): Minor => (amount + Math.floor((amount + 50) / 100)) as Minor
const payShare = (h: Headless, r: PaymentRequest, actor: string, over: Record<string, unknown> = {}): UserCommand =>
  ({
    type: 'pay',
    actor,
    cmdId: id(),
    to: h.node.getState().directory[r.requester]?.handle,
    amount: r.amount,
    channel: 'request',
    requestId: r.id,
    expect: { senderDebit: withFee(r.amount) },
    ...over,
  }) as UserCommand
const decline = (requestId: string, actor: string): UserCommand => ({
  type: 'request.decline',
  actor,
  cmdId: id('decline'),
  requestId,
})

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
const split = (h: Headless, splitId = 'S-000001'): Split => {
  const sp = h.node.getState().splits[splitId]
  if (!sp) throw new Error(`no split ${splitId}`)
  return sp
}
const request = (h: Headless, requestId: string): PaymentRequest => {
  const r = h.node.getState().requests[requestId]
  if (!r) throw new Error(`no request ${requestId}`)
  return r
}
const bal = (h: Headless, a: string) => formatHundredths(h.node.getState().balances[a]?.confirmed ?? Number.NaN)
const equal = [{ party: '@marko', amount: '13.20' }]

describe('split.create', () => {
  it('Brunch for two with Marko: 26.40 split in two, one request of 13.20, Ana keeps 13.20', () => {
    const h = fresh()
    const events = run(h, create(h, equal))
    expect(events.map((e) => e.type)).toEqual(['split.created', 'request.created'])
    const sp = split(h)
    expect(sp).toMatchObject({
      id: 'S-000001',
      owner: 'ana',
      total: 2640,
      note: 'Brunch for two',
      ownShare: 1320,
      sourceTxId: brunchOf(h.node.getState()).id,
      shares: [{ party: 'marko', amount: 1320, requestId: 'R-000001' }],
      createdAt: h.node.now(),
    })
    expect(request(h, 'R-000001')).toMatchObject({
      requester: 'ana',
      payer: 'marko',
      amount: 1320,
      note: 'Brunch for two',
      channel: 'split',
      splitId: 'S-000001',
      feePayer: 'sender',
      policy: 'transfer',
      status: 'open',
    })
    expect(h.node.getState().counters).toMatchObject({ splitSeq: 1, requestSeq: 1 })
    expect(invariants(h.node.getState())).toEqual([])
    expect(bal(h, 'ana')).toBe('247.50')
  })

  it('Marko pays his share: 13.33 (13.20 + 0.13); Ana 260.70, Marko 119.65', () => {
    const h = fresh()
    run(h, create(h, equal))
    run(h, payShare(h, request(h, 'R-000001'), 'marko'))
    h.node.settleDue()
    expect(bal(h, 'ana')).toBe('260.70')
    expect(bal(h, 'marko')).toBe('119.65')
    expect(request(h, 'R-000001').status).toBe('paid')
    const tx = h.node.getState().txs[request(h, 'R-000001').txId ?? ''] as Tx
    expect(tx).toMatchObject({ kind: 'transfer', channel: 'request', links: { requestId: 'R-000001' } })
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('10.00 with two people: 3.33 each, and Ana keeps 3.34', () => {
    const h = fresh()
    run(
      h,
      create(
        h,
        [
          { party: '@marko', amount: '3.33' },
          { party: '@marta_k', amount: '3.33' },
        ],
        { total: m('10.00'), sourceTxId: undefined, note: 'Pizza' },
      ),
    )
    expect(split(h).ownShare).toBe(334)
    expect(split(h).sourceTxId).toBeUndefined()
    expect(split(h).shares.map((sh) => sh.requestId)).toEqual(['R-000001', 'R-000002'])
    expect(request(h, 'R-000002').payer).toBe('@marta_k')
    // An off-stage person's share stays open.
    expect(request(h, 'R-000002').status).toBe('open')
  })

  it('the shares may add up to the whole total: Ana keeps nothing', () => {
    const h = fresh()
    run(h, create(h, [{ party: '@marko', amount: '26.40' }]))
    expect(split(h).ownShare).toBe(0)
  })

  it('refuses shares that add up to more than the total: "The shares add up to more than 26.40."', () => {
    const h = fresh()
    expect(refusal(h, create(h, [{ party: '@marko', amount: '26.41' }]))).toEqual({
      code: 'invalid-amount',
      max: m('26.40'),
    })
    expect(
      refusal(
        h,
        create(h, [
          { party: '@marko', amount: '13.21' },
          { party: '@eva', amount: '13.20' },
        ]),
      ),
    ).toEqual({ code: 'invalid-amount', max: m('26.40') })
    expect(h.node.getState().counters).toMatchObject({ splitSeq: 0, requestSeq: 0 })
  })

  it('refuses: a business owner, a business or unknown or own share, a person twice, no shares, too many', () => {
    const h = fresh()
    expect(refusal(h, create(h, equal, {}, 'cafe'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, create(h, [{ party: '@cafelipa', amount: '13.20' }]))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, create(h, [{ party: '@nobody', amount: '13.20' }]))).toEqual({
      code: 'unknown-recipient',
      handle: '@nobody',
    })
    expect(refusal(h, create(h, [{ party: '@ana', amount: '13.20' }]))).toEqual({ code: 'self-payment' })
    expect(
      refusal(
        h,
        create(h, [
          { party: '@marko', amount: '1.00' },
          { party: '@marko', amount: '2.00' },
        ]),
      ),
    ).toEqual({ code: 'invalid-state' })
    expect(refusal(h, create(h, []))).toEqual({ code: 'invalid-state' })
    const eleven = [...'abcdefghijk'].map((_, i) => ({ party: `@marta_k${i}`, amount: '1.00' }))
    expect(refusal(h, create(h, eleven))).toEqual({ code: 'invalid-state' })
    expect(refusal(h, create(h, [{ party: '@marko', amount: '0.00' }]))).toEqual({ code: 'invalid-amount' })
    expect(h.node.getState().counters.splitSeq).toBe(0)
  })

  it('refuses a bad total, a total above 999.99 and an empty or long note', () => {
    const h = fresh()
    expect(refusal(h, create(h, equal, { total: 0 }))).toEqual({ code: 'invalid-amount' })
    expect(refusal(h, create(h, equal, { total: m('1000.00') }))).toEqual({ code: 'invalid-amount', max: m('999.99') })
    expect(refusal(h, create(h, equal, { note: '' }))).toEqual({ code: 'invalid-state' })
    expect(refusal(h, create(h, equal, { note: 'x'.repeat(41) }))).toEqual({ code: 'invalid-state' })
  })

  it("a source must be the actor's own outgoing payment: not someone else's, not a top-up or cash-out", () => {
    const h = fresh()
    const s = h.node.getState()
    const taxi = Object.values(s.txs).find((t) => t.seedMeta?.key === 'taxi-share') as Tx // Marko paid Ana
    const topUp = Object.values(s.txs).find((t) => t.seedMeta?.key === 'ana-topup-card') as Tx
    expect(refusal(h, create(h, equal, { sourceTxId: taxi.id, total: taxi.amount }))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, create(h, equal, { sourceTxId: topUp.id, total: topUp.amount }))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, create(h, equal, { sourceTxId: 'BC-NOPE00' }))).toEqual({ code: 'invalid-state' })
  })

  it('a conversion cannot be split', () => {
    const h = fresh()
    const cash = Object.values(h.node.getState().txs).find((t) => t.seedMeta?.key === 'cafe-cashout-wed') as Tx
    expect(refusal(h, create(h, equal, { sourceTxId: cash.id }, 'cafe'))).toEqual({ code: 'not-allowed' })
  })

  it('a payment can be split once', () => {
    const h = fresh()
    run(h, create(h, equal))
    expect(refusal(h, create(h, [{ party: '@eva', amount: '5.00' }]))).toEqual({
      code: 'invalid-state',
      status: 'split',
    })
    expect(h.node.getState().counters.splitSeq).toBe(1)
  })
})

describe('split.reask', () => {
  it('after Marko declines, Ana asks again: a new request replaces the share; the old one stays declined', () => {
    const h = fresh()
    run(h, create(h, equal))
    run(h, decline('R-000001', 'marko'))
    const events = run(h, reask('S-000001', '@marko'))
    expect(events.map((e) => e.type)).toEqual(['request.created', 'split.share-updated'])
    expect(events[1]).toMatchObject({ splitId: 'S-000001', party: 'marko', requestId: 'R-000002' })
    expect(split(h).shares).toEqual([{ party: 'marko', amount: 1320, requestId: 'R-000002' }])
    expect(request(h, 'R-000002')).toMatchObject({
      status: 'open',
      channel: 'split',
      splitId: 'S-000001',
      amount: 1320,
      payer: 'marko',
      note: 'Brunch for two',
    })
    expect(request(h, 'R-000001').status).toBe('declined')
    expect(invariants(h.node.getState())).toEqual([])
    // Marko can pay the new request and the split completes.
    run(h, payShare(h, request(h, 'R-000002'), 'marko'))
    h.node.settleDue()
    expect(bal(h, 'ana')).toBe('260.70')
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('works after a cancel too', () => {
    const h = fresh()
    run(h, create(h, equal))
    run(h, { type: 'request.cancel', actor: 'ana', cmdId: id('cancel'), requestId: 'R-000001' })
    run(h, reask('S-000001', '@marko'))
    expect(split(h).shares[0]?.requestId).toBe('R-000002')
  })

  it('refuses: an open or paid share, a stranger to the split, not the owner, an unknown split or person', () => {
    const h = fresh()
    run(h, create(h, equal))
    expect(refusal(h, reask('S-000001', '@marko'))).toEqual({ code: 'invalid-state', status: 'open' })
    expect(refusal(h, reask('S-000001', '@eva'))).toEqual({ code: 'invalid-state' })
    expect(refusal(h, reask('S-000001', '@marko', 'marko'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, reask('S-999999', '@marko'))).toEqual({ code: 'invalid-state' })
    expect(refusal(h, reask('S-000001', '@nobody'))).toEqual({ code: 'unknown-recipient', handle: '@nobody' })
    run(h, payShare(h, request(h, 'R-000001'), 'marko'))
    expect(refusal(h, reask('S-000001', '@marko'))).toEqual({ code: 'invalid-state', status: 'paid' })
  })
})

describe('split.cancel', () => {
  const three = [
    { party: '@marko', amount: '5.00' },
    { party: '@marta_k', amount: '5.00' },
    { party: '@eva', amount: '5.00' },
  ]

  it('cancels every open share in one batch and leaves a paid one alone', () => {
    const h = fresh()
    run(h, create(h, three, { total: m('20.00'), sourceTxId: undefined }))
    run(h, payShare(h, request(h, 'R-000001'), 'marko'))
    const events = run(h, cancel('S-000001'))
    expect(events.map((e) => e.type)).toEqual(['request.status', 'request.status'])
    expect(events.map((e) => (e as Extract<LedgerEvent, { type: 'request.status' }>).requestId)).toEqual([
      'R-000002',
      'R-000003',
    ])
    expect(request(h, 'R-000001').status).toBe('paid')
    expect(request(h, 'R-000002').status).toBe('cancelled')
    expect(request(h, 'R-000003').status).toBe('cancelled')
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('refuses: no open share left, not the owner, an unknown split', () => {
    const h = fresh()
    run(h, create(h, equal))
    expect(refusal(h, cancel('S-000001', 'marko'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, cancel('S-999999'))).toEqual({ code: 'invalid-state' })
    run(h, cancel('S-000001'))
    expect(refusal(h, cancel('S-000001'))).toEqual({ code: 'invalid-state' })
  })

  it('a cancelled share can be asked again', () => {
    const h = fresh()
    run(h, create(h, equal))
    run(h, cancel('S-000001'))
    run(h, reask('S-000001', '@marko'))
    expect(request(h, 'R-000002').status).toBe('open')
  })
})

describe('the log form of a split', () => {
  it("a split names its source by seed key or command, shares by handle; one command's requests are told apart by place", () => {
    const h = fresh()
    const c = create(
      h,
      [
        { party: '@marko', amount: '3.33' },
        { party: '@eva', amount: '3.33' },
      ],
      { total: m('10.00') },
    )
    run(h, c)
    const s = h.node.getState()
    const wire = encodeCommand(s, c)
    expect(wire).toEqual({
      ok: true,
      value: {
        type: 'split.create',
        sourceRef: { seedRow: 'cafe-thu-brunch' },
        total: '10.00',
        note: 'Brunch for two',
        shares: [
          { party: '@marko', amount: '3.33' },
          { party: '@eva', amount: '3.33' },
        ],
      },
    })
    if (!wire.ok) return
    expect(checkWireCommand(wire.value)).toBeNull()
    expect(decodeCommand(s, content, { actor: 'ana', cmdId: c.cmdId, cmd: wire.value })).toEqual({ ok: true, value: c })

    // Both requests came from the same command; the second is named with its place.
    const second = decline('R-000002', 'ana')
    expect(encodeCommand(s, decline('R-000001', 'marko'))).toEqual({
      ok: true,
      value: { type: 'request.decline', requestRef: { cmdId: c.cmdId } },
    })
    expect(encodeCommand(s, second)).toEqual({
      ok: true,
      value: { type: 'request.decline', requestRef: { cmdId: c.cmdId, n: 1 } },
    })
    const w2 = encodeCommand(s, second)
    if (!w2.ok) return
    expect(checkWireCommand(w2.value)).toBeNull()
    expect(decodeCommand(s, content, { actor: 'ana', cmdId: second.cmdId, cmd: w2.value })).toEqual({
      ok: true,
      value: second,
    })

    const r = reask('S-000001', '@marko')
    const w3 = encodeCommand(s, r)
    expect(w3).toEqual({ ok: true, value: { type: 'split.reask', splitRef: { cmdId: c.cmdId }, party: '@marko' } })
    expect(encodeCommand(s, cancel('S-000001'))).toEqual({
      ok: true,
      value: { type: 'split.cancel', splitRef: { cmdId: c.cmdId } },
    })
  })

  it('a session with a split, a decline, an ask again, a payment and a cancel replays to the same ledger', () => {
    const h = fresh()
    run(
      h,
      create(
        h,
        [
          { party: '@marko', amount: '3.33' },
          { party: '@eva', amount: '3.33' },
        ],
        { total: m('10.00') },
      ),
    )
    h.node.clock.advance(1000)
    run(h, decline('R-000001', 'marko'))
    run(h, reask('S-000001', '@marko'))
    run(h, payShare(h, request(h, 'R-000003'), 'marko'))
    run(h, cancel('S-000001'))
    h.node.settleDue()
    expect(request(h, 'R-000002').status).toBe('cancelled')
    const record = recordOf(h.node, h.seed.t0Date)
    const r = replay({
      seed: h.seed.state,
      t0: h.seed.t0,
      t0Date: h.seed.t0Date,
      content,
      log: record.log,
      clock: record.clock,
    })
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    expect(JSON.stringify(r.value.state)).toBe(JSON.stringify(h.node.getState()))
    expect(invariants(r.value.state)).toEqual([])
  })
})
