import { Search } from 'lucide-react'
import { entryOf } from '@domain/ledger'
import { asMinor, formatMinor } from '@domain/money'
import type { Party, Tx } from '@domain/types'
import { formatTime, formatWeekday } from '@sim/tz'
import { counterpartyOf } from '@store/parties'
import { refundStateOf, refundableSales, salesToRefund } from '@store/selectors'
import { available } from '@domain/ledger'
import { fill, ui } from '../copy'
import { dateTimeText, itemsText, partyLabel } from '../format'
import { PartyAvatar } from '../kit/PartyAvatar'
import { EmptyState } from '../phone/chrome/EmptyState'
import { ErrorLine } from '../phone/chrome/ErrorLine'
import { FactsCard } from '../phone/chrome/FactsCard'
import { InfoNote } from '../phone/chrome/InfoNote'
import { DoneTag } from '../phone/chrome/Tag'
import { SuccessScreen } from '../phone/chrome/SuccessScreen'
import { errorText } from '../errors'
import { TopUpAction } from './topUpOffer'
import type { FlowCtx, FlowImpl, StepProps } from './types'

// Refund a sale (biz.refund.*): pick one of the named sales, check, and refund the whole amount to
// the customer. A refund has no fee, and the fee the sale paid is not returned. A sale that was
// refunded is listed greyed and cannot be picked again. Opened from a sale's detail, the sale is
// already chosen and the flow starts on the check.

interface Draft {
  /** The sale chosen, or null while none is. */
  txId: string | null
  /** What was typed in the search field. */
  query: string
}

/** What a sale is called in the list: its note, else what was bought. */
const whatOf = (tx: Tx): string => tx.note ?? itemsText(tx.items)

/** Everything the steps derive from the draft and the ledger right now. */
function figures(d: Draft, ctx: FlowCtx) {
  const tx = d.txId === null ? undefined : entryOf(ctx.state.txs, d.txId)
  const customer: Party | undefined = tx ? counterpartyOf(ctx.state, tx.from, tx.party) : undefined
  const state = tx ? refundStateOf(tx, ctx.persona) : 'no'
  const have = available(ctx.state, ctx.persona)
  const short = tx && have < tx.amount ? asMinor(tx.amount - have) : null
  return { tx, customer, state, have, short }
}

/** "Fri 14:15": when a sale was refunded, for the line that says it was. */
function refundedAt(ctx: FlowCtx, tx: Tx): string {
  const refund = tx.refundedBy === undefined ? undefined : entryOf(ctx.state.txs, tx.refundedBy)
  const at = refund ? (refund.confirmedAt ?? refund.createdAt) : undefined
  const tz = ctx.app.persona(ctx.persona)?.tz ?? ctx.content.config.t0.tz
  return at === undefined ? '' : `${formatWeekday(at, tz)} ${formatTime(at, tz)}`
}

/** The text a search looks through: who, what, how much and the reference. */
function haystack(tx: Tx, customer: Party | undefined): string {
  return [customer?.handle, customer?.displayName, whatOf(tx), formatMinor(tx.amount), tx.id].join(' ').toLowerCase()
}

function PickBody({ d, ctx, api }: StepProps<Draft>) {
  const tz = ctx.app.persona(ctx.persona)?.tz ?? ctx.content.config.t0.tz
  const all = salesToRefund(ctx.state, ctx.persona)
  const nothing = refundableSales(ctx.state, ctx.persona).length === 0
  const typed = d.query.trim().toLowerCase()
  const rows = all.filter(
    ({ tx }) => typed === '' || haystack(tx, counterpartyOf(ctx.state, tx.from, tx.party)).includes(typed),
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 font-display text-display-m text-navy-900">{ui.refund.pickTitle}</h2>
      {nothing ? (
        <EmptyState icon={Search} title={ui.refund.none} />
      ) : (
        <>
          <div className="field mt-3.5 flex h-12 shrink-0 items-center gap-2.5 bg-surface px-3">
            <Search size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-grey-600" />
            <input
              type="text"
              name="refund-search"
              id="refund-search"
              data-testid="refund-search"
              aria-label={ui.refund.searchLabel}
              placeholder={ui.refund.searchPlaceholder}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              inputMode="text"
              enterKeyHint="search"
              value={d.query}
              onChange={(e) => api.set({ query: e.target.value })}
              className="min-w-0 flex-1 bg-transparent font-body text-body-l text-navy-900 outline-none placeholder:text-grey-500"
            />
          </div>
          {rows.length === 0 ? (
            <p data-testid="refund-none-found" className="pt-4 font-body text-body text-grey-600">
              {ui.empty.search.title}
            </p>
          ) : (
            <ul className="pt-3" data-testid="refund-sales">
              {rows.map(({ tx, state }) => {
                const customer = counterpartyOf(ctx.state, tx.from, tx.party)
                const what = whatOf(tx)
                const on = d.txId === tx.id
                const done = state === 'refunded'
                return (
                  <li key={tx.id} className={on ? '' : 'border-b border-line-100'}>
                    <button
                      type="button"
                      data-testid={`refund-tx-${tx.id}`}
                      aria-pressed={on}
                      aria-disabled={done || undefined}
                      onClick={() => !done && api.set({ txId: tx.id })}
                      className={`flex min-h-[61px] w-full items-center gap-3 border-2 px-2.5 py-2 text-left ${
                        on ? 'border-navy-900 bg-surface' : 'border-transparent'
                      } ${done ? 'opacity-60' : 'active:bg-line-100'}`}
                    >
                      {customer && <PartyAvatar party={customer} />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-body text-body font-semibold text-navy-900">
                          {customer ? partyLabel(customer) : ''}
                          {what ? ` · ${what}` : ''}
                        </span>
                        <span className="block truncate font-body text-body-s text-grey-600">
                          {dateTimeText(tx.createdAt, false, tz)}
                        </span>
                      </span>
                      {done && <DoneTag>{ui.sales.refunded}</DoneTag>}
                      <span className="shrink-0 font-body text-body font-semibold text-navy-900 tnum">
                        {formatMinor(tx.amount)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function ReviewBody({ d, ctx, api, sending }: StepProps<Draft>) {
  const { tx, customer, have, short } = figures(d, ctx)
  if (!tx || !customer) return null
  const tz = ctx.app.persona(ctx.persona)?.tz ?? ctx.content.config.t0.tz
  const what = whatOf(tx)
  // While the refund sends, the balance already holds it: no shortfall is shown then.
  const missing = sending ? null : short
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 pb-3 font-display text-display-m text-navy-900">
        {fill(ui.refund.reviewTitle, { amount: formatMinor(tx.amount), name: partyLabel(customer) })}
      </h2>
      <FactsCard
        accent
        facts={[
          {
            label: ui.refund.rowSale,
            value: what || partyLabel(customer),
            sub: dateTimeText(tx.createdAt, false, tz),
            testId: 'fact-sale',
          },
          { label: ui.refund.rowReference, value: tx.id, mono: true, testId: 'fact-reference' },
          {
            label: ui.refund.rowRefund,
            value: fill(ui.refund.refundValue, { amount: formatMinor(tx.amount) }),
            total: true,
            testId: 'review-total',
          },
        ]}
      />
      <InfoNote testId="refund-note">{fill(ui.refund.note, { fee: formatMinor(tx.fee.fee) })}</InfoNote>
      {missing !== null && (
        <ErrorLine className="mt-3" action={<TopUpAction ctx={ctx} short={missing} api={api} />}>
          {errorText({ code: 'insufficient-funds', have, short: missing }, { about: 'refund' })}
        </ErrorLine>
      )}
    </div>
  )
}

export const refundFlow: FlowImpl<Draft> = {
  id: 'refund',
  title: () => ui.refund.title,
  tone: () => 'business',
  barFromTwo: true,
  init: (ctx) => ({
    // From a sale's detail it is that sale; from the list, the newest one that can be refunded.
    txId: ctx.params.txId ?? refundableSales(ctx.state, ctx.persona)[0]?.id ?? null,
    query: '',
  }),
  openOn: (_d, ctx) => (ctx.params.txId === undefined ? 'pick' : 'review'),
  steps: [
    {
      id: 'pick',
      screen: 'biz.refund.pick',
      kind: 'input',
      Screen: PickBody,
      skip: (_d, ctx) => ctx.params.txId !== undefined,
      primary: (d, ctx) => ({
        label: ui.common.continue,
        tone: 'navy',
        enabled: figures(d, ctx).state === 'refundable',
      }),
    },
    {
      id: 'review',
      screen: 'biz.refund.review',
      kind: 'review',
      Screen: ReviewBody,
      primary: (d, ctx) => {
        const { tx, short } = figures(d, ctx)
        return {
          label: fill(ui.refund.button, { amount: tx ? formatMinor(tx.amount) : '' }),
          tone: 'money',
          enabled: tx !== undefined && short === null,
        }
      },
    },
  ],
  commits: [
    {
      step: 'review',
      await: 'tx',
      refusal: (d, ctx) => {
        const { tx } = figures(d, ctx)
        return { about: 'refund', time: tx ? refundedAt(ctx, tx) : '' }
      },
      command: (d, ctx, cmdId) =>
        d.txId === null ? null : { type: 'refund', actor: ctx.persona, cmdId, txId: d.txId },
    },
  ],
  Success: ({ d, tx, ctx, done }) => {
    const sale = d.txId === null ? undefined : entryOf(ctx.state.txs, d.txId)
    const customer = sale ? counterpartyOf(ctx.state, sale.from, sale.party) : undefined
    if (!tx || !customer) return null
    return (
      <SuccessScreen
        id="biz.refund.done"
        variant="money"
        overline={ui.refund.doneOverline}
        amount={{ value: tx.amount }}
        sub={
          customer.kind === 'person'
            ? fill(ui.refund.doneTo, { handle: customer.handle, name: customer.displayName })
            : fill(ui.refund.doneToName, { name: customer.displayName })
        }
        body={ui.refund.doneBody}
        lines={[
          { label: ui.refund.rowFee, value: ui.refund.noFee },
          { label: ui.refund.rowReference, value: tx.id, mono: true },
        ]}
        linesStyle="card"
        onDone={done}
      />
    )
  },
}
