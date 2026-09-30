import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import { formatHundredths } from '@domain/money'
import type { LedgerEvent, LedgerState, Tx, UserCommand } from '@domain/types'
import { resolveItems } from '@sim/seed'
import { decodeCommand, encodeCommand } from '@store/log-codec'
import { checkWireCommand } from '@store/record'
import { replay } from '@store/replay'
import { type Headless, headless } from '../support/journey'
import { recordOf } from '../support/records'
import { content, m } from './helpers'

// refund: a merchant returns a sale in full, no fee, the fee of the sale is not returned.

let n = 0
const id = (step = 'review') => `${(++n).toString(16).padStart(16, '0')}:${step}`
const refund = (txId: string, actor = 'cafe'): UserCommand => ({ type: 'refund', actor, cmdId: id('refund'), txId })
const seedTx = (h: Headless, key: string): Tx => {
  const tx = Object.values(h.node.getState().txs).find((t) => t.seedMeta?.key === key)
  if (!tx) throw new Error(`no seed row ${key}`)
  return tx
}
const run = (h: Headless, c: UserCommand): LedgerEvent[] => {
  const r = h.node.dispatch(c)
  if (!r.ok) throw new Error(`refused ${r.error.code}`)
  return r.value
}
const refusal = (h: Headless, c: UserCommand) => {
  const r = h.node.dispatch(c)
  return r.ok ? 'accepted' : r.error
}
const bal = (s: LedgerState, a: string) => formatHundredths(s.balances[a]?.confirmed ?? Number.NaN)
const fees = (h: Headless) =>
  formatHundredths(
    (h.node.getState().balances['sys:fees']?.confirmed ?? 0) -
      (h.node.seedState().balances['sys:fees']?.confirmed ?? 0),
  )
const sale = (h: Headless, cmdId = id()): Tx => {
  const items = resolveItems(content, 'cafe', [
    { sku: 'flat-white', qty: 2 },
    { sku: 'croissant', qty: 2 },
  ])
  run(h, {
    type: 'pay',
    actor: 'ana',
    cmdId,
    to: '@cafelipa',
    amount: m('11.00'),
    channel: 'qr',
    items,
    expect: { senderDebit: m('11.00') },
  })
  h.node.settleDue()
  return Object.values(h.node.getState().txs).find((t) => t.cmdId === cmdId) as Tx
}

describe('refund of the seeded Brunch (26.40)', () => {
  it('returns it in full with no fee: café 259.60, Ana 273.90; the 0.26 fee stays with the network', () => {
    const h = headless('2026-09-25')
    const brunch = seedTx(h, 'cafe-thu-brunch')
    const events = run(h, refund(brunch.id))
    expect(events.map((e) => e.type)).toEqual(['tx.submitted'])
    const tx = (events[0] as Extract<LedgerEvent, { type: 'tx.submitted' }>).tx
    expect(tx).toMatchObject({
      kind: 'refund',
      status: 'pending',
      from: 'cafe',
      to: 'ana',
      amount: 2640,
      note: 'Brunch for two',
      links: { refundOf: brunch.id },
    })
    expect(tx.fee).toMatchObject({ policy: 'refund', fee: 0, senderDebit: 2640, recipientCredit: 2640 })
    expect(tx.items).toEqual(brunch.items)
    // Marked at once: the sale reads refunded while the refund settles.
    expect(h.node.getState().txs[brunch.id]?.refundedBy).toBe(tx.id)
    expect(bal(h.node.getState(), 'cafe')).toBe('286.00')
    h.node.settleDue()
    const s = h.node.getState()
    expect(bal(s, 'cafe')).toBe('259.60')
    expect(bal(s, 'ana')).toBe('273.90')
    expect(fees(h)).toBe('0.00')
    expect(invariants(s)).toEqual([])
  })

  it('a second attempt is "already refunded", also while the first is still settling', () => {
    const h = headless('2026-09-25')
    const brunch = seedTx(h, 'cafe-thu-brunch')
    run(h, refund(brunch.id))
    expect(refusal(h, refund(brunch.id))).toEqual({ code: 'already-refunded' })
    h.node.settleDue()
    expect(refusal(h, refund(brunch.id))).toEqual({ code: 'already-refunded' })
    expect(bal(h.node.getState(), 'cafe')).toBe('259.60')
  })

  it('a refund of a live 11.00 sale costs the café the full 11.00 although it received 10.89', () => {
    const h = headless('2026-09-25')
    const s = sale(h)
    expect(bal(h.node.getState(), 'cafe')).toBe('296.89')
    run(h, refund(s.id))
    h.node.settleDue()
    expect(bal(h.node.getState(), 'cafe')).toBe('285.89')
    expect(bal(h.node.getState(), 'ana')).toBe('247.50')
    expect(fees(h)).toBe('0.11')
    expect(invariants(h.node.getState())).toEqual([])
  })
})

describe('what can be refunded', () => {
  it('only the recipient of the sale', () => {
    const h = headless('2026-09-25')
    expect(refusal(h, refund(seedTx(h, 'cafe-thu-brunch').id, 'ana'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, refund(seedTx(h, 'cafe-thu-brunch').id, 'studio'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, refund(seedTx(h, 'cafe-thu-brunch').id, 'nobody'))).toEqual({ code: 'not-allowed' })
  })

  it('not a daily summary row, a carried-over balance, a transfer, a top-up or a conversion', () => {
    const h = headless('2026-09-25')
    for (const key of ['cafe-thu', 'cafe-today', 'cafe-carried-over']) {
      expect(refusal(h, refund(seedTx(h, key).id)), key).toEqual({ code: 'invalid-state' })
    }
    // A conversion is paid out by the account, not received by it.
    for (const key of ['cafe-cashout-wed', 'cafe-autoconvert-thu']) {
      expect(refusal(h, refund(seedTx(h, key).id)), key).toEqual({ code: 'not-allowed' })
    }
    expect(refusal(h, refund(seedTx(h, 'taxi-share').id, 'ana'))).toEqual({ code: 'invalid-state' })
    expect(refusal(h, refund(seedTx(h, 'ana-topup-card').id, 'ana'))).toEqual({ code: 'invalid-state' })
    expect(refusal(h, refund('BC-NOPE00'))).toEqual({ code: 'invalid-state' })
  })

  it('not a sale that is still settling', () => {
    const h = headless('2026-09-25')
    const cmdId = id()
    run(h, {
      type: 'pay',
      actor: 'ana',
      cmdId,
      to: '@cafelipa',
      amount: m('11.00'),
      channel: 'qr',
      expect: { senderDebit: m('11.00') },
    })
    const pending = Object.values(h.node.getState().txs).find((t) => t.cmdId === cmdId) as Tx
    expect(refusal(h, refund(pending.id))).toEqual({ code: 'invalid-state', status: 'pending' })
  })

  it('a refund cannot be refunded', () => {
    const h = headless('2026-09-25')
    run(h, refund(seedTx(h, 'cafe-thu-brunch').id))
    h.node.settleDue()
    const back = Object.values(h.node.getState().txs).find((t) => t.kind === 'refund') as Tx
    expect(refusal(h, refund(back.id, 'ana'))).toEqual({ code: 'invalid-state' })
  })

  it('needs funds for the whole amount: "You have … The refund needs 26.40"', () => {
    const h = headless('2026-09-25')
    run(h, { type: 'ramp.off', actor: 'cafe', cmdId: id('cashout'), amount: m('270.00') })
    h.node.settleDue()
    expect(bal(h.node.getState(), 'cafe')).toBe('16.00')
    expect(refusal(h, refund(seedTx(h, 'cafe-thu-brunch').id))).toEqual({
      code: 'insufficient-funds',
      have: m('16.00'),
      short: m('10.40'),
    })
    expect(h.node.getState().txs[seedTx(h, 'cafe-thu-brunch').id]?.refundedBy).toBeUndefined()
  })

  it('a repeated command id is a duplicate', () => {
    const h = headless('2026-09-25')
    const c = refund(seedTx(h, 'cafe-thu-brunch').id)
    run(h, c)
    expect(refusal(h, c)).toEqual({ code: 'duplicate' })
  })
})

describe('named sales of the studio', () => {
  it('a purchase by an off-stage person goes back to them off-stage, with their handle on the posting', () => {
    const h = headless('2026-09-25')
    const gems = seedTx(h, 'studio-luka-gems')
    const events = run(h, refund(gems.id, 'studio'))
    const tx = (events[0] as Extract<LedgerEvent, { type: 'tx.submitted' }>).tx
    expect(tx).toMatchObject({ from: 'studio', to: 'sys:offstage', party: '@luka', amount: 550 })
    expect(tx.postings).toContainEqual({ account: 'sys:offstage', delta: 550, party: '@luka' })
    h.node.settleDue()
    expect(bal(h.node.getState(), 'studio')).toBe('1,248.50')
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('a subscription charge can be refunded; the subscription itself is untouched', () => {
    const h = headless('2026-09-25')
    const renewal = seedTx(h, 'studio-renewal-eva')
    run(h, refund(renewal.id, 'studio'))
    h.node.settleDue()
    expect(bal(h.node.getState(), 'studio')).toBe('1,243.00')
    expect(h.node.getState().txs[renewal.id]?.refundedBy).toBeDefined()
  })

  it('refunding a one-off item takes it away first: Marko no longer owns the skin', () => {
    const h = headless('2026-09-25')
    const skin = seedTx(h, 'studio-tue-skin')
    expect(h.node.getState().ownership.marko).toEqual(['aurora-wings'])
    const events = run(h, refund(skin.id, 'studio'))
    expect(events.map((e) => e.type)).toEqual(['ownership.revoked', 'tx.submitted'])
    expect(events[0]).toMatchObject({ party: 'marko', sku: 'aurora-wings' })
    expect(h.node.getState().ownership.marko).toEqual([])
    h.node.settleDue()
    expect(bal(h.node.getState(), 'marko')).toBe('134.08') // 132.98 plus the 1.10 given back
    expect(invariants(h.node.getState())).toEqual([])
  })
})

describe('the log form of a refund', () => {
  it('names a seeded sale by its seed row and a live one by the command that made it', () => {
    const h = headless('2026-09-25')
    const brunch = seedTx(h, 'cafe-thu-brunch')
    const c1 = refund(brunch.id)
    expect(encodeCommand(h.node.getState(), c1)).toEqual({
      ok: true,
      value: { type: 'refund', txRef: { seedRow: 'cafe-thu-brunch' } },
    })
    const cmdId = id()
    const live = sale(h, cmdId)
    const c2 = refund(live.id)
    const wire = encodeCommand(h.node.getState(), c2)
    expect(wire).toEqual({ ok: true, value: { type: 'refund', txRef: { cmdId } } })
    if (!wire.ok) return
    expect(checkWireCommand(wire.value)).toBeNull()
    expect(decodeCommand(h.node.getState(), content, { actor: 'cafe', cmdId: c2.cmdId, cmd: wire.value })).toEqual({
      ok: true,
      value: c2,
    })
    expect(encodeCommand(h.node.getState(), refund('BC-NOPE00'))).toEqual({ ok: false, error: 'unknown-ref' })
  })

  it('a session with a sale, a refund and a skin refund replays to the same ledger', () => {
    const h = headless('2026-09-25')
    const live = sale(h)
    run(h, refund(live.id))
    run(h, refund(seedTx(h, 'cafe-thu-brunch').id))
    run(h, refund(seedTx(h, 'studio-tue-skin').id, 'studio'))
    h.node.settleDue()
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
