import { describe, expect, it } from 'vitest'
import { isConversionPolicy } from '@domain/fees'
import { invariants } from '@domain/invariants'
import { formatHundredths } from '@domain/money'
import type { AccountId, PersonaId, SimTime } from '@domain/types'
import { buildSeed } from '@sim/seed'
import { addDays, formatTime, formatWeekday, localDateOf } from '@sim/tz'
import { EPOCH, content } from './helpers'

const expected: Record<PersonaId, string> = {
  ana: '247.50',
  marko: '132.98',
  cafe: '286.00',
  studio: '1,254.00',
  firm: '12,100.00',
  supplier: '880.00',
  bakery: '0.00',
}

describe('seed ledger', () => {
  const seed = buildSeed(content, EPOCH)
  const s = seed.state

  it('has all seven personas', () => {
    expect(seed.personas.map((p) => p.id).sort()).toEqual(Object.keys(expected).sort())
  })

  it.each(Object.entries(expected))('%s starts at %s BCPS (sum of its rows)', (id, balance) => {
    const rowsSum = s.txOrder
      .map((txId) => s.txs[txId])
      .flatMap((tx) => tx?.postings ?? [])
      .filter((p) => p.account === id)
      .reduce((acc, p) => acc + p.delta, 0)
    expect(formatHundredths(rowsSum)).toBe(balance)
    expect(formatHundredths(s.balances[id as AccountId]?.confirmed ?? -1)).toBe(balance)
    expect(s.balances[id as AccountId]?.held).toBe(0)
  })

  it('every row sums to zero, fee postings to sys:fees included', () => {
    for (const id of s.txOrder) {
      const tx = s.txs[id]
      expect(tx).toBeDefined()
      if (!tx) continue
      expect(tx.postings.reduce((acc, p) => acc + p.delta, 0)).toBe(0)
      const toFees = tx.postings.filter((p) => p.account === 'sys:fees').reduce((acc, p) => acc + p.delta, 0)
      expect(toFees).toBe(tx.fee.fee)
    }
  })

  it('the seed sys:fees holds 46.10 (21.78 in-network + 24.32 conversion)', () => {
    expect(formatHundredths(s.balances['sys:fees']?.confirmed ?? -1)).toBe('46.10')
    const fees = (conversion: boolean, who?: AccountId) =>
      Object.values(s.txs)
        .filter((tx) => isConversionPolicy(tx.fee.policy) === conversion)
        .filter((tx) => who === undefined || tx.from === who || tx.to === who)
        .reduce((acc, tx) => acc + tx.fee.fee, 0)
    expect(formatHundredths(fees(false))).toBe('21.78')
    expect(formatHundredths(fees(true))).toBe('24.32')
    // In the network: Ana 0.07, Marko 0.31, café 12.20, studio 9.20 (the payer of each fee).
    expect(formatHundredths(fees(false, 'cafe'))).toBe('12.20')
    expect(formatHundredths(fees(false, 'studio'))).toBe('9.20')
    // Conversions: café 15.32, studio 9.00.
    expect(formatHundredths(fees(true, 'cafe'))).toBe('15.32')
    expect(formatHundredths(fees(true, 'studio'))).toBe('9.00')
  })

  it('per-persona row deltas match the reference tables', () => {
    const rowsOf = (id: AccountId) =>
      s.txOrder
        .map((txId) => s.txs[txId])
        .filter((tx) => tx?.postings.some((p) => p.account === id))
        .map((tx) => formatHundredths(tx?.postings.find((p) => p.account === id)?.delta ?? 0))
    // Seed rows: Ana A1–A7, Marko, café C1–C15, studio L1–L19 (chronological).
    // D29: the taxi share (8.61) and the pizza (7.44 + 0.07) keep Ana's and
    // Marko's start balances; the carried-over rows C1 (97.59) and L1 (944.70) close the rest.
    expect(rowsOf('ana')).toEqual(['143.00', '8.61', '−7.51', '110.00', '−2.20', '22.00', '−26.40'])
    expect(rowsOf('marko')).toEqual(['110.00', '−8.70', '55.00', '−1.10', '−22.22'])
    expect(rowsOf('cafe')).toEqual([
      '97.59',
      '331.23',
      '−214.41',
      '177.37',
      '−195.89',
      '2.18',
      '141.59',
      '−169.83',
      '139.67',
      '−220.00',
      '−44.75',
      '26.14',
      '280.57',
      '−175.73',
      '110.27',
    ])
    expect(rowsOf('studio')).toEqual([
      '944.70',
      '118.70',
      '149.19',
      '151.37',
      '−600.00',
      '86.03',
      '1.09',
      '104.54',
      '108.90',
      '121.97',
      '10.89',
      '10.89',
      '10.89',
      '10.89',
      '5.44',
      '1.09',
      '5.44',
      '10.89',
      '1.09',
    ])
    expect(rowsOf('firm')).toEqual(['12,100.00'])
    expect(rowsOf('supplier')).toEqual(['880.00'])
    expect(rowsOf('bakery')).toEqual([])
  })

  it('the café holds 44.75 after the Wednesday conversion (C11)', () => {
    let cafe = 0
    for (const id of s.txOrder) {
      const tx = s.txs[id]
      cafe += tx?.postings.filter((p) => p.account === 'cafe').reduce((a, p) => a + p.delta, 0) ?? 0
      if (tx?.seedMeta?.key === 'cafe-autoconvert-wed') break
    }
    expect(formatHundredths(cafe)).toBe('44.75')
  })

  it('named off-stage rows carry the party on the tx and on the sys:offstage posting', () => {
    const pizza = Object.values(s.txs).find((tx) => tx.seedMeta?.key === 'ana-pizza')
    expect(pizza?.to).toBe('sys:offstage')
    expect(pizza?.party).toBe('@marta_k')
    expect(pizza?.postings.find((p) => p.account === 'sys:offstage')?.party).toBe('@marta_k')
    for (const tx of Object.values(s.txs)) {
      for (const p of tx.postings) if (p.party !== undefined) expect(p.account).toBe('sys:offstage')
    }
  })

  it('summary rows: fee = 1 % of the gross paid by the business; studio gross = Σ mix × price', () => {
    const sat = Object.values(s.txs).find((tx) => tx.seedMeta?.key === 'cafe-sat')
    expect(sat?.summary?.count).toBe(48)
    expect(formatHundredths(sat?.amount ?? 0)).toBe('334.58')
    expect(formatHundredths(sat?.fee.fee ?? 0)).toBe('3.35')
    expect(sat?.fee.rule).toBe('percent')
    expect(sat?.fee.payer).toBe('recipient')
    expect(sat?.fee.card).toBeUndefined()
    const studioSat = Object.values(s.txs).find((tx) => tx.seedMeta?.key === 'studio-sat')
    expect(studioSat?.summary?.mix).toEqual({ 'season-pass': 4, 'gem-pack-500': 15, 'aurora-wings': 22 })
    expect(formatHundredths(studioSat?.amount ?? 0)).toBe('150.70')
    expect(formatHundredths(studioSat?.fee.fee ?? 0)).toBe('1.51')
    const today = Object.values(s.txs).find((tx) => tx.seedMeta?.key === 'cafe-today')
    expect(formatHundredths(today?.fee.fee ?? 0)).toBe('1.11')
    expect(formatHundredths(today?.fee.recipientCredit ?? 0)).toBe('110.27')
  })

  it('conversions: 1.5 % out of the converted amount, ≈ € of the rest (C3, C10, C14, L5)', () => {
    const row = (key: string) => Object.values(s.txs).find((tx) => tx.seedMeta?.key === key)
    const conv = (key: string) => {
      const tx = row(key)
      return [tx?.amount, tx?.fee.fee, tx?.fee.eurOut].map((v) => formatHundredths(v ?? -1))
    }
    expect(conv('cafe-autoconvert-sat')).toEqual(['214.41', '3.22', '191.99'])
    expect(conv('cafe-cashout-wed')).toEqual(['220.00', '3.30', '197.00'])
    expect(conv('cafe-autoconvert-thu')).toEqual(['175.73', '2.64', '157.35'])
    expect(conv('studio-cashout-mon')).toEqual(['600.00', '9.00', '537.27'])
    // Week payouts (C3, C5, C8, C10, C11, C14): 1,020.61 converted, 15.32 conversion, ≈ €913.89.
    const payouts = Object.values(s.txs).filter((tx) => tx.from === 'cafe' && tx.kind === 'off-ramp')
    expect(formatHundredths(payouts.reduce((a, tx) => a + tx.amount, 0))).toBe('1,020.61')
    expect(formatHundredths(payouts.reduce((a, tx) => a + tx.fee.fee, 0))).toBe('15.32')
    expect(formatHundredths(payouts.reduce((a, tx) => a + (tx.fee.eurOut ?? 0), 0))).toBe('913.89')
  })

  it('references are BC- plus six characters, in chronological order of refSeq, all distinct', () => {
    expect(new Set(s.txOrder).size).toBe(s.txOrder.length)
    for (const id of s.txOrder) expect(id).toMatch(/^BC-[0-9A-HJKMNP-TV-Z]{6}$/)
    expect(s.counters.refSeq).toBeGreaterThanOrEqual(s.txOrder.length)
    // Stable on every build of the seed and at every epoch.
    expect(buildSeed(content, '2027-03-26').state.txOrder).toEqual(s.txOrder)
  })

  it('seeded requests and invoices are open, with the fee payer fixed at creation', () => {
    const lunch = s.requests.r_seed_lunch
    expect(lunch).toMatchObject({ requester: 'marko', payer: 'ana', amount: 1320, status: 'open', channel: 'username' })
    expect(lunch?.feePayer).toBe('sender')
    const hb = s.requests['HB-0917']
    expect(hb).toMatchObject({ requester: 'supplier', payer: 'firm', amount: 110000, channel: 'invoice' })
    expect(hb?.invoice?.description).toBe('Tooling spare parts')
    expect(s.requests['PZ-0412']).toMatchObject({ requester: 'bakery', payer: 'cafe', amount: 5280 })
    const due = hb?.invoice?.dueAt ?? 0
    expect(localDateOf(due as SimTime, 'Europe/Ljubljana')).toBe(addDays(seed.t0Date, 7))
  })

  it('directory: personas plus off-stage people, handles unique; merchant settings, plans, ownership', () => {
    expect(Object.keys(s.directory)).toHaveLength(7 + 10)
    expect(s.directory['@marta_k']).toMatchObject({ offstage: true, displayName: 'Marta K.' })
    expect(s.handles['@cafelipa']).toBe('cafe')
    expect(s.directory.cafe?.merchant).toBe(true)
    expect(s.directory.studio?.merchant).toBe(true)
    expect(s.directory.firm?.merchant).toBeUndefined()
    expect(Object.keys(s.merchant).sort()).toEqual(['cafe', 'firm', 'studio', 'supplier'])
    expect(s.merchant.cafe?.autoConvert).toMatchObject({ enabled: true, schedule: 'daily', sharePct: 50 })
    expect(s.plans['season-pass']?.amount).toBe(1100)
    expect(s.ownership.marko).toEqual(['aurora-wings'])
    expect(s.stats.studio.activeSubscribers).toBe(142)
    expect(s.counters.invoiceSeq.supplier).toEqual({ prefix: 'HB', next: 918 })
  })

  it('is healthy', () => {
    expect(invariants(s)).toEqual([])
  })

  it('all rows are marked seed and are at or before T0', () => {
    for (const id of s.txOrder) {
      expect(s.txs[id]?.seed).toBe(true)
      expect(s.txs[id]?.createdAt ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(seed.t0)
    }
  })
})

describe('T0', () => {
  it.each([
    ['2026-09-24', '2026-09-18'], // Thursday -> previous Friday
    ['2026-09-25', '2026-09-25'], // Friday -> same day
    ['2026-09-27', '2026-09-25'], // Sunday -> Friday
    ['2026-01-15', '2026-01-09'], // winter
    ['2026-07-01', '2026-06-26'], // summer
  ])('epoch %s -> Friday %s at 12:15 Europe/Ljubljana', (epoch, friday) => {
    const { t0, t0Date } = buildSeed(content, epoch)
    expect(t0Date).toBe(friday)
    expect(localDateOf(t0, 'Europe/Ljubljana')).toBe(friday)
    expect(formatTime(t0, 'Europe/Ljubljana')).toBe('12:15')
    expect(formatWeekday(t0, 'Europe/Ljubljana')).toBe('Fri')
  })

  it('winter and summer offsets differ by one hour in UTC', () => {
    const winter = buildSeed(content, '2026-01-09').t0
    const summer = buildSeed(content, '2026-06-26').t0
    expect(new Date(winter).getUTCHours()).toBe(11)
    expect(new Date(summer).getUTCHours()).toBe(10)
  })

  it('seed sums do not depend on the epoch (DST inside the 30-day history)', () => {
    for (const epoch of ['2026-10-30', '2026-03-31', '2026-01-09', '2026-07-01']) {
      const st = buildSeed(content, epoch).state
      expect(formatHundredths(st.balances.ana?.confirmed ?? -1)).toBe('247.50')
      expect(formatHundredths(st.balances.cafe?.confirmed ?? -1)).toBe('286.00')
      expect(invariants(st)).toEqual([])
    }
  })

  it('seed rows keep their local times across DST', () => {
    const st = buildSeed(content, '2026-10-30').state // history spans the October switch
    const taxi = Object.values(st.txs).find((tx) => tx.seedMeta?.key === 'taxi-share')
    expect(taxi && formatTime(taxi.createdAt, 'Europe/Ljubljana')).toBe('23:14')
    expect(taxi && formatWeekday(taxi.createdAt, 'Europe/Ljubljana')).toBe('Sat')
  })
})
