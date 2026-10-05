import { Copy, QrCode } from 'lucide-react'
import { useEffect, useState } from 'react'
import { entryOf, limitFor } from '@domain/ledger'
import { formatMinor } from '@domain/money'
import type { Party, PaymentLink } from '@domain/types'
import { resolveParty } from '@store/parties'
import { linkByCmdId } from '@store/selectors'
import { copyText } from '../clipboard'
import { fill, ui } from '../copy'
import { approx } from '../format'
import { QrSvg } from '../kit/QrCard'
import { linkPayload } from '../paymentCode'
import { FactsCard } from '../phone/chrome/FactsCard'
import { SuccessScreen } from '../phone/chrome/SuccessScreen'
import { AmountStep, parseAmount } from './steps/AmountStep'
import { NoteStep } from './steps/NoteStep'
import { PickPartyStep } from './steps/PickPartyStep'
import type { FlowCtx, FlowImpl, StepProps } from './types'

// Payment link (c.link.*): an amount, what it is for, a check, and the link is made. A person's
// link is single use: one person can pay it, and the payer pays the 1% fee on top. Link ready shows
// the QR and offers Copy link, Show QR (full screen) and Send in BCPS (to one person); Done leaves
// the link waiting. The same flow, opened from a link that waits, goes straight to sending it
// again. The address is never written out on screen.

interface Draft {
  /** The keypad string. */
  amount: string
  note: string
  /** The link that was made, or the one a flow opened from a waiting link sends. */
  linkId?: string
  /** The link was made by this flow (Back from sending returns to Link ready). */
  made: boolean
  /** What is typed when choosing who gets the link. */
  query: string
  /** Who the link was sent to, once it was. */
  sharedTo?: string
}

const isPerson = (p: Party): boolean => p.kind === 'person'

function linkOf(d: Draft, ctx: FlowCtx): PaymentLink | undefined {
  return d.linkId === undefined ? undefined : entryOf(ctx.state.links, d.linkId)
}

/** The shortened text of a link, for the QR's label: "bcps link · 13.20 BCPS · Pizza". */
function linkLabel(link: PaymentLink): string {
  const values = { amount: formatMinor(link.amount), note: link.note ?? '' }
  return fill(link.note ? ui.link.qrLabel : ui.link.qrLabelPlain, values)
}

function AmountBody({ d, ctx, api }: StepProps<Draft>) {
  return (
    <AmountStep
      title={ui.link.amountTitle}
      value={d.amount}
      onChange={(amount) => api.set({ amount })}
      rate={ctx.rate}
      maxMinor={limitFor(ctx.state, ctx.persona)}
      available={null}
      max={null}
      hint={ui.link.amountHint}
      onEnter={api.press}
    />
  )
}

function NoteBody({ d, ctx, api }: StepProps<Draft>) {
  return (
    <NoteStep
      title={ui.link.noteTitle}
      value={d.note}
      chips={ctx.content.catalogue.noteChips.person}
      onChange={(note) => api.set({ note })}
      visibility={ui.link.noteVisibility}
    />
  )
}

function ReviewBody({ d, ctx, api }: StepProps<Draft>) {
  const amount = parseAmount(d.amount)
  const edit = (step: string) => () => api.goto(step, { editing: true })
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 pb-3.5 font-display text-display-m text-navy-900">{ui.link.reviewTitle}</h2>
      <FactsCard
        accent
        facts={[
          {
            label: ui.link.rowAmount,
            value: `${formatMinor(amount)} ${ui.common.bcps}`,
            sub: approx(amount, ctx.rate),
            onEdit: edit('amount'),
          },
          { label: ui.link.rowNote, value: d.note.trim() || ui.link.noNote, onEdit: edit('note') },
          { label: ui.link.rowWho, value: ui.link.who },
          { label: ui.link.rowFee, value: ui.link.feeBy },
        ]}
      />
    </div>
  )
}

/** Link ready: the QR, the amount and note, Copy link and Show QR, the reference. */
function ReadyBody({ d, ctx, api }: StepProps<Draft>) {
  const link = linkOf(d, ctx)
  const [copied, setCopied] = useState(false)
  const owner = ctx.persona
  const linkId = link?.id
  // Showing the QR lets the phone beside this one scan it (for ten minutes).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per link shown
  useEffect(() => {
    if (linkId !== undefined) ctx.app.actions.showQr(owner, 'link', linkId)
  }, [linkId, owner])
  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(id)
  }, [copied])
  const handle = entryOf(ctx.state.directory, owner)?.handle
  if (!link || !handle) return null
  const payload = linkPayload(handle, link.amount, link.id)
  const button =
    'flex h-12 min-w-0 flex-1 items-center justify-center gap-2 border border-line-300 px-3 font-display text-[15px] font-semibold text-white active:bg-navy-700'
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center px-5 pt-3 text-center">
      <span className="bg-white p-2.5">
        <QrSvg payload={payload} size={174} label={linkLabel(link)} />
      </span>
      <p className="mt-4 font-display text-[36px] leading-10 font-semibold tracking-[-0.02em] text-white tnum">
        {formatMinor(link.amount)}
        <span className="ml-2 text-[16px] font-medium tracking-normal text-muted-on-800">{ui.common.bcps}</span>
      </p>
      {link.note && <p className="font-body text-body-l text-line-300">{link.note}</p>}
      <div className="mt-4 flex w-full gap-3">
        <button
          type="button"
          data-testid="copy-link"
          onClick={async () => setCopied(await copyText(payload))}
          className={button}
        >
          <Copy size={20} strokeWidth={1.75} aria-hidden="true" />
          {copied ? ui.link.copied : ui.link.copy}
        </button>
        <button type="button" data-testid="show-qr" onClick={() => api.goto('qr')} className={button}>
          <QrCode size={20} strokeWidth={1.75} aria-hidden="true" />
          {ui.link.showQr}
        </button>
      </div>
      <p className="mt-3 font-body text-body-s text-line-300" data-testid="link-reference">
        {fill(ui.link.reference, { id: link.id })}
      </p>
      <span role="status" className="sr-only">
        {copied ? ui.link.copied : ''}
      </span>
    </div>
  )
}

/** The code on its own, full screen, for the other phone. */
function QrBody({ d, ctx }: StepProps<Draft>) {
  const link = linkOf(d, ctx)
  const owner = ctx.persona
  const linkId = link?.id
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per link shown
  useEffect(() => {
    if (linkId !== undefined) ctx.app.actions.showQr(owner, 'link', linkId)
  }, [linkId, owner])
  const handle = entryOf(ctx.state.directory, owner)?.handle
  if (!link || !handle) return null
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 pb-6 text-center">
      <span className="bg-white p-3" data-testid="qr-large">
        <QrSvg payload={linkPayload(handle, link.amount, link.id)} size={262} label={linkLabel(link)} />
      </span>
      <p className="mt-5 font-display text-[32px] leading-9 font-semibold text-white tnum">
        {formatMinor(link.amount)}
        <span className="ml-2 text-[16px] font-medium text-grey-400">{ui.common.bcps}</span>
      </p>
      {link.note && <p className="font-body text-body-l text-line-300">{link.note}</p>}
      <p className="mt-2 font-body text-body-s text-line-300">{ui.link.qrHint}</p>
    </div>
  )
}

function ToBody({ d, ctx, api }: StepProps<Draft>) {
  return (
    <PickPartyStep
      title={ui.link.toTitle}
      query={d.query}
      onQuery={(query) => api.set({ query })}
      state={ctx.state}
      content={ctx.content}
      viewer={ctx.persona}
      peopleOnly
      businessError={ui.link.peopleOnly}
      onSubmit={api.press}
    />
  )
}

export const paymentLinkFlow: FlowImpl<Draft> = {
  id: 'paymentLink',
  title: () => ui.link.title,
  tone: () => 'light',
  init: (ctx) => ({
    amount: '',
    note: '',
    made: false,
    query: '',
    ...(ctx.params.linkId !== undefined ? { linkId: ctx.params.linkId } : {}),
  }),
  // "Share again" opens on sending; a new link opens on its amount.
  openOn: (d) => (d.linkId !== undefined && !d.made ? 'to' : 'amount'),
  steps: [
    {
      id: 'amount',
      screen: 'c.link.amount',
      kind: 'input',
      Screen: AmountBody,
      primary: (d) => ({ label: ui.common.continue, tone: 'navy', enabled: parseAmount(d.amount) > 0 }),
    },
    {
      id: 'note',
      screen: 'c.link.note',
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
      screen: 'c.link.review',
      kind: 'review',
      Screen: ReviewBody,
      primary: () => ({ label: ui.link.create, tone: 'navy', enabled: true }),
    },
    {
      id: 'ready',
      screen: 'c.link.ready',
      kind: 'committed',
      offPath: true,
      body: 'navy-800',
      header: () => 'navy800',
      overline: () => ui.link.readyOverline,
      Screen: ReadyBody,
      primary: () => ({ label: ui.link.sendInBcps, tone: 'white', enabled: true }),
      stack: (_d, _ctx, api) => [
        { label: ui.link.sendInBcps, kind: 'white', onPress: () => api.goto('to') },
        { label: ui.common.done, kind: 'outline', onPress: api.done },
      ],
    },
    {
      id: 'qr',
      screen: 'c.link.qr',
      kind: 'committed',
      offPath: true,
      body: 'navy',
      header: () => 'navy',
      hideDock: () => true,
      Screen: QrBody,
      primary: () => ({ label: ui.common.done, tone: 'white', enabled: true }),
      back: () => ({ step: 'ready' }),
    },
    {
      id: 'to',
      screen: 'c.link.to',
      kind: 'input',
      offPath: true,
      Screen: ToBody,
      primary: (d, ctx) => ({
        label: ui.link.sendLink,
        tone: 'navy',
        enabled: resolveParty(ctx.state, ctx.persona, d.query, { filter: isPerson }) !== undefined,
      }),
      // From Link ready back to it; from a waiting link, out of the flow.
      back: (d) => (d.made ? { step: 'ready' } : 'leave'),
    },
  ],
  commits: [
    {
      step: 'review',
      await: 'none',
      command: (d, ctx, cmdId) => {
        const amount = parseAmount(d.amount)
        const note = d.note.trim()
        return {
          type: 'link.create',
          actor: ctx.persona,
          cmdId,
          amount,
          ...(note ? { note } : {}),
        }
      },
      onAccepted: (_d, ctx, api, cmdId) => {
        const link = linkByCmdId(ctx.app.runtime.node.getState(), cmdId)
        api.set({ made: true, ...(link ? { linkId: link.id } : {}) })
        api.goto('ready')
      },
    },
    {
      step: 'to',
      await: 'none',
      refusal: () => ({ about: 'link' }),
      command: (d, ctx, cmdId) => {
        const to = resolveParty(ctx.state, ctx.persona, d.query, { filter: isPerson })
        if (!to || d.linkId === undefined) return null
        return { type: 'link.share', actor: ctx.persona, cmdId, linkId: d.linkId, to: to.handle }
      },
      onAccepted: (d, ctx, api) => {
        const to = resolveParty(ctx.state, ctx.persona, d.query, { filter: isPerson })
        api.set({ sharedTo: to?.handle ?? d.query })
      },
    },
  ],
  done: (d) => d.sharedTo !== undefined,
  Success: ({ d, done }) => (
    <SuccessScreen
      id="c.link.shared"
      variant="neutral"
      overline={ui.link.sentOverline}
      title={ui.link.sentTitle}
      body={fill(ui.link.sentBody, { handle: d.sharedTo ?? '' })}
      onDone={done}
    />
  ),
}
