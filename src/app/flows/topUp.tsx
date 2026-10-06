import { formatHundredths, formatMinor } from '@domain/money'
import { type TopUpMethod, rampByCmdId, topUpAmount, topUpLimitEur, topUpMethods } from '@store/selectors'
import { errorText } from '../errors'
import { fill, ui } from '../copy'
import { rateText } from '../format'
import { ErrorLine } from '../phone/chrome/ErrorLine'
import { FactsCard } from '../phone/chrome/FactsCard'
import { METHOD_ICON, TopUpResult, methodHint, methodTitle } from '../phone/views/TopUpResult'
import { EuroAmountStep, parseEuros } from './steps/EuroAmountStep'
import type { FlowCtx, FlowImpl, StepProps } from './types'

// Top up (shared.topup.*): how many euros, how, then Check and top up. Whole euros only; the BCPS
// they give is shown at once and there is no fee. A card or a local method settles like a payment;
// a bank transfer is requested and ends on its timeline until the money arrives. The error line of
// a payment that the balance cannot cover opens this flow with the shortfall in whole euros.

interface Draft {
  /** The whole euros typed ("50"). */
  eur: string
  /** The method chosen; the first one on file until the person picks another. */
  method: TopUpMethod['method']
  /** The command that asked for the top-up, once it did (the ending finds its top-up by it). */
  cmdId?: string
}

/** Everything the steps derive from the draft and the ledger right now. */
function figures(d: Draft, ctx: FlowCtx) {
  const eur = parseEuros(d.eur)
  const methods = topUpMethods(ctx.state, ctx.persona, ctx.content)
  const chosen = methods.find((m) => m.method === d.method) ?? methods[0]
  const limit = topUpLimitEur(ctx.state, ctx.persona)
  const amount = topUpAmount(ctx.state, eur)
  return { eur, methods, chosen, limit, amount, over: eur > limit }
}

/** "50.00": whole euros as the button and the check show them. */
const euros = (eur: number): string => formatHundredths(eur * 100)

function AmountBody({ d, ctx, api }: StepProps<Draft>) {
  const { amount, over, limit } = figures(d, ctx)
  return (
    <EuroAmountStep
      title={ui.topUp.amountTitle}
      value={d.eur}
      onChange={(eur) => api.set({ eur })}
      youGet={fill(ui.topUp.youGet, { amount: formatMinor(amount) })}
      hint={ui.topUp.noFee}
      error={over ? <ErrorLine>{errorText({ code: 'invalid-amount', maxEur: limit })}</ErrorLine> : null}
      onEnter={api.press}
    />
  )
}

function MethodBody({ d, ctx, api }: StepProps<Draft>) {
  const { methods, chosen } = figures(d, ctx)
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 pb-3.5 font-display text-display-m text-navy-900">{ui.topUp.methodTitle}</h2>
      <div role="radiogroup" aria-label={ui.topUp.methodGroup} className="flex flex-col gap-2">
        {methods.map((m) => {
          const on = chosen?.method === m.method
          const Icon = METHOD_ICON[m.method]
          return (
            // biome-ignore lint/a11y/useSemanticElements: a card that is a radio; the input would be hidden
            <button
              key={m.method}
              type="button"
              role="radio"
              aria-checked={on}
              data-testid={`method-${m.method}`}
              onClick={() => api.set({ method: m.method })}
              className={`flex min-h-[60px] w-full items-center gap-3.5 bg-surface px-3.5 py-2 text-left ${
                on ? 'border-2 border-navy-900' : 'border border-line-200'
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
                  on ? 'border-navy-900' : 'border-line-300'
                }`}
              >
                {on && <span className="size-2.5 rounded-full bg-navy-900" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-body text-body font-semibold text-navy-900">{methodTitle(m)}</span>
                <span className="block font-body text-body-s text-grey-600">{methodHint(m)}</span>
              </span>
              <Icon size={22} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-grey-600" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ReviewBody({ d, ctx, api }: StepProps<Draft>) {
  const { eur, chosen, amount } = figures(d, ctx)
  if (!chosen) return null
  const edit = (step: string) => () => api.goto(step, { editing: true })
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 pb-3.5 font-display text-display-m text-navy-900">{ui.topUp.reviewTitle}</h2>
      <FactsCard
        accent
        facts={[
          { label: ui.topUp.rowAmount, value: `€${euros(eur)}`, onEdit: edit('amount'), testId: 'fact-amount' },
          {
            label: ui.topUp.rowMethod,
            value: methodTitle(chosen),
            sub: methodHint(chosen),
            onEdit: edit('method'),
            testId: 'fact-method',
          },
          { label: ui.topUp.rowFee, value: ui.topUp.noFee, testId: 'fact-fee' },
          {
            label: ui.topUp.rowGet,
            value: `${formatMinor(amount)} ${ui.common.bcps}`,
            total: true,
            testId: 'review-total',
          },
        ]}
      />
      <p className="mt-3 font-body text-body text-grey-600">{fill(ui.common.rateInfo, { rate: rateText(ctx.rate) })}</p>
    </div>
  )
}

/** The top-up this flow asked for, once it did. */
const rampOf = (d: Draft, ctx: FlowCtx) => (d.cmdId === undefined ? undefined : rampByCmdId(ctx.state, d.cmdId))

export const topUpFlow: FlowImpl<Draft> = {
  id: 'topUp',
  title: () => ui.topUp.title,
  tone: (ctx) => (ctx.shell === 'pos' ? 'business' : 'light'),
  init: (ctx) => {
    const wanted = Number.parseInt(ctx.params.eur ?? '', 10)
    return {
      // A shortfall opens it with the euros that cover it.
      eur: Number.isSafeInteger(wanted) && wanted > 0 ? String(wanted) : '',
      method: topUpMethods(ctx.state, ctx.persona, ctx.content)[0]?.method ?? 'local-method',
    }
  },
  steps: [
    {
      id: 'amount',
      screen: 'shared.topup.amount',
      kind: 'input',
      Screen: AmountBody,
      primary: (d, ctx) => {
        const { eur, over } = figures(d, ctx)
        return { label: ui.common.continue, tone: 'navy', enabled: eur >= 1 && !over }
      },
    },
    {
      id: 'method',
      screen: 'shared.topup.method',
      kind: 'input',
      Screen: MethodBody,
      primary: (d, ctx) => ({ label: ui.common.continue, tone: 'navy', enabled: figures(d, ctx).chosen !== undefined }),
    },
    {
      id: 'review',
      screen: 'shared.topup.review',
      kind: 'review',
      Screen: ReviewBody,
      primary: (d, ctx) => {
        const { eur, over } = figures(d, ctx)
        return {
          label: fill(ui.topUp.button, { eur: euros(eur) }),
          tone: 'money',
          enabled: eur >= 1 && !over,
        }
      },
    },
  ],
  commits: [
    {
      step: 'review',
      await: 'tx',
      command: (d, ctx, cmdId) => {
        const { eur, chosen, over } = figures(d, ctx)
        if (!chosen || eur < 1 || over) return null
        return { type: 'ramp.on', actor: ctx.persona, cmdId, method: chosen.method, eur }
      },
      onAccepted: (_d, _ctx, api, cmdId) => api.set({ cmdId }),
    },
  ],
  // A bank transfer has no payment yet: the flow has ended once the top-up is asked for.
  done: (d, ctx) => rampOf(d, ctx)?.method === 'bank-transfer',
  // The banner of the payment this top-up made would only repeat the screen.
  covers: (d, ctx, txId) => rampOf(d, ctx)?.txId === txId,
  Success: ({ d, ctx, done }) => {
    const ramp = rampOf(d, ctx)
    if (!ramp) return null
    return (
      <TopUpResult
        ramp={ramp}
        state={ctx.state}
        content={ctx.content}
        persona={ctx.persona}
        tz={ctx.app.persona(ctx.persona)?.tz ?? ctx.content.config.t0.tz}
        business={ctx.shell === 'pos'}
        onDone={done}
      />
    )
  },
}
