import { available, entryOf } from '@domain/ledger'
import { asMinor, formatMinor } from '@domain/money'
import type { Party, PaymentLink, PaymentRequest } from '@domain/types'
import { quoteForLink, quoteForRequest } from '@store/selectors'
import { fill, ui } from '../copy'
import { errorText } from '../errors'
import { approx, firstName, partyLabel, whenText } from '../format'
import { ErrorLine } from '../phone/chrome/ErrorLine'
import { FactsCard } from '../phone/chrome/FactsCard'
import { SuccessScreen } from '../phone/chrome/SuccessScreen'
import { MoneySuccess } from './MoneySuccess'
import { ConfirmStep } from './steps/ConfirmStep'
import { partyLines } from './steps/PickPartyStep'
import type { FlowCtx, FlowImpl, StepProps } from './types'

// Pay what someone asked (c.payItem.*): a request from a person, a payment link they sent, or a
// share of a bill they split. The check shows who asks, what for, the amount, the 1% fee the payer
// pays and the total; [Pay …] pays it, [Decline] (requests and shares) asks to confirm and tells
// the other person. A payment link cannot be declined.

interface Draft {
  kind: 'request' | 'link'
  /** The request's or the link's id. */
  id: string
  /** The request was declined (the flow then ends on a neutral screen). */
  declined: boolean
}

/** Everything the steps derive from the draft and the ledger right now. */
function figures(d: Draft, ctx: FlowCtx) {
  const s = ctx.state
  const request: PaymentRequest | undefined = d.kind === 'request' ? entryOf(s.requests, d.id) : undefined
  const link: PaymentLink | undefined = d.kind === 'link' ? entryOf(s.links, d.id) : undefined
  const fromId = request?.requester ?? link?.owner
  const from: Party | undefined = fromId === undefined ? undefined : entryOf(s.directory, fromId)
  const amount = request?.amount ?? link?.amount
  const note = request?.note ?? link?.note
  const quote = request ? quoteForRequest(s, request) : link ? quoteForLink(s, link) : null
  const have = available(s, ctx.persona)
  const short = quote && quote.senderDebit > have ? asMinor(quote.senderDebit - have) : null
  const sharedAt = link ? link.sharedAt[link.sharedWith.indexOf(ctx.persona)] : undefined
  const at = request?.createdAt ?? sharedAt ?? link?.createdAt
  return { request, link, from, amount, note, quote, have, short, at, declinable: request !== undefined }
}

function ReviewBody({ d, ctx, sending }: StepProps<Draft>) {
  const { request, from, amount, note, quote, have: haveNow, short, at } = figures(d, ctx)
  if (!from || amount === undefined || !quote) return null
  const rate = ctx.rate
  const lines = partyLines(from, ctx.content)
  const first = firstName(from)
  const when =
    at === undefined
      ? ''
      : whenText(at, ctx.now, ctx.app.persona(ctx.persona)?.tz ?? ctx.content.config.t0.tz, 'sentence')
  const asked =
    d.kind === 'link'
      ? ui.payItem.askedLink
      : request?.channel === 'split'
        ? ui.payItem.askedShare
        : ui.payItem.askedRequest
  // While the payment sends, the balance already holds it: no shortfall is shown then.
  const missing = sending ? null : short
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 pb-3 font-display text-display-m text-navy-900">
        {fill(ui.payItem.reviewTitle, { name: partyLabel(from) })}
      </h2>
      <FactsCard
        accent
        facts={[
          { label: ui.payItem.rowFrom, value: `${lines.first} · ${lines.second}`, testId: 'fact-from' },
          { label: ui.payItem.rowFor, value: note ?? ui.payItem.noNote },
          {
            label: ui.payItem.rowAmount,
            value: `${formatMinor(amount)} ${ui.common.bcps}`,
            sub: approx(amount, rate),
          },
          {
            label: ui.payItem.rowFee,
            value: `${formatMinor(quote.fee)} ${ui.common.bcps}`,
            sub: approx(quote.fee, rate),
            testId: 'fact-fee',
          },
          {
            label: ui.payItem.rowTotal,
            value: `${formatMinor(quote.senderDebit)} ${ui.common.bcps}`,
            total: true,
            testId: 'review-total',
          },
        ]}
      />
      <p className="mt-3 font-body text-body-s text-grey-600">{fill(asked, { name: first, when })}</p>
      {missing !== null && (
        <ErrorLine className="mt-3">
          {errorText({ code: 'insufficient-funds', have: haveNow, short: missing })}
        </ErrorLine>
      )}
    </div>
  )
}

function DeclineBody({ d, ctx }: StepProps<Draft>) {
  const { from, amount, note } = figures(d, ctx)
  if (!from || amount === undefined) return null
  return (
    <ConfirmStep
      title={fill(ui.payItem.declineTitle, { name: partyLabel(from) })}
      body={fill(ui.payItem.declineBody, { first: firstName(from) })}
    >
      <div className="mt-4">
        <FactsCard
          facts={[
            { label: ui.payItem.rowRequest, value: note ?? ui.payItem.noNote },
            {
              label: ui.payItem.rowAmount,
              value: `${formatMinor(amount)} ${ui.common.bcps}`,
              sub: approx(amount, ctx.rate),
            },
          ]}
        />
      </div>
    </ConfirmStep>
  )
}

export const payItemFlow: FlowImpl<Draft> = {
  id: 'payItem',
  title: () => ui.hubs.titles.payRequest,
  tone: () => 'light',
  init: (ctx) => ({
    kind: ctx.params.link !== undefined ? 'link' : 'request',
    id: ctx.params.link ?? ctx.params.request ?? '',
    declined: false,
  }),
  steps: [
    {
      id: 'review',
      screen: 'c.payItem.review',
      kind: 'review',
      Screen: ReviewBody,
      primary: (d, ctx) => {
        const { quote, short } = figures(d, ctx)
        return {
          label: fill(ui.payItem.pay, { amount: quote ? formatMinor(quote.senderDebit) : '' }),
          tone: 'money',
          enabled: quote !== null && short === null,
        }
      },
      secondary: (d, ctx, api) =>
        figures(d, ctx).declinable
          ? { kind: 'outline', label: ui.payItem.decline, onPress: () => api.goto('decline') }
          : null,
    },
    {
      id: 'decline',
      screen: 'c.payItem.decline',
      kind: 'confirm',
      Screen: DeclineBody,
      primary: () => ({ label: ui.payItem.declineConfirm, tone: 'navy', enabled: true }),
      secondary: (_d, _ctx, api) => ({ kind: 'outline', label: ui.payItem.keep, onPress: api.back }),
    },
  ],
  commits: [
    {
      step: 'review',
      await: 'tx',
      refusal: (d) => ({ about: d.kind }),
      command: (d, ctx, cmdId) => {
        const { request, link, from, amount, note, quote } = figures(d, ctx)
        if (!from || amount === undefined || !quote) return null
        return {
          type: 'pay',
          actor: ctx.persona,
          cmdId,
          to: from.handle,
          amount,
          channel: request ? 'request' : 'link',
          ...(note ? { note } : {}),
          ...(request ? { requestId: request.id } : link ? { linkId: link.id } : {}),
          expect: { senderDebit: quote.senderDebit },
        }
      },
    },
    {
      step: 'decline',
      await: 'none',
      refusal: () => ({ about: 'request' }),
      command: (d, ctx, cmdId) => {
        const { request } = figures(d, ctx)
        return request ? { type: 'request.decline', actor: ctx.persona, cmdId, requestId: request.id } : null
      },
      onAccepted: (_d, _ctx, api) => api.set({ declined: true }),
    },
  ],
  done: (d) => d.declined,
  Success: ({ d, tx, ctx, done }) => {
    if (d.declined) {
      const { from } = figures(d, ctx)
      return (
        <SuccessScreen
          id="c.payItem.declined"
          variant="neutral"
          overline={ui.payItem.declinedOverline}
          title={ui.payItem.declinedTitle}
          body={from ? fill(ui.payItem.declinedBody, { first: firstName(from) }) : undefined}
          onDone={done}
        />
      )
    }
    return tx ? (
      <MoneySuccess id="c.payItem.success" overline={ui.receipt.paid} tx={tx} ctx={ctx} onDone={done} />
    ) : null
  },
}
