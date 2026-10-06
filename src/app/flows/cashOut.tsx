import { Landmark } from 'lucide-react'
import { cashOutRef } from '@domain/ids'
import { available } from '@domain/ledger'
import { formatHundredths, formatMinor } from '@domain/money'
import { bankOf, hasBank, maxCashOut, quoteCashOut } from '@store/selectors'
import { fill, ui } from '../copy'
import { errorText } from '../errors'
import { EmptyState } from '../phone/chrome/EmptyState'
import { ErrorLine } from '../phone/chrome/ErrorLine'
import { FactsCard } from '../phone/chrome/FactsCard'
import { SuccessScreen } from '../phone/chrome/SuccessScreen'
import { AmountStep, parseAmount } from './steps/AmountStep'
import type { FlowCtx, FlowImpl, StepProps } from './types'

// Cash out (shared.cashout.*): BCPS to euros at the bank account on file. An amount (never more
// than what is available; locked funds do not count), then the check: the 1.5% conversion the
// converter pays, the bank, and the euros received. An account with no bank on file sees why
// instead, and can top up.

interface Draft {
  /** The keypad string ("110.00"). */
  amount: string
}

/** Everything the steps derive from the draft and the ledger right now. */
function figures(d: Draft, ctx: FlowCtx) {
  const amount = parseAmount(d.amount)
  const min = ctx.state.config.limits.cashOutMin
  const have = available(ctx.state, ctx.persona)
  const quote = quoteCashOut(ctx.state, amount)
  const bank = bankOf(ctx.content, ctx.persona)
  return { amount, min, have, quote, bank, below: amount > 0 && amount < min, ready: quote !== null && amount <= have }
}

function NoBankBody({ api }: StepProps<Draft>) {
  return (
    <EmptyState
      icon={Landmark}
      title={ui.cashOut.noBankTitle}
      body={ui.cashOut.noBankBody}
      action={
        <button
          type="button"
          data-testid="no-bank-top-up"
          onClick={() => api.handoff('topUp')}
          className="min-h-11 font-body text-body font-semibold text-green-700 underline underline-offset-2"
        >
          {ui.cashOut.noBankAction}
        </button>
      }
    />
  )
}

function AmountBody({ d, ctx, api }: StepProps<Draft>) {
  const { have, below, min } = figures(d, ctx)
  const max = maxCashOut(ctx.state, ctx.persona)
  return (
    <AmountStep
      title={ui.cashOut.amountTitle}
      value={d.amount}
      onChange={(amount) => api.set({ amount })}
      rate={ctx.rate}
      maxMinor={max}
      available={have}
      max={max > 0 ? max : null}
      error={below ? <ErrorLine>{errorText({ code: 'invalid-amount', min })}</ErrorLine> : null}
      onEnter={api.press}
    />
  )
}

function ReviewBody({ d, ctx, api }: StepProps<Draft>) {
  const { amount, quote, bank } = figures(d, ctx)
  if (!quote || !bank) return null
  const edit = () => api.goto('amount', { editing: true })
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 pb-3.5 font-display text-display-m text-navy-900">{ui.cashOut.reviewTitle}</h2>
      <FactsCard
        accent
        facts={[
          {
            label: ui.cashOut.rowAmount,
            value: `${formatMinor(amount)} ${ui.common.bcps}`,
            onEdit: edit,
            testId: 'fact-amount',
          },
          {
            label: ui.cashOut.rowConversion,
            value: `${formatMinor(quote.fee)} ${ui.common.bcps}`,
            testId: 'fact-conversion',
          },
          { label: ui.cashOut.rowTo, value: bank, testId: 'fact-to' },
          {
            label: ui.cashOut.rowReceive,
            value: fill(ui.common.approxEur, { eur: formatHundredths(quote.eurOut ?? 0) }),
            total: true,
            testId: 'review-total',
          },
        ]}
      />
      <p className="mt-3 font-body text-body-s text-grey-600">{ui.cashOut.arrives}</p>
    </div>
  )
}

export const cashOutFlow: FlowImpl<Draft> = {
  id: 'cashOut',
  title: () => ui.cashOut.title,
  tone: (ctx) => (ctx.shell === 'pos' ? 'business' : 'light'),
  init: () => ({ amount: '' }),
  // An account with no bank on file opens on the explanation.
  openOn: (_d, ctx) => (hasBank(ctx.state, ctx.persona) ? 'amount' : 'noBank'),
  barFromTwo: true,
  steps: [
    {
      id: 'noBank',
      screen: 'shared.cashout.noBank',
      kind: 'input',
      offPath: true,
      Screen: NoBankBody,
      hideDock: () => true,
      primary: () => ({ label: ui.common.continue, tone: 'navy', enabled: false }),
    },
    {
      id: 'amount',
      screen: 'shared.cashout.amount',
      kind: 'input',
      Screen: AmountBody,
      primary: (d, ctx) => ({ label: ui.common.continue, tone: 'navy', enabled: figures(d, ctx).ready }),
    },
    {
      id: 'review',
      screen: 'shared.cashout.review',
      kind: 'review',
      Screen: ReviewBody,
      primary: (d, ctx) => {
        const { amount, ready } = figures(d, ctx)
        return { label: fill(ui.cashOut.button, { amount: formatMinor(amount) }), tone: 'money', enabled: ready }
      },
    },
  ],
  commits: [
    {
      step: 'review',
      await: 'tx',
      command: (d, ctx, cmdId) => {
        const { amount, ready } = figures(d, ctx)
        return ready ? { type: 'ramp.off', actor: ctx.persona, cmdId, amount } : null
      },
    },
  ],
  Success: ({ tx, ctx, done }) => {
    if (!tx) return null
    const bank = bankOf(ctx.content, ctx.persona) ?? ''
    return (
      <SuccessScreen
        id="shared.cashout.done"
        variant="money"
        overline={ui.cashOut.doneOverline}
        amount={{ value: tx.amount }}
        eur={fill(ui.cashOut.receive, { eur: formatHundredths(tx.fee.eurOut ?? 0) })}
        title={fill(ui.cashOut.to, { bank })}
        lines={[
          { label: ui.cashOut.rowConversion, value: `${formatMinor(tx.fee.fee)} ${ui.common.bcps}` },
          { label: ui.cashOut.rowReference, value: cashOutRef(tx.id), mono: true },
        ]}
        linesStyle="card"
        onDone={done}
      />
    )
  },
}
