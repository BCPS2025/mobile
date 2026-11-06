import { ChevronRight } from 'lucide-react'
import { available, entryOf, limitFor, selectParty } from '@domain/ledger'
import { asMinor, formatMinor } from '@domain/money'
import type { FeeQuote, Minor, Party, PaymentRequest, PersonaId } from '@domain/types'
import { otherStage, personaOn } from '@store/sessions'
import {
  type ScanCandidate,
  counterMerchants,
  posCodeState,
  quoteFor,
  quoteForRequest,
  scanCandidates,
} from '@store/selectors'
import { errorText } from '../errors'
import { fill, ui } from '../copy'
import { approx, eur, itemsText, partyLabel, payerShort } from '../format'
import { FeeChip } from '../kit/FeeChip'
import { PartyAvatar } from '../kit/PartyAvatar'
import { QrSvg } from '../kit/QrCard'
import { linkPayload, personPayload, posCodePayload } from '../paymentCode'
import { ErrorLine } from '../phone/chrome/ErrorLine'
import { StatusChip } from '../phone/chrome/Tag'
import { createPhoneNav, usePhoneNav } from '../phone/nav'
import { MoneySuccess } from './MoneySuccess'
import { AmountStep, parseAmount } from './steps/AmountStep'
import { ReviewStep } from './steps/ReviewStep'
import { partyLines } from './steps/PickPartyStep'
import { TopUpAction, topUpLink } from './topUpOffer'
import type { FlowApi, FlowCtx, FlowImpl, StepProps } from './types'

// Scan (c.scan, c.scan.nearby, c.scan.counterAmount, c.payCode.review): there is no camera. The
// viewfinder locks onto the one code in view and [Continue] goes on: an open payment code opens its
// review, a counter code asks for the amount first, a personal code opens Send for that person and a
// payment link opens its check. With several codes in view ("2 codes nearby", phone mode) [Continue]
// lists them and a tap chooses one. [Pay …] pays the code. "Can't scan? Pay by @username" hands over to
// Send. While no code is in view there is nothing to continue: no dock.

interface Draft {
  /** The payment code that was locked (its request); the review pays this one. */
  locked: string | null
  /** The merchant whose counter code was chosen: the payer enters the amount. */
  counter: PersonaId | null
  /** The counter amount, as typed on the keypad ("3.3"). */
  amount: string
  /** The fee quote the counter review shows and the payment is checked against (`expect`). */
  quoted: FeeQuote | null
  /** The counter code was chosen from the list of codes nearby (Back returns there). */
  fromList: boolean
}

const validityMs = (ctx: FlowCtx): number => ctx.state.config.posCodeValidityMs

/**
 * Every code the phone can point at right now. On the stage: what the phone beside this one shows (a
 * merchant's open code, a personal code or a payment link shown lately); nothing when no one is on it.
 * In phone mode there is no other phone to point at: every open code, every QR shown lately and the
 * counter codes are nearby.
 */
function codesNear(ctx: FlowCtx): ScanCandidate[] {
  const other = ctx.slot === 'single' ? null : personaOn(ctx.app.runtime.ui.get(), otherStage(ctx.slot))
  if (ctx.slot !== 'single' && other === null) return []
  return scanCandidates(ctx.state, ctx.persona, other, ctx.now, validityMs(ctx), {
    shown: ctx.app.transient.get().shownQr,
    counterMerchants: counterMerchants(ctx.content),
  })
}

/** How a code looks to the payer: who shows it, what is under the lock, what its QR holds, its row. */
interface Look {
  key: string
  party: Party
  lock: string
  line: string
  payload: string
  title: string
  sub: string
  amount: Minor | null
}

function lookOf(c: ScanCandidate, ctx: FlowCtx): Look | null {
  const party = (id: PersonaId): Party | undefined => entryOf(ctx.state.directory, id)
  switch (c.kind) {
    case 'pos': {
      const merchant = party(c.merchant)
      if (!merchant) return null
      return {
        key: 'pos',
        party: merchant,
        lock: merchant.displayName,
        line: fill(ui.scan.lockedLine, { table: ui.charge.table, amount: formatMinor(c.amount) }),
        payload: posCodePayload(merchant.handle, c.amount, c.requestId),
        title: fill(ui.scan.rowTable, { name: merchant.displayName, table: ui.charge.table }),
        sub: itemsText([...c.items]) || (c.note ?? ''),
        amount: c.amount,
      }
    }
    case 'counter': {
      const merchant = party(c.merchant)
      if (!merchant) return null
      return {
        key: 'counter',
        party: merchant,
        lock: merchant.displayName,
        line: ui.scan.lockedCounter,
        payload: personPayload(merchant.handle),
        title: fill(ui.scan.rowCounter, { name: merchant.displayName }),
        sub: ui.scan.rowCounterHint,
        amount: null,
      }
    }
    case 'person': {
      const person = party(c.persona)
      if (!person) return null
      return {
        key: `person-${c.persona}`,
        party: person,
        lock: person.displayName,
        line: fill(ui.scan.lockedPerson, { handle: c.handle }),
        payload: personPayload(c.handle),
        title: c.handle,
        sub: ui.hubs.rows.myCode,
        amount: null,
      }
    }
    case 'link': {
      const owner = party(c.owner)
      if (!owner) return null
      return {
        key: `link-${c.linkId}`,
        party: owner,
        lock: owner.displayName,
        line: fill(ui.scan.lockedLink, { amount: formatMinor(c.amount) }),
        payload: linkPayload(owner.handle, c.amount, c.linkId),
        title: fill(ui.lists.linkFrom, { name: partyLabel(owner) }),
        sub: c.note ?? '',
        amount: c.amount,
      }
    }
  }
}

/** What a chosen code leads to. A personal code and a payment link hand the flow over. */
function choose(c: ScanCandidate, ctx: FlowCtx, api: FlowApi<Draft>, fromList: boolean): void {
  const nav = () => createPhoneNav(ctx.app, { persona: ctx.persona, slot: ctx.slot, shell: ctx.shell })
  switch (c.kind) {
    case 'pos':
      api.set({ locked: c.requestId, counter: null })
      api.goto('review')
      break
    case 'counter':
      api.set({ counter: c.merchant, locked: null, amount: '', quoted: null, fromList })
      api.goto('counter')
      break
    case 'person':
      nav().handoff('send', { to: c.handle })
      break
    case 'link':
      nav().handoff('payItem', { link: c.linkId })
      break
  }
}

/** The fee quote of a counter payment of this amount (the merchant's setting now), or null. */
const counterQuote = (ctx: FlowCtx, merchant: PersonaId, amount: Minor): FeeQuote | null =>
  amount > 0 ? quoteFor(ctx.state, merchant, 'qr', amount) : null

/**
 * What the review shows and pays. A payment code: its request and the quote its own fee payer gives. A
 * counter code: the amount typed and the quote taken when it was typed, so that a change of the café's
 * fee setting meanwhile is caught when paying (the quote then no longer matches what the ledger asks).
 */
function reviewOf(d: Draft, ctx: FlowCtx) {
  const have = available(ctx.state, ctx.persona)
  if (d.counter !== null) {
    const merchant = selectParty(ctx.state, d.counter)
    const quote = d.quoted
    const short = quote && quote.senderDebit > have ? asMinor(quote.senderDebit - have) : null
    return { request: undefined, code: 'open' as const, quote, merchant, have, short }
  }
  const request: PaymentRequest | undefined = d.locked ? entryOf(ctx.state.requests, d.locked) : undefined
  const code = request ? posCodeState(ctx.state, request.id, ctx.now, validityMs(ctx)) : undefined
  const quote = request ? quoteForRequest(ctx.state, request) : null
  const merchant = request ? selectParty(ctx.state, request.requester) : undefined
  const short = quote && quote.senderDebit > have ? asMinor(quote.senderDebit - have) : null
  return { request, code, quote, merchant, have, short }
}

function Corner({ at, locked }: { at: 'tl' | 'tr' | 'bl' | 'br'; locked: boolean }) {
  const edges = {
    tl: 'top-0 left-0 border-t-4 border-l-4',
    tr: 'top-0 right-0 border-t-4 border-r-4',
    bl: 'bottom-0 left-0 border-b-4 border-l-4',
    br: 'right-0 bottom-0 border-r-4 border-b-4',
  }
  return (
    <span
      aria-hidden="true"
      className={`absolute size-11 ${edges[at]} ${locked ? 'border-green-500' : 'border-grey-400'}`}
    />
  )
}

function ScanBody({ ctx }: StepProps<Draft>) {
  const nav = usePhoneNav()
  const codes = codesNear(ctx)
  const several = codes.length > 1
  const one = codes.length === 1 && codes[0] ? lookOf(codes[0], ctx) : null
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pt-5 pb-3">
      <div className="flex flex-1 flex-col items-center">
        <figure
          aria-label={ui.scan.viewfinder}
          className="relative size-[260px] shrink-0 bg-navy-800"
          data-testid="viewfinder"
        >
          <Corner at="tl" locked={codes.length > 0} />
          <Corner at="tr" locked={codes.length > 0} />
          <Corner at="bl" locked={codes.length > 0} />
          <Corner at="br" locked={codes.length > 0} />
          {one ? (
            <span className="anim-fade absolute inset-10 flex items-center justify-center bg-white p-2.5">
              <QrSvg payload={one.payload} size={160} label={ui.scan.title} />
            </span>
          ) : (
            <span aria-hidden="true" className="absolute top-1/2 right-10 left-10 h-0.5 bg-navy-700" />
          )}
        </figure>
        {one ? (
          <>
            <p
              data-testid="scan-status"
              className="anim-fade mt-3.5 inline-flex h-[38px] items-center gap-2 border border-green-500 px-3.5 font-body text-body font-semibold text-green-500"
            >
              <span aria-hidden="true" className="inline-block size-2 bg-green-500" />
              {fill(ui.scan.locked, { name: one.lock })}
            </p>
            <p className="mt-4 font-body text-body font-semibold text-white tnum">{one.line}</p>
          </>
        ) : several ? (
          <p
            data-testid="scan-status"
            className="anim-fade mt-3.5 inline-flex h-[38px] items-center gap-2 border border-green-500 px-3.5 font-body text-body font-semibold text-green-500"
          >
            <span aria-hidden="true" className="inline-block size-2 bg-green-500" />
            {fill(ui.scan.nearby, { count: codes.length })}
          </p>
        ) : (
          <>
            <p
              data-testid="scan-status"
              className="mt-3.5 inline-flex h-[38px] items-center gap-2 border border-navy-700 px-3.5 font-body text-body font-semibold text-line-300"
            >
              <span aria-hidden="true" className="inline-block size-2 bg-line-300" />
              {ui.scan.noCode}
            </p>
            <p className="mt-3 font-body text-[13px] leading-[18px] text-line-300">{ui.scan.hold}</p>
          </>
        )}
      </div>
      <p className="mt-2 text-center font-body text-[13px] leading-[18px] text-line-300">
        {ui.scan.cantScan}{' '}
        <button
          type="button"
          data-testid="pay-by-username"
          onClick={() => nav.handoff('send')}
          className="min-h-11 font-semibold text-green-500 underline underline-offset-2"
        >
          {ui.scan.payByUsername}
        </button>
      </p>
    </div>
  )
}

/** The codes nearby: one row each, a tap chooses it. The counter code is listed first, as it is always there. */
function NearbyBody({ ctx, api }: StepProps<Draft>) {
  const near = codesNear(ctx)
  const codes = [...near.filter((c) => c.kind === 'counter'), ...near.filter((c) => c.kind !== 'counter')]
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 font-display text-display-m text-white">{fill(ui.scan.nearby, { count: codes.length })}</h2>
      <ul className="mt-4" data-testid="codes-nearby">
        {codes.map((c) => {
          const look = lookOf(c, ctx)
          if (!look) return null
          return (
            <li key={look.key}>
              <button
                type="button"
                data-testid={`code-${look.key}`}
                onClick={() => choose(c, ctx, api, true)}
                className="flex min-h-[61px] w-full items-center gap-3 border-b border-navy-700 py-2 text-left active:bg-navy-800"
              >
                <PartyAvatar party={look.party} onNavy />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-body text-body font-semibold text-white">{look.title}</span>
                  {look.sub && <span className="block truncate font-body text-body-s text-line-300">{look.sub}</span>}
                </span>
                {look.amount !== null && (
                  <span className="shrink-0 text-right tnum">
                    <span className="block font-body text-body font-semibold text-white">
                      {formatMinor(look.amount)}
                    </span>
                    <span className="block font-body text-body-s text-line-300">{ui.common.bcps}</span>
                  </span>
                )}
                <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-line-300" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** A counter code: "How much?" with the keypad; the fee is the café's setting now. */
function CounterBody({ d, ctx, api }: StepProps<Draft>) {
  const merchant = d.counter ? selectParty(ctx.state, d.counter) : undefined
  const amount = parseAmount(d.amount)
  const quote = merchant ? counterQuote(ctx, merchant.id, amount) : null
  const have = available(ctx.state, ctx.persona)
  const short = quote && quote.senderDebit > have ? asMinor(quote.senderDebit - have) : null
  if (!merchant) return null
  return (
    <AmountStep
      title={ui.send.amountTitle}
      tag={
        <StatusChip tone="success" testId="counter-tag">
          {fill(ui.scan.counterTag, { name: merchant.displayName })}
        </StatusChip>
      }
      value={d.amount}
      onChange={(value) => {
        const q = counterQuote(ctx, merchant.id, parseAmount(value))
        api.set({ amount: value, quoted: q })
      }}
      rate={ctx.rate}
      maxMinor={limitFor(ctx.state, ctx.persona)}
      available={have}
      max={null}
      error={
        short !== null && quote ? <ErrorLine>{errorText({ code: 'insufficient-funds', have, short })}</ErrorLine> : null
      }
      onEnter={api.press}
    />
  )
}

function ReviewBody({ d, ctx, api, sending }: StepProps<Draft>) {
  const { request, code, quote, merchant, have: haveNow, short } = reviewOf(d, ctx)
  if (!quote || !merchant || (d.counter === null && !request)) return null
  const lines = partyLines(merchant, ctx.content)
  // While the payment sends, the code reads as paid and the balance already holds it: show the review as it was.
  const have = sending ? asMinor(haveNow + quote.senderDebit) : haveNow
  const problem = sending
    ? null
    : code && code !== 'open'
      ? errorText({ code: 'invalid-state', status: code })
      : short !== null
        ? errorText({ code: 'insufficient-funds', have, short })
        : null
  // A balance that falls short offers Top up; a code that is no longer open does not.
  const offer = !sending && short !== null && (!code || code === 'open')
  const fee = { fee: formatMinor(quote.fee), eur: eur(quote.fee, ctx.rate) }
  const amount = parseAmount(d.amount)
  return (
    <ReviewStep
      title={fill(ui.scan.reviewTitle, { name: partyLabel(merchant) })}
      rows={[
        { label: ui.scan.rowTo, value: lines.first, sub: lines.second, leading: <PartyAvatar party={merchant} /> },
        ...(d.counter !== null
          ? [
              {
                label: ui.send.rowAmount,
                value: `${formatMinor(amount)} ${ui.common.bcps}`,
                sub: approx(amount, ctx.rate),
                onEdit: () => api.goto('counter', { editing: true }),
              },
            ]
          : []),
        ...(request?.items && request.items.length > 0
          ? [{ label: ui.scan.rowItems, value: itemsText(request.items) }]
          : []),
      ]}
      feeLine={
        quote.payer === 'sender'
          ? fill(ui.fee.transactionYou, fee)
          : fill(ui.fee.transactionBy, { ...fee, name: partyLabel(merchant) })
      }
      feeChip={
        <FeeChip
          quote={quote}
          rate={ctx.rate}
          payerName={quote.payer === 'sender' ? ui.fee.payerYou : payerShort(merchant.id)}
        />
      }
      total={quote.senderDebit}
      balanceAfter={asMinor(have - quote.senderDebit)}
    >
      {problem && (
        <ErrorLine
          className="mt-3"
          {...(offer && short !== null ? { action: <TopUpAction ctx={ctx} short={short} api={api} /> } : {})}
        >
          {problem}
        </ErrorLine>
      )}
    </ReviewStep>
  )
}

export const scanFlow: FlowImpl<Draft> = {
  id: 'scan',
  title: () => ui.scan.title,
  tone: () => 'navy',
  init: () => ({ locked: null, counter: null, amount: '', quoted: null, fromList: false }),
  steps: [
    {
      id: 'scan',
      screen: 'c.scan',
      kind: 'input',
      body: 'navy',
      live: true,
      Screen: ScanBody,
      hideDock: (_d, ctx) => codesNear(ctx).length === 0,
      primary: (_d, ctx) => ({ label: ui.common.continue, tone: 'navy', enabled: codesNear(ctx).length > 0 }),
      onPrimary: (_d, ctx, api) => {
        const codes = codesNear(ctx)
        const only = codes[0]
        if (codes.length === 0 || !only) return
        if (codes.length > 1) api.goto('nearby')
        else choose(only, ctx, api, false)
      },
    },
    {
      id: 'nearby',
      screen: 'c.scan.nearby',
      kind: 'input',
      offPath: true,
      body: 'navy',
      live: true,
      title: () => ui.scan.nearbyTitle,
      Screen: NearbyBody,
      hideDock: () => true,
      primary: () => ({ label: ui.common.continue, tone: 'navy', enabled: false }),
      back: () => ({ step: 'scan' }),
    },
    {
      id: 'counter',
      screen: 'c.scan.counterAmount',
      kind: 'input',
      offPath: true,
      header: () => 'light',
      title: (d, ctx) => {
        const merchant = d.counter ? selectParty(ctx.state, d.counter) : undefined
        return fill(ui.scan.counterTitle, { name: merchant?.displayName ?? '' })
      },
      Screen: CounterBody,
      primary: (d, ctx) => {
        const merchant = d.counter ? selectParty(ctx.state, d.counter) : undefined
        const quote = merchant ? counterQuote(ctx, merchant.id, parseAmount(d.amount)) : null
        const short = quote ? quote.senderDebit > available(ctx.state, ctx.persona) : false
        return { label: ui.common.continue, tone: 'navy', enabled: quote !== null && !short }
      },
      secondary: (d, ctx, api) => {
        const merchant = d.counter ? selectParty(ctx.state, d.counter) : undefined
        const quote = merchant ? counterQuote(ctx, merchant.id, parseAmount(d.amount)) : null
        const have = available(ctx.state, ctx.persona)
        return topUpLink(ctx, quote && quote.senderDebit > have ? asMinor(quote.senderDebit - have) : null, api)
      },
      onPrimary: (_d, _ctx, api) => api.goto('review'),
      back: (d) => ({ step: d.fromList ? 'nearby' : 'scan' }),
    },
    {
      id: 'review',
      screen: 'c.payCode.review',
      kind: 'review',
      live: true,
      header: () => 'light',
      Screen: ReviewBody,
      primary: (d, ctx) => {
        const { code, quote, short } = reviewOf(d, ctx)
        return {
          label: fill(ui.scan.pay, { amount: quote ? formatMinor(quote.senderDebit) : '' }),
          tone: 'money',
          enabled: quote !== null && code === 'open' && short === null,
        }
      },
      back: (d) => (d.counter !== null ? { step: 'counter' } : 'default'),
    },
  ],
  commits: [
    {
      step: 'review',
      await: 'tx',
      // The café changed who pays the fee while the check was open: show the new total with the refusal.
      onRefused: (error, d, ctx, api) => {
        if (error.code !== 'quote-changed' || d.counter === null) return
        const merchant = selectParty(ctx.state, d.counter)
        if (merchant) api.set({ quoted: counterQuote(ctx, merchant.id, parseAmount(d.amount)) })
      },
      command: (d, ctx, cmdId) => {
        const { request, quote, merchant } = reviewOf(d, ctx)
        if (!quote || !merchant) return null
        if (d.counter !== null) {
          return {
            type: 'pay',
            actor: ctx.persona,
            cmdId,
            to: merchant.handle,
            amount: parseAmount(d.amount),
            channel: 'qr',
            expect: { senderDebit: quote.senderDebit },
          }
        }
        if (!request) return null
        return {
          type: 'pay',
          actor: ctx.persona,
          cmdId,
          to: merchant.handle,
          amount: request.amount,
          channel: 'qr',
          ...(request.note ? { note: request.note } : {}),
          requestId: request.id,
          expect: { senderDebit: quote.senderDebit },
        }
      },
    },
  ],
  Success: ({ tx, ctx, done }) =>
    tx ? <MoneySuccess id="c.payCode.success" overline={ui.receipt.paid} tx={tx} ctx={ctx} onDone={done} /> : null,
}
