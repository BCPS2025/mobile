import type { Tx } from '@domain/types'
import { cmdIdFor } from '@store/cmdIds'
import { txByCmdId } from '@store/selectors'
import type { FlowScreen } from '../phone/types'
import type { CommitDef, FlowCtx, FlowImpl, StepDef } from './types'

// The pure part of the flow engine: which steps a flow visits, the step bar, and the phase of a
// flow instance, which comes from the ledger (never from an event or a timer).

export type FlowPhase = 'input' | 'sending' | 'success'

type Impl<D> = Pick<FlowImpl<D>, 'steps' | 'commits' | 'openOn' | 'done'>

const skipped = <D>(step: StepDef<D>, d: D, ctx: FlowCtx) => step.skip?.(d, ctx) === true

/** Indices of the steps on the linear path (not off-path, not skipped), in order. */
export function pathIndices<D>(impl: Impl<D>, d: D, ctx: FlowCtx): number[] {
  const out: number[] = []
  impl.steps.forEach((s, i) => {
    if (!s.offPath && !skipped(s, d, ctx)) out.push(i)
  })
  return out
}

export function nextIndex<D>(impl: Impl<D>, d: D, ctx: FlowCtx, from: number): number | null {
  return pathIndices(impl, d, ctx).find((i) => i > from) ?? null
}

export function prevIndex<D>(impl: Impl<D>, d: D, ctx: FlowCtx, from: number): number | null {
  const before = pathIndices(impl, d, ctx).filter((i) => i < from)
  return before.length > 0 ? (before[before.length - 1] as number) : null
}

/** The step a new instance opens on: `openOn` (template-filled flows open on Review) or the first not skipped. */
export function openIndex<D>(impl: Impl<D>, d: D, ctx: FlowCtx): number {
  if (impl.openOn) {
    const i = impl.steps.findIndex((s) => s.id === impl.openOn?.(d, ctx))
    if (i >= 0) return i
  }
  return pathIndices(impl, d, ctx)[0] ?? 0
}

/** Steps the bar counts: input, review and confirm steps on the path. */
const counted = <D>(s: StepDef<D>) => !s.offPath && (s.kind === 'input' || s.kind === 'review' || s.kind === 'confirm')

/** "Step 2 of 4", or null on flows of fewer than three steps and on steps the bar does not count. */
export function stepBar<D>(impl: Impl<D>, d: D, ctx: FlowCtx, index: number): { n: number; total: number } | null {
  const path = pathIndices(impl, d, ctx).filter((i) => counted(impl.steps[i] as StepDef<D>))
  const at = path.indexOf(index)
  if (at < 0 || path.length < 3) return null
  return { n: at + 1, total: path.length }
}

export const commitOf = <D>(impl: Impl<D>, stepId: string): CommitDef<D> | undefined =>
  impl.commits.find((c) => c.step === stepId)

/** The transaction the flow's payment commit created (the commit that waits for one). */
export function txOf<D>(screen: FlowScreen, impl: Impl<D>, ctx: Pick<FlowCtx, 'state'>): Tx | undefined {
  const commit = impl.commits.find((c) => c.await === 'tx')
  return commit ? txByCmdId(ctx.state, cmdIdFor(screen.instanceId, commit.step)) : undefined
}

/**
 * input: the persona is filling in steps; sending: the payment was dispatched and is pending;
 * success: it is confirmed (or the flow says it is done). A persona that was away meanwhile finds
 * the success screen when it comes back.
 */
export function phaseOf<D>(screen: FlowScreen, impl: Impl<D>, ctx: FlowCtx): FlowPhase {
  if (impl.done?.(screen.draft as D, ctx)) return 'success'
  if (!screen.sent) return 'input'
  const tx = txOf(screen, impl, ctx)
  if (!tx) return 'input'
  return tx.status === 'pending' ? 'sending' : 'success'
}
