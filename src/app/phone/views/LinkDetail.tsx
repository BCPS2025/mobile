import { Info } from 'lucide-react'
import { entryOf } from '@domain/ledger'
import type { SimTime } from '@domain/types'
import { useLedger, useLedgerNode } from '@store/useLedger'
import { fill, ui } from '../../copy'
import { firstName, whenText } from '../../format'
import { AmountHead } from '../chrome/AmountHead'
import { Dock } from '../chrome/Dock'
import { EmptyState } from '../chrome/EmptyState'
import { type Fact, FactsCard } from '../chrome/FactsCard'
import { PhoneScreen } from '../chrome/PhoneScreen'
import { StatusChip } from '../chrome/Tag'
import type { ScreenProps } from '../implemented'
import { usePhoneNav } from '../nav'
import { usePersonaPhone } from '../PhoneContext'
import { DETAILS } from '../registry'
import { personLine } from './RequestDetail'

// A payment link you made (c.link.detail): the amount and note, whether it waits or was paid and by
// whom, who it was sent to and when, and its reference. A link that waits can be sent again; a
// paid link is closed.

export function LinkDetail({ params }: ScreenProps) {
  const { persona, tz } = usePersonaPhone()
  const nav = usePhoneNav()
  const node = useLedgerNode()
  const state = useLedger((s) => s)
  const link = entryOf(state.links, params.linkId ?? '')
  const frame = { id: DETAILS.link.screen, header: 'light' as const }
  const chrome = { title: ui.linkDetail.title, onBack: nav.back, onHome: nav.home }
  if (!link || link.owner !== persona) {
    return (
      <PhoneScreen {...frame} {...chrome}>
        <EmptyState icon={Info} title={ui.detail.missing} />
      </PhoneScreen>
    )
  }
  const now = node.now()
  const at = (t: SimTime) => whenText(t, now, tz, 'detail')
  const payment = link.payments[0] === undefined ? undefined : entryOf(state.txs, link.payments[0])
  const payer = payment ? entryOf(state.directory, payment.from) : undefined
  const sentTo =
    link.sharedWith.length > 0 ? entryOf(state.directory, link.sharedWith[link.sharedWith.length - 1] ?? '') : undefined
  const sentAt = link.sharedAt[link.sharedAt.length - 1]

  const facts: Fact[] = []
  if (link.status === 'paid') {
    facts.push({
      label: ui.linkDetail.paid,
      value: at((payment?.confirmedAt ?? payment?.createdAt ?? link.createdAt) as SimTime),
    })
    facts.push({ label: ui.linkDetail.from, value: personLine(payer) })
  } else {
    if (sentTo) facts.push({ label: ui.linkDetail.sentTo, value: personLine(sentTo) })
    if (sentAt !== undefined) facts.push({ label: ui.linkDetail.sent, value: at(sentAt) })
  }
  facts.push({ label: ui.linkDetail.reference, value: link.id, mono: true })

  const chip =
    link.status === 'paid'
      ? { tone: 'success' as const, text: fill(ui.linkDetail.paidBy, { handle: payer?.handle ?? '' }) }
      : { tone: 'neutral' as const, text: ui.linkDetail.waiting }

  return (
    <PhoneScreen
      {...frame}
      {...chrome}
      dock={
        link.status === 'open' ? (
          <Dock
            primary={{
              label: link.sharedWith.length > 0 ? ui.linkDetail.shareAgain : ui.linkDetail.send,
              tone: 'navy',
              onPress: () => nav.openFlow('paymentLink', { linkId: link.id }),
            }}
          />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 px-5 pt-4 pb-3" data-testid="link-detail">
        <AmountHead amount={link.amount} note={link.note} />
        <StatusChip tone={chip.tone}>{chip.text}</StatusChip>
        <FactsCard facts={facts} />
        <p className="font-body text-body-s text-grey-600">
          {link.status === 'paid' && payer
            ? fill(ui.linkDetail.singleClosed, { first: firstName(payer) })
            : ui.linkDetail.singleOpen}
        </p>
      </div>
    </PhoneScreen>
  )
}
