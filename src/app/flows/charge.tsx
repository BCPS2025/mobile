import { useEffect, useRef } from 'react'
import { entryOf, selectParty } from '@domain/ledger'
import { asMinor, formatMinor, mustParseMinor } from '@domain/money'
import type { Minor, Tx, TxItem, UserCommand } from '@domain/types'
import { counterpartyOf } from '@store/parties'
import { latestPosRequest, openPosRequest, posCodeState } from '@store/selectors'
import { fill, ui } from '../copy'
import { approx, eur, itemsText, partyLabel } from '../format'
import { QrSvg } from '../kit/QrCard'
import { errorText } from '../errors'
import { ErrorLine } from '../phone/chrome/ErrorLine'
import { InfoRows } from '../phone/chrome/InfoRows'
import { SuccessScreen } from '../phone/chrome/SuccessScreen'
import { posCodePayload } from '../paymentCode'
import { AmountKeys, keypadKeyOf, parseAmount } from './steps/AmountStep'
import { ConfirmStep } from './steps/ConfirmStep'
import { WaitStep } from './steps/WaitStep'
import { keypadInput } from '../kit/Keypad'
import type { FlowCtx, FlowImpl, StepProps } from './types'

// Charge (pos.charge, pos.code, pos.code.cancel, pos.paid): the café picks what was sold (item
// chips, or a custom amount on the keypad), [Charge …] shows a payment code that the customer's
// phone can scan, and the flow ends on PAID once the payment settles. The code lives in the
// ledger (a request of the POS channel), not in the flow: the step renders it from the ledger, so
// it is right after a reload, after Home, and while the café is away. Back on the code is the
// Cancel confirm. A code runs out after five minutes: [New code] makes a fresh one with the same
// items, [Cancel] closes it.

interface Draft {
  /** What was tapped: item quantities in the order of the first tap. */
  items: { sku: string; qty: number }[]
  /** The keypad string of a custom amount. */
  custom: string
  /** The custom amount keypad is open. */
  keypad: boolean
  /** The code this flow shows (a request of the ledger). */
  requestId: string | null
  /** Codes this flow has made: every command id is used once, also after a cancel or an expiry. */
  codes: number
}

const validityMs = (ctx: FlowCtx): number => ctx.state.config.posCodeValidityMs

/** What the café has chosen: the priced items, and the amount they (or the keypad) make. */
function chosen(d: Draft, ctx: FlowCtx): { items: TxItem[]; amount: Minor } {
  const catalogue = ctx.content.catalogue.products[ctx.persona] ?? []
  const items: TxItem[] = d.items.flatMap(({ sku, qty }) => {
    const product = catalogue.find((p) => p.sku === sku)
    return product ? [{ sku: product.sku, name: product.name, qty, price: mustParseMinor(product.price) }] : []
  })
  if (items.length === 0) return { items, amount: parseAmount(d.custom) }
  return { items, amount: asMinor(items.reduce((sum, it) => sum + it.qty * it.price, 0)) }
}

/** The code this flow shows, and what it is right now (open, ran out, paid, cancelled). */
function codeOf(d: Draft, ctx: FlowCtx) {
  const request = d.requestId ? entryOf(ctx.state.requests, d.requestId) : undefined
  const state = request ? posCodeState(ctx.state, request.id, ctx.now, validityMs(ctx)) : undefined
  return { request, state }
}

/** The sale that paid the code of this flow, once it has settled. */
function settledSale(d: Draft, ctx: FlowCtx): Tx | undefined {
  const { request, state } = codeOf(d, ctx)
  if (!request || state !== 'paid' || request.txId === undefined) return undefined
  const tx = entryOf(ctx.state.txs, request.txId)
  return tx?.status === 'confirmed' ? tx : undefined
}

/** m:ss of the time left; the last second still reads 0:00. */
function countdown(ms: number): string {
  const seconds = Math.max(0, Math.floor((ms - 1) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function Heading({ children }: { children: string }) {
  return (
    <div className="pt-6 pb-3">
      <h2 className="font-display text-[13px] leading-4 font-semibold uppercase tracking-[0.14em] text-white">
        {children}
      </h2>
      <span aria-hidden="true" className="mt-1.5 block h-[3px] w-6 bg-green-500" />
    </div>
  )
}

// ---- step 1: what was sold

function ItemsBody({ d, ctx, api }: StepProps<Draft>) {
  const { items, amount } = chosen(d, ctx)
  const catalogue = ctx.content.catalogue.products[ctx.persona] ?? []
  const max = ctx.state.config.limits.consumerMax
  const locked = items.length > 0
  // What was tapped comes first, in the order it was tapped; the rest follow in menu order.
  const tapped = d.items.flatMap(({ sku }) => catalogue.filter((p) => p.sku === sku))
  const shelf = [...tapped, ...catalogue.filter((p) => !tapped.includes(p))]
  const root = useRef<HTMLDivElement>(null)
  const open = d.keypad
  useEffect(() => {
    if (open) root.current?.focus({ preventScroll: true })
  }, [open])

  const tap = (sku: string) =>
    api.set((x) => {
      const at = x.items.findIndex((i) => i.sku === sku)
      const next =
        at < 0 ? [...x.items, { sku, qty: 1 }] : x.items.map((i, k) => (k === at ? { ...i, qty: i.qty + 1 } : i))
      return { ...x, items: next, custom: '' }
    })
  const press = (key: string) => {
    if (locked) return
    api.set({ custom: keypadInput(d.custom, key, max) })
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!d.keypad) return
    const key = keypadKeyOf(e)
    if (key === null) return
    press(key)
    e.preventDefault()
  }
  const value = amount > 0 ? formatMinor(amount) : d.custom === '' ? '0.00' : d.custom

  return (
    // biome-ignore lint/a11y/useSemanticElements: a keypad region that takes keyboard input; a fieldset would draw a box
    <div
      ref={root}
      role="group"
      aria-label={open ? ui.steps.keypad : ui.charge.title}
      tabIndex={-1}
      data-keypad
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 flex-col px-5 pb-3 outline-none"
    >
      <div className="pt-5 text-center">
        <p
          data-testid="amount-value"
          className={`font-display text-[48px] leading-[52px] font-semibold tracking-[-0.02em] tnum ${
            amount > 0 || d.custom !== '' ? 'text-white' : 'text-navy-700'
          }`}
        >
          {value}
          <span className="ml-2 text-[22px] font-medium tracking-normal text-grey-400">{ui.common.bcps}</span>
        </p>
        <p className="font-body text-body text-line-300 tnum">{approx(amount, ctx.rate)}</p>
      </div>
      <Heading>{ui.charge.items}</Heading>
      <ul className="flex flex-wrap gap-2">
        {shelf.map((p) => {
          const qty = d.items.find((i) => i.sku === p.sku)?.qty ?? 0
          return (
            <li key={p.sku}>
              <button
                type="button"
                data-testid={`item-${p.sku}`}
                aria-pressed={qty > 0}
                onClick={() => tap(p.sku)}
                className={`flex h-12 items-center gap-2 px-3.5 font-body text-body ${
                  qty > 0 ? 'bg-white font-semibold text-navy-900' : 'border border-navy-700 bg-navy-800 text-white'
                }`}
              >
                {p.name}
                {qty > 0 && (
                  <span data-testid={`qty-${p.sku}`} className="text-[13px] font-semibold opacity-80">
                    {fill(ui.charge.quantity, { qty })}
                  </span>
                )}
              </button>
            </li>
          )
        })}
        <li>
          <button
            type="button"
            data-testid="item-custom"
            aria-pressed={open}
            onClick={() => api.set({ keypad: !open })}
            className={`flex h-12 items-center px-3.5 font-body text-body ${
              open ? 'bg-white font-semibold text-navy-900' : 'border border-navy-700 bg-navy-800 text-white'
            }`}
          >
            {ui.charge.custom}
          </button>
        </li>
      </ul>
      {amount > max && (
        <ErrorLine onNavy className="mt-3">
          {errorText({ code: 'invalid-amount', max })}
        </ErrorLine>
      )}
      {open ? (
        <div className="mt-2">
          {locked && (
            <p className="flex items-center justify-between py-1 font-body text-body-s text-line-300">
              {ui.charge.fromItems}
              <button
                type="button"
                data-testid="charge-clear"
                onClick={() => api.set({ items: [], custom: '' })}
                className="min-h-11 pl-3 font-semibold text-green-500 underline underline-offset-2"
              >
                {ui.charge.clear}
              </button>
            </p>
          )}
          <AmountKeys onPress={press} locked={locked} onNavy />
        </div>
      ) : (
        <p className="mt-auto pt-3 text-center font-body text-[13px] leading-[18px] text-line-300">
          {fill(ui.charge.hint, { table: ui.charge.table })}
        </p>
      )}
    </div>
  )
}

// ---- step 2: the payment code

function CodeBody({ d, ctx }: StepProps<Draft>) {
  const { request, state } = codeOf(d, ctx)
  const merchant = request ? selectParty(ctx.state, request.requester) : undefined
  if (!request || !merchant) return null
  // A code that was paid and is settling still reads as a code until PAID shows.
  const expired = state === 'expired'
  const left = request.createdAt + validityMs(ctx) - ctx.now
  const what = [request.note, itemsText(request.items)].filter((x) => x).join(' · ')
  return (
    <WaitStep onNavy>
      <span
        data-testid="code-qr"
        className={`mt-3 inline-block border border-line-200 bg-white p-3 ${expired ? 'opacity-50' : ''}`}
      >
        <QrSvg
          payload={posCodePayload(merchant.handle, request.amount, request.id)}
          size={200}
          label={ui.charge.codeLabel}
        />
      </span>
      <p
        data-testid="code-amount"
        className="mt-3.5 font-display text-[32px] leading-[35px] font-semibold tracking-[-0.02em] tnum text-white"
      >
        {formatMinor(request.amount)}
        <span className="ml-1.5 text-[14px] font-medium tracking-normal text-grey-400">{ui.common.bcps}</span>
      </p>
      {expired ? (
        <p data-testid="code-expired" className="mt-3 font-body text-body font-semibold text-warning-on-dark">
          {ui.charge.expired}
        </p>
      ) : (
        <>
          {what && <p className="mt-1 font-body text-body text-line-300">{what}</p>}
          <div className="mt-3.5 flex flex-wrap justify-center gap-2">
            <span
              role="timer"
              data-testid="code-countdown"
              className="inline-flex h-7 items-center bg-navy-700 px-2.5 font-body text-[12px] leading-4 font-semibold tracking-[0.02em] text-white tnum"
            >
              {fill(ui.charge.valid, { time: countdown(left) })}
            </span>
            <span className="inline-flex h-7 items-center bg-navy-700 px-2.5 font-body text-[12px] leading-4 font-semibold tracking-[0.12em] text-white">
              {ui.charge.tapToPay} · {ui.common.planned}
            </span>
          </div>
        </>
      )}
    </WaitStep>
  )
}

// ---- Cancel this charge?

function CancelBody({ d, ctx }: StepProps<Draft>) {
  const { request } = codeOf(d, ctx)
  if (!request) return null
  const rows = [
    { label: ui.charge.rowAmount, value: `${formatMinor(request.amount)} ${ui.common.bcps}` },
    ...(request.items && request.items.length > 0
      ? [{ label: ui.charge.rowItems, value: itemsText(request.items) }]
      : []),
  ]
  return (
    <ConfirmStep title={ui.charge.cancelTitle} body={ui.charge.cancelBody} onNavy>
      <InfoRows className="mt-3.5" rows={rows} />
    </ConfirmStep>
  )
}

// ---- PAID

function PaidBody({ tx, ctx, followOn }: { tx: Tx; ctx: FlowCtx; followOn: () => void }) {
  // PAID is the café being told: its notification for this sale is read once the screen shows.
  const { app, persona } = ctx
  useEffect(() => {
    app.actions.markRead(persona, `tx:${tx.id}`)
  }, [app, persona, tx.id])
  const payer = counterpartyOf(ctx.state, tx.from, tx.party)
  const from = payer
    ? payer.kind === 'person'
      ? fill(ui.charge.from, { handle: payer.handle, name: payer.displayName })
      : fill(ui.charge.fromName, { name: partyLabel(payer) })
    : undefined
  return (
    <SuccessScreen
      id="pos.paid"
      variant="money"
      overline={ui.charge.paid}
      amount={{ value: tx.amount, signed: true }}
      {...(from ? { sub: from } : {})}
      highlight={ui.charge.spendable}
      linesStyle="card"
      lines={[
        {
          label: ui.charge.fee,
          value:
            tx.fee.rule === 'zero'
              ? ui.fee.chipNone
              : fill(ui.charge.feeValue, { fee: formatMinor(tx.fee.fee), eur: eur(tx.fee.fee, ctx.rate) }),
        },
        { label: ui.charge.reference, value: tx.id, mono: true },
      ]}
      doneLabel={ui.charge.newSale}
      onDone={followOn}
    />
  )
}

// ---- the flow

/** A code made by this flow, from what the ledger holds now: the flow shows it from here on. */
const onCreated: NonNullable<FlowImpl<Draft>['commits'][number]['onAccepted']> = (_d, ctx, api, _cmdId) => {
  const made = latestPosRequest(ctx.app.runtime.node.getState(), ctx.persona)
  api.set((x) => ({ ...x, requestId: made?.id ?? null, codes: x.codes + 1 }))
}

const createStep = (d: Draft): string => (d.codes === 0 ? 'items' : `items-${d.codes}`)

export const chargeFlow: FlowImpl<Draft> = {
  id: 'charge',
  title: () => ui.charge.title,
  tone: () => 'business',
  init: (ctx) => {
    const open = openPosRequest(ctx.state, ctx.persona, ctx.now, validityMs(ctx))
    return { items: [], custom: '', keypad: false, requestId: open?.id ?? null, codes: 0 }
  },
  // The Charge tile opens straight on the code while one is open (also after a reload).
  openOn: (d) => (d.requestId ? 'code' : 'items'),
  steps: [
    {
      id: 'items',
      screen: 'pos.charge',
      kind: 'input',
      body: 'navy',
      Screen: ItemsBody,
      primary: (d, ctx) => {
        const { amount } = chosen(d, ctx)
        const ok = amount > 0 && amount <= ctx.state.config.limits.consumerMax
        return {
          label: amount > 0 ? fill(ui.charge.charge, { amount: formatMinor(amount) }) : ui.charge.title,
          tone: 'money',
          enabled: ok,
        }
      },
    },
    {
      id: 'code',
      screen: 'pos.code',
      kind: 'waitFor',
      body: 'navy',
      title: () => ui.charge.codeTitle,
      live: true,
      Screen: CodeBody,
      // Back on the code asks whether to cancel it.
      back: () => ({ step: 'cancel' }),
      primary: (d, ctx) =>
        codeOf(d, ctx).state === 'expired'
          ? { label: ui.charge.newCode, tone: 'navy', enabled: true }
          : { label: ui.charge.cancel, tone: 'outline', enabled: true },
      secondary: (d, ctx, api) =>
        codeOf(d, ctx).state === 'expired'
          ? { kind: 'link', label: ui.charge.cancel, onPress: () => api.goto('cancel') }
          : null,
      onPrimary: (_d, _ctx, api) => api.goto('cancel'),
    },
    {
      id: 'cancel',
      screen: 'pos.code.cancel',
      kind: 'confirm',
      body: 'navy',
      title: () => ui.charge.codeTitle,
      offPath: true,
      Screen: CancelBody,
      back: () => ({ step: 'code' }),
      primary: () => ({ label: ui.charge.cancelCharge, tone: 'navy', enabled: true }),
      secondary: (_d, _ctx, api) => ({ kind: 'outline', label: ui.charge.keep, onPress: () => api.goto('code') }),
    },
  ],
  commits: [
    {
      step: 'items',
      cmdStep: createStep,
      await: 'none',
      command: (d, ctx, cmdId): UserCommand | null => {
        const { items, amount } = chosen(d, ctx)
        if (amount <= 0) return null
        return {
          type: 'request.create',
          actor: ctx.persona,
          cmdId,
          channel: 'pos',
          amount,
          ...(items.length > 0 ? { items } : {}),
          note: ui.charge.table,
        }
      },
      onAccepted: (d, ctx, api, cmdId) => {
        onCreated(d, ctx, api, cmdId)
        api.next()
      },
    },
    {
      // [New code] on a code that ran out: a fresh code with the same items.
      step: 'code',
      cmdStep: createStep,
      when: (d, ctx) => codeOf(d, ctx).state === 'expired',
      await: 'none',
      command: (d, ctx, cmdId): UserCommand | null => {
        const { request } = codeOf(d, ctx)
        if (!request) return null
        return {
          type: 'request.create',
          actor: ctx.persona,
          cmdId,
          channel: 'pos',
          amount: request.amount,
          ...(request.items && request.items.length > 0 ? { items: request.items } : {}),
          ...(request.note ? { note: request.note } : {}),
        }
      },
      onAccepted: onCreated,
    },
    {
      step: 'cancel',
      cmdStep: (d) => `cancel-${d.codes}`,
      await: 'none',
      command: (d, ctx, cmdId): UserCommand | null =>
        d.requestId ? { type: 'request.cancel', actor: ctx.persona, cmdId, requestId: d.requestId } : null,
      // The charge is gone: back to an empty Charge.
      onAccepted: (_d, _ctx, api) => {
        api.set((x) => ({ ...x, items: [], custom: '', keypad: false, requestId: null }))
        api.goto('items')
      },
    },
  ],
  done: (d, ctx) => settledSale(d, ctx) !== undefined,
  covers: (d, ctx, txId) => codeOf(d, ctx).request?.txId === txId,
  Success: ({ d, ctx, followOn }) => {
    const tx = settledSale(d, ctx)
    return tx ? <PaidBody tx={tx} ctx={ctx} followOn={() => followOn('charge')} /> : null
  },
}
