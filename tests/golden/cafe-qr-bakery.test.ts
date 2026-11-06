// Golden journey cafe-qr-bakery, driven by plain engine commands: the café
// sale of 11.00 by QR (1 % fee 0.11, paid by the café), then the café pays its bakery 8.80 (fee
// 0.09 on top). Checked at the three golden epochs.
import { describe, expect, it } from 'vitest'
import { fillTemplate } from '@domain/counter'
import { invariants } from '@domain/invariants'
import { evolve } from '@domain/ledger'
import { formatHundredths } from '@domain/money'
import { approxEur } from '@domain/rate'
import type { AccountId, LedgerState, Tx } from '@domain/types'
import { LJUBLJANA, cardPayoutWindow, formatTime } from '@sim/tz'
import { createLedgerNode } from '@store/node'
import { type StateRecord, serializeRecord, stableStringify } from '@store/record'
import { replay } from '@store/replay'
import { restoreText } from '@store/restore'
import { feesSince, lastSessionTx, quoteFor, txByCmdId } from '@store/selectors'
import { type Headless, headless, instantOf, runJourney } from '../support/journey'
import { recordOf } from '../support/records'
import { content } from '../unit/helpers'
import { cafeQrBakery } from './journeys/cafe-qr-bakery'

const EPOCHS = ['2026-09-25', '2026-10-23', '2027-03-26'] as const

const journey = cafeQrBakery(content)
const [sale, supplier] = [journey.slice(0, 1), journey.slice(1)]

const bal = (s: LedgerState, a: AccountId) => formatHundredths(s.balances[a]?.confirmed ?? Number.NaN)
const snapshot = (h: Headless) =>
  JSON.stringify({ state: h.node.getState(), events: h.node.events(), commands: h.node.commands(), now: h.node.now() })

function expectEndState(h: Headless) {
  expectEndBalances(h.node.getState(), h.node.seedState())
  expect(h.node.hasPending()).toBe(false)
}

function expectEndBalances(s: LedgerState, seed: LedgerState) {
  expect(bal(s, 'ana')).toBe('236.50')
  expect(bal(s, 'cafe')).toBe('288.00')
  expect(bal(s, 'bakery')).toBe('8.80')
  expect(formatHundredths(feesSince(s, seed))).toBe('0.20')
  // Untouched personas keep their seed balances.
  expect(bal(s, 'marko')).toBe('132.98')
  expect(bal(s, 'studio')).toBe('1,254.00')
  expect(bal(s, 'firm')).toBe('12,100.00')
  expect(bal(s, 'supplier')).toBe('880.00')
  expect(s.pending).toEqual([])
  expect(invariants(s)).toEqual([])
}

/** The live journey and its record (the state-file format: calendar stamps, stored commands). */
function liveWithRecord(epoch: string): { h: Headless; record: StateRecord } {
  const h = headless(epoch)
  runJourney(h, journey)
  return { h, record: recordOf(h.node, h.seed.t0Date) }
}

/** Replays a record headlessly on the seed of its own T0; invariants after every event. */
function replayRecord(h: Headless, record: StateRecord) {
  const r = replay({
    seed: h.seed.state,
    t0: h.seed.t0,
    t0Date: record.t0Date,
    content,
    log: record.log,
    clock: record.clock,
  })
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  let s = h.seed.state
  for (const e of r.value.events) {
    s = evolve(s, e)
    expect(invariants(s)).toEqual([])
  }
  return r.value
}

describe.each(EPOCHS)('cafe-qr-bakery at T0 = %s', (epoch) => {
  it('the journey is the 11.00 order and the 8.80 bakery payment', () => {
    const [first, second] = journey
    expect(first?.cmd).toMatchObject({ actor: 'ana', to: '@cafelipa', amount: 1100, channel: 'qr' })
    expect(first?.cmd.type === 'pay' && first.cmd.items).toEqual([
      { sku: 'flat-white', name: 'Flat white', qty: 2, price: 330 },
      { sku: 'croissant', name: 'Croissant', qty: 2, price: 220 },
    ])
    expect(second?.cmd).toMatchObject({ actor: 'cafe', to: '@pekarnazrno', amount: 880, channel: 'username' })
  })

  it('sale: Ana 236.50, café 296.89, fee 0.11 (≈ €0.10) paid by the café, card range €0.15–0.30', () => {
    const h = headless(epoch)
    expect(formatTime(h.node.now(), LJUBLJANA)).toBe('12:15')
    runJourney(h, sale)
    const s = h.node.getState()
    expect(bal(s, 'ana')).toBe('236.50')
    expect(bal(s, 'cafe')).toBe('296.89')
    expect(formatHundredths(feesSince(s, h.node.seedState()))).toBe('0.11')

    const tx = lastSessionTx(s) as Tx
    expect(tx.status).toBe('confirmed')
    expect(tx.id).toMatch(/^BC-[0-9A-HJKMNP-TV-Z]{6}$/)
    expect(tx.cmdId).toBe('3be07a9c11f45d62:review')
    expect(txByCmdId(s, '3be07a9c11f45d62:review')).toBe(tx)
    expect(tx.createdAt).toBe(instantOf(h.seed.t0Date, { day: 0, time: '12:16:00.000' }))
    expect(tx.confirmedAt).toBe(tx.createdAt + 1400)
    expect(formatHundredths(tx.fee.fee)).toBe('0.11')
    expect(formatHundredths(approxEur(tx.fee.fee, s.config.rate))).toBe('0.10')
    expect(tx.fee.payer).toBe('recipient')
    expect(formatHundredths(tx.fee.recipientCredit)).toBe('10.89')
    expect(tx.fee.card).toEqual({ lowEurCents: 15, highEurCents: 30 })
    // What the review step quotes is what decide charged.
    expect(quoteFor(h.node.seedState(), 'cafe', 'qr', tx.amount)).toEqual(tx.fee)

    // The merchant payment-detail lines (shared.tx) fill from the sale; PAID shows none of them (D30).
    const card = {
      cardLow: formatHundredths(tx.fee.card?.lowEurCents ?? 0),
      cardHigh: formatHundredths(tx.fee.card?.highEurCents ?? 0),
    }
    const net = fillTemplate(content.copy.txDetail.net, {
      net: formatHundredths(tx.fee.recipientCredit),
      fee: formatHundredths(tx.fee.fee),
      eur: formatHundredths(approxEur(tx.fee.fee, s.config.rate)),
    })
    expect(net).toBe('Net 10.89 · Transaction fee 1% · 0.11 BCPS (≈ €0.10)')
    expect(fillTemplate(content.copy.txDetail.cards, card)).toBe(
      'Cards typically ≈ €0.15–0.30 · 1.5–3% plus additional charges',
    )
    expect(fillTemplate(content.copy.txDetail.payout, cardPayoutWindow(tx.confirmedAt ?? tx.createdAt))).toBe(
      'Card payout would typically arrive Mon–Wed (1–3 business days) · typical',
    )
  })

  it('bakery: café 288.00 (8.80 + fee 0.09), bakery 8.80, fees 0.20 in total', () => {
    const h = headless(epoch)
    runJourney(h, sale)
    runJourney(h, supplier)
    expectEndState(h)
    const tx = lastSessionTx(h.node.getState()) as Tx
    expect(tx.fee.policy).toBe('transfer')
    expect(tx.fee.payer).toBe('sender')
    expect(formatHundredths(tx.fee.fee)).toBe('0.09')
    expect(formatHundredths(tx.fee.senderDebit)).toBe('8.89')
    expect(tx.note).toBe('Croissant delivery')
  })

  it('invariants hold after every event, live and on replay; replay is byte-identical', () => {
    const h = headless(epoch)
    const problems: string[][] = []
    h.node.onEvent((_e, s) => problems.push(invariants(s)))
    const events = runJourney(h, journey)
    expect(events).toHaveLength(4)
    expect(problems).toHaveLength(4)
    for (const p of problems) expect(p).toEqual([])

    let s = h.node.seedState()
    for (const e of h.node.events()) {
      s = evolve(s, e)
      expect(invariants(s)).toEqual([])
    }
    expect(JSON.stringify(s)).toBe(JSON.stringify(h.node.getState()))
    expectEndState(h)
  })

  it('live and replayed from its record: byte-identical state and events', () => {
    const { h, record } = liveWithRecord(epoch)
    const replayed = replayRecord(h, record)
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(h.node.getState()))
    expect(JSON.stringify(replayed.events)).toBe(JSON.stringify(h.node.events()))
    expect(replayed.clock).toBe(h.node.now())
    expectEndBalances(replayed.state, h.seed.state)
    // The production restore path (parse, validate, replay, invariants, fingerprint) agrees.
    const restored = restoreText(serializeRecord(record), { content }, { acceptOlder: false })
    if (!restored.ok) throw new Error(JSON.stringify(restored.error))
    expect(restored.value.recalculated).toBe(false)
    expect(JSON.stringify(restored.value.session.state)).toBe(JSON.stringify(h.node.getState()))
  })

  it('10 × (reset → replay of the record) gives the live bytes every time', () => {
    const { h, record } = liveWithRecord(epoch)
    const live = JSON.stringify({ state: h.node.getState(), events: h.node.events() })
    const node = createLedgerNode({ seed: h.seed.state, t0: h.seed.t0 })
    const seen = new Set<string>()
    for (let i = 0; i < 10; i++) {
      node.resetToSeed()
      const r = replayRecord(h, record)
      node.loadSession({ seed: h.seed.state, t0: h.seed.t0, ...r })
      expectEndBalances(node.getState(), node.seedState())
      seen.add(JSON.stringify({ state: node.getState(), events: node.events() }))
      seen.add(serializeRecord(recordOf(node, h.seed.t0Date)))
    }
    expect([...seen]).toEqual([live, serializeRecord(record)])
  })

  it('10 × (reset → journey) gives identical state', () => {
    const h = headless(epoch)
    const snapshots: string[] = []
    for (let i = 0; i < 10; i++) {
      h.node.resetToSeed()
      expect(h.node.events()).toHaveLength(0)
      expect(h.node.commands()).toHaveLength(0)
      expect(h.node.now()).toBe(h.seed.t0)
      runJourney(h, journey)
      expectEndState(h)
      snapshots.push(snapshot(h))
    }
    expect(new Set(snapshots).size).toBe(1)
    // A fresh node produces the same bytes.
    const other = headless(epoch)
    runJourney(other, journey)
    expect(snapshot(other)).toBe(snapshots[0])
  })
})

describe('cafe-qr-bakery across the epochs', () => {
  it('stores the same calendar-stamped log at every epoch, and each replays on the others', () => {
    const records = EPOCHS.map((epoch) => liveWithRecord(epoch))
    const logs = new Set(records.map(({ record }) => stableStringify({ log: record.log, clock: record.clock })))
    expect(logs.size).toBe(1)
    // Re-based onto another Friday by calendar: the same balances and wall-clock times.
    for (const { record } of records) {
      for (const epoch of EPOCHS) {
        const h = headless(epoch)
        const replayed = replayRecord(h, { ...record, t0Date: h.seed.t0Date })
        expectEndBalances(replayed.state, h.seed.state)
        const sale = replayed.state.txs[replayed.state.txOrder.at(-2) as string] as Tx
        expect(formatTime(sale.createdAt, LJUBLJANA)).toBe('12:16')
      }
    }
  })
})
