import { available, entryOf } from '@domain/ledger'
import { asMinor, formatMinor } from '@domain/money'
import type { PaymentRequest, SimTime } from '@domain/types'
import { localDateOf } from '@sim/tz'
import { invoiceTag, quoteForRequest } from '@store/selectors'
import { errorText } from '../errors'
import { fill, ui } from '../copy'
import { approx, dayText, partyLabel } from '../format'
import { ErrorLine } from '../phone/chrome/ErrorLine'
import { FactsCard } from '../phone/chrome/FactsCard'
import { SuccessScreen } from '../phone/chrome/SuccessScreen'
import { MoneySuccess } from './MoneySuccess'
import { TopUpAction } from './topUpOffer'
import type { FlowCtx, FlowImpl, StepProps } from './types'

// Pay an invoice (biz.invoice.*): who sent it, its number, what for, when it was issued and is due,
// the 1% fee (the payer pays it on an invoice) and the total. [Pay] pays it; [Decline] first asks
// why, from the reasons in the catalogue, and tells the supplier. Nothing is added to the invoice.

interface Draft {
  /** The invoice's request id. */
  id: string
  /** The reason chosen for declining. */
  reason: string
  /** The invoice was declined (the flow then ends on a neutral screen). */
  declined: boolean
}

const reasonsOf = (ctx: FlowCtx): readonly string[] => ctx.content.catalogue.declineReasons.invoice
const tzOf = (ctx: FlowCtx): string => ctx.app.persona(ctx.persona)?.tz ?? ctx.content.config.t0.tz

/** Everything the steps derive from the draft and the ledger right now. */
function figures(d: Draft, ctx: FlowCtx) {
  const request: PaymentRequest | undefined = entryOf(ctx.state.requests, d.id)
  const issuer = request ? entryOf(ctx.state.directory, request.requester) : undefined
  const quote = request ? quoteForRequest(ctx.state, request) : null
  const have = available(ctx.state, ctx.persona)
  const short = quote && quote.senderDebit > have ? asMinor(quote.senderDebit - have) : null
  const open = request?.status === 'open'
  return { request, issuer, quote, have, short, open }
}

/** DUE TODAY on the day it is due, DUE before, OVERDUE after. */
function statusOf(request: PaymentRequest, ctx: FlowCtx): { label: string; overdue: boolean } {
  const tz = tzOf(ctx)
  if (invoiceTag(request, ctx.now, tz) === 'overdue') return { label: ui.invoices.overdue, overdue: true }
  const dueDay = request.invoice ? localDateOf(request.invoice.dueAt, tz) : undefined
  return dueDay === localDateOf(ctx.now, tz)
    ? { label: ui.invoices.dueToday, overdue: false }
    : { label: ui.invoices.due, overdue: false }
}

function DetailBody({ d, ctx, api, sending }: StepProps<Draft>) {
  const { request, issuer, quote, have, short } = figures(d, ctx)
  if (!request || !issuer || !quote) return null
  const tz = tzOf(ctx)
  const status = statusOf(request, ctx)
  // While the payment sends, the balance already holds it: no shortfall is shown then.
  const missing = sending ? null : short
  const day = (t: SimTime) => dayText(localDateOf(t, tz))
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pt-4">
      <p
        data-testid="invoice-status"
        className={`w-fit border px-2.5 py-1 font-body text-[13px] leading-[18px] font-bold tracking-[0.02em] ${
          status.overdue ? 'border-danger text-danger' : 'border-warning text-warning'
        }`}
      >
        {status.label}
      </p>
      <p className="mt-2.5 font-display text-[44px] leading-[48px] font-semibold tracking-[-0.02em] text-navy-900 tnum">
        {formatMinor(request.amount)}
        <span className="ml-2 text-[18px] leading-none font-medium tracking-normal text-grey-600">
          {ui.common.bcps}
        </span>
      </p>
      <p className="font-body text-body text-grey-600 tnum">{approx(request.amount, ctx.rate)}</p>
      <div className="mt-4">
        <FactsCard
          facts={[
            {
              label: ui.invoices.rowFrom,
              value: partyLabel(issuer),
              sub: <span className="text-green-700">{ui.detail.verified}</span>,
              testId: 'fact-from',
            },
            { label: ui.invoices.rowNumber, value: request.invoice?.number ?? '', mono: true, testId: 'fact-number' },
            {
              label: ui.invoices.rowDescription,
              value: request.invoice?.description ?? '',
              testId: 'fact-description',
            },
            { label: ui.invoices.rowIssued, value: day(request.createdAt), testId: 'fact-issued' },
            { label: ui.invoices.rowDue, value: request.invoice ? day(request.invoice.dueAt) : '', testId: 'fact-due' },
            {
              label: ui.invoices.rowFee,
              value: `${formatMinor(quote.fee)} ${ui.common.bcps}`,
              sub: approx(quote.fee, ctx.rate),
              testId: 'fact-fee',
            },
            {
              label: ui.invoices.rowTotal,
              value: `${formatMinor(quote.senderDebit)} ${ui.common.bcps}`,
              total: true,
              testId: 'review-total',
            },
          ]}
        />
      </div>
      {missing !== null && (
        <ErrorLine className="mt-3" action={<TopUpAction ctx={ctx} short={missing} api={api} />}>
          {errorText({ code: 'insufficient-funds', have, short: missing })}
        </ErrorLine>
      )}
    </div>
  )
}

function DeclineBody({ d, ctx, api }: StepProps<Draft>) {
  const { issuer } = figures(d, ctx)
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pt-4">
      <h2 className="pb-3.5 font-display text-display-m text-navy-900">{ui.invoices.declineTitle}</h2>
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" data-testid="decline-reasons">
        <legend className="sr-only">{ui.invoices.declineGroup}</legend>
        {reasonsOf(ctx).map((reason) => {
          const on = reason === d.reason
          return (
            <label
              key={reason}
              data-testid={`reason-${reason}`}
              className={`flex min-h-14 cursor-pointer items-center gap-3 bg-surface px-3.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green-600 ${
                on ? 'border-2 border-navy-900' : 'border border-line-200'
              }`}
            >
              <input
                type="radio"
                name="decline-reason"
                value={reason}
                checked={on}
                onChange={() => api.set({ reason })}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
                  on ? 'border-navy-900' : 'border-line-300'
                }`}
              >
                {on && <span className="size-3 rounded-full bg-navy-900" />}
              </span>
              <span className="font-body text-body font-semibold text-navy-900">{reason}</span>
            </label>
          )
        })}
      </fieldset>
      {issuer && (
        <p className="mt-3.5 font-body text-body-s text-grey-600">
          {fill(ui.invoices.declineNote, { name: partyLabel(issuer) })}
        </p>
      )}
    </div>
  )
}

export const invoiceFlow: FlowImpl<Draft> = {
  id: 'invoice',
  title: () => ui.invoices.detailTitle,
  tone: () => 'business',
  init: (ctx) => ({ id: ctx.params.request ?? '', reason: reasonsOf(ctx)[0] ?? '', declined: false }),
  steps: [
    {
      id: 'detail',
      screen: 'biz.invoice.detail',
      kind: 'review',
      Screen: DetailBody,
      primary: (d, ctx) => {
        const { quote, short, open } = figures(d, ctx)
        return {
          label: fill(ui.invoices.pay, { amount: quote ? formatMinor(quote.senderDebit) : '' }),
          tone: 'money',
          enabled: quote !== null && short === null && open,
        }
      },
      secondary: (_d, _ctx, api) => ({
        kind: 'outline',
        label: ui.invoices.decline,
        onPress: () => api.goto('decline'),
        fit: true,
      }),
    },
    {
      id: 'decline',
      screen: 'biz.invoice.decline',
      kind: 'confirm',
      Screen: DeclineBody,
      primary: () => ({ label: ui.invoices.declineConfirm, tone: 'navy', enabled: true }),
      secondary: (_d, _ctx, api) => ({ kind: 'outline', label: ui.invoices.keep, onPress: api.back }),
    },
  ],
  commits: [
    {
      step: 'detail',
      await: 'tx',
      refusal: () => ({ about: 'request' }),
      command: (d, ctx, cmdId) => {
        const { request, issuer, quote } = figures(d, ctx)
        if (!request || !issuer || !quote) return null
        return {
          type: 'pay',
          actor: ctx.persona,
          cmdId,
          to: issuer.handle,
          amount: request.amount,
          channel: 'request',
          requestId: request.id,
          expect: { senderDebit: quote.senderDebit },
        }
      },
    },
    {
      step: 'decline',
      await: 'none',
      refusal: () => ({ about: 'request' }),
      command: (d, ctx, cmdId) =>
        d.id === '' ? null : { type: 'request.decline', actor: ctx.persona, cmdId, requestId: d.id, reason: d.reason },
      onAccepted: (_d, _ctx, api) => api.set({ declined: true }),
    },
  ],
  done: (d) => d.declined,
  Success: ({ d, tx, ctx, done }) => {
    if (d.declined) {
      const { issuer } = figures(d, ctx)
      return (
        <SuccessScreen
          id="biz.invoice.declined"
          variant="neutral"
          overline={ui.invoices.declinedOverline}
          title={ui.invoices.declinedTitle}
          body={issuer ? fill(ui.invoices.declinedBody, { name: partyLabel(issuer) }) : undefined}
          onDone={done}
        />
      )
    }
    return tx ? <MoneySuccess id="biz.invoice.paid" overline={ui.receipt.paid} tx={tx} ctx={ctx} onDone={done} /> : null
  },
}
