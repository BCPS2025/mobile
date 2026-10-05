import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { available, entryOf } from '@domain/ledger'
import { asMinor, formatMinor } from '@domain/money'
import type { FeeQuote, Minor, PaymentUri, PersonaId, UserCommand } from '@domain/types'
import { parsePaymentUri } from '@domain/uri'
import { LJUBLJANA } from '@sim/tz'
import { cmdIdFor, newFlowInstanceId } from '@store/cmdIds'
import {
  type PayTarget,
  payRefusal,
  payTarget,
  posCodeState,
  quoteForLink,
  quoteForRequest,
  txByCmdId,
} from '@store/selectors'
import { useLedgerNode, useLedgerState } from '@store/useLedger'
import { MoneySuccess } from '../flows/MoneySuccess'
import { type Refusal, errorText } from '../errors'
import { fill, ui } from '../copy'
import { approx, eur, itemsText, maskEmail, partyLabel } from '../format'
import { PartyAvatar } from '../kit/PartyAvatar'
import { Wordmark } from '../kit/Wordmark'
import { Dock } from '../phone/chrome/Dock'
import { ErrorLine } from '../phone/chrome/ErrorLine'
import { FactsCard } from '../phone/chrome/FactsCard'
import { PhoneScreen } from '../phone/chrome/PhoneScreen'
import { SuccessLayout } from '../phone/chrome/SuccessScreen'
import { PhoneContext, type PhoneContextValue } from '../phone/PhoneContext'
import { LIVE_SHELLS } from '../phone/registry'
import { useHash } from '../router'
import { AppProvider, useApp } from '../state/AppContext'
import { getAppState } from '../state/boot'
import { LiveRegion, PrefsEffects } from './Presenter'
import PhonePage from './PhonePage'

// The page a payment link, a request or a payment code opens (#/pay?v=1&to=@ana&amount=13.20&link=L-000001),
// outside the phones. When the id is one this browser knows, the page shows what is asked, who is paying
// (the accounts that can log in), the check and the receipt. Paying takes the writer lock from the tab that
// has it; [Back to BCPS] hands it back, and that tab goes on by itself. An address with an id this browser
// does not know opens phone mode on Welcome.

const PHONE: PhoneContextValue = {
  slot: 'single',
  persona: null,
  shell: null,
  mode: 'phone',
  statusBar: false,
  tz: LJUBLJANA,
}

/** The writer lock is this tab's: asks for it when another tab has it, and waits for the saved session to load. */
function takeLock(app: ReturnType<typeof useApp>): Promise<void> {
  const lock = app.runtime.lock
  if (!lock || lock.isWriter()) return Promise.resolve()
  return new Promise((resolve) => {
    const off = lock.onAcquired(() => {
      off()
      resolve()
    })
    lock.takeOver()
  })
}

/** What is asked, from the address and this browser's ledger. */
interface Ask {
  overline: string
  /** "@ana", "Café Lipa". */
  name: string
  amount: Minor
  note: string | undefined
  /** The quote the payer would get (who pays the fee is the link's or the request's own). */
  quote: FeeQuote | null
  single: boolean
}

function askOf(target: PayTarget, state: ReturnType<typeof useLedgerState>): Ask | null {
  if (target.kind === 'link') {
    return {
      overline: ui.payPage.overlineLink,
      name: target.owner ? partyLabel(target.owner) : '',
      amount: target.link.amount,
      note: target.link.note,
      quote: quoteForLink(state, target.link),
      single: !target.link.reusable,
    }
  }
  if (target.kind === 'request') {
    const { request } = target
    const items = itemsText(request.items)
    return {
      overline: request.channel === 'pos' ? ui.payPage.overlineCode : ui.payPage.overlineRequest,
      name: target.requester ? partyLabel(target.requester) : '',
      amount: request.amount,
      note: items || request.note,
      quote: quoteForRequest(state, request),
      single: false,
    }
  }
  return null
}

/**
 * The words for a refusal on this page: a request made of someone else says who can pay it ("Only @ana
 * can do this."); a link or request that is paid or cancelled says so.
 */
function refusalText(error: Refusal, target: PayTarget, state: ReturnType<typeof useLedgerState>): string | null {
  if (error.code === 'not-allowed' && target.kind === 'request' && target.request.payer !== undefined) {
    const payer = entryOf(state.directory, target.request.payer)
    if (payer) return errorText(error, { name: partyLabel(payer) })
  }
  // Paying one's own request or code is "You can't pay yourself."; one's own link has its own words.
  if (error.code === 'self-payment' && target.kind === 'request') return errorText(error)
  return errorText(error, { about: aboutOf(target) })
}

/** What a refusal is about: a payment code, a request or a link (the words differ). */
const aboutOf = (target: PayTarget): 'code' | 'request' | 'link' =>
  target.kind === 'link' ? 'link' : target.kind === 'request' && target.request.channel === 'pos' ? 'code' : 'request'

/** The command that pays the target as `payer`. */
function commandOf(target: PayTarget, payer: PersonaId, cmdId: string, quote: FeeQuote): UserCommand | null {
  const expect = { senderDebit: quote.senderDebit }
  if (target.kind === 'link' && target.owner) {
    return {
      type: 'pay',
      actor: payer,
      cmdId,
      to: target.owner.handle,
      amount: target.link.amount,
      channel: 'link',
      ...(target.link.note ? { note: target.link.note } : {}),
      linkId: target.link.id,
      expect,
    }
  }
  if (target.kind === 'request' && target.requester) {
    const { request } = target
    return {
      type: 'pay',
      actor: payer,
      cmdId,
      to: target.requester.handle,
      amount: request.amount,
      channel: request.channel === 'pos' ? 'qr' : 'request',
      ...(request.note ? { note: request.note } : {}),
      requestId: request.id,
      expect,
    }
  }
  return null
}

/** The navy band at the top of the page: the wordmark, what is asked and how much. */
function Band({ ask, rate }: { ask: Ask; rate: Parameters<typeof approx>[1] }) {
  return (
    <div className="on-navy shrink-0 bg-navy-900 px-5 pt-5 pb-6 text-white">
      <Wordmark className="text-[20px]" />
      <p className="mt-6 font-body text-overline uppercase text-muted-navy">{ask.overline}</p>
      <h1 className="mt-1 font-display text-[24px] leading-[30px] font-semibold">
        {fill(ui.payPage.title, { name: ask.name })}
      </h1>
      <p
        className="mt-2 font-display text-[44px] leading-[48px] font-semibold tracking-[-0.02em] tnum"
        data-testid="pay-amount"
      >
        {formatMinor(ask.amount)}
        <span className="ml-2 text-[20px] font-medium tracking-normal text-grey-400">{ui.common.bcps}</span>
      </p>
      <p className="font-body text-body text-line-300 tnum">
        {ask.note
          ? fill(ui.payPage.noteLine, { note: ask.note, eur: approx(ask.amount, rate) })
          : approx(ask.amount, rate)}
      </p>
    </div>
  )
}

function PayKnown({ uri }: { uri: PaymentUri }) {
  const app = useApp()
  const state = useLedgerState()
  const node = useLedgerNode()
  const [payer, setPayer] = useState<PersonaId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [instance] = useState(newFlowInstanceId)
  const cmdId = cmdIdFor(instance, 'review')

  const target = payTarget(state, uri)
  const ask = askOf(target, state)
  const tx = txByCmdId(state, cmdId)
  const accounts = app.content.personas.personas.filter((p) => p.login && p.shell && LIVE_SHELLS.includes(p.shell))
  if (!ask) return null
  const rate = state.config.rate
  const account = payer === null ? undefined : accounts.find((p) => p.id === payer)

  const back = () => {
    // Nothing more to save: hand the lock back so the tab that had it goes on by itself, then leave.
    app.runtime.flush()
    app.runtime.lock?.release()
    window.location.replace(`${window.location.pathname}${window.location.search}`)
  }

  const pay = async () => {
    if (busy || payer === null) return
    setBusy(true)
    setError(null)
    await takeLock(app)
    // The saved session was loaded when the lock came: decide on what the ledger says now.
    const now = app.runtime.node.getState()
    const fresh = payTarget(now, uri)
    const refusal = payRefusal(fresh, payer)
    const quote =
      fresh.kind === 'link'
        ? quoteForLink(now, fresh.link)
        : fresh.kind === 'request'
          ? quoteForRequest(now, fresh.request)
          : null
    const cmd = quote ? commandOf(fresh, payer, cmdId, quote) : null
    if (refusal || !cmd) {
      setError(refusalText(refusal ?? { code: 'not-allowed' }, fresh, now))
    } else {
      const result = app.runtime.dispatch(cmd)
      if (!result.ok) setError(refusalText(result.error, fresh, now))
    }
    setBusy(false)
  }

  if (tx?.status === 'confirmed') {
    return (
      <PhoneContext.Provider value={PHONE}>
        <MoneySuccess
          id="page.pay.done"
          overline={ui.receipt.paid}
          tx={tx}
          ctx={{ state, persona: payer ?? '', rate }}
          onDone={back}
          doneLabel={ui.payPage.back}
          layout={SuccessLayout}
        />
      </PhoneContext.Provider>
    )
  }

  const sending = tx?.status === 'pending'
  const have = payer === null ? asMinor(0) : available(state, payer)
  const quote = ask.quote
  const refusal = payer === null ? null : payRefusal(target, payer)
  const short = quote && payer !== null && quote.senderDebit > have ? asMinor(quote.senderDebit - have) : null
  const problem = sending
    ? null
    : refusal
      ? refusalText(refusal, target, state)
      : short !== null
        ? errorText({ code: 'insufficient-funds', have, short })
        : error

  // A link that is not open: no one is asked who is paying.
  const code =
    target.kind === 'request' && target.request.channel === 'pos'
      ? posCodeState(state, target.request.id, node.now(), state.config.posCodeValidityMs)
      : undefined
  const closedText =
    code !== undefined && code !== 'open'
      ? errorText({ code: 'invalid-state', status: code }, { about: 'code' })
      : target.kind === 'link' && target.link.status !== 'open'
        ? errorText({ code: 'invalid-state', status: target.link.status }, { about: 'link' })
        : target.kind === 'request' && code === undefined && target.request.status !== 'open'
          ? errorText({ code: 'invalid-state', status: target.request.status }, { about: 'request' })
          : null

  return (
    <PhoneContext.Provider value={PHONE}>
      <PhoneScreen
        id={payer === null ? 'page.pay' : 'page.pay.review'}
        bare
        banner={false}
        dock={
          payer !== null && quote ? (
            <Dock
              settle
              secondary={{
                kind: 'link',
                label: ui.payPage.change,
                onPress: () => setPayer(null),
                disabled: sending || busy,
              }}
              primary={{
                label: fill(ui.payPage.pay, { amount: `${formatMinor(quote.senderDebit)} ${ui.common.bcps}` }),
                tone: 'money',
                enabled: refusal === null && short === null && !busy,
                sending: sending || busy,
                onPress: pay,
              }}
            />
          ) : undefined
        }
        error={payer !== null && problem ? <ErrorLine>{problem}</ErrorLine> : undefined}
      >
        <Band ask={ask} rate={rate} />
        {closedText ? (
          <div className="px-5 pt-5">
            <ErrorLine>{closedText}</ErrorLine>
          </div>
        ) : account === undefined || quote === null ? (
          <div className="px-5 pt-5">
            <h2 className="font-display text-title text-navy-900">{ui.payPage.who}</h2>
            <ul className="mt-3" data-testid="payers">
              {accounts.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    data-testid={`payer-${p.id}`}
                    onClick={() => {
                      setError(null)
                      setPayer(p.id)
                    }}
                    className="flex min-h-14 w-full items-center gap-3 border-b border-line-100 py-2 text-left active:bg-line-100"
                  >
                    <PartyAvatar party={p} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-body text-body font-semibold text-navy-900">
                        {p.displayName}
                      </span>
                      <span className="block truncate font-body text-caption text-grey-600">
                        {maskEmail(p.login?.email ?? '')}
                      </span>
                    </span>
                    <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink" />
                  </button>
                </li>
              ))}
            </ul>
            {ask.single && <p className="mt-4 font-body text-body-s text-grey-600">{ui.payPage.single}</p>}
          </div>
        ) : (
          <div className="px-5 pt-5" data-testid="pay-check">
            <FactsCard
              accent
              facts={[
                {
                  label: ui.payPage.rowFrom,
                  value: `${account.displayName} · ${account.handle}`,
                  testId: 'fact-payer',
                },
                { label: ui.payPage.rowFor, value: ask.note ?? ui.payPage.noNote },
                {
                  label: ui.payPage.rowAmount,
                  value: `${formatMinor(ask.amount)} ${ui.common.bcps}`,
                  sub: approx(ask.amount, rate),
                },
                {
                  label: ui.payPage.rowFee,
                  value: `${formatMinor(quote.fee)} ${ui.common.bcps}`,
                  sub: fill(ui.common.approxEur, { eur: eur(quote.fee, rate) }),
                  testId: 'fact-fee',
                },
                {
                  label: ui.payPage.rowTotal,
                  value: `${formatMinor(quote.senderDebit)} ${ui.common.bcps}`,
                  total: true,
                  testId: 'review-total',
                },
              ]}
            />
          </div>
        )}
      </PhoneScreen>
    </PhoneContext.Provider>
  )
}

function PayRoute() {
  const hash = useHash()
  const app = useApp()
  const state = useLedgerState()
  const parsed = parsePaymentUri(hash)
  if (!parsed.ok) return <PhonePage />
  const target = payTarget(state, parsed.value)
  // A link or a request this browser knows (an invoice has its own screens); anything else opens phone mode.
  const known = target.kind === 'link' || (target.kind === 'request' && target.request.channel !== 'invoice')
  if (!known) return <PhonePage />
  return (
    <div
      data-testid="pay-page"
      className="on-navy fixed inset-0 flex items-center justify-center overflow-hidden bg-navy-900"
      style={{ height: 'var(--app-h, 100dvh)' }}
    >
      <PrefsEffects />
      <LiveRegion />
      <div
        className="relative flex h-full max-h-[900px] w-full max-w-[430px] flex-col bg-bg text-ink"
        data-app={app ? '' : undefined}
      >
        <PayKnown key={hash} uri={parsed.value} />
      </div>
    </div>
  )
}

export default function PayPage() {
  const app = getAppState()
  return (
    <AppProvider app={app}>
      <PayRoute />
    </AppProvider>
  )
}
