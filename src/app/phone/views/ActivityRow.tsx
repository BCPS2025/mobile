import {
  Banknote,
  ChartColumn,
  CreditCard,
  Landmark,
  Link as LinkIcon,
  type LucideIcon,
  Split,
  Wallet,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { formatMinor, formatSignedMinor } from '@domain/money'
import type { LedgerState, PersonaId } from '@domain/types'
import { formatTime } from '@sim/tz'
import { counterpartyOf } from '@store/parties'
import { type ActivityRampRow, type ActivityRow as Row, type ActivityStatusRow, deltaFor } from '@store/selectors'
import { fill, ui } from '../../copy'
import { itemsText, partyLabel, shortBank, txLabel } from '../../format'
import { PartyAvatar } from '../../kit/PartyAvatar'
import { Tag } from '../chrome/Tag'

// One line of History: an avatar (or an icon square for top-ups, cash-outs and summaries), the
// name with what it was for, the time and items under it, and the signed amount. A payment that
// has not settled yet carries a PENDING tag. A daily summary is not a payment: it has no amount
// and no arrow, and does not open.

const tone = (icon: LucideIcon) => {
  const Icon = icon
  return (
    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center bg-green-50 text-green-700">
      <Icon size={20} strokeWidth={1.75} />
    </span>
  )
}

export interface RowText {
  title: string
  sub: string
  leading: ReactNode
  /** A daily summary: not a payment, so no amount. */
  summary: boolean
  /** Whether a tap opens the payment detail (summaries and carried-over balances do not open). */
  openable: boolean
}

/**
 * What a History row says about a payment, from one account's point of view. `bank`: the
 * account's bank account as shown ("SI56 •••• •••• 1934"), named on its cash-outs.
 */
export function rowText(row: Row, s: LedgerState, viewer: PersonaId, tz: string, bank?: string): RowText {
  const { tx } = row
  const time = formatTime(row.at, tz)
  const summary = tx.summary !== undefined
  const labelKey = tx.seedMeta?.labelKey
  // A day's sales in one row: "Daily sales" over "48 payments · net 331.23" (net of the fees).
  if (tx.summary && (labelKey === 'dailySales' || labelKey === 'todaySoFar')) {
    return {
      title: labelKey === 'dailySales' ? ui.history.dailySales : ui.history.todaySoFar,
      sub: fill(ui.history.summaryLine, { count: tx.summary.count, net: formatMinor(deltaFor(tx, viewer)) }),
      leading: tone(ChartColumn),
      summary: true,
      openable: false,
    }
  }
  // Money to the bank (a cash-out or an automatic conversion): "Cash out" over "23:00 · to SI56 •••• 1934".
  if (tx.kind === 'off-ramp' && tx.from === viewer) {
    return {
      title: ui.history.cashOut,
      sub: bank ? fill(ui.history.cashOutLine, { time, bank: shortBank(bank) }) : time,
      leading: tone(Banknote),
      summary,
      openable: true,
    }
  }
  // A top-up that came through the bank or the card: "Top up" over the time and how it was paid.
  if (tx.kind === 'on-ramp' && !tx.seedMeta && tx.to === viewer) {
    const method = tx.rampId === undefined ? undefined : s.ramps[tx.rampId]?.method
    return {
      title: ui.history.topUp,
      sub: method ? fill(ui.history.topUpLine, { time, method: ui.history.methods[method] }) : time,
      leading: tone(method === 'card' ? CreditCard : Landmark),
      summary,
      openable: true,
    }
  }
  if (tx.seedMeta && labelKey) {
    const icon =
      tx.kind === 'on-ramp'
        ? tx.seedMeta.method === 'card'
          ? CreditCard
          : Landmark
        : tx.kind === 'off-ramp'
          ? Banknote
          : summary
            ? ChartColumn
            : Wallet
    const openable = !summary && tx.seedMeta.labelKey !== 'carriedOver'
    return { title: txLabel(tx, viewer), sub: time, leading: tone(icon), summary, openable }
  }
  const other = counterpartyOf(s, row.direction === 'out' ? tx.to : tx.from, tx.party)
  const name = other ? partyLabel(other) : ''
  const leading = other ? <PartyAvatar party={other} /> : tone(Wallet)
  const items = itemsText(tx.items)
  // Money paid to a shop or a business names it, with what it was for under the name.
  if (row.direction === 'out' && (tx.kind === 'purchase' || other?.kind === 'business')) {
    const what = items || tx.note
    return {
      title: name,
      sub: what ? fill(ui.tx.withNote, { label: time, note: what }) : time,
      leading,
      summary,
      openable: true,
    }
  }
  // A share of a bill that someone split reads "Split share · 18:20".
  const share = tx.links?.requestId === undefined ? undefined : s.requests[tx.links.requestId]
  const sub =
    tx.kind === 'purchase'
      ? fill(ui.tx.withNote, { label: time, note: ui.history.sale })
      : share?.channel === 'split'
        ? fill(ui.history.splitShareOut, { when: time })
        : time
  return {
    title: tx.note ? fill(ui.tx.withNote, { label: name, note: tx.note }) : name,
    sub,
    leading,
    summary,
    openable: true,
  }
}

export function ActivityRowView({ row, text, onOpen }: { row: Row; text: RowText; onOpen: () => void }) {
  const inner = (
    <>
      {text.leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-body font-semibold text-navy-900">{text.title}</span>
        <span className="block truncate font-body text-body-s text-grey-600">{text.sub}</span>
      </span>
      {row.pending && (
        <span className="shrink-0 border border-warning bg-surface px-[7px] py-[3px] font-body text-[11px] leading-[14px] font-semibold tracking-[0.08em] text-warning">
          {ui.history.pending}
        </span>
      )}
      {!text.summary && (
        <span
          className={`shrink-0 font-body text-body font-semibold tnum ${row.direction === 'in' ? 'text-green-700' : 'text-navy-900'}`}
        >
          {formatSignedMinor(row.signed)}
        </span>
      )}
    </>
  )
  const cls = 'flex min-h-14 w-full items-center gap-3 border-b border-line-100 py-1 text-left'
  return !text.openable ? (
    <div className={cls} data-testid="history-summary">
      {inner}
    </div>
  ) : (
    <button type="button" data-testid={`tx-${row.tx.id}`} onClick={onOpen} className={`${cls} active:bg-line-100`}>
      {inner}
    </button>
  )
}

// ---- Requests, payment links and bank transfers that have not arrived

const STATUS_TAG = {
  open: { tone: 'warning', label: ui.history.waiting },
  paid: { tone: 'success', label: ui.lists.paid },
  declined: { tone: 'danger', label: ui.lists.declined },
  cancelled: { tone: 'neutral', label: ui.lists.cancelled },
  closed: { tone: 'neutral', label: ui.lists.closed },
} as const

/**
 * What a request or a payment link says in the list: who and what for, "Asked you" / "You asked" /
 * "Your payment link" over the time, and a tag for where it stands. It has an amount but no sign: no
 * money has moved.
 */
export function statusText(row: ActivityStatusRow, tz: string): RowText {
  const when = formatTime(row.at, tz)
  const name = row.party ? partyLabel(row.party) : ''
  const toPay = row.direction === 'to-pay'
  if (row.kind === 'link') {
    return {
      title: row.note ?? ui.lists.linkTitle,
      sub: fill(toPay ? ui.history.linkIn : ui.history.linkOut, { when }),
      leading: tone(LinkIcon),
      summary: false,
      openable: true,
    }
  }
  const title = row.note ? fill(ui.lists.requestOf, { handle: name, note: row.note }) : name
  return {
    title,
    sub: fill(toPay ? ui.history.requestIn : row.splitId ? ui.history.splitShareOut : ui.history.requestOut, { when }),
    leading: row.party ? <PartyAvatar party={row.party} /> : tone(row.splitId ? Split : LinkIcon),
    summary: false,
    openable: true,
  }
}

export function StatusRowView({
  row,
  text,
  onOpen,
}: {
  row: ActivityStatusRow
  text: RowText
  onOpen: (() => void) | null
}) {
  const tag = STATUS_TAG[row.status]
  const inner = (
    <>
      {text.leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-body font-semibold text-navy-900">{text.title}</span>
        <span className="block truncate font-body text-body-s text-grey-600">{text.sub}</span>
      </span>
      <Tag tone={tag.tone}>{tag.label}</Tag>
      <span className="shrink-0 font-body text-body font-semibold text-navy-900 tnum">{formatMinor(row.amount)}</span>
    </>
  )
  const cls = 'flex min-h-14 w-full items-center gap-3 border-b border-line-100 py-1 text-left'
  return onOpen === null ? (
    <div className={cls} data-testid={`status-${row.id}`}>
      {inner}
    </div>
  ) : (
    <button
      type="button"
      data-testid={`status-${row.id}`}
      data-status={row.status}
      onClick={onOpen}
      className={`${cls} active:bg-line-100`}
    >
      {inner}
    </button>
  )
}

/**
 * A bank transfer asked for and not yet arrived: "Top up" over "Bank transfer · on its way", PENDING,
 * +55.00. It opens the timeline of the transfer.
 */
export function RampRowView({ row, onOpen }: { row: ActivityRampRow; onOpen: () => void }) {
  const method = row.ramp.method ?? 'bank-transfer'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-14 w-full items-center gap-3 border-b border-line-100 py-1 text-left active:bg-line-100"
      data-testid={`ramp-${row.ramp.id}`}
    >
      {tone(method === 'card' ? CreditCard : Landmark)}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-body font-semibold text-navy-900">{ui.history.topUp}</span>
        <span className="block truncate font-body text-body-s text-grey-600">{rampSub(row)}</span>
      </span>
      <Tag tone="warning">{ui.history.pending}</Tag>
      <span className="shrink-0 font-body text-body font-semibold text-green-700 tnum">
        {formatSignedMinor(row.signed)}
      </span>
    </button>
  )
}

/** "Bank transfer · on its way": what a search for a top-up on its way looks through, too. */
export const rampSub = (row: ActivityRampRow): string =>
  fill(ui.history.onItsWay, { method: ui.history.methods[row.ramp.method ?? 'bank-transfer'] })
