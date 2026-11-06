import type { Minor } from '@domain/types'
import { topUpForShortfall } from '@store/selectors'
import { ui } from '../copy'
import type { FlowApi, FlowCtx, SecondaryDef } from './types'

// What a payment that the balance cannot cover offers: Top up, with the euros that make up the
// shortfall already typed (5.86 BCPS short is €6). It replaces the flow that was open and leaves the
// screens below it as they were. On an amount step it is the dock's text link, on a check it is a
// link inside the error line.

/** Opens Top up in place of the running flow, with the whole euros that cover `short`. */
export function offerTopUp<D>(ctx: FlowCtx, short: Minor, api: FlowApi<D>): void {
  api.handoff('topUp', { eur: String(topUpForShortfall(ctx.state, ctx.persona, short)) })
}

/** The dock's text link on an amount step, or null while the balance covers the payment. */
export function topUpLink<D>(ctx: FlowCtx, short: Minor | null, api: FlowApi<D>): SecondaryDef | null {
  if (short === null) return null
  return { kind: 'link', label: ui.topUp.link, onPress: () => offerTopUp(ctx, short, api) }
}

/** The inline link of an error line ([Top up] after "You have … BCPS."). */
export function TopUpAction<D>({ ctx, short, api }: { ctx: FlowCtx; short: Minor; api: FlowApi<D> }) {
  return (
    <button
      type="button"
      data-testid="error-top-up"
      onClick={() => offerTopUp(ctx, short, api)}
      className="font-semibold text-green-700 underline underline-offset-2"
    >
      {ui.topUp.link}
    </button>
  )
}
