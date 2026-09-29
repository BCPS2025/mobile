import { describe, expect, it } from 'vitest'
import { parseContent } from '@content/schema'
import { quoteFee } from '@domain/fees'
import { fillTemplate, sessionCounter, sessionCounterText } from '@domain/counter'
import { invariants } from '@domain/invariants'
import type { FeePolicyId, LedgerState, Minor, SimTime, Tx } from '@domain/types'
import { createClock } from '@sim/clock'
import { buildSeed, simConfigFrom } from '@sim/seed'
import { addBusinessDays, cardPayoutWindow, formatTime, mostRecentWeekdayOnOrBefore, resolveLocal } from '@sim/tz'
import { createUiBus } from '@store/uiBus'
import catalogue from '../../content/catalogue.yaml'
import config from '../../content/config.yaml'
import copy from '../../content/copy.en.yaml'
import homes from '../../content/homes.yaml'
import notifications from '../../content/notifications.yaml'
import personas from '../../content/personas.yaml'
import seed from '../../content/seed.yaml'
import { EPOCH, content, m } from './helpers'

const simConfig = simConfigFrom(content)

function sessionTx(amount: string, policy: FeePolicyId): Tx {
  const q = quoteFee(m(amount), simConfig.fees[policy], simConfig.rate)
  if (!q.ok) throw new Error('quote')
  return {
    id: `t-${amount}-${policy}`,
    kind: 'purchase',
    channel: 'qr',
    status: 'confirmed',
    from: 'ana',
    to: 'cafe',
    amount: m(amount),
    fee: q.value,
    postings: [],
    createdAt: 0 as SimTime,
    dueAt: 0 as SimTime,
    confirmedAt: 0 as SimTime,
  }
}

describe('session counter (pure)', () => {
  const t =
    'Merchant payments {count} · fees {fees} BCPS ≈ €{eur} vs cards typically ≈ €{cardLow}–{cardHigh} plus additional charges'
  it('sums each counted payment’s own card range and converts the BCPS fee total', () => {
    const s1 = [sessionTx('11.00', 'merchant')]
    const s2 = [...s1, sessionTx('5.50', 'web-checkout')]
    const s3 = [...s2, sessionTx('11.00', 'subscription'), sessionTx('11.00', 'subscription')]
    expect(sessionCounterText(sessionCounter(s1, simConfig.rate), t)).toBe(
      'Merchant payments 1 · fees 0.11 BCPS ≈ €0.10 vs cards typically ≈ €0.15–0.30 plus additional charges',
    )
    expect(sessionCounterText(sessionCounter(s2, simConfig.rate), t)).toBe(
      'Merchant payments 2 · fees 0.17 BCPS ≈ €0.15 vs cards typically ≈ €0.23–0.45 plus additional charges',
    )
    expect(sessionCounterText(sessionCounter(s3, simConfig.rate), t)).toBe(
      'Merchant payments 4 · fees 0.39 BCPS ≈ €0.35 vs cards typically ≈ €0.53–1.05 plus additional charges',
    )
  })

  it('never counts transfers, small items, pending or seed payments', () => {
    const pending = { ...sessionTx('11.00', 'merchant'), status: 'pending' as const }
    const seeded: Tx = { ...sessionTx('11.00', 'merchant'), seed: true }
    const txs = [
      sessionTx('8.80', 'transfer'),
      sessionTx('3.30', 'merchant'),
      sessionTx('5.49', 'merchant'),
      pending,
      seeded,
    ]
    expect(sessionCounter(txs, simConfig.rate).count).toBe(0)
    expect(sessionCounterText(sessionCounter(txs, simConfig.rate), t)).toBeNull()
  })

  it('fillTemplate leaves unknown placeholders alone', () => {
    expect(fillTemplate('{a} and {b}', { a: 1 })).toBe('1 and {b}')
  })
})

describe('invariants detect corruption', () => {
  const s = buildSeed(content, EPOCH).state
  it('a non-zero-sum tx', () => {
    const id = s.txOrder[0] ?? ''
    const tx = s.txs[id] as Tx
    const bad: LedgerState = {
      ...s,
      txs: { ...s.txs, [id]: { ...tx, postings: [...tx.postings, { account: 'ana', delta: 1 as Minor }] } },
    }
    expect(invariants(bad).some((p) => p.includes('postings sum'))).toBe(true)
  })
  it('a negative available balance and a broken total', () => {
    const bad: LedgerState = { ...s, balances: { ...s.balances, bakery: { confirmed: -1 as Minor, held: 0 as Minor } } }
    const problems = invariants(bad)
    expect(problems.some((p) => p.includes('bakery available'))).toBe(true)
    expect(problems.some((p) => p.includes('sum to'))).toBe(true)
  })
  it('held funds without a pending tx', () => {
    const bad: LedgerState = {
      ...s,
      balances: { ...s.balances, ana: { confirmed: s.balances.ana?.confirmed ?? (0 as Minor), held: 5 as Minor } },
    }
    expect(invariants(bad).some((p) => p.includes('held'))).toBe(true)
  })
})

describe('content validation', () => {
  const raw = { config, personas, catalogue, seed, homes, notifications, copy }

  it('accepts the committed content', () => {
    expect(() => parseContent(raw)).not.toThrow()
  })

  it('rejects a float rate', () => {
    const bad = { ...raw, config: { ...(config as object), rate: { bcps: 1.1, eur: 1 } } }
    expect(() => parseContent(bad)).toThrow(/config.yaml/)
  })

  it('rejects amounts that are not two-decimal strings', () => {
    const s = seed as { rows: Record<string, unknown>[] }
    for (const amount of ['143.0', 143, '1,100.00']) {
      const rows = s.rows.map((r, i) => (i === 0 ? { ...r, amount } : r))
      expect(() => parseContent({ ...raw, seed: { ...s, rows } })).toThrow(/seed.yaml/)
    }
  })

  it('YAML is read with the 1.2 core schema (times stay strings)', () => {
    const s = seed as { rows: { at: { time: unknown } }[] }
    expect(typeof s.rows[0]?.at.time).toBe('string')
  })

  it('every seed labelKey exists in copy', () => {
    for (const row of content.seed.rows) {
      if (row.labelKey) expect((content.copy.seedRows as Record<string, unknown>)[row.labelKey]).toBeTypeOf('string')
    }
  })
})

describe('sim helpers', () => {
  it('the manual clock only moves when told to, and forward only (set is the exception)', () => {
    const clock = createClock({ start: 1000 as SimTime })
    let minutes = 0
    clock.subscribeMinute(() => (minutes += 1))
    expect(clock.now()).toBe(1000)
    clock.advance(500)
    clock.advance(0)
    expect(clock.now()).toBe(1500)
    expect(() => clock.jumpTo(200 as SimTime)).toThrow(/forward/)
    expect(() => clock.advance(-1)).toThrow()
    clock.jumpTo(61_000 as SimTime)
    expect(minutes).toBe(1)
    clock.set(200 as SimTime)
    expect(clock.now()).toBe(200)
    expect(minutes).toBe(2)
  })

  it('tz: Ljubljana wall times across DST', () => {
    expect(formatTime(resolveLocal('2026-10-25', '12:15', 'Europe/Ljubljana'), 'Europe/Ljubljana')).toBe('12:15')
    expect(formatTime(resolveLocal('2026-03-29', '12:15', 'Europe/Ljubljana'), 'Europe/Ljubljana')).toBe('12:15')
    expect(new Date(resolveLocal('2026-10-24', '12:15', 'Europe/Ljubljana')).getUTCHours()).toBe(10)
    expect(new Date(resolveLocal('2026-10-26', '12:15', 'Europe/Ljubljana')).getUTCHours()).toBe(11)
  })

  it('tz: weekday and business-day helpers', () => {
    expect(mostRecentWeekdayOnOrBefore('2026-09-24', 5)).toBe('2026-09-18')
    expect(addBusinessDays('2026-09-18', 1)).toBe('2026-09-21')
    expect(addBusinessDays('2026-09-18', 3)).toBe('2026-09-23')
    const fri = resolveLocal('2026-09-18', '12:15', 'Europe/Ljubljana')
    expect(cardPayoutWindow(fri)).toEqual({ first: 'Mon', last: 'Wed' })
  })

  it('uiBus delivers typed events and unsubscribes', () => {
    const bus = createUiBus()
    const got: string[] = []
    const off = bus.on('notify', (p) => got.push(`${p.phone}/${p.text}`))
    bus.emit('notify', { phone: 'ana', text: 'received' })
    off()
    bus.emit('notify', { phone: 'ana', text: 'received' })
    expect(got).toEqual(['ana/received'])
  })
})
