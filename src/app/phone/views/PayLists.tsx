import { Link, Split as SplitIcon } from 'lucide-react'
import { asMinor } from '@domain/money'
import type { Party, PersonaId } from '@domain/types'
import { type PayItem, type WaitingItem, payItems, waitingItems } from '@store/selectors'
import { useLedger, useLedgerNode } from '@store/useLedger'
import { fill, ui } from '../../copy'
import { agoText, partyLabel, whenText } from '../../format'
import { PartyAvatar } from '../../kit/PartyAvatar'
import { ItemRow, IconSquare } from '../chrome/ItemRow'
import { ListSection } from '../chrome/ListRow'
import { Tag } from '../chrome/Tag'
import { usePhoneNav } from '../nav'
import { usePersonaPhone } from '../PhoneContext'

// The two lists of the Pay & request hub that come from state: TO PAY (requests, payment links and
// split shares you were sent) and WAITING (what you asked for or made, and what closed lately). A
// list with nothing in it is not shown.

/** "@marko · Lunch", or "@marko" when there is no note. */
const titleOf = (p: Party | undefined, note: string | undefined): string => {
  const name = p ? partyLabel(p) : ''
  return note ? fill(ui.lists.requestOf, { handle: name, note }) : name
}

function ToPayRow({ item, tz }: { item: PayItem; tz: string }) {
  const nav = usePhoneNav()
  const node = useLedgerNode()
  const now = node.now()
  const name = item.from ? partyLabel(item.from) : ''
  if (item.kind === 'request') {
    return (
      <ItemRow
        testId={`pay-item-${item.id}`}
        leading={item.from ? <PartyAvatar party={item.from} /> : <IconSquare icon={Link} />}
        title={titleOf(item.from, item.request.note)}
        sub={fill(ui.lists.request, { when: whenText(item.at, now, tz) })}
        amount={item.request.amount}
        onPress={() => nav.openFlow('payItem', { request: item.id })}
      />
    )
  }
  if (item.kind === 'split') {
    return (
      <ItemRow
        testId={`pay-item-${item.id}`}
        leading={<IconSquare icon={SplitIcon} />}
        title={item.request.note ?? ui.lists.linkTitle}
        sub={fill(ui.lists.shareFrom, { name })}
        amount={item.request.amount}
        onPress={() => nav.openFlow('payItem', { request: item.id })}
      />
    )
  }
  if (item.kind === 'link') {
    return (
      <ItemRow
        testId={`pay-item-${item.id}`}
        leading={<IconSquare icon={Link} />}
        title={item.link.note ?? ui.lists.linkTitle}
        sub={fill(ui.lists.linkFrom, { name })}
        amount={item.link.amount}
        onPress={() => nav.openFlow('payItem', { link: item.id })}
      />
    )
  }
  return null
}

export function ToPaySection({ persona }: { persona: PersonaId }) {
  const { tz } = usePersonaPhone()
  const items = useLedger((s) => payItems(s, persona)).filter((i) => i.kind !== 'invoice')
  if (items.length === 0) return null
  return (
    <section aria-label={ui.hubs.sections.toPay} data-testid="to-pay">
      <ListSection>{ui.hubs.sections.toPay}</ListSection>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <ToPayRow item={item} tz={tz} />
          </li>
        ))}
      </ul>
    </section>
  )
}

const TAGS = {
  paid: { tone: 'success', label: ui.lists.paid },
  declined: { tone: 'danger', label: ui.lists.declined },
  cancelled: { tone: 'neutral', label: ui.lists.cancelled },
} as const

function WaitingRow({ item, tz }: { item: WaitingItem; tz: string }) {
  const nav = usePhoneNav()
  const node = useLedgerNode()
  const now = node.now()
  const tag = item.outcome === 'open' ? undefined : <Tag tone={TAGS[item.outcome].tone}>{TAGS[item.outcome].label}</Tag>
  if (item.kind === 'request') {
    const { request, payer } = item.row
    return (
      <ItemRow
        testId={`waiting-${item.id}`}
        leading={payer ? <PartyAvatar party={payer} /> : <IconSquare icon={Link} />}
        title={titleOf(payer, request.note)}
        sub={fill(ui.lists.asked, { when: agoText(request.createdAt, now, tz) })}
        amount={request.amount}
        tag={tag}
        onPress={() => nav.open({ kind: 'detail', id: 'request' }, { requestId: item.id })}
      />
    )
  }
  if (item.kind === 'link') {
    const { link } = item.row
    return (
      <ItemRow
        testId={`waiting-${item.id}`}
        leading={<IconSquare icon={Link} />}
        title={link.note ?? ui.lists.linkTitle}
        sub={fill(ui.lists.sentLink, { when: agoText(link.createdAt, now, tz) })}
        amount={link.amount}
        tag={tag}
        onPress={() => nav.open({ kind: 'detail', id: 'link' }, { linkId: item.id })}
      />
    )
  }
  const { split, paid, count, shares } = item.row
  return (
    <ItemRow
      testId={`waiting-${item.id}`}
      leading={<IconSquare icon={SplitIcon} />}
      title={split.note}
      sub={fill(ui.lists.splitProgress, { paid, count })}
      amount={asMinor(shares.reduce((sum, x) => sum + x.amount, 0))}
      tag={tag}
      onPress={() => nav.open({ kind: 'detail', id: 'split' }, { splitId: item.id })}
    />
  )
}

export function WaitingSection({ persona }: { persona: PersonaId }) {
  const { tz } = usePersonaPhone()
  const node = useLedgerNode()
  const items = useLedger((s) => waitingItems(s, persona, node.now()))
  if (items.length === 0) return null
  return (
    <section aria-label={ui.hubs.sections.waiting} data-testid="waiting">
      <ListSection>{ui.hubs.sections.waiting}</ListSection>
      <ul>
        {items.map((item) => (
          <li key={`${item.kind}:${item.id}`}>
            <WaitingRow item={item} tz={tz} />
          </li>
        ))}
      </ul>
    </section>
  )
}
