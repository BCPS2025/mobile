import { Bell, Info } from 'lucide-react'
import { formatMinor } from '@domain/money'
import { entryOf } from '@domain/ledger'
import { formatTime } from '@sim/tz'
import { counterpartyOf } from '@store/parties'
import { useLedger } from '@store/useLedger'
import { fill, ui } from '../../copy'
import { itemsText, partyLabel } from '../../format'
import { EmptyState } from '../chrome/EmptyState'
import { PhoneScreen } from '../chrome/PhoneScreen'
import { SuccessScreen } from '../chrome/SuccessScreen'
import type { ScreenProps } from '../implemented'
import { usePhoneNav } from '../nav'
import { usePersonaPhone } from '../PhoneContext'
import { DETAILS } from '../registry'

// Received (biz.received): what a business sees when it opens a sale from a banner, a toast or
// its notifications while the Charge screen was not open: the amount, who paid, "Spendable now"
// and the sale, the fee and the reference. [Done] goes back to where it came from.

export function ReceivedDetail({ params }: ScreenProps) {
  const { persona, tz } = usePersonaPhone()
  const nav = usePhoneNav()
  const state = useLedger((s) => s)
  const tx = entryOf(state.txs, params.txId ?? '')
  if (!tx || tx.to !== persona) {
    return (
      <PhoneScreen
        id={DETAILS.received.screen}
        header="business"
        title={ui.detail.title}
        onBack={nav.back}
        onHome={nav.home}
        body="navy"
      >
        <EmptyState icon={Info} title={ui.detail.missing} onNavy />
      </PhoneScreen>
    )
  }
  const payer = counterpartyOf(state, tx.from, tx.party)
  const from = payer
    ? payer.kind === 'person'
      ? fill(ui.charge.from, { handle: payer.handle, name: payer.displayName })
      : fill(ui.charge.fromName, { name: partyLabel(payer) })
    : undefined
  const sale = itemsText(tx.items) || tx.note || ''
  return (
    <SuccessScreen
      id={DETAILS.received.screen}
      variant="money"
      overline={ui.charge.received}
      chip={
        <>
          <Bell size={14} strokeWidth={1.75} aria-hidden="true" />
          {fill(ui.charge.fromNotification, { time: formatTime(tx.confirmedAt ?? tx.createdAt, tz) })}
        </>
      }
      amount={{ value: tx.amount, signed: true }}
      {...(from ? { sub: from } : {})}
      highlight={ui.charge.spendable}
      lines={[
        ...(sale ? [{ label: ui.charge.sale, value: sale }] : []),
        { label: ui.charge.feeShort, value: fill(ui.charge.feeShortValue, { fee: formatMinor(tx.fee.fee) }) },
        { label: ui.charge.reference, value: tx.id, mono: true },
      ]}
      onDone={nav.back}
    />
  )
}
