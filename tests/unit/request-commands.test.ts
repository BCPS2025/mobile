import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import { formatHundredths } from '@domain/money'
import type { LedgerEvent, PaymentRequest, SimTime, TxItem, UserCommand } from '@domain/types'
import { resolveItems } from '@sim/seed'
import { decodeCommand, encodeCommand } from '@store/log-codec'
import { parseRecord, serializeRecord } from '@store/record'
import { replay } from '@store/replay'
import { feesSince, latestPosRequest, openPosRequest, posCodeState, quoteForRequest } from '@store/selectors'
import { type Headless, headless } from '../support/journey'
import { recordOf } from '../support/records'
import { content, m } from './helpers'

// request.create and request.cancel: the café's payment code, its five-minute life, and what a
// payment against it does (fee from the code's snapshot, tx kind purchase over the QR channel).

const EPOCH = '2026-09-25'
const VALIDITY = content.config.posCodeValidityMin * 60_000
const items: TxItem[] = resolveItems(content, 'cafe', [
  { sku: 'flat-white', qty: 2 },
  { sku: 'croissant', qty: 2 },
])

let n = 0
const id = (step = 'items') => `${(++n).toString(16).padStart(16, '0')}:${step}`

const charge = (over: Record<string, unknown> = {}, actor = 'cafe'): UserCommand =>
  ({
    type: 'request.create',
    actor,
    cmdId: id(),
    channel: 'pos',
    amount: m('11.00'),
    items,
    note: 'Table 4',
    ...over,
  }) as UserCommand
const cancel = (requestId: string, actor = 'cafe'): UserCommand => ({
  type: 'request.cancel',
  actor,
  cmdId: id('cancel'),
  requestId,
})
const payCode = (r: PaymentRequest, actor = 'ana', over: Record<string, unknown> = {}): UserCommand =>
  ({
    type: 'pay',
    actor,
    cmdId: id('review'),
    to: '@cafelipa',
    amount: r.amount,
    channel: 'qr',
    requestId: r.id,
    expect: { senderDebit: quoteForRequest({ ...seedOf().getState() }, r)?.senderDebit ?? m('0.01') },
    ...over,
  }) as UserCommand
let current: Headless
const seedOf = () => current.node

const fresh = (): Headless => {
  current = headless(EPOCH)
  return current
}
const codeOf = (h: Headless, requestId?: string): PaymentRequest => {
  const s = h.node.getState()
  const r = requestId ? s.requests[requestId] : openPosRequest(s, 'cafe', h.node.now(), VALIDITY)
  if (!r) throw new Error('no code')
  return r
}
const run = (h: Headless, c: UserCommand): LedgerEvent[] => {
  const r = h.node.dispatch(c)
  if (!r.ok) throw new Error(`refused ${r.error.code}`)
  return r.value
}
const bal = (h: Headless, a: string) => formatHundredths(h.node.getState().balances[a]?.confirmed ?? Number.NaN)

describe('request.create', () => {
  it('makes an open POS code with the items, the note and the fee snapshot of the café', () => {
    const h = fresh()
    const events = run(h, charge())
    expect(events.map((e) => e.type)).toEqual(['request.created'])
    const r = codeOf(h)
    expect(r).toMatchObject({
      requester: 'cafe',
      channel: 'pos',
      amount: 1100,
      note: 'Table 4',
      feePayer: 'recipient',
      policy: 'merchant',
      status: 'open',
      createdAt: h.node.now(),
    })
    expect(r.payer).toBeUndefined()
    expect(r.id).toBe('R-000001')
    expect(r.items).toEqual(items)
    expect(r.cmdId).toMatch(/:items$/)
    expect(h.node.getState().counters.requestSeq).toBe(1)
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('a custom amount has no items', () => {
    const h = fresh()
    run(h, charge({ amount: m('7.25'), items: undefined }))
    const r = codeOf(h)
    expect(r.amount).toBe(725)
    expect(r.items).toBeUndefined()
  })

  it('a new code cancels the previous open one in the same batch, also one that ran out', () => {
    const h = fresh()
    run(h, charge())
    const first = codeOf(h)
    const events = run(h, charge({ amount: m('2.20'), items: items.slice(1, 2).map((i) => ({ ...i, qty: 1 })) }))
    expect(events.map((e) => e.type)).toEqual(['request.status', 'request.created'])
    expect(events[0]).toMatchObject({ requestId: first.id, status: 'cancelled' })
    expect(h.node.getState().requests[first.id]?.status).toBe('cancelled')
    const second = codeOf(h)
    // Time passes: the second code runs out (still `open`), a third replaces it.
    h.node.clock.jumpTo((h.node.now() + VALIDITY) as SimTime)
    expect(posCodeState(h.node.getState(), second.id, h.node.now(), VALIDITY)).toBe('expired')
    const again = run(h, charge())
    expect(again.map((e) => e.type)).toEqual(['request.status', 'request.created'])
    expect(h.node.getState().requests[second.id]?.status).toBe('cancelled')
    expect(codeOf(h).id).toBe('R-000003')
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('refuses: someone who is not a merchant, a bad amount, more than 999.99, items that do not add up', () => {
    const h = fresh()
    const refused = (c: UserCommand) => {
      const r = h.node.dispatch(c)
      return r.ok ? 'accepted' : r.error
    }
    expect(refused(charge({}, 'ana'))).toEqual({ code: 'not-allowed' })
    expect(refused(charge({ amount: 0, items: undefined }))).toEqual({ code: 'invalid-amount' })
    expect(refused(charge({ amount: Number.NaN, items: undefined }))).toEqual({ code: 'invalid-amount' })
    expect(refused(charge({ amount: m('1000.00'), items: undefined }))).toEqual({
      code: 'invalid-amount',
      max: m('999.99'),
    })
    expect(refused(charge({ amount: m('11.01') }))).toEqual({ code: 'invalid-amount' })
    expect(refused(charge({ items: [{ ...items[0], qty: 0 }], amount: 0 }))).toEqual({ code: 'invalid-amount' })
    expect(refused(charge({ amount: m('999.99'), items: undefined }))).toBe('accepted')
    expect(h.node.getState().counters.requestSeq).toBe(1)
  })

  it('the fee payer of the café’s setting at that moment is fixed in the code', () => {
    const h = fresh()
    const s = h.node.getState()
    // The café's setting changes later (a later milestone): the code keeps what it was made with.
    run(h, charge())
    const r = codeOf(h)
    expect(s.merchant.cafe?.feePayer).toBe('recipient')
    expect(r.feePayer).toBe('recipient')
  })

  it('a repeated command id is refused silently (duplicate) and makes no second code', () => {
    const h = fresh()
    const c = charge()
    run(h, c)
    expect(h.node.dispatch(c)).toEqual({ ok: false, error: { code: 'duplicate' } })
    expect(Object.values(h.node.getState().requests).filter((r) => r.channel === 'pos')).toHaveLength(1)
  })
})

describe('the newest code', () => {
  it('is the last one made, in any state; none before the first', () => {
    const h = fresh()
    expect(latestPosRequest(h.node.getState(), 'cafe')).toBeUndefined()
    run(h, charge())
    const first = codeOf(h)
    expect(latestPosRequest(h.node.getState(), 'cafe')?.id).toBe(first.id)
    run(h, cancel(first.id))
    expect(latestPosRequest(h.node.getState(), 'cafe')).toMatchObject({ id: first.id, status: 'cancelled' })
    run(h, charge())
    expect(latestPosRequest(h.node.getState(), 'cafe')?.id).toBe('R-000002')
    expect(latestPosRequest(h.node.getState(), 'ana')).toBeUndefined()
  })
})

describe('request.cancel', () => {
  it('the requester cancels an open code; nothing else changes', () => {
    const h = fresh()
    run(h, charge())
    const r = codeOf(h)
    const before = h.node.getState().balances
    const events = run(h, cancel(r.id))
    expect(events).toMatchObject([{ type: 'request.status', requestId: r.id, status: 'cancelled' }])
    expect(h.node.getState().requests[r.id]?.status).toBe('cancelled')
    expect(h.node.getState().balances).toEqual(before)
    expect(openPosRequest(h.node.getState(), 'cafe', h.node.now(), VALIDITY)).toBeUndefined()
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('a code that ran out can still be cancelled', () => {
    const h = fresh()
    run(h, charge())
    const r = codeOf(h)
    h.node.clock.jumpTo((h.node.now() + VALIDITY + 1) as SimTime)
    expect(h.node.dispatch(cancel(r.id)).ok).toBe(true)
  })

  it('refuses: another account, an unknown id, a code that is already cancelled or paid', () => {
    const h = fresh()
    run(h, charge())
    const r = codeOf(h)
    const refused = (c: UserCommand) => {
      const x = h.node.dispatch(c)
      return x.ok ? 'accepted' : x.error
    }
    expect(refused(cancel(r.id, 'ana'))).toEqual({ code: 'not-allowed' })
    expect(refused(cancel('R-999999'))).toEqual({ code: 'invalid-state' })
    expect(refused(cancel('constructor'))).toEqual({ code: 'invalid-state' })
    run(h, payCode(r))
    expect(refused(cancel(r.id))).toEqual({ code: 'invalid-state', status: 'paid' })
    run(h, charge())
    const second = codeOf(h)
    run(h, cancel(second.id))
    expect(refused(cancel(second.id))).toEqual({ code: 'invalid-state', status: 'cancelled' })
  })
})

describe('paying a code', () => {
  it('Ana pays 11.00: Ana 236.50, café 296.89, fee 0.11 paid by the café, a purchase over QR, the code paid', () => {
    const h = fresh()
    run(h, charge())
    const r = codeOf(h)
    const events = run(h, payCode(r))
    const tx = (events[0] as Extract<LedgerEvent, { type: 'tx.submitted' }>).tx
    expect(tx).toMatchObject({ kind: 'purchase', channel: 'qr', to: 'cafe', from: 'ana' })
    expect(tx.links).toEqual({ requestId: r.id })
    expect(tx.items).toEqual(items)
    expect(tx.fee).toMatchObject({ policy: 'merchant', payer: 'recipient', fee: 11, senderDebit: 1100 })
    expect(tx.fee.card).toEqual({ lowEurCents: 15, highEurCents: 30 })
    expect(h.node.getState().requests[r.id]).toMatchObject({ status: 'paid', txId: tx.id })
    h.node.settleDue()
    expect(bal(h, 'ana')).toBe('236.50')
    expect(bal(h, 'cafe')).toBe('296.89')
    expect(formatHundredths(feesSince(h.node.getState(), h.node.seedState()))).toBe('0.11')
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('Espresso 2.20 alone: fee 0.02, no card comparison', () => {
    const h = fresh()
    const espresso = resolveItems(content, 'cafe', [{ sku: 'espresso', qty: 1 }])
    run(h, charge({ amount: m('2.20'), items: espresso }))
    const r = codeOf(h)
    const events = run(h, payCode(r))
    const tx = (events[0] as Extract<LedgerEvent, { type: 'tx.submitted' }>).tx
    expect(tx.fee.fee).toBe(2)
    expect(tx.fee.card).toBeUndefined()
  })

  it('a code is paid once, not after it was cancelled, and not after it ran out', () => {
    const h = fresh()
    run(h, charge())
    const r = codeOf(h)
    run(h, payCode(r))
    expect(h.node.dispatch(payCode(r, 'marko'))).toEqual({
      ok: false,
      error: { code: 'invalid-state', status: 'paid' },
    })

    const h2 = fresh()
    run(h2, charge())
    const r2 = codeOf(h2)
    run(h2, cancel(r2.id))
    expect(h2.node.dispatch(payCode(r2))).toEqual({
      ok: false,
      error: { code: 'invalid-state', status: 'cancelled' },
    })

    const h3 = fresh()
    run(h3, charge())
    const r3 = codeOf(h3)
    const pay = payCode(r3)
    h3.node.clock.jumpTo((h3.node.now() + VALIDITY - 1) as SimTime)
    expect(h3.node.dispatch(pay).ok).toBe(true)
    const h4 = fresh()
    run(h4, charge())
    const r4 = codeOf(h4)
    const late = payCode(r4)
    h4.node.clock.jumpTo((h4.node.now() + VALIDITY) as SimTime)
    expect(h4.node.dispatch(late)).toEqual({ ok: false, error: { code: 'invalid-state', status: 'expired' } })
    expect(h4.node.getState().requests[r4.id]?.status).toBe('open')
  })

  it('the amount and items must be the code’s; the debit must be what the review showed', () => {
    const h = fresh()
    run(h, charge())
    const r = codeOf(h)
    const refused = (c: UserCommand) => {
      const x = h.node.dispatch(c)
      return x.ok ? 'accepted' : x.error.code
    }
    expect(refused(payCode(r, 'ana', { amount: m('10.00'), expect: { senderDebit: m('10.00') } }))).toBe(
      'invalid-amount',
    )
    expect(refused(payCode(r, 'ana', { items: items.slice(0, 1) }))).toBe('invalid-amount')
    expect(refused(payCode(r, 'ana', { expect: { senderDebit: m('11.01') } }))).toBe('quote-changed')
    expect(refused(payCode(r, 'cafe'))).toBe('self-payment')
    expect(refused(payCode(r))).toBe('accepted')
  })

  it('the acceptance journey: sale, then the café pays the bakery 8.89 (café 288.00, bakery 8.80, fees 0.20)', () => {
    const h = fresh()
    run(h, charge())
    run(h, payCode(codeOf(h)))
    h.node.settleDue()
    run(h, {
      type: 'pay',
      actor: 'cafe',
      cmdId: id('review'),
      to: '@pekarnazrno',
      amount: m('8.80'),
      channel: 'username',
      note: 'Croissant delivery',
      expect: { senderDebit: m('8.89') },
    })
    h.node.settleDue()
    expect(bal(h, 'cafe')).toBe('288.00')
    expect(bal(h, 'bakery')).toBe('8.80')
    expect(formatHundredths(feesSince(h.node.getState(), h.node.seedState()))).toBe('0.20')
  })
})

describe('the saved log', () => {
  it('commands encode by sku and reference the code by the command that made it, and decode back', () => {
    const h = fresh()
    const create = charge()
    run(h, create)
    const r = codeOf(h)
    const s = h.node.getState()
    const wire = encodeCommand(s, create)
    expect(wire).toEqual({
      ok: true,
      value: {
        type: 'request.create',
        channel: 'pos',
        amount: '11.00',
        note: 'Table 4',
        items: [
          { sku: 'flat-white', qty: 2 },
          { sku: 'croissant', qty: 2 },
        ],
      },
    })
    const cancelCmd = cancel(r.id)
    const cancelWire = encodeCommand(s, cancelCmd)
    expect(cancelWire).toEqual({ ok: true, value: { type: 'request.cancel', requestRef: { cmdId: create.cmdId } } })
    if (!cancelWire.ok || !wire.ok) return
    const back = decodeCommand(s, content, { actor: 'cafe', cmdId: cancelCmd.cmdId, cmd: cancelWire.value })
    expect(back).toEqual({ ok: true, value: cancelCmd })
    const backCreate = decodeCommand(s, content, { actor: 'cafe', cmdId: create.cmdId, cmd: wire.value })
    expect(backCreate).toEqual({ ok: true, value: create })
    // A reference to a code that does not exist, and an item the café does not sell, do not decode.
    expect(
      decodeCommand(s, content, {
        actor: 'cafe',
        cmdId: id('cancel'),
        cmd: { type: 'request.cancel', requestRef: { cmdId: 'ffffffffffffffff:items' } },
      }),
    ).toEqual({ ok: false, error: 'unknown-ref' })
    expect(
      decodeCommand(s, content, {
        actor: 'cafe',
        cmdId: id(),
        cmd: { type: 'request.create', channel: 'pos', amount: '1.00', items: [{ sku: 'aurora-wings', qty: 1 }] },
      }),
    ).toEqual({ ok: false, error: 'unknown-item' })
  })

  it('a session with a sale, a cancelled code and an expired one replays to the same ledger', () => {
    const h = fresh()
    run(h, charge())
    run(h, cancel(codeOf(h).id))
    run(h, charge({ amount: m('2.20'), items: items.slice(1, 2).map((i) => ({ ...i, qty: 1 })) }))
    h.node.clock.jumpTo((h.node.now() + VALIDITY + 5000) as SimTime)
    run(h, charge())
    run(h, payCode(codeOf(h)))
    h.node.settleDue()
    const record = recordOf(h.node, h.seed.t0Date)
    // The file round trip: serialise, parse (untrusted), replay on the seed.
    const parsed = parseRecord(serializeRecord(record), {
      stateVersion: content.config.stateVersion,
      t0Weekday: 5,
      personaIds: new Set(content.personas.personas.map((p) => p.id)),
      acceptOlder: false,
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const r = replay({
      seed: h.seed.state,
      t0: h.seed.t0,
      t0Date: parsed.record.t0Date,
      content,
      log: parsed.record.log,
      clock: parsed.record.clock,
    })
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    expect(JSON.stringify(r.value.state)).toBe(JSON.stringify(h.node.getState()))
    expect(JSON.stringify(r.value.events)).toBe(JSON.stringify(h.node.events()))
  })

  it('rejects a file whose code command is malformed', () => {
    const h = fresh()
    run(h, charge())
    const record = recordOf(h.node, h.seed.t0Date)
    const text = serializeRecord(record)
    const bad = (mut: (j: { log: { cmd: Record<string, unknown> }[] }) => void) => {
      const j = JSON.parse(text)
      mut(j)
      return parseRecord(JSON.stringify(j), {
        stateVersion: content.config.stateVersion,
        t0Weekday: 5,
        personaIds: new Set(content.personas.personas.map((p) => p.id)),
        acceptOlder: false,
      })
    }
    expect(bad((j) => Object.assign(j.log[0]?.cmd ?? {}, { channel: 'username' })).ok).toBe(false)
    expect(bad((j) => Object.assign(j.log[0]?.cmd ?? {}, { extra: 1 })).ok).toBe(false)
    expect(bad((j) => Object.assign(j.log[0]?.cmd ?? {}, { amount: 11 })).ok).toBe(false)
    expect(bad((j) => Object.assign(j.log[0]?.cmd ?? {}, { note: '' })).ok).toBe(false)
    expect(bad(() => undefined).ok).toBe(true)
  })
})
