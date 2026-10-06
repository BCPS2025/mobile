import { CreditCard, Landmark, type LucideIcon, Wallet } from 'lucide-react'
import type { Content } from '@content/schema'
import { formatHundredths, formatMinor } from '@domain/money'
import type { LedgerState, PersonaId, Ramp } from '@domain/types'
import { formatTime, formatWeekday } from '@sim/tz'
import { topUpMethods, type TopUpMethod } from '@store/selectors'
import { fill, ui } from '../../copy'
import { dateTimeText } from '../../format'
import { Dock } from '../chrome/Dock'
import { FactsCard } from '../chrome/FactsCard'
import { PhoneScreen } from '../chrome/PhoneScreen'
import { SuccessScreen } from '../chrome/SuccessScreen'
import { usePhoneNav } from '../nav'

// How a top-up ended. A card or a local method has settled: TOPPED UP (money moved). A bank
// transfer that has not arrived yet shows its timeline: Requested → Your bank sends it → In your
// BCPS balance, with the time it is expected. Once it arrives, the same screen reads TOPPED UP.

/** How a method is named on a row and in a check: "Card •• 7719", "Bank transfer from SI56 •••• •••• 4821". */
export function methodTitle(m: TopUpMethod): string {
  if (m.method === 'card') return fill(ui.topUp.methodCard, { last4: m.last4 })
  if (m.method === 'bank-transfer') return fill(ui.topUp.methodBank, { bank: m.bank })
  return ui.topUp.methodLocal
}

/** The grey line under a method: Instant, or When your bank sends it. */
export const methodHint = (m: TopUpMethod): string =>
  m.method === 'bank-transfer' ? ui.topUp.bankHint : ui.topUp.instant

export const METHOD_ICON: Record<TopUpMethod['method'], LucideIcon> = {
  card: CreditCard,
  'bank-transfer': Landmark,
  'local-method': Wallet,
}

/** "from €50.00 · Card •• 7719", "from €50.00 · bank transfer": where a top-up came from. */
export function fromText(ramp: Ramp, state: LedgerState, content: Content): string {
  const eur = formatHundredths(ramp.eur)
  if (ramp.method === 'bank-transfer') return fill(ui.topUp.fromBank, { eur })
  if (ramp.method === 'local-method') return fill(ui.topUp.fromLocal, { eur })
  const card = topUpMethods(state, ramp.persona, content).find((m) => m.method === 'card')
  return fill(ui.topUp.from, {
    eur,
    method: fill(ui.topUp.methodCard, { last4: card?.method === 'card' ? card.last4 : '' }),
  })
}

/** "Fri 14:15": a weekday and the time, in the account's zone. */
const dayTime = (t: Ramp['requestedAt'], tz: string): string => `${formatWeekday(t, tz)} ${formatTime(t, tz)}`

/** The three steps of a bank transfer; the first is done, the second is the one it waits at. */
function Timeline({ ramp, tz }: { ramp: Ramp; tz: string }) {
  const steps = [
    {
      key: 'requested',
      title: ui.topUp.stepRequested,
      sub: dateTimeText(ramp.requestedAt, false, tz),
      state: 'done',
    },
    {
      key: 'sent',
      title: ui.topUp.stepSent,
      sub:
        ramp.arrivesAt === undefined
          ? ui.topUp.stepSentHint
          : fill(ui.topUp.stepExpected, { when: dayTime(ramp.arrivesAt, tz) }),
      state: 'now',
    },
    { key: 'arrived', title: ui.topUp.stepArrived, sub: ui.topUp.stepArrivedHint, state: 'next' },
  ] as const
  return (
    <ol className="mt-5" data-testid="top-up-timeline">
      {steps.map((st, i) => (
        <li
          key={st.key}
          data-state={st.state}
          className="relative grid grid-cols-[14px_1fr] items-start gap-x-3.5 pb-3.5 last:pb-0"
        >
          {i < steps.length - 1 && (
            <span
              aria-hidden="true"
              className={`absolute top-[18px] bottom-[-2px] left-[6px] w-0.5 ${st.state === 'done' ? 'bg-green-600' : 'bg-line-200'}`}
            />
          )}
          <span
            aria-hidden="true"
            className={`relative mt-[3px] size-3.5 ${
              st.state === 'done'
                ? 'bg-green-600'
                : st.state === 'now'
                  ? 'border-2 border-green-600 bg-surface'
                  : 'border border-line-300 bg-line-100'
            }`}
          />
          <span>
            <span
              className={`block font-body text-body-l font-semibold ${st.state === 'next' ? 'text-grey-600' : 'text-navy-900'}`}
            >
              {st.title}
            </span>
            <span className="block font-body text-body-s text-grey-600 tnum">{st.sub}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

export function TopUpResult({
  ramp,
  state,
  content,
  persona,
  tz,
  business,
  onDone,
}: {
  ramp: Ramp
  state: LedgerState
  content: Content
  persona: PersonaId
  tz: string
  business: boolean
  onDone: () => void
}) {
  const nav = usePhoneNav()
  const tx = ramp.txId === undefined ? undefined : state.txs[ramp.txId]
  const bank = topUpMethods(state, persona, content).find((m) => m.method === 'bank-transfer')

  if (ramp.status === 'completed' && tx) {
    return (
      <SuccessScreen
        id="shared.topup.done"
        variant="money"
        overline={ui.topUp.doneOverline}
        amount={{ value: ramp.amount, signed: true }}
        eur={fromText(ramp, state, content)}
        highlight={ui.topUp.ready}
        lines={[
          { label: ui.topUp.rowReference, value: tx.id, mono: true },
          { label: ui.topUp.rowFee, value: ui.topUp.noFee },
        ]}
        linesStyle="card"
        onDone={onDone}
      />
    )
  }

  return (
    <PhoneScreen
      id="shared.topup.onItsWay"
      header={business ? 'business' : 'light'}
      title={ui.topUp.title}
      businessName={state.directory[persona]?.displayName ?? ''}
      onBack={nav.back}
      onHome={nav.home}
      dock={<Dock primary={{ label: ui.common.done, tone: 'navy', onPress: onDone }} />}
    >
      <div className="px-5 pt-3.5 pb-3">
        <p className="font-body text-caption font-medium uppercase tracking-[0.16em] text-grey-600">
          {ui.topUp.waitOverline}
        </p>
        <p data-testid="top-up-amount" className="mt-1.5 font-display text-display-xl tnum text-navy-900">
          +{formatMinor(ramp.amount)}
          <span className="ml-2 text-[18px] leading-none font-medium tracking-normal text-grey-600">
            {ui.common.bcps}
          </span>
        </p>
        <p className="mt-0.5 font-body text-body text-grey-600 tnum">{fromText(ramp, state, content)}</p>
        <Timeline ramp={ramp} tz={tz} />
        <div className="mt-5">
          <FactsCard
            facts={[
              ...(bank ? [{ label: ui.topUp.rowFrom, value: bank.bank }] : []),
              { label: ui.topUp.rowReference, value: ramp.id, mono: true },
            ]}
          />
        </div>
      </div>
    </PhoneScreen>
  )
}
