import { Banknote, ChartColumn, CreditCard, Landmark, type LucideIcon, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatMinor, formatSignedMinor } from '@domain/money'
import type { LedgerState, PersonaId } from '@domain/types'
import { formatTime } from '@sim/tz'
import { counterpartyOf } from '@store/parties'
import { type ActivityRow as Row, deltaFor } from '@store/selectors'
import { fill, ui } from '../../copy'
import { itemsText, partyLabel, shortBank, txLabel } from '../../format'
import { PartyAvatar } from '../../kit/PartyAvatar'

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
  const sub = tx.kind === 'purchase' ? fill(ui.tx.withNote, { label: time, note: ui.history.sale }) : time
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
