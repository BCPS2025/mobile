import { available, entryOf, selectParty } from '@domain/ledger'
import { asMinor, formatMinor } from '@domain/money'
import type { PaymentRequest } from '@domain/types'
import { otherStage, personaOn } from '@store/sessions'
import { type PosScanCandidate, posCodeState, quoteForRequest, scanCandidates } from '@store/selectors'
import { errorText } from '../errors'
import { fill, ui } from '../copy'
import { eur, itemsText, partyLabel, payerShort } from '../format'
import { FeeChip } from '../kit/FeeChip'
import { PartyAvatar } from '../kit/PartyAvatar'
import { QrSvg } from '../kit/QrCard'
import { ErrorLine } from '../phone/chrome/ErrorLine'
import { usePhoneNav } from '../phone/nav'
import { posCodePayload } from '../paymentCode'
import { MoneySuccess } from './MoneySuccess'
import { ReviewStep } from './steps/ReviewStep'
import { partyLines } from './steps/PickPartyStep'
import type { FlowCtx, FlowImpl, StepProps } from './types'

// Scan (c.scan, c.payCode.review): there is no camera. The viewfinder locks onto the open payment
// code of the account on the other visible phone ("Locked · Café Lipa ✓ · Table 4 · 11.00 BCPS"),
// [Continue] opens the review, and [Pay …] pays the code. "Can't scan? Pay by @username" hands
// over to Send. While no code is in view there is nothing to continue: no dock.

interface Draft {
  /** The code that was locked (its request); the review pays this one. */
  locked: string | null
}

const validityMs = (ctx: FlowCtx): number => ctx.state.config.posCodeValidityMs

/**
 * The code the viewfinder is locked onto right now, if any: the open code of the merchant on the phone
 * beside this one. In phone mode there is no other phone to point at; the codes nearby are listed.
 */
function candidateOf(ctx: FlowCtx): PosScanCandidate | undefined {
  if (ctx.slot === 'single') return undefined
  const other = personaOn(ctx.app.runtime.ui.get(), otherStage(ctx.slot))
  const first = scanCandidates(ctx.state, ctx.persona, other, ctx.now, validityMs(ctx))[0]
  return first?.kind === 'pos' ? first : undefined
}

/** What the review shows and pays, from the locked code and the ledger right now. */
function reviewOf(d: Draft, ctx: FlowCtx) {
  const request: PaymentRequest | undefined = d.locked ? entryOf(ctx.state.requests, d.locked) : undefined
  const code = request ? posCodeState(ctx.state, request.id, ctx.now, validityMs(ctx)) : undefined
  const quote = request ? quoteForRequest(ctx.state, request) : null
  const merchant = request ? selectParty(ctx.state, request.requester) : undefined
  const have = available(ctx.state, ctx.persona)
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
  const candidate = candidateOf(ctx)
  const merchant = candidate ? selectParty(ctx.state, candidate.merchant) : undefined
  const amount = candidate ? formatMinor(candidate.amount) : ''
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pt-5 pb-3">
      <div className="flex flex-1 flex-col items-center">
        <figure
          aria-label={ui.scan.viewfinder}
          className="relative size-[260px] shrink-0 bg-navy-800"
          data-testid="viewfinder"
        >
          <Corner at="tl" locked={Boolean(candidate)} />
          <Corner at="tr" locked={Boolean(candidate)} />
          <Corner at="bl" locked={Boolean(candidate)} />
          <Corner at="br" locked={Boolean(candidate)} />
          {candidate && merchant ? (
            <span className="anim-fade absolute inset-10 flex items-center justify-center bg-white p-2.5">
              <QrSvg
                payload={posCodePayload(merchant.handle, candidate.amount, candidate.requestId)}
                size={160}
                label={ui.scan.title}
              />
            </span>
          ) : (
            <span aria-hidden="true" className="absolute top-1/2 right-10 left-10 h-0.5 bg-navy-700" />
          )}
        </figure>
        {candidate && merchant ? (
          <>
            <p
              data-testid="scan-status"
              className="anim-fade mt-3.5 inline-flex h-[38px] items-center gap-2 border border-green-500 px-3.5 font-body text-body font-semibold text-green-500"
            >
              <span aria-hidden="true" className="inline-block size-2 bg-green-500" />
              {fill(ui.scan.locked, { name: merchant.displayName })}
            </p>
            <p className="mt-4 font-body text-body font-semibold text-white tnum">
              {fill(ui.scan.lockedLine, { table: ui.charge.table, amount })}
            </p>
          </>
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

function ReviewBody({ d, ctx, sending }: StepProps<Draft>) {
  const { request, code, quote, merchant, have: haveNow, short } = reviewOf(d, ctx)
  if (!request || !quote || !merchant) return null
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
  const fee = { fee: formatMinor(quote.fee), eur: eur(quote.fee, ctx.rate) }
  return (
    <ReviewStep
      title={fill(ui.scan.reviewTitle, { name: partyLabel(merchant) })}
      rows={[
        { label: ui.scan.rowTo, value: lines.first, sub: lines.second, leading: <PartyAvatar party={merchant} /> },
        ...(request.items && request.items.length > 0
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
      {problem && <ErrorLine className="mt-3">{problem}</ErrorLine>}
    </ReviewStep>
  )
}

export const scanFlow: FlowImpl<Draft> = {
  id: 'scan',
  title: () => ui.scan.title,
  tone: () => 'navy',
  init: () => ({ locked: null }),
  steps: [
    {
      id: 'scan',
      screen: 'c.scan',
      kind: 'input',
      body: 'navy',
      live: true,
      Screen: ScanBody,
      hideDock: (_d, ctx) => candidateOf(ctx) === undefined,
      primary: (_d, ctx) => ({ label: ui.common.continue, tone: 'navy', enabled: candidateOf(ctx) !== undefined }),
      onPrimary: (_d, ctx, api) => {
        const candidate = candidateOf(ctx)
        if (!candidate) return
        api.set({ locked: candidate.requestId })
        api.next()
      },
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
    },
  ],
  commits: [
    {
      step: 'review',
      await: 'tx',
      command: (d, ctx, cmdId) => {
        const { request, quote, merchant } = reviewOf(d, ctx)
        if (!request || !quote || !merchant) return null
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
