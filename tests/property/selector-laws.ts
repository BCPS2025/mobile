// Laws the selectors of everyday money keep on whatever session the random commands made: the badges
// count what is to pay, the History chips partition and narrow the list, the sales figures add up,
// splits and payouts are consistent with their payments, and no list repeats an entry.
import { expect } from 'vitest'
import type { LedgerState, PersonaId, SimTime } from '@domain/types'
import { type IsoDate, localDateOf } from '@sim/tz'
import {
  CAFE_FILTERS,
  PEOPLE_FILTERS,
  type ActivityFilter,
  activity,
  badges,
  counterMerchants,
  invoices,
  linksOf,
  payItems,
  payoutsOf,
  refundableSales,
  salesDashboard,
  scanCandidates,
  splitCandidates,
  splitsOf,
  txDetail,
  txsFor,
} from '@store/selectors'
import { notificationsFor } from '@store/notifications'
import { content } from '../unit/helpers'

const TZ = content.config.t0.tz
const VALIDITY = content.config.posCodeValidityMin * 60_000
const FILTERS: readonly ActivityFilter[] = [...new Set([...PEOPLE_FILTERS, ...CAFE_FILTERS])]

const unique = <T>(xs: readonly T[]): boolean => new Set(xs).size === xs.length
const descending = (xs: readonly number[]): boolean => xs.every((x, i) => i === 0 || (xs[i - 1] ?? 0) >= x)

export function checkSelectorLaws(s: LedgerState, now: SimTime): void {
  const personas = ['ana', 'marko', 'cafe', 'studio', 'firm', 'supplier', 'bakery'] as PersonaId[]
  for (const p of personas) {
    checkToPay(s, p)
    checkHistory(s, p, now)
    checkNotifications(s, p)
    checkScan(s, p, now)
  }
  for (const p of Object.keys(s.merchant) as PersonaId[]) {
    checkSales(s, p, now)
    checkPayouts(s, p, now)
  }
  for (const p of ['ana', 'marko'] as const) checkSplits(s, p)
  checkRefunds(s)
}

function checkToPay(s: LedgerState, p: PersonaId): void {
  const items = payItems(s, p)
  expect(unique(items.map((i) => `${i.kind}:${i.id}`))).toBe(true)
  expect(descending(items.map((i) => i.at))).toBe(true)
  for (const item of items) {
    const request = item.kind === 'link' ? undefined : item.kind === 'invoice' ? item.row.request : item.request
    // A request is open and made of the account; a link is open, was sent to it and is not its own.
    if (item.kind === 'link') {
      expect(item.link.status).toBe('open')
      expect(item.link.owner).not.toBe(p)
    } else {
      expect(request?.status).toBe('open')
      expect(request?.payer).toBe(p)
    }
  }
  const b = badges(s, p)
  expect(b.toPay + b.invoicesToPay).toBe(items.length)
  expect(invoices(s, p, 'toPay').length).toBe(b.invoicesToPay)
  expect(linksOf(s, p).length).toBe(Object.values(s.links).filter((l) => l.owner === p).length)
}

function checkHistory(s: LedgerState, p: PersonaId, now: SimTime): void {
  const all = activity(s, p, now, TZ, { filter: 'all', status: true })
  const ids = (filter: ActivityFilter) => activity(s, p, now, TZ, { filter }).flatMap((g) => g.rows.map((r) => r.tx.id))
  const allIds = all.flatMap((g) => g.rows.map((r) => r.tx.id))
  // Every payment of the account is one row, newest first, in the group of its day.
  expect(allIds.sort()).toEqual(
    txsFor(s, p)
      .map((t) => t.id)
      .sort(),
  )
  expect(unique(allIds)).toBe(true)
  expect(descending(all.map((g) => Date.parse(g.date)))).toBe(true)
  for (const g of all) {
    expect(descending(g.rows.map((r) => r.at))).toBe(true)
    for (const r of g.rows) expect(localDateOf(r.at, TZ)).toBe(g.date)
  }
  // Money in and money out split the list; every other chip is part of it.
  expect(ids('in').length + ids('out').length).toBe(allIds.length)
  for (const f of FILTERS) for (const id of ids(f)) expect(allIds).toContain(id)
  // A pending bank transfer is a row of money in, of top-ups and of nothing else.
  const rampsOf = (f: ActivityFilter) =>
    activity(s, p, now, TZ, { filter: f }).flatMap((g) => g.ramps.map((r) => r.ramp.id))
  const waiting = Object.values(s.ramps).filter(
    (r) => r.persona === p && r.direction === 'on' && r.status === 'pending',
  )
  expect(rampsOf('all').sort()).toEqual(waiting.map((r) => r.id).sort())
  for (const f of FILTERS) {
    if (f === 'all' || f === 'in' || f === 'topupsCashouts' || f === 'topups') continue
    expect(rampsOf(f), f).toEqual([])
  }
  // A search for a reference finds that payment and no payment that lacks it.
  const some = allIds[0]
  if (some !== undefined) {
    const found = activity(s, p, now, TZ, { query: some.toLowerCase() }).flatMap((g) => g.rows.map((r) => r.tx.id))
    expect(found).toContain(some)
    for (const id of found) expect(allIds).toContain(id)
  }
  // The period grouping holds the same rows.
  const period = activity(s, p, now, TZ, { grouping: 'period' }).flatMap((g) => g.rows.map((r) => r.tx.id))
  expect(period.slice().sort()).toEqual(allIds.slice().sort())
}

function checkNotifications(s: LedgerState, p: PersonaId): void {
  const list = notificationsFor(s, p, content)
  expect(unique(list.map((n) => n.id))).toBe(true)
  expect(descending(list.map((n) => n.at))).toBe(true)
  for (const n of list) {
    expect(n.persona).toBe(p)
    // What a notification is about exists, and only a payment gives a transaction to open.
    const { subject } = n
    if (subject.type === 'tx') expect(s.txs[subject.id]).toBeDefined()
    if (subject.type === 'request') expect(s.requests[subject.id]).toBeDefined()
    if (subject.type === 'link') expect(s.links[subject.id]).toBeDefined()
    if (subject.type === 'split') expect(s.splits[subject.id]).toBeDefined()
    if (subject.type === 'ramp') expect(s.ramps[subject.id]).toBeDefined()
    expect(n.txId).toBe(subject.type === 'tx' ? subject.id : null)
  }
}

function checkScan(s: LedgerState, p: PersonaId, now: SimTime): void {
  const found = scanCandidates(s, p, null, now, VALIDITY, { counterMerchants: counterMerchants(content) })
  for (const c of found) {
    // Never one's own code.
    if (c.kind === 'pos' || c.kind === 'counter') expect(c.merchant).not.toBe(p)
    else if (c.kind === 'person') expect(c.persona).not.toBe(p)
    else expect(c.owner).not.toBe(p)
  }
}

function checkSales(s: LedgerState, merchant: PersonaId, now: SimTime): void {
  const today = salesDashboard(s, merchant, 'today', now, content)
  const week = salesDashboard(s, merchant, '7d', now, content)
  expect(week.sales).toBeGreaterThanOrEqual(today.sales)
  expect(week.gross).toBeGreaterThanOrEqual(today.gross)
  for (const d of [today, week]) {
    // Fees are what the merchant paid on the gross; net is what it received less what it refunded.
    expect(d.gross - d.fees).toBeGreaterThanOrEqual(0)
    expect(d.received).toBe(d.rows.reduce((sum, r) => sum + r.net, 0))
    expect(d.net).toBe(d.received - d.refunds.amount)
    expect(d.sales).toBe(d.rows.reduce((sum, r) => sum + r.count, 0))
    expect(descending(d.rows.map((r) => r.at))).toBe(true)
  }
  // The chart is the week: seven days, today last, and as many payments as the list.
  expect(week.days).toHaveLength(7)
  expect(week.days[6]?.today).toBe(true)
  expect(week.days.reduce((sum, d) => sum + d.count, 0)).toBe(week.sales)
  expect(week.days.reduce((sum, d) => sum + d.gross, 0)).toBe(week.gross)
  expect(week.days[6]?.date).toBe(today.to)
}

function checkPayouts(s: LedgerState, p: PersonaId, now: SimTime): void {
  const out = payoutsOf(s, p, now, TZ)
  expect(descending(out.rows.map((r) => r.at))).toBe(true)
  const from: IsoDate = out.week.from
  const inWeek = out.rows.filter((r) => r.date >= from && r.date <= out.week.to)
  expect(out.week.count).toBe(inWeek.length)
  expect(out.week.amount).toBe(inWeek.reduce((sum, r) => sum + r.amount, 0))
  expect(out.week.fee).toBe(inWeek.reduce((sum, r) => sum + r.fee, 0))
  expect(out.week.eur).toBe(inWeek.reduce((sum, r) => sum + r.eur, 0))
  for (const r of out.rows) expect(r.fee).toBeLessThanOrEqual(r.amount)
}

function checkSplits(s: LedgerState, p: PersonaId): void {
  // What the picker offers is what the payment detail offers to split, newest first, ten at most.
  const offered = splitCandidates(s, p)
  expect(offered.length).toBeLessThanOrEqual(10)
  expect(descending(offered.map((t) => t.createdAt))).toBe(true)
  for (const tx of offered) expect(txDetail(s, tx.id, p, content)?.splittable).toBe(true)

  for (const sp of splitsOf(s, p)) {
    const states = sp.shares.map((x) => x.status)
    expect(sp.count).toBe(sp.split.shares.length)
    expect(sp.paid).toBe(states.filter((x) => x === 'paid').length)
    expect(sp.collected + sp.open).toBeLessThanOrEqual(sp.split.total - sp.split.ownShare)
    expect(sp.status === 'complete').toBe(sp.paid === sp.count)
    if (sp.status === 'open') expect(states).toContain('open')
    // A paid share has the payment that paid it.
    for (const x of sp.shares) expect(x.tx !== undefined).toBe(x.status === 'paid')
  }
}

function checkRefunds(s: LedgerState): void {
  for (const m of Object.keys(s.merchant) as PersonaId[]) {
    const list = refundableSales(s, m)
    expect(unique(list.map((t) => t.id))).toBe(true)
    for (const tx of list) {
      expect(tx.refundedBy).toBeUndefined()
      expect(txDetail(s, tx.id, m, content)?.refundState).toBe('refundable')
    }
  }
}
