import type { Content } from '@content/schema'
import { fillTemplate } from '@domain/counter'
import { entryOf, quoteWith } from '@domain/ledger'
import { asMinor, formatHundredths } from '@domain/money'
import type { EurCents, FeePayer, LedgerState, Minor, Party, PersonaId, SimTime, Tx } from '@domain/types'
import { type IsoDate, addDays, formatTime, localDateOf, weekdayOfDate } from '@sim/tz'
import { counterpartyOf } from './parties'

// A merchant's sales and payouts as the dashboard, the payout history, the day summary and the CSV
// export show them. Pure over the ledger: every figure comes from settled payments and the seeded
// daily summary rows.

const isSale = (tx: Tx, merchant: PersonaId): boolean =>
  tx.to === merchant && (tx.kind === 'purchase' || tx.kind === 'subscription-charge')

/** The local day a payment counts on. */
const dayOf = (tx: Tx, tz: string): IsoDate => localDateOf(tx.confirmedAt ?? tx.createdAt, tz)

export type SalesRange = 'today' | '7d'

/** One sale in the list: a payment, or a seeded daily summary row (many payments in one). */
export interface SaleRow {
  kind: 'sale' | 'summary'
  tx: Tx
  at: SimTime
  /** Payments the row stands for (1 for a sale). */
  count: number
  gross: Minor
  /** The fee charged on it. */
  fee: Minor
  /** What the merchant received (the gross less the fee when the merchant pays it). */
  net: Minor
  /** Who paid, for a named sale. */
  payer: Party | undefined
  refunded: boolean
}

/** One day of the chart. */
export interface SalesDay {
  date: IsoDate
  /** 0 = Sunday. */
  weekday: number
  count: number
  gross: Minor
  /** The business does not open on this weekday. */
  closed: boolean
  today: boolean
}

export interface SalesDashboard {
  range: SalesRange
  /** First and last local day of the range. */
  from: IsoDate
  to: IsoDate
  /** Payments (a daily summary counts as its payments). */
  sales: number
  gross: Minor
  /** What the merchant paid in fees on them. */
  fees: Minor
  /** What it kept: received less what it refunded. */
  net: Minor
  /** What it received before refunds. */
  received: Minor
  /** Refunds made in the range. */
  refunds: { count: number; amount: Minor }
  /** The seven days ending today, oldest first (the chart). */
  days: SalesDay[]
  /** The sales of the range, newest first. */
  rows: SaleRow[]
}

/** One settled sale (or daily summary row) as the list and the CSV show it. */
export const saleRow = (s: LedgerState, tx: Tx): SaleRow => ({
  kind: tx.summary ? 'summary' : 'sale',
  tx,
  at: tx.confirmedAt ?? tx.createdAt,
  count: tx.summary?.count ?? 1,
  gross: tx.amount,
  fee: tx.fee.fee,
  net: tx.fee.recipientCredit,
  payer: tx.summary ? undefined : counterpartyOf(s, tx.from, tx.party),
  refunded: tx.refundedBy !== undefined,
})

/**
 * A merchant's sales today or over the last seven days (today and the six days before): payments,
 * gross, fees, net after refunds, a chart of the seven days and the list. Fresh café, today: 23
 * payments, gross 111.38, fees 1.11, net 110.27; seven days: 180 payments, gross 1,221.22, fees 12.20,
 * net 1,209.02. `content` says which weekdays the business with a till opens.
 */
export function salesDashboard(
  s: LedgerState,
  merchant: PersonaId,
  range: SalesRange,
  now: SimTime,
  content: Content,
): SalesDashboard {
  const tz = content.config.t0.tz
  const today = localDateOf(now, tz)
  const from = range === 'today' ? today : addDays(today, -6)
  // Only a business with a till keeps opening hours (the café); any other is open every day.
  const hasTill = content.personas.personas.find((p) => p.id === merchant)?.shell === 'pos'
  const openDays = new Set(Object.keys(content.config.background.cafe.open).map(Number))
  const inRange = (date: IsoDate) => date >= from && date <= today

  const rows: SaleRow[] = []
  const byDay = new Map<IsoDate, { count: number; gross: number }>()
  let refundCount = 0
  let refundAmount = 0
  for (const id of s.txOrder) {
    const tx = s.txs[id]
    if (tx?.status !== 'confirmed') continue
    const date = dayOf(tx, tz)
    if (tx.kind === 'refund' && tx.from === merchant) {
      if (inRange(date)) {
        refundCount += 1
        refundAmount += tx.amount
      }
      continue
    }
    if (!isSale(tx, merchant)) continue
    const day = byDay.get(date) ?? { count: 0, gross: 0 }
    day.count += tx.summary?.count ?? 1
    day.gross += tx.amount
    byDay.set(date, day)
    if (inRange(date)) rows.push(saleRow(s, tx))
  }
  rows.sort((a, b) => b.at - a.at || (a.tx.id < b.tx.id ? 1 : -1))

  const sales = rows.reduce((sum, r) => sum + r.count, 0)
  const gross = rows.reduce((sum, r) => sum + r.gross, 0)
  const received = rows.reduce((sum, r) => sum + r.net, 0)
  const days: SalesDay[] = []
  for (let i = -6; i <= 0; i++) {
    const date = addDays(today, i)
    const weekday = weekdayOfDate(date)
    const d = byDay.get(date)
    days.push({
      date,
      weekday,
      count: d?.count ?? 0,
      gross: asMinor(d?.gross ?? 0),
      closed: hasTill && !openDays.has(weekday),
      today: i === 0,
    })
  }
  return {
    range,
    from,
    to: today,
    sales,
    gross: asMinor(gross),
    fees: asMinor(gross - received),
    net: asMinor(received - refundAmount),
    received: asMinor(received),
    refunds: { count: refundCount, amount: asMinor(refundAmount) },
    days,
    rows,
  }
}

// ---- who pays the fee

/** What a sale costs each side under one choice of fee payer. */
export interface FeePayerExample {
  /** The fee (1 % of the sale, paid by one side). */
  fee: Minor
  /** What the customer is charged. */
  customerPays: Minor
  /** What the business receives. */
  merchantReceives: Minor
}

/**
 * A sale of `amount` under each choice on the "Who pays the fee" screen: `recipient` ("You pay": the customer
 * pays 11.00 of an 11.00 sale and the business receives 10.89) and `sender` ("Customer pays": 11.11 and 11.00).
 */
export function feePayerExamples(s: LedgerState, amount: Minor): Record<FeePayer, FeePayerExample> {
  const example = (payer: FeePayer): FeePayerExample => {
    const q = quoteWith(s, { policyId: 'merchant', policy: s.config.fees.merchant, override: payer }, amount)
    if (!q.ok) throw new Error('a sale amount that cannot be quoted')
    return { fee: q.value.fee, customerPays: q.value.senderDebit, merchantReceives: q.value.recipientCredit }
  }
  return { recipient: example('recipient'), sender: example('sender') }
}

// ---- refunds

/**
 * Whether `viewer` can refund a payment: `refundable` (a named sale it received that has settled), `refunded`
 * (it was) or `no`. A daily summary, a sale to or from anyone else and a buyer the ledger does not name
 * (the starting balance carried over) offer nothing.
 */
export function refundStateOf(tx: Tx, viewer: PersonaId): 'refundable' | 'refunded' | 'no' {
  if (!isSale(tx, viewer) || tx.summary || (tx.from === 'sys:offstage' && tx.party === undefined)) return 'no'
  if (tx.refundedBy !== undefined) return 'refunded'
  return tx.status === 'confirmed' ? 'refundable' : 'no'
}

/** The sales a merchant can refund, newest first: named, settled, not a daily summary, not refunded yet. */
export function refundableSales(s: LedgerState, merchant: PersonaId): Tx[] {
  const out: Tx[] = []
  for (const id of s.txOrder) {
    const tx = s.txs[id]
    if (tx && refundStateOf(tx, merchant) === 'refundable') out.push(tx)
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
}

/**
 * The named sales "Refund a sale" lists, newest first: the ones a merchant can refund and the ones it
 * already did (listed greyed, with REFUNDED ✓, and not to be picked).
 */
export function salesToRefund(s: LedgerState, merchant: PersonaId): { tx: Tx; state: 'refundable' | 'refunded' }[] {
  const out: { tx: Tx; state: 'refundable' | 'refunded' }[] = []
  for (const id of s.txOrder) {
    const tx = s.txs[id]
    const state = tx ? refundStateOf(tx, merchant) : 'no'
    if (tx && state !== 'no') out.push({ tx, state })
  }
  return out.sort((a, b) => b.tx.createdAt - a.tx.createdAt || (a.tx.id < b.tx.id ? 1 : -1))
}

/** The refund of a payment, if it was refunded. */
export function refundTxOf(s: LedgerState, tx: Tx): Tx | undefined {
  return tx.refundedBy === undefined ? undefined : entryOf(s.txs, tx.refundedBy)
}

// ---- payouts

/** One conversion to euros: a cash-out or an automatic conversion. */
export interface PayoutRow {
  tx: Tx
  at: SimTime
  date: IsoDate
  /** An automatic conversion (a share of the balance on a schedule). */
  auto: boolean
  /** The share an automatic conversion took. */
  sharePct: number | undefined
  /** BCPS converted, the conversion fee and the euros paid out. */
  amount: Minor
  fee: Minor
  eur: EurCents
}

export interface Payouts {
  /** Every conversion, newest first (the seeded ones and those made now). */
  rows: PayoutRow[]
  /** The last seven days (today and the six before): "This week ≈ €913.89 · 6 payouts". */
  week: { from: IsoDate; to: IsoDate; count: number; amount: Minor; fee: Minor; eur: EurCents }
}

/**
 * The account's payouts: conversions to euros, newest first, and the week's total. Fresh café: six
 * payouts, 1,020.61 BCPS converted, conversion 15.32, ≈ €913.89.
 */
export function payoutsOf(s: LedgerState, persona: PersonaId, now: SimTime, tz: string): Payouts {
  const rows: PayoutRow[] = []
  for (const id of s.txOrder) {
    const tx = s.txs[id]
    if (tx?.kind !== 'off-ramp' || tx.from !== persona) continue
    rows.push({
      tx,
      at: tx.createdAt,
      date: localDateOf(tx.createdAt, tz),
      auto: tx.seedMeta?.sharePct !== undefined,
      sharePct: tx.seedMeta?.sharePct,
      amount: tx.amount,
      fee: tx.fee.fee,
      eur: (tx.fee.eurOut ?? 0) as EurCents,
    })
  }
  rows.sort((a, b) => b.at - a.at || (a.tx.id < b.tx.id ? 1 : -1))
  const to = localDateOf(now, tz)
  const from = addDays(to, -6)
  const week = rows.filter((r) => r.date >= from && r.date <= to)
  return {
    rows,
    week: {
      from,
      to,
      count: week.length,
      amount: asMinor(week.reduce((sum, r) => sum + r.amount, 0)),
      fee: asMinor(week.reduce((sum, r) => sum + r.fee, 0)),
      eur: week.reduce((sum, r) => sum + r.eur, 0) as EurCents,
    },
  }
}

// ---- the day summary

export interface DaySummary {
  /** The seeded daily summary row. */
  tx: Tx
  date: IsoDate
  count: number
  gross: Minor
  fees: Minor
  net: Minor
  /** The first sale of the day (the product is named by its sku). */
  firstSale: { at: SimTime; party: Party | undefined; sku: string } | undefined
  /** The busiest hour: it starts at `from` and holds `count` payments. */
  busiest: { from: SimTime; count: number } | undefined
  /** The day's conversions to euros, in time order. */
  conversions: Tx[]
}

/** The summary of a day of sales, from the seeded row's key ("cafe-sat"); undefined for any other row. */
export function daySummary(s: LedgerState, rowKey: string, tz: string): DaySummary | undefined {
  const tx = s.txOrder.map((id) => s.txs[id]).find((t) => t?.seed && t.seedMeta?.key === rowKey)
  if (!tx?.summary) return undefined
  const date = localDateOf(tx.createdAt, tz)
  const day = tx.seedMeta?.day
  const conversions: Tx[] = []
  for (const id of s.txOrder) {
    const t = s.txs[id]
    if (t && t.kind === 'off-ramp' && t.from === tx.to && localDateOf(t.createdAt, tz) === date) conversions.push(t)
  }
  return {
    tx,
    date,
    count: tx.summary.count,
    gross: tx.amount,
    fees: tx.fee.fee,
    net: tx.fee.recipientCredit,
    firstSale: day && {
      at: day.firstSale.at,
      party: counterpartyOf(s, 'sys:offstage', day.firstSale.party),
      sku: day.firstSale.sku,
    },
    busiest: day?.busiest,
    conversions: conversions.sort((a, b) => a.createdAt - b.createdAt),
  }
}

// ---- CSV

/** A cell as the export writes it: text that would run as a formula gets an apostrophe, then quoted. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

const plain = (n: number): string => formatHundredths(n).replace(/,/g, '')

export const CSV_HEADER = 'date,time,reference,payer,items,gross,fee,net'

/** "Café Lipa" → "cafe-lipa". */
function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The sales CSV of some rows: oldest first, one line per sale and one per daily summary row, every
 * cell quoted (a cell that starts with =, +, - or @ gets an apostrophe first: "'@ana"). Columns:
 * date, time, reference, payer, items, gross, fee (charged), net (received).
 */
export function salesCsv(rows: readonly SaleRow[], content: Content, tz: string): string {
  const lines = [CSV_HEADER]
  for (const row of [...rows].sort((a, b) => a.at - b.at || (a.tx.id < b.tx.id ? -1 : 1))) {
    const labelKey = row.tx.seedMeta?.labelKey
    const template = labelKey === undefined ? undefined : (content.copy.seedRows as Record<string, unknown>)[labelKey]
    const items =
      row.kind === 'summary'
        ? fillTemplate(typeof template === 'string' ? template : '', { count: row.count })
        : (row.tx.items ?? [])
            .map((it) => fillTemplate(content.copy.tx.items, { qty: it.qty, name: it.name }))
            .join(', ') ||
          (row.tx.note ?? '')
    const cells = [
      localDateOf(row.at, tz),
      formatTime(row.at, tz),
      row.tx.id,
      row.payer?.handle ?? '',
      items,
      plain(row.gross),
      plain(row.fee),
      plain(row.net),
    ]
    lines.push(cells.map(csvCell).join(','))
  }
  return `${lines.join('\n')}\n`
}

/**
 * The export of some sales rows: `cafe-lipa-sales-2026-09-25.csv` and its text. `day` is a moment of
 * the day the file is named for: now for a dashboard, the day itself for a day summary.
 */
export function salesCsvFile(
  s: LedgerState,
  merchant: PersonaId,
  rows: readonly SaleRow[],
  day: SimTime,
  content: Content,
): { fileName: string; text: string } {
  const tz = content.config.t0.tz
  const name = entryOf(s.directory, merchant)?.displayName ?? merchant
  return { fileName: `${slug(name)}-sales-${localDateOf(day, tz)}.csv`, text: salesCsv(rows, content, tz) }
}
