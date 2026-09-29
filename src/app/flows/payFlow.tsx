import { available, maxPayable } from '@domain/ledger'
import { asMinor, formatMinor } from '@domain/money'
import type { Party } from '@domain/types'
import { resolveParty } from '@store/parties'
import { quoteFor } from '@store/selectors'
import { errorText } from '../errors'
import { fill, ui } from '../copy'
import { approx, eur, partyLabel } from '../format'
import { PartyAvatar } from '../kit/PartyAvatar'
import { ErrorLine } from '../phone/chrome/ErrorLine'
import { MoneySuccess } from './MoneySuccess'
import { AmountStep, parseAmount } from './steps/AmountStep'
import { NoteStep } from './steps/NoteStep'
import { PickPartyStep, partyLines } from './steps/PickPartyStep'
import { ReviewStep } from './steps/ReviewStep'
import type { FlowCtx, FlowImpl, StepProps } from './types'

// Send (c.send.*): who, how much, an optional note, then Check and send. A payment to a person
// or a business by @username is a transfer: the sender pays the fee, and the review shows the
// total. "Send again" from a payment opens it filled in, straight on Review, with an Edit link on
// each field.

interface Draft {
  /** What is typed in the search field, or a picked @handle. */
  query: string
  /** The keypad string ("16.5"). */
  amount: string
  note: string
  /** Opened filled in: it starts on Review and the first three steps are passed over. */
  templated: boolean
}

/** Everything the steps derive from the draft and the ledger right now. */
function figures(d: Draft, ctx: FlowCtx) {
  const to = resolveParty(ctx.state, ctx.persona, d.query)
  const amount = parseAmount(d.amount)
  const quote = to && amount > 0 ? quoteFor(ctx.state, to.id, 'username', amount) : null
  const have = available(ctx.state, ctx.persona)
  const short = quote && quote.senderDebit > have ? asMinor(quote.senderDebit - have) : null
  return { to, amount, quote, have, short }
}

function ToStep({ d, ctx, api }: StepProps<Draft>) {
  return (
    <PickPartyStep
      title={ui.send.toTitle}
      query={d.query}
      onQuery={(query) => api.set({ query })}
      state={ctx.state}
      content={ctx.content}
      viewer={ctx.persona}
      onSubmit={api.press}
    />
  )
}

function AmountBody({ d, ctx, api }: StepProps<Draft>) {
  const { to, quote, have, short } = figures(d, ctx)
  const max = to ? maxPayable(ctx.state, ctx.persona, to.handle, 'username') : asMinor(0)
  return (
    <AmountStep
      title={ui.send.amountTitle}
      value={d.amount}
      onChange={(amount) => api.set({ amount })}
      rate={ctx.rate}
      maxMinor={ctx.state.config.limits.consumerMax}
      available={have}
      max={max > 0 ? max : null}
      error={
        short !== null && quote ? <ErrorLine>{errorText({ code: 'insufficient-funds', have, short })}</ErrorLine> : null
      }
      onEnter={api.press}
    />
  )
}

function NoteBody({ d, ctx, api }: StepProps<Draft>) {
  const to = resolveParty(ctx.state, ctx.persona, d.query)
  return (
    <NoteStep
      title={ui.send.noteTitle}
      value={d.note}
      chips={ctx.content.catalogue.noteChips.person}
      onChange={(note) => api.set({ note })}
      {...(to ? { visibility: fill(ui.steps.noteVisibility, { name: partyLabel(to) }) } : {})}
    />
  )
}

function ReviewBody({ d, ctx, api, sending }: StepProps<Draft>) {
  const { to, amount, quote, have: haveNow } = figures(d, ctx)
  if (!to || !quote) return null
  // While the payment sends, the balance already holds it: show the review as it was.
  const have = sending ? asMinor(haveNow + quote.senderDebit) : haveNow
  const lines = partyLines(to as Party, ctx.content)
  const edit = (step: string) => () => api.goto(step, { editing: true })
  return (
    <ReviewStep
      title={ui.send.reviewTitle}
      rows={[
        {
          label: ui.send.rowTo,
          value: lines.first,
          sub: lines.second,
          leading: <PartyAvatar party={to} />,
          onEdit: edit('to'),
        },
        {
          label: ui.send.rowAmount,
          value: `${formatMinor(amount)} ${ui.common.bcps}`,
          sub: approx(amount, ctx.rate),
          onEdit: edit('amount'),
        },
        { label: ui.send.rowNote, value: d.note || ui.send.noNote, onEdit: edit('note') },
      ]}
      feeLine={fill(ui.fee.transactionYou, { fee: formatMinor(quote.fee), eur: eur(quote.fee, ctx.rate) })}
      total={quote.senderDebit}
      balanceAfter={asMinor(have - quote.senderDebit)}
    />
  )
}

export const sendFlow: FlowImpl<Draft> = {
  id: 'send',
  title: () => ui.send.title,
  tone: () => 'light',
  init: (ctx) => {
    const to = ctx.params.to
    const amount = ctx.params.amount
    return {
      query: to ?? '',
      amount: amount ?? '',
      note: ctx.params.note ?? '',
      templated: to !== undefined && amount !== undefined,
    }
  },
  openOn: (d) => (d.templated ? 'review' : 'to'),
  steps: [
    {
      id: 'to',
      screen: 'c.send.to',
      kind: 'input',
      Screen: ToStep,
      skip: (d) => d.templated,
      primary: (d, ctx) => ({
        label: ui.common.continue,
        tone: 'navy',
        enabled: resolveParty(ctx.state, ctx.persona, d.query) !== undefined,
      }),
    },
    {
      id: 'amount',
      screen: 'c.send.amount',
      kind: 'input',
      Screen: AmountBody,
      skip: (d) => d.templated,
      primary: (d, ctx) => {
        const { amount, quote, short } = figures(d, ctx)
        return { label: ui.common.continue, tone: 'navy', enabled: amount > 0 && quote !== null && short === null }
      },
    },
    {
      id: 'note',
      screen: 'c.send.note',
      kind: 'input',
      Screen: NoteBody,
      skip: (d) => d.templated,
      primary: () => ({ label: ui.common.continue, tone: 'navy', enabled: true }),
      secondary: (_d, _ctx, api) => ({
        kind: 'link',
        label: ui.common.skip,
        onPress: () => {
          api.set({ note: '' })
          api.next()
        },
      }),
    },
    {
      id: 'review',
      screen: 'c.send.review',
      kind: 'review',
      Screen: ReviewBody,
      primary: (d, ctx) => {
        const { quote, short } = figures(d, ctx)
        return {
          label: fill(ui.send.send, { amount: quote ? formatMinor(quote.senderDebit) : '' }),
          tone: 'money',
          enabled: quote !== null && short === null,
        }
      },
    },
  ],
  commits: [
    {
      step: 'review',
      await: 'tx',
      command: (d, ctx, cmdId) => {
        const { to, amount, quote } = figures(d, ctx)
        if (!to || !quote) return null
        const note = d.note.trim()
        return {
          type: 'pay',
          actor: ctx.persona,
          cmdId,
          to: to.handle,
          amount,
          channel: 'username',
          ...(note ? { note } : {}),
          expect: { senderDebit: quote.senderDebit },
        }
      },
    },
  ],
  Success: ({ tx, ctx, done }) =>
    tx ? <MoneySuccess id="c.send.success" overline={ui.receipt.sent} tx={tx} ctx={ctx} onDone={done} /> : null,
}
