import { Info } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { cashOutRef } from '@domain/ids'
import { entryOf } from '@domain/ledger'
import { formatHundredths, formatMinor, formatSignedMinor } from '@domain/money'
import type { Party } from '@domain/types'
import { formatTime, formatWeekday, localDateOf } from '@sim/tz'
import { bankOf, splitsOf, topUpMethods, txDetail } from '@store/selectors'
import { useLedger, useLedgerNode } from '@store/useLedger'
import { copy, fill, ui } from '../../copy'
import { approx, eur, firstName, itemsText, partyLabel, rateText } from '../../format'
import { useApp } from '../../state/AppContext'
import { Dock } from '../chrome/Dock'
import { EmptyState } from '../chrome/EmptyState'
import { PhoneScreen } from '../chrome/PhoneScreen'
import { usePhoneNav } from '../nav'
import { usePersonaPhone } from '../PhoneContext'
import { type ScreenProps, isImplemented } from '../implemented'
import { DETAILS } from '../registry'

// The payment detail (shared.tx): the amount as this account sees it, Sent → Settled with the
// seconds, then who, what, the fee, the rate and the reference, and a line on who can see it. The
// merchant's view of a sale is navy: who paid, the items, the fee, "Final · no chargebacks" and
// what cards would have cost. An outgoing payment to a person offers [Send again].

function Row({ label, sub, children }: { label: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 border-b border-line-100 px-3.5 py-1.5 last:border-b-0">
      <span className="shrink-0 font-body text-[13px] leading-[18px] text-grey-600">{label}</span>
      <span className="min-w-0 text-right">
        <span className="block font-body text-body leading-5 font-medium text-navy-900">{children}</span>
        {sub && <span className="block font-body text-caption leading-4 text-grey-600">{sub}</span>}
      </span>
    </div>
  )
}

/** A party: "Ana Novak · @ana" for people, the name for businesses; the other side may show ✓ Verified. */
function PartyRow({ label, party, verify }: { label: string; party: Party; verify: boolean }) {
  const [open, setOpen] = useState(false)
  const name =
    party.kind === 'person'
      ? fill(ui.detail.party, { name: party.displayName, handle: party.handle })
      : party.displayName
  return (
    <Row
      label={label}
      sub={
        verify && party.onStage ? (
          <>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="min-h-6 font-body text-caption text-green-700"
            >
              {ui.detail.verified}
            </button>
            {open && (
              <span className="anim-fade block">
                {party.kind === 'business' ? ui.detail.verifiedBusiness : ui.detail.verifiedPerson}
              </span>
            )}
          </>
        ) : undefined
      }
    >
      {name}
    </Row>
  )
}

export function TxDetailView({ params }: ScreenProps) {
  const app = useApp()
  const { persona, tz } = usePersonaPhone()
  const nav = usePhoneNav()
  const node = useLedgerNode()
  const state = useLedger((s) => s)
  const account = app.persona(persona)
  const detail = txDetail(state, params.txId ?? '', persona, app.content)
  const business = account?.kind === 'business'
  const frame = { id: DETAILS.tx.screen, header: business ? ('business' as const) : ('light' as const) }
  const chrome = {
    title: ui.detail.title,
    businessName: account?.displayName ?? '',
    onBack: nav.back,
    onHome: nav.home,
  }
  if (!detail) {
    return (
      <PhoneScreen {...frame} {...chrome}>
        <EmptyState icon={Info} title={ui.detail.missing} />
      </PhoneScreen>
    )
  }

  const { tx, role, from, to } = detail
  const other = role === 'to' ? from : to
  // A business is named as the one who pays the fee; a person reads "paid by you".
  const feeYou = detail.feePaidBy !== null && (detail.feePaidBy === 'from') === (role === 'from') && !business
  const feePayer = detail.feePaidBy === 'from' ? from : to
  const today = localDateOf(node.now(), tz)
  const sentOn = localDateOf(tx.createdAt, tz)
  const dayPrefix = detail.outsideBankingHours || sentOn !== today
  const sentAt = `${dayPrefix ? `${formatWeekday(tx.createdAt, tz)} ` : ''}${formatTime(tx.createdAt, tz, true)}`
  // A row from the start of the session settled with its payment; it still reads Sent → Settled a moment later.
  const settledAt =
    detail.settledAt === undefined
      ? undefined
      : detail.settledAt > tx.createdAt
        ? detail.settledAt
        : ((tx.createdAt + state.config.settleMs) as typeof tx.createdAt)
  const eurText = approx(tx.amount, state.config.rate)
  // Money in from a top-up and out to a bank: the way it came and the euros, or the bank and the conversion.
  const moneyIn = tx.kind === 'on-ramp' && role === 'to'
  const moneyOut = tx.kind === 'off-ramp' && role === 'from'
  const ramp = tx.rampId === undefined ? undefined : entryOf(state.ramps, tx.rampId)
  const rampMethod = ramp?.method ?? tx.seedMeta?.method
  const card = topUpMethods(state, persona, app.content).find((m) => m.method === 'card')
  const methodText =
    rampMethod === undefined
      ? ''
      : fill(app.content.copy.methodLabels[rampMethod], { last4: card?.method === 'card' ? card.last4 : '' })
  const eurPaid = ramp?.eur ?? tx.seedMeta?.eur
  const eurPaidText = eurPaid === undefined ? undefined : formatHundredths(eurPaid)
  const cardRange = tx.fee.card
  const canSendAgain =
    role === 'from' &&
    tx.kind === 'transfer' &&
    other !== undefined &&
    DETAILS.tx.flows.includes('send') &&
    !detail.merchantSale
  const sendAgain = () => {
    if (!other) return
    nav.openFlow('send', {
      to: other.handle,
      amount: formatMinor(tx.amount).replaceAll(',', ''),
      ...(tx.note ? { note: tx.note } : {}),
    })
  }
  // A payment you made can be split; one that already was shows how the split stands.
  const split = detail.split ? splitsOf(state, persona).find((x) => x.split.id === detail.split?.id) : undefined
  const canSplit = detail.splittable && isImplemented({ kind: 'flow', id: 'split' }, 'consumer')
  const splitAction = split
    ? {
        label: fill(ui.lists.splitProgress, { paid: split.paid, count: split.count }),
        onPress: () => nav.open({ kind: 'detail', id: 'split' }, { splitId: split.split.id }),
      }
    : canSplit
      ? { label: ui.detail.splitThis, onPress: () => nav.openFlow('split', { txId: tx.id }) }
      : undefined
  const refundedAt = detail.refund ? (detail.refund.confirmedAt ?? detail.refund.createdAt) : undefined
  // A merchant can refund a sale it received that has settled and was not refunded yet.
  const canRefund = detail.refundState === 'refundable' && isImplemented({ kind: 'flow', id: 'refund' }, 'pos')
  return (
    <PhoneScreen
      {...frame}
      {...chrome}
      dock={
        canRefund ? (
          <Dock
            primary={{
              label: ui.detail.refund,
              tone: 'navy',
              onPress: () => nav.openFlow('refund', { txId: tx.id }),
            }}
          />
        ) : canSendAgain ? (
          <Dock
            primary={{ label: ui.detail.sendAgain, tone: 'navy', onPress: sendAgain }}
            {...(splitAction ? { secondary: { kind: 'outline' as const, ...splitAction } } : {})}
          />
        ) : splitAction ? (
          <Dock primary={{ label: splitAction.label, tone: 'navy', onPress: splitAction.onPress }} />
        ) : undefined
      }
    >
      <div className="px-5 pt-3.5 pb-3" data-testid="tx-detail">
        <div className="text-center">
          <p className="font-display text-[40px] leading-11 font-semibold tracking-[-0.02em] text-navy-900 tnum">
            {formatSignedMinor(detail.signed)}
            <span className="ml-2 text-[18px] leading-none font-medium tracking-normal text-grey-600">
              {ui.common.bcps}
            </span>
          </p>
          <p className="font-body text-body text-grey-600 tnum">
            {other
              ? fill(role === 'from' ? ui.detail.toLine : ui.detail.fromLine, {
                  name: partyLabel(other),
                  eur: eur(tx.amount, state.config.rate),
                })
              : eurText}
          </p>
        </div>
        {detail.outsideBankingHours && (
          <p className="mt-2.5 text-center">
            <span className="inline-block border border-warning bg-surface px-2.5 py-1 font-body text-caption leading-4 font-semibold tracking-[0.02em] text-warning">
              {ui.detail.outsideHours}
            </span>
          </p>
        )}
        <div className="mt-3 flex items-center gap-2 font-body text-[13px] leading-[18px] text-grey-600 tnum">
          <span aria-hidden="true" className="size-2.5 shrink-0 bg-green-600" />
          <span className="font-semibold text-navy-900">{ui.detail.sent}</span>
          <span>{sentAt}</span>
          <span aria-hidden="true" className="h-0.5 min-w-4 flex-1 bg-green-600" />
          {settledAt !== undefined ? (
            <>
              <span aria-hidden="true" className="size-2.5 shrink-0 bg-green-600" />
              <span className="font-semibold text-navy-900">{ui.detail.settled}</span>
              <span>{formatTime(settledAt, tz, true)}</span>
            </>
          ) : (
            <span className="font-semibold text-navy-900 anim-pending">{ui.detail.settling}</span>
          )}
        </div>
        <div className="mt-3 border border-line-200 bg-surface">
          {from && !moneyIn && !moneyOut && <PartyRow label={ui.detail.from} party={from} verify={role !== 'from'} />}
          {to && !detail.merchantSale && !moneyIn && !moneyOut && (
            <PartyRow label={ui.detail.to} party={to} verify={role !== 'to'} />
          )}
          {moneyIn && (
            <Row label={ui.detail.method} sub={eurPaidText ? fill(ui.detail.paidEur, { eur: eurPaidText }) : undefined}>
              {methodText}
            </Row>
          )}
          {moneyOut && (
            <>
              <Row label={ui.detail.to}>{bankOf(app.content, persona) ?? ''}</Row>
              <Row label={ui.cashOut.rowConversion}>{`${formatMinor(tx.fee.fee)} ${ui.common.bcps}`}</Row>
              <Row label={ui.cashOut.rowReceive}>
                {fill(ui.common.approxEur, { eur: formatHundredths(tx.fee.eurOut ?? 0) })}
              </Row>
            </>
          )}
          {tx.items && tx.items.length > 0 && <Row label={ui.detail.items}>{itemsText(tx.items)}</Row>}
          {tx.note && !detail.merchantSale && <Row label={ui.detail.note}>{tx.note}</Row>}
          {!moneyOut && (
            <Row
              label={ui.detail.fee}
              sub={
                feePayer && !moneyIn
                  ? feeYou
                    ? ui.detail.paidByYou
                    : fill(ui.detail.paidBy, { name: partyLabel(feePayer) })
                  : undefined
              }
            >
              {moneyIn
                ? ui.topUp.noFee
                : tx.fee.rule === 'zero'
                  ? ui.fee.chipNone
                  : fill(ui.detail.feeValue, {
                      fee: formatMinor(tx.fee.fee),
                      eur: eur(tx.fee.fee, state.config.rate),
                    })}
            </Row>
          )}
          {detail.merchantSale ? (
            <Row label={ui.detail.status}>{copy.txDetail.final}</Row>
          ) : (
            <Row label={ui.detail.rate}>{fill(ui.common.rate, { rate: rateText(state.config.rate) })}</Row>
          )}
          {refundedAt !== undefined && (
            <Row label={ui.detail.refund}>
              {fill(ui.detail.refunded, { time: `${formatWeekday(refundedAt, tz)} ${formatTime(refundedAt, tz)}` })}
            </Row>
          )}
          <Row label={ui.detail.reference}>
            <span className="font-mono">{moneyOut ? cashOutRef(tx.id) : tx.id}</span>
          </Row>
        </div>
        {detail.merchantSale && cardRange && (
          <p className="mt-3 flex items-start gap-2.5 bg-green-50 px-3.5 py-3 font-body text-body text-navy-900">
            <Info size={20} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0" />
            {fill(copy.txDetail.cards, {
              cardLow: formatHundredths(cardRange.lowEurCents),
              cardHigh: formatHundredths(cardRange.highEurCents),
            })}
          </p>
        )}
        {!detail.merchantSale && other && role !== 'other' && (
          <p className="mt-3 font-body text-[13px] leading-[18px] text-grey-600">
            {fill(tx.kind === 'purchase' ? ui.detail.privacyPurchase : ui.detail.privacyPerson, {
              name: firstName(other),
            })}
          </p>
        )}
      </div>
    </PhoneScreen>
  )
}
