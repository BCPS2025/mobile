import { entryOf } from '@domain/ledger'
import { asMinor, formatMinor } from '@domain/money'
import type { PaymentRequest } from '@domain/types'
import { splitsOf } from '@store/selectors'
import { fill, ui } from '../copy'
import { approx, firstName, partyLabel } from '../format'
import { FactsCard } from '../phone/chrome/FactsCard'
import { SuccessScreen } from '../phone/chrome/SuccessScreen'
import { ConfirmStep } from './steps/ConfirmStep'
import type { FlowCtx, FlowImpl, StepProps } from './types'

// Cancelling what you asked for: one request (c.request.cancel), or every open share of a split
// (c.split.cancel). Each asks first, tells the people it concerned and moves no money.

interface Draft {
  /** The request's or the split's id. */
  id: string
  done: boolean
}

// ---- a request

function requestOf(d: Draft, ctx: FlowCtx): PaymentRequest | undefined {
  return entryOf(ctx.state.requests, d.id)
}

function CancelRequestBody({ d, ctx }: StepProps<Draft>) {
  const request = requestOf(d, ctx)
  const payer = request?.payer === undefined ? undefined : entryOf(ctx.state.directory, request.payer)
  if (!request || !payer) return null
  return (
    <ConfirmStep
      title={fill(ui.requestDetail.cancelTitle, { handle: partyLabel(payer) })}
      body={fill(ui.requestDetail.cancelBody, { first: firstName(payer) })}
    >
      <div className="mt-4">
        <FactsCard
          facts={[
            { label: ui.payItem.rowRequest, value: request.note ?? ui.payItem.noNote },
            {
              label: ui.payItem.rowAmount,
              value: `${formatMinor(request.amount)} ${ui.common.bcps}`,
              sub: approx(request.amount, ctx.rate),
            },
          ]}
        />
      </div>
    </ConfirmStep>
  )
}

export const cancelRequestFlow: FlowImpl<Draft> = {
  id: 'cancelRequest',
  title: () => ui.requestDetail.title,
  tone: () => 'light',
  init: (ctx) => ({ id: ctx.params.requestId ?? '', done: false }),
  steps: [
    {
      id: 'confirm',
      screen: 'c.request.cancel',
      kind: 'confirm',
      Screen: CancelRequestBody,
      primary: () => ({ label: ui.requestDetail.cancel, tone: 'navy', enabled: true }),
      secondary: (_d, _ctx, api) => ({ kind: 'outline', label: ui.requestDetail.keep, onPress: api.back }),
    },
  ],
  commits: [
    {
      step: 'confirm',
      await: 'none',
      refusal: () => ({ about: 'request' }),
      command: (d, ctx, cmdId) => ({ type: 'request.cancel', actor: ctx.persona, cmdId, requestId: d.id }),
      onAccepted: (_d, _ctx, api) => api.set({ done: true }),
    },
  ],
  done: (d) => d.done,
  Success: ({ d, ctx, done }) => {
    const request = requestOf(d, ctx)
    const payer = request?.payer === undefined ? undefined : entryOf(ctx.state.directory, request.payer)
    return (
      <SuccessScreen
        id="c.request.cancelled"
        variant="neutral"
        overline={ui.requestDetail.cancelOverline}
        title={ui.requestDetail.cancelledTitle}
        body={payer ? fill(ui.requestDetail.cancelledBody, { first: firstName(payer) }) : undefined}
        onDone={done}
      />
    )
  },
}

// ---- a split

function CancelSplitBody({ d, ctx }: StepProps<Draft>) {
  const progress = splitsOf(ctx.state, ctx.persona).find((x) => x.split.id === d.id)
  if (!progress) return null
  const open = progress.shares.filter((x) => x.status === 'open')
  const left = asMinor(open.reduce((sum, x) => sum + x.amount, 0))
  return (
    <ConfirmStep title={ui.splitDetail.cancelTitle} body={ui.splitDetail.cancelBody}>
      <div className="mt-4">
        <FactsCard
          facts={[
            { label: ui.splitDetail.cancelOpen, value: String(open.length) },
            {
              label: ui.splitDetail.cancelLeft,
              value: `${formatMinor(left)} ${ui.common.bcps}`,
              sub: approx(left, ctx.rate),
            },
          ]}
        />
      </div>
    </ConfirmStep>
  )
}

export const cancelSplitFlow: FlowImpl<Draft> = {
  id: 'cancelSplit',
  title: () => ui.splitDetail.title,
  tone: () => 'light',
  init: (ctx) => ({ id: ctx.params.splitId ?? '', done: false }),
  steps: [
    {
      id: 'confirm',
      screen: 'c.split.cancel',
      kind: 'confirm',
      Screen: CancelSplitBody,
      primary: () => ({ label: ui.splitDetail.cancelConfirm, tone: 'navy', enabled: true }),
      secondary: (_d, _ctx, api) => ({ kind: 'outline', label: ui.requestDetail.keep, onPress: api.back }),
    },
  ],
  commits: [
    {
      step: 'confirm',
      await: 'none',
      refusal: () => ({ about: 'request' }),
      command: (d, ctx, cmdId) => ({ type: 'split.cancel', actor: ctx.persona, cmdId, splitId: d.id }),
      onAccepted: (_d, _ctx, api) => api.set({ done: true }),
    },
  ],
  done: (d) => d.done,
  Success: ({ done }) => (
    <SuccessScreen
      id="c.split.cancelled"
      variant="neutral"
      overline={ui.requestDetail.cancelOverline}
      title={ui.splitDetail.cancelledTitle}
      body={ui.splitDetail.cancelledBody}
      onDone={done}
    />
  ),
}
