import { Info } from 'lucide-react'
import { useRef } from 'react'
import { asMinor, formatMinor } from '@domain/money'
import type { SimTime } from '@domain/types'
import { cmdIdFor, newFlowInstanceId } from '@store/cmdIds'
import { type SplitShareRow, splitsOf } from '@store/selectors'
import { useLedger, useLedgerNode } from '@store/useLedger'
import { errorText } from '../../errors'
import { fill, ui } from '../../copy'
import { whenText } from '../../format'
import { PartyAvatar } from '../../kit/PartyAvatar'
import { useApp } from '../../state/AppContext'
import { AmountHead } from '../chrome/AmountHead'
import { Dock } from '../chrome/Dock'
import { EmptyState } from '../chrome/EmptyState'
import { ErrorLine } from '../chrome/ErrorLine'
import { ListSection } from '../chrome/ListRow'
import { PhoneScreen } from '../chrome/PhoneScreen'
import { StatusChip, Tag } from '../chrome/Tag'
import type { ScreenProps } from '../implemented'
import { usePhoneNav } from '../nav'
import { usePersonaPhone } from '../PhoneContext'
import { DETAILS } from '../registry'
import { useState } from 'react'

// How a split you made stands (c.split.detail): what is collected, how many have paid, and each
// person's share with its state. A person who declined (or whose request was cancelled) can be asked
// again; what is still open can be cancelled after a question.

const TAGS = {
  paid: { tone: 'success', label: ui.lists.paid },
  declined: { tone: 'danger', label: ui.lists.declined },
  cancelled: { tone: 'neutral', label: ui.lists.cancelled },
} as const

export function SplitDetail({ params }: ScreenProps) {
  const app = useApp()
  const { persona, tz } = usePersonaPhone()
  const nav = usePhoneNav()
  const node = useLedgerNode()
  const progress = useLedger((s) => splitsOf(s, persona).find((x) => x.split.id === params.splitId))
  const instance = useRef(newFlowInstanceId())
  const [problem, setProblem] = useState<string | null>(null)
  const frame = { id: DETAILS.split.screen, header: 'light' as const }
  const chrome = { title: ui.splitDetail.title, onBack: nav.back, onHome: nav.home }
  if (!progress) {
    return (
      <PhoneScreen {...frame} {...chrome}>
        <EmptyState icon={Info} title={ui.detail.missing} />
      </PhoneScreen>
    )
  }
  const now = node.now()
  const { split, shares, paid, count, collected } = progress
  const asked = asMinor(shares.reduce((sum, x) => sum + x.amount, 0))
  const redo = shares.filter((x) => x.status === 'declined' || x.status === 'cancelled')
  const open = shares.filter((x) => x.status === 'open')
  const complete = paid === count

  const when = (x: SplitShareRow): string => {
    const t = (x.request?.closedAt ?? x.request?.createdAt ?? split.createdAt) as SimTime
    const text = whenText(t, now, tz, 'dot')
    if (x.status === 'paid') return fill(ui.splitDetail.paidAt, { when: text })
    if (x.status === 'declined') return fill(ui.splitDetail.declinedAt, { when: text })
    if (x.status === 'cancelled') return fill(ui.splitDetail.cancelledAt, { when: text })
    return fill(ui.splitDetail.waiting, { when: text })
  }

  const askAgain = () => {
    setProblem(null)
    for (const x of redo) {
      const handle = x.party?.handle
      if (!handle || !x.request) continue
      const result = app.runtime.dispatch({
        type: 'split.reask',
        actor: persona,
        cmdId: cmdIdFor(instance.current, `reask-${x.request.id.toLowerCase()}`),
        splitId: split.id,
        party: handle,
      })
      if (!result.ok) {
        const text = errorText(result.error, { about: 'request' })
        if (text) setProblem(text)
      }
    }
  }
  const cancelOpen = () => nav.openFlow('cancelSplit', { splitId: split.id })

  const dock =
    redo.length > 0 ? (
      <Dock
        primary={{ label: ui.splitDetail.askAgain, tone: 'navy', onPress: askAgain }}
        {...(open.length > 0
          ? { secondary: { kind: 'link' as const, label: ui.splitDetail.cancelOpenLink, onPress: cancelOpen } }
          : {})}
      />
    ) : open.length > 0 ? (
      <Dock primary={{ label: ui.splitDetail.cancelOpenLink, tone: 'navy', onPress: cancelOpen }} />
    ) : undefined

  return (
    <PhoneScreen {...frame} {...chrome} error={problem ? <ErrorLine>{problem}</ErrorLine> : null} dock={dock}>
      <div className="flex flex-col gap-3 px-5 pt-4 pb-3" data-testid="split-detail">
        <AmountHead
          caption={ui.splitDetail.collected}
          amount={collected}
          note={fill(ui.splitDetail.of, { total: formatMinor(asked), note: split.note })}
        />
        <StatusChip tone={complete ? 'success' : 'neutral'}>
          {fill(complete ? ui.splitDetail.progressDone : ui.splitDetail.progress, { paid, count })}
        </StatusChip>
        <div>
          <ListSection>{ui.splitDetail.people}</ListSection>
          <ul>
            {shares.map((x) => {
              const tag = x.status === 'open' ? undefined : TAGS[x.status]
              return (
                <li
                  key={x.partyId}
                  data-testid={`share-${(x.party?.handle ?? x.partyId).replace('@', '')}`}
                  data-status={x.status}
                  className="flex min-h-[61px] items-center gap-3 border-b border-line-100 py-1"
                >
                  {x.party && <PartyAvatar party={x.party} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-body text-body font-semibold text-navy-900">
                      {x.party?.handle ?? x.partyId}
                    </span>
                    <span className="block truncate font-body text-body-s text-grey-600">{when(x)}</span>
                  </span>
                  {tag && <Tag tone={tag.tone}>{tag.label}</Tag>}
                  <span className="shrink-0 font-body text-body font-semibold text-navy-900 tnum">
                    {formatMinor(x.amount)}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
        {redo.length > 0 && <p className="font-body text-body-s text-grey-600">{ui.splitDetail.hintAsk}</p>}
      </div>
    </PhoneScreen>
  )
}
