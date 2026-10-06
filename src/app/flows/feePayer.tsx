import { mustParseMinor } from '@domain/money'
import type { FeePayer } from '@domain/types'
import { feePayerExamples } from '@store/selectors'
import { fill, ui } from '../copy'
import { formatMinor } from '@domain/money'
import { SuccessScreen } from '../phone/chrome/SuccessScreen'
import type { FlowCtx, FlowImpl, StepProps } from './types'

// Who pays the fee on sales (biz.feePayer): "You pay" or "Customer pays", each with what an example
// sale comes to for the customer and for the business. Saving applies it to the codes and links
// made from then on; the ones already open keep the choice they were made with.

interface Draft {
  feePayer: FeePayer
  saved: boolean
}

const OPTIONS: readonly FeePayer[] = ['recipient', 'sender']
const nowOf = (ctx: FlowCtx): FeePayer => ctx.state.merchant[ctx.persona]?.feePayer ?? 'recipient'

function ChooseBody({ d, ctx, api }: StepProps<Draft>) {
  const sale = mustParseMinor(ctx.content.config.feeExampleSale)
  const examples = feePayerExamples(ctx.state, sale)
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pt-4">
      <h2 className="pb-3.5 font-display text-display-m text-navy-900">{ui.feePayer.question}</h2>
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" data-testid="fee-payer-options">
        <legend className="sr-only">{ui.feePayer.group}</legend>
        {OPTIONS.map((option) => {
          const on = option === d.feePayer
          const example = examples[option]
          return (
            <label
              key={option}
              data-testid={`fee-payer-${option}`}
              className={`flex cursor-pointer items-start gap-3 bg-surface px-3.5 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green-600 ${
                on ? 'border-2 border-navy-900' : 'border border-line-200'
              }`}
            >
              <input
                type="radio"
                name="fee-payer"
                value={option}
                checked={on}
                onChange={() => api.set({ feePayer: option })}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
                  on ? 'border-navy-900' : 'border-line-300'
                }`}
              >
                {on && <span className="size-3 rounded-full bg-navy-900" />}
              </span>
              <span className="min-w-0">
                <span className="block font-body text-body font-semibold text-navy-900">
                  {option === 'recipient' ? ui.feePayer.you : ui.feePayer.customer}
                </span>
                <span className="block font-body text-body-s text-grey-600 tnum">
                  {fill(ui.feePayer.example, {
                    sale: formatMinor(sale),
                    customerPays: formatMinor(example.customerPays),
                    merchantReceives: formatMinor(example.merchantReceives),
                  })}
                </span>
              </span>
            </label>
          )
        })}
      </fieldset>
      <p className="mt-3.5 font-body text-body-s text-grey-600">{ui.feePayer.note}</p>
    </div>
  )
}

export const feePayerFlow: FlowImpl<Draft> = {
  id: 'feePayer',
  title: () => ui.feePayer.title,
  tone: () => 'business',
  init: (ctx) => ({ feePayer: nowOf(ctx), saved: false }),
  steps: [
    {
      id: 'choose',
      screen: 'biz.feePayer',
      kind: 'input',
      Screen: ChooseBody,
      primary: () => ({ label: ui.feePayer.save, tone: 'navy', enabled: true }),
    },
  ],
  commits: [
    {
      step: 'choose',
      await: 'none',
      command: (d, ctx, cmdId) => ({
        type: 'merchant.settings',
        actor: ctx.persona,
        cmdId,
        patch: { feePayer: d.feePayer },
      }),
      onAccepted: (_d, _ctx, api) => api.set({ saved: true }),
    },
  ],
  done: (d) => d.saved,
  Success: ({ d, done }) => (
    <SuccessScreen
      id="biz.feePayer.saved"
      variant="neutral"
      overline={ui.feePayer.savedOverline}
      title={ui.feePayer.savedTitle}
      body={d.feePayer === 'recipient' ? ui.feePayer.savedYou : ui.feePayer.savedCustomer}
      onDone={done}
    />
  ),
}
