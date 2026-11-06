import { Info } from 'lucide-react'
import { entryOf } from '@domain/ledger'
import type { Party, SimTime } from '@domain/types'
import { useLedger, useLedgerNode } from '@store/useLedger'
import { fill, ui } from '../../copy'
import { whenText } from '../../format'
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

// A request you made (c.request.detail): the amount and note, where it stands (Waiting, Paid by,
// Declined by, Cancelled), who it was asked of and when, and the payment once it was paid. While
// it is open it can be cancelled.

/** "Marko Kovač · @marko". */
export const personLine = (p: Party | undefined): string =>
  p ? fill(ui.detail.party, { name: p.displayName, handle: p.handle }) : ''

export function RequestDetail({ params }: ScreenProps) {
  const { persona, tz } = usePersonaPhone()
  const nav = usePhoneNav()
  const node = useLedgerNode()
  const state = useLedger((s) => s)
  const request = entryOf(state.requests, params.requestId ?? '')
  const frame = { id: DETAILS.request.screen, header: 'light' as const }
  const chrome = { title: ui.requestDetail.title, onBack: nav.back, onHome: nav.home }
  if (!request || request.requester !== persona) {
    return (
      <PhoneScreen {...frame} {...chrome}>
        <EmptyState icon={Info} title={ui.detail.missing} />
      </PhoneScreen>
    )
  }
  const payer = request.payer === undefined ? undefined : entryOf(state.directory, request.payer)
  const tx = request.txId === undefined ? undefined : entryOf(state.txs, request.txId)
  const now = node.now()
  const at = (t: SimTime) => whenText(t, now, tz, 'detail')
  const closed = (request.closedAt ?? request.createdAt) as SimTime
  const handle = payer?.handle ?? ''

  const chip =
    request.status === 'open'
      ? { tone: 'neutral' as const, text: ui.requestDetail.waiting }
      : request.status === 'paid'
        ? { tone: 'success' as const, text: fill(ui.requestDetail.paidBy, { handle }) }
        : request.status === 'declined'
          ? { tone: 'danger' as const, text: fill(ui.requestDetail.declinedBy, { handle }) }
          : { tone: 'neutral' as const, text: ui.requestDetail.cancelled }

  const facts: Fact[] = []
  if (request.status === 'paid') {
    facts.push({ label: ui.requestDetail.paid, value: at((tx?.confirmedAt ?? closed) as SimTime) })
    facts.push({ label: ui.requestDetail.from, value: personLine(payer) })
    facts.push({
      label: ui.requestDetail.payment,
      testId: 'fact-payment',
      value: tx ? (
        <button
          type="button"
          data-testid="view-payment"
          onClick={() => nav.open({ kind: 'detail', id: 'tx' }, { txId: tx.id })}
          className="min-h-11 font-mono text-body font-medium text-green-700 underline underline-offset-2"
        >
          {tx.id}
        </button>
      ) : (
        ''
      ),
    })
  } else {
    if (request.status === 'declined') facts.push({ label: ui.requestDetail.declined, value: at(closed) })
    else if (request.status === 'cancelled') facts.push({ label: ui.requestDetail.cancelledAt, value: at(closed) })
    facts.push({ label: ui.requestDetail.askedOf, value: personLine(payer) })
    facts.push({ label: ui.requestDetail.asked, value: at(request.createdAt) })
    if (request.declineReason) facts.push({ label: ui.requestDetail.reason, value: request.declineReason })
    facts.push({ label: ui.requestDetail.reference, value: request.id, mono: true })
  }

  return (
    <PhoneScreen
      {...frame}
      {...chrome}
      dock={
        request.status === 'open' ? (
          <Dock
            primary={{
              label: ui.requestDetail.cancel,
              tone: 'navy',
              onPress: () => nav.openFlow('cancelRequest', { requestId: request.id }),
            }}
          />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 px-5 pt-4 pb-3" data-testid="request-detail">
        <AmountHead amount={request.amount} note={request.note} />
        <StatusChip tone={chip.tone}>{chip.text}</StatusChip>
        <FactsCard facts={facts} />
      </div>
    </PhoneScreen>
  )
}
