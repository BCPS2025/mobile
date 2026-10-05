import { limitFor } from '@domain/ledger'
import { formatMinor } from '@domain/money'
import type { Party } from '@domain/types'
import { identicalOpenRequest, quoteFor, requestByCmdId } from '@store/selectors'
import { resolveParty } from '@store/parties'
import { fill, ui } from '../copy'
import { approx, firstName } from '../format'
import { FactsCard } from '../phone/chrome/FactsCard'
import { InfoNote } from '../phone/chrome/InfoNote'
import { SuccessScreen } from '../phone/chrome/SuccessScreen'
import { AmountStep, parseAmount } from './steps/AmountStep'
import { ConfirmStep } from './steps/ConfirmStep'
import { NoteStep } from './steps/NoteStep'
import { PickPartyStep, partyLines } from './steps/PickPartyStep'
import type { FlowCtx, FlowImpl, StepProps } from './types'

// Request money (c.request.*): who, how much, a note, then Check and send. Only people are asked
// (businesses pay by invoice). The person who is asked pays the 1% fee when they pay, so the check
// says so and the requester receives the full amount. Nothing moves until they pay. Asking the same
// person for the same amount and note again asks first.

interface Draft {
  /** What is typed in the search field, or a picked @handle. */
  query: string
  /** The keypad string ("13.2"). */
  amount: string
  note: string
  /** The request that was made, once it is. */
  requestId?: string
}

const isPerson = (p: Party): boolean => p.kind === 'person'

/** Everything the steps derive from the draft and the ledger right now. */
function figures(d: Draft, ctx: FlowCtx) {
  const payer = resolveParty(ctx.state, ctx.persona, d.query, { filter: isPerson })
  const amount = parseAmount(d.amount)
  const note = d.note.trim()
  const fee = payer && amount > 0 ? quoteFor(ctx.state, ctx.persona, 'username', amount)?.fee : undefined
  const again =
    payer && amount > 0 ? identicalOpenRequest(ctx.state, ctx.persona, payer.handle, amount, note) : undefined
  return { payer, amount, note, fee, again }
}

function FromBody({ d, ctx, api }: StepProps<Draft>) {
  return (
    <PickPartyStep
      title={ui.request.fromTitle}
      query={d.query}
      onQuery={(query) => api.set({ query })}
      state={ctx.state}
      content={ctx.content}
      viewer={ctx.persona}
      peopleOnly
      selfAbout="request"
      onSubmit={api.press}
    />
  )
}

function AmountBody({ d, ctx, api }: StepProps<Draft>) {
  return (
    <AmountStep
      title={ui.request.amountTitle}
      value={d.amount}
      onChange={(amount) => api.set({ amount })}
      rate={ctx.rate}
      maxMinor={limitFor(ctx.state, ctx.persona)}
      available={null}
      max={null}
      onEnter={api.press}
    />
  )
}

function NoteBody({ d, ctx, api }: StepProps<Draft>) {
  const { payer } = figures(d, ctx)
  return (
    <NoteStep
      title={ui.request.noteTitle}
      value={d.note}
      chips={ctx.content.catalogue.noteChips.person}
      onChange={(note) => api.set({ note })}
      {...(payer ? { visibility: fill(ui.steps.noteVisibility, { name: payer.handle }) } : {})}
    />
  )
}

function ReviewBody({ d, ctx, api }: StepProps<Draft>) {
  const { payer, amount, fee } = figures(d, ctx)
  if (!payer || fee === undefined) return null
  const lines = partyLines(payer, ctx.content)
  const edit = (step: string) => () => api.goto(step, { editing: true })
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 pb-3.5 font-display text-display-m text-navy-900">{ui.request.reviewTitle}</h2>
      <FactsCard
        accent
        facts={[
          { label: ui.request.rowFrom, value: `${lines.first} · ${lines.second}`, onEdit: edit('from') },
          {
            label: ui.request.rowAmount,
            value: `${formatMinor(amount)} ${ui.common.bcps}`,
            sub: approx(amount, ctx.rate),
            onEdit: edit('amount'),
          },
          { label: ui.request.rowNote, value: d.note.trim() || ui.request.noNote, onEdit: edit('note') },
        ]}
      />
      <InfoNote>{fill(ui.request.feeNote, { name: firstName(payer), fee: formatMinor(fee) })}</InfoNote>
    </div>
  )
}

function AgainBody({ d, ctx }: StepProps<Draft>) {
  const { payer, amount, note } = figures(d, ctx)
  if (!payer) return null
  const values = { handle: payer.handle, amount: formatMinor(amount), note }
  return (
    <ConfirmStep
      title={ui.request.againTitle}
      body={fill(note ? ui.request.againBody : ui.request.againBodyPlain, values)}
    />
  )
}

/** The command that sends the request (from the check, or after "Send another"). */
function makeRequest(d: Draft, ctx: FlowCtx, cmdId: string) {
  const { payer, amount, note } = figures(d, ctx)
  if (!payer) return null
  return {
    type: 'request.create' as const,
    channel: 'username' as const,
    actor: ctx.persona,
    cmdId,
    payer: payer.handle,
    amount,
    ...(note ? { note } : {}),
  }
}

/** Remembers which request the command made (the success screen shows it). */
const remember: NonNullable<FlowImpl<Draft>['commits'][number]['onAccepted']> = (_d, ctx, api, cmdId) => {
  const made = requestByCmdId(ctx.app.runtime.node.getState(), cmdId)
  if (made) api.set({ requestId: made.id })
}

export const requestFlow: FlowImpl<Draft> = {
  id: 'request',
  title: () => ui.request.title,
  tone: () => 'light',
  init: () => ({ query: '', amount: '', note: '' }),
  steps: [
    {
      id: 'from',
      screen: 'c.request.from',
      kind: 'input',
      Screen: FromBody,
      primary: (d, ctx) => ({
        label: ui.common.continue,
        tone: 'navy',
        enabled: figures(d, ctx).payer !== undefined,
      }),
    },
    {
      id: 'amount',
      screen: 'c.request.amount',
      kind: 'input',
      Screen: AmountBody,
      primary: (d) => ({ label: ui.common.continue, tone: 'navy', enabled: parseAmount(d.amount) > 0 }),
    },
    {
      id: 'note',
      screen: 'c.request.note',
      kind: 'input',
      Screen: NoteBody,
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
      screen: 'c.request.review',
      kind: 'review',
      Screen: ReviewBody,
      primary: (d, ctx) => ({
        label: ui.request.send,
        tone: 'navy',
        enabled: figures(d, ctx).payer !== undefined,
      }),
      // An identical request is open: ask before sending another.
      onPrimary: (_d, _ctx, api) => api.goto('again'),
    },
    {
      id: 'again',
      screen: 'c.request.again',
      kind: 'confirm',
      offPath: true,
      Screen: AgainBody,
      primary: () => ({ label: ui.request.sendAnother, tone: 'navy', enabled: true }),
      secondary: (_d, _ctx, api) => ({ kind: 'outline', label: ui.request.cancel, onPress: api.back }),
    },
  ],
  commits: [
    {
      step: 'review',
      await: 'none',
      when: (d, ctx) => figures(d, ctx).again === undefined,
      refusal: () => ({ about: 'request' }),
      command: makeRequest,
      onAccepted: remember,
    },
    {
      step: 'again',
      await: 'none',
      refusal: () => ({ about: 'request' }),
      command: makeRequest,
      onAccepted: remember,
    },
  ],
  done: (d) => d.requestId !== undefined,
  Success: ({ d, ctx, done }) => {
    const { payer, amount, note } = figures(d, ctx)
    const handle = payer?.handle ?? d.query
    const values = { amount: formatMinor(amount), handle, note }
    return (
      <SuccessScreen
        id="c.request.sent"
        variant="neutral"
        overline={ui.request.sentOverline}
        title={ui.request.sentTitle}
        body={fill(note ? ui.request.sentBody : ui.request.sentBodyPlain, values)}
        lines={d.requestId ? [{ label: ui.receipt.reference, value: d.requestId, mono: true }] : []}
        onDone={done}
      />
    )
  },
}
