import type { ReactNode } from 'react'
import { available, limitFor, maxPayable } from '@domain/ledger'
import { asMinor, formatMinor } from '@domain/money'
import type { Party } from '@domain/types'
import { resolveParty } from '@store/parties'
import { quoteFor } from '@store/selectors'
import { errorText } from '../errors'
import { fill, ui } from '../copy'
import { approx, eur, partyLabel } from '../format'
import { PartyAvatar } from '../kit/PartyAvatar'
import { VerifiedTick } from '../kit/VerifiedTick'
import { ErrorLine } from '../phone/chrome/ErrorLine'
import type { FlowId } from '../phone/registry'
import { MoneySuccess } from './MoneySuccess'
import { AmountStep, parseAmount } from './steps/AmountStep'
import { NoteStep } from './steps/NoteStep'
import { PickPartyStep, partyLines } from './steps/PickPartyStep'
import { ReviewStep } from './steps/ReviewStep'
import type { FlowCtx, FlowImpl, StepProps } from './types'

// The flows that pay a person or a business by @username: who, how much, an optional note, then
// Check and pay. Send (people, c.send.*) and Pay supplier (the café, biz.send.*) are the same
// four steps with their own screens, words and starting point. A payment to a person or a
// business by @username is a transfer: the sender pays the fee, and the review shows the total.
// A flow that starts from a template or from a payment ("Send again", the café's supplier order)
// opens straight on Review with an Edit link on each field.

export interface PayDraft {
  /** What is typed in the search field, or a picked @handle. */
  query: string
  /** The keypad string ("16.5"). */
  amount: string
  note: string
  /** Opened filled in: it starts on Review and the first three steps are passed over. */
  templated: boolean
}

export interface PayFlowConfig {
  id: Extract<FlowId, 'send' | 'paySupplier'>
  title: string
  tone: 'light' | 'business'
  screens: { to: string; amount: string; note: string; review: string; success: string }
  words: { toTitle: string; amountTitle: string; noteTitle: string; reviewTitle: string; pay: string }
  /** The overline of the success screen (PAID or SENT). */
  overline: string
  /** The note chips (catalogue.yaml `noteChips`). */
  chips: (ctx: FlowCtx) => readonly string[]
  /** The draft of a new instance. */
  init(ctx: FlowCtx): PayDraft
  /** A verified tick after the name on Review (businesses). */
  verifiedOnReview: boolean
}

/** Everything the steps derive from the draft and the ledger right now. */
function figures(d: PayDraft, ctx: FlowCtx) {
  const to = resolveParty(ctx.state, ctx.persona, d.query)
  const amount = parseAmount(d.amount)
  const quote = to && amount > 0 ? quoteFor(ctx.state, to.id, 'username', amount) : null
  const have = available(ctx.state, ctx.persona)
  const short = quote && quote.senderDebit > have ? asMinor(quote.senderDebit - have) : null
  return { to, amount, quote, have, short }
}

export function createPayFlow(cfg: PayFlowConfig): FlowImpl<PayDraft> {
  function ToStep({ d, ctx, api }: StepProps<PayDraft>) {
    return (
      <PickPartyStep
        title={cfg.words.toTitle}
        query={d.query}
        onQuery={(query) => api.set({ query })}
        state={ctx.state}
        content={ctx.content}
        viewer={ctx.persona}
        onSubmit={api.press}
      />
    )
  }

  function AmountBody({ d, ctx, api }: StepProps<PayDraft>) {
    const { to, quote, have, short } = figures(d, ctx)
    const max = to ? maxPayable(ctx.state, ctx.persona, to.handle, 'username') : asMinor(0)
    return (
      <AmountStep
        title={cfg.words.amountTitle}
        value={d.amount}
        onChange={(amount) => api.set({ amount })}
        rate={ctx.rate}
        maxMinor={limitFor(ctx.state, ctx.persona)}
        available={have}
        max={max > 0 ? max : null}
        error={
          short !== null && quote ? (
            <ErrorLine>{errorText({ code: 'insufficient-funds', have, short })}</ErrorLine>
          ) : null
        }
        onEnter={api.press}
      />
    )
  }

  function NoteBody({ d, ctx, api }: StepProps<PayDraft>) {
    const to = resolveParty(ctx.state, ctx.persona, d.query)
    return (
      <NoteStep
        title={cfg.words.noteTitle}
        value={d.note}
        chips={cfg.chips(ctx)}
        onChange={(note) => api.set({ note })}
        {...(to ? { visibility: fill(ui.steps.noteVisibility, { name: partyLabel(to) }) } : {})}
      />
    )
  }

  function ReviewBody({ d, ctx, api, sending }: StepProps<PayDraft>) {
    const { to, amount, quote, have: haveNow } = figures(d, ctx)
    if (!to || !quote) return null
    // While the payment sends, the balance already holds it: show the review as it was.
    const have = sending ? asMinor(haveNow + quote.senderDebit) : haveNow
    const lines = partyLines(to as Party, ctx.content)
    const edit = (step: string) => () => api.goto(step, { editing: true })
    const name: ReactNode =
      cfg.verifiedOnReview && lines.verified ? (
        <>
          {lines.first} <VerifiedTick />
        </>
      ) : (
        lines.first
      )
    return (
      <ReviewStep
        title={cfg.words.reviewTitle}
        rows={[
          {
            label: ui.send.rowTo,
            value: name,
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

  return {
    id: cfg.id,
    title: () => cfg.title,
    tone: () => cfg.tone,
    init: cfg.init,
    openOn: (d) => (d.templated ? 'review' : 'to'),
    steps: [
      {
        id: 'to',
        screen: cfg.screens.to,
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
        screen: cfg.screens.amount,
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
        screen: cfg.screens.note,
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
        screen: cfg.screens.review,
        kind: 'review',
        Screen: ReviewBody,
        primary: (d, ctx) => {
          const { quote, short } = figures(d, ctx)
          return {
            label: fill(cfg.words.pay, { amount: quote ? formatMinor(quote.senderDebit) : '' }),
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
      tx ? <MoneySuccess id={cfg.screens.success} overline={cfg.overline} tx={tx} ctx={ctx} onDone={done} /> : null,
  }
}
