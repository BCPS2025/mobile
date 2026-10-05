import { entryOf } from '@domain/ledger'
import { asMinor, formatMinor } from '@domain/money'
import type {
  LedgerState,
  Minor,
  Party,
  PaymentLink,
  PaymentRequest,
  PersonaId,
  Ramp,
  SimTime,
  Tx,
} from '@domain/types'
import { type IsoDate, addDays, localDateOf, weekdayOfDate } from '@sim/tz'
import { counterpartyOf } from './parties'
import { txsFor } from './txs'

// History: an account's payments (and, for a person, what is still to pay or waiting) as one list,
// newest first, grouped by day or by period, filtered by a chip and searched by text. Pure over the
// ledger; the History screen draws it.

export interface ActivityRow {
  tx: Tx
  /** The payment amount as this account sees it: minus for money it sent, plus for money it received. */
  signed: Minor
  direction: 'in' | 'out'
  at: SimTime
  pending: boolean
}

/**
 * A request or a payment link in the list, without an amount sign: "Waiting" (I asked, or it is my
 * link), "To pay" (I was asked, or sent a link), "Declined", "Cancelled" and, under the Requests
 * chip, "Paid".
 */
export interface ActivityStatusRow {
  kind: 'request' | 'link'
  /** The request's or the link's id. */
  id: string
  direction: 'to-pay' | 'waiting'
  status: 'open' | 'paid' | 'declined' | 'cancelled' | 'closed'
  /** When it was made. */
  at: SimTime
  amount: Minor
  /** The other person, when they are in the directory. */
  party: Party | undefined
  note: string | undefined
  /** The split a request is a share of. */
  splitId: string | undefined
}

/**
 * A bank-transfer top-up that was asked for and has not arrived: a row of its own ("Top up · Bank transfer
 * · on its way", PENDING) until the bank sends it, when it becomes the payment it is.
 */
export interface ActivityRampRow {
  ramp: Ramp
  /** What it adds once it arrives. */
  signed: Minor
  /** When it was asked for. */
  at: SimTime
  /** When the bank is expected to send it. */
  arrivesAt: SimTime
}

export interface ActivityGroup {
  /**
   * `today`, `yesterday`, `thisWeek` or `earlier` (period grouping); or the ISO date of an older
   * day (day grouping, the default).
   */
  key: 'today' | 'yesterday' | 'thisWeek' | 'earlier' | IsoDate
  /** The local date of the group (its newest day when it spans several). */
  date: IsoDate
  /** The payments, newest first. */
  rows: ActivityRow[]
  /** Requests and links with no payment to show (only when asked for), newest first. */
  status: ActivityStatusRow[]
  /** Bank-transfer top-ups on their way, newest first. */
  ramps: ActivityRampRow[]
}

/** The History chips: people's on the left, the café's on the right (`all` is both). */
export type ActivityFilter =
  | 'all'
  | 'in'
  | 'out'
  | 'shops'
  | 'people'
  | 'topupsCashouts'
  | 'requests'
  | 'sales'
  | 'refunds'
  | 'suppliers'
  | 'payouts'
  | 'topups'

export const PEOPLE_FILTERS: readonly ActivityFilter[] = [
  'all',
  'in',
  'out',
  'shops',
  'people',
  'topupsCashouts',
  'requests',
]
export const CAFE_FILTERS: readonly ActivityFilter[] = ['all', 'sales', 'refunds', 'suppliers', 'payouts', 'topups']

export interface ActivityOptions {
  /** A chip (default `all`). */
  filter?: ActivityFilter
  /** Text to find in names, handles, notes, items, references and amounts (default: everything). */
  query?: string
  /**
   * `day` (default): Today, Yesterday, then one group per older day. `period`: Today, Yesterday,
   * This week (this Monday to Sunday) and Earlier.
   */
  grouping?: 'day' | 'period'
  /** Also list requests and links (people only): what is to pay, waiting, declined or cancelled. */
  status?: boolean
  /** The visible label of a payment (its row text), so a search finds what the row says. */
  label?: (tx: Tx) => string
  /** The visible label of a top-up on its way, for the same reason. */
  rampLabel?: (ramp: Ramp) => string
}

/** Lower case, no accents: "Café" and "cafe" are the same. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Whether a payment belongs under a chip, for one account. */
function inFilter(s: LedgerState, filter: ActivityFilter, tx: Tx, persona: PersonaId): boolean {
  const out = tx.from === persona
  const other = counterpartyOf(s, out ? tx.to : tx.from, tx.party)
  const sale = tx.kind === 'purchase' || tx.kind === 'subscription-charge'
  switch (filter) {
    case 'all':
      return true
    case 'in':
      return !out
    case 'out':
      return out
    case 'shops':
      return sale || tx.kind === 'refund'
    case 'people':
      return tx.kind === 'transfer' && other?.kind === 'person'
    case 'topupsCashouts':
      return tx.kind === 'on-ramp' || tx.kind === 'off-ramp'
    case 'requests':
      return false
    case 'sales':
      return sale && tx.to === persona
    case 'refunds':
      return tx.kind === 'refund'
    case 'suppliers':
      return tx.kind === 'transfer' && out && other?.kind === 'business'
    case 'payouts':
      return tx.kind === 'off-ramp'
    case 'topups':
      return tx.kind === 'on-ramp'
  }
}

/** Whether a top-up on its way belongs under a chip: it is money in, and a top-up. */
const rampInFilter = (filter: ActivityFilter): boolean =>
  filter === 'all' || filter === 'in' || filter === 'topupsCashouts' || filter === 'topups'

/** What a search looks through for a top-up on its way. */
function rampText(ramp: Ramp, label?: (ramp: Ramp) => string): string {
  return fold(
    ['top up', ramp.method ?? '', formatMinor(ramp.amount), ramp.id, label ? label(ramp) : ''].join(' \u0001 '),
  )
}

/** What a search looks through for a payment. */
function paymentText(s: LedgerState, tx: Tx, persona: PersonaId, label?: (tx: Tx) => string): string {
  const other = counterpartyOf(s, tx.from === persona ? tx.to : tx.from, tx.party)
  const parts = [
    other?.handle ?? '',
    other?.displayName ?? '',
    tx.note ?? '',
    ...(tx.items ?? []).map((it) => it.name),
    tx.id,
    formatMinor(tx.amount),
    label ? label(tx) : '',
  ]
  return fold(parts.join(' \u0001 '))
}

function statusText(row: ActivityStatusRow): string {
  return fold(
    [row.party?.handle ?? '', row.party?.displayName ?? '', row.note ?? '', formatMinor(row.amount)].join(' \u0001 '),
  )
}

/** The requests and links of a person that are worth a row: asked of them, asked by them, sent to them, made by them. */
function statusRows(s: LedgerState, persona: PersonaId, withPaid: boolean): ActivityStatusRow[] {
  if (entryOf(s.directory, persona)?.kind !== 'person') return []
  const out: ActivityStatusRow[] = []
  for (const r of Object.values(s.requests) as PaymentRequest[]) {
    if (r.channel !== 'username' && r.channel !== 'split') continue
    const mine = r.requester === persona
    if (!mine && r.payer !== persona) continue
    if (r.status === 'paid' && !withPaid) continue // the payment is the row
    out.push({
      kind: 'request',
      id: r.id,
      direction: mine ? 'waiting' : 'to-pay',
      status: r.status,
      at: r.createdAt,
      amount: r.amount,
      party: entryOf(s.directory, mine ? (r.payer ?? '') : r.requester),
      note: r.note,
      splitId: r.splitId,
    })
  }
  for (const l of Object.values(s.links) as PaymentLink[]) {
    const mine = l.owner === persona
    const sharedAt = l.sharedWith.indexOf(persona)
    if (!mine && sharedAt < 0) continue
    if (l.status === 'paid' && !withPaid) continue
    out.push({
      kind: 'link',
      id: l.id,
      direction: mine ? 'waiting' : 'to-pay',
      status: l.status,
      at: mine ? l.createdAt : (l.sharedAt[sharedAt] ?? l.createdAt),
      amount: l.amount,
      party: mine ? undefined : entryOf(s.directory, l.owner),
      note: l.note,
      splitId: undefined,
    })
  }
  return out.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
}

/**
 * An account's payments, newest first, in groups: Today, Yesterday, then one group per older day (or
 * This week and Earlier). Seed rows and daily summary rows are included (a business's history shows
 * them). `filter` and `query` narrow it; `status` adds the requests and links of a person, and the
 * `requests` chip shows only those (paid ones too). A bank-transfer top-up that has not arrived is a row
 * of `ramps` under the chips that hold top-ups and money in.
 */
export function activity(
  s: LedgerState,
  persona: PersonaId,
  now: SimTime,
  tz: string,
  opts: ActivityOptions = {},
): ActivityGroup[] {
  const { filter = 'all', grouping = 'day' } = opts
  const query = fold((opts.query ?? '').trim())
  const today = localDateOf(now, tz)
  const yesterday = addDays(today, -1)
  const weekStart = addDays(today, -((weekdayOfDate(today) + 6) % 7))

  const rows: ActivityRow[] =
    filter === 'requests'
      ? []
      : txsFor(s, persona)
          .filter((tx) => inFilter(s, filter, tx, persona))
          .filter((tx) => query === '' || paymentText(s, tx, persona, opts.label).includes(query))
          .map((tx) => {
            const out = tx.from === persona
            return {
              tx,
              signed: asMinor(out ? -tx.amount : tx.amount),
              direction: out ? 'out' : 'in',
              at: tx.createdAt,
              pending: tx.status === 'pending',
            }
          })
  rows.sort((a, b) => b.at - a.at)
  const status =
    filter === 'requests' || (opts.status === true && filter === 'all')
      ? statusRows(s, persona, filter === 'requests').filter((r) => query === '' || statusText(r).includes(query))
      : []

  // Bank transfers asked for and not yet arrived (their payment does not exist until they do).
  const ramps: ActivityRampRow[] = rampInFilter(filter)
    ? (Object.values(s.ramps) as Ramp[])
        .filter(
          (r) =>
            r.persona === persona &&
            r.direction === 'on' &&
            r.status === 'pending' &&
            r.arrivesAt !== undefined &&
            (query === '' || rampText(r, opts.rampLabel).includes(query)),
        )
        .map((r) => ({ ramp: r, signed: r.amount, at: r.requestedAt, arrivesAt: r.arrivesAt as SimTime }))
        .sort((a, b) => b.at - a.at || (a.ramp.id < b.ramp.id ? 1 : -1))
    : []

  const keyOf = (date: IsoDate): ActivityGroup['key'] => {
    if (date === today) return 'today'
    if (date === yesterday) return 'yesterday'
    if (grouping === 'day') return date
    return date >= weekStart ? 'thisWeek' : 'earlier'
  }
  const groups: ActivityGroup[] = []
  const groupOf = (date: IsoDate): ActivityGroup => {
    const key = keyOf(date)
    // Groups are found by key: with period grouping several days share one.
    let g = groups.find((x) => x.key === key)
    if (!g) {
      g = { key, date, rows: [], status: [], ramps: [] }
      groups.push(g)
    } else if (date > g.date) g.date = date
    return g
  }
  for (const row of rows) groupOf(localDateOf(row.at, tz)).rows.push(row)
  for (const row of status) groupOf(localDateOf(row.at, tz)).status.push(row)
  for (const row of ramps) groupOf(localDateOf(row.at, tz)).ramps.push(row)
  return groups.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}
