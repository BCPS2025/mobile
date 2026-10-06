import { newFlowInstanceId, cmdIdFor } from '@store/cmdIds'
import { errorText } from '../errors'
import { flowImpl } from '../phone/implemented'
import { normalise, replaceFlow, topFlow, updateFlow } from '../phone/stack'
import type { FlowScreen, Params, Shell, SlotKey } from '../phone/types'
import type { AppState } from '../state/app'
import type { PersonaId } from '@domain/types'
import { makeFlowCtx } from './ctx'
import { commitOf, nextIndex, openIndex, prevIndex } from './engine'
import type { CommitDef, FlowApi, FlowImpl } from './types'

// What a flow's buttons do to its running instance (the flow entry on top of a persona's stack).
// Every function re-reads the instance from the stack, so a stale closure never overwrites newer
// state. Shared by the flow screen, the header's Back and the phone-mode history.

export interface Who {
  persona: PersonaId
  slot: SlotKey
  shell: Shell
}

/** A new flow instance: its draft from `init`, opened on the step `openOn` names. */
export function newFlowScreen(app: AppState, who: Who, impl: FlowImpl<never>, params?: Params): FlowScreen {
  const ctx = makeFlowCtx(app, who, params)
  const draft = impl.init(ctx)
  const step = openIndex(impl, draft, ctx)
  return {
    kind: 'flow',
    id: impl.id,
    instanceId: newFlowInstanceId(),
    step,
    openedOn: step,
    draft,
    ...(params ? { params } : {}),
    sent: false,
  }
}

export function createFlowApi<D>(app: AppState, who: Who, instanceId: string): FlowApi<D> {
  const stackOf = () => normalise(app.nav.stack(who.persona))
  const current = (): FlowScreen | null => {
    const f = topFlow(stackOf())
    return f && f.instanceId === instanceId ? f : null
  }
  const impl = (f: FlowScreen) => flowImpl(f.id) as FlowImpl<D> | undefined
  const patch = (change: (f: FlowScreen) => FlowScreen) => {
    const stack = stackOf()
    const next = updateFlow(stack, instanceId, change)
    if (next !== stack) app.nav.set(who.persona, next)
  }
  const ctxOf = (f: FlowScreen) => makeFlowCtx(app, who, f.params)
  const leave = () => {
    const stack = stackOf()
    if (topFlow(stack)?.instanceId === instanceId) app.nav.set(who.persona, stack.slice(0, -1))
  }

  const api: FlowApi<D> = {
    set(change) {
      patch((f) => {
        const d = f.draft as D
        const draft = typeof change === 'function' ? change(d) : { ...d, ...change }
        const { error: _cleared, ...rest } = f
        return { ...rest, draft }
      })
    },
    next() {
      const f = current()
      const i = f && impl(f)
      if (!f || !i) return
      const to = nextIndex(i, f.draft as D, ctxOf(f), f.step)
      if (to !== null) patch((x) => ({ ...withoutError(x), step: to, editing: false }))
    },
    back() {
      const f = current()
      const i = f && impl(f)
      if (!f || !i) return
      const d = f.draft as D
      const ctx = ctxOf(f)
      const step = i.steps[f.step]
      if (f.editing) {
        const review = i.steps.findIndex((s) => s.kind === 'review')
        if (review >= 0) return patch((x) => ({ ...withoutError(x), step: review, editing: false }))
      }
      const custom = step?.back?.(d, ctx, api)
      if (custom === 'leave') return leave()
      if (custom && custom !== 'default') {
        const to = i.steps.findIndex((s) => s.id === custom.step)
        if (to >= 0) return patch((x) => ({ ...withoutError(x), step: to }))
      }
      // Steps after a commit never go back to input steps.
      if (step?.kind === 'waitFor' || step?.kind === 'committed') return leave()
      const prev = prevIndex(i, d, ctx, f.step)
      if (prev === null || f.step <= f.openedOn) return leave()
      patch((x) => ({ ...withoutError(x), step: prev }))
    },
    goto(stepId, opts) {
      const f = current()
      const i = f && impl(f)
      if (!f || !i) return
      const to = i.steps.findIndex((s) => s.id === stepId)
      if (to >= 0) patch((x) => ({ ...withoutError(x), step: to, editing: opts?.editing === true }))
    },
    leave,
    done() {
      if (current()) app.nav.set(who.persona, [{ kind: 'home' }])
    },
    handoff(id, params) {
      if (!current()) return
      const target = flowImpl(id) as FlowImpl<never> | undefined
      if (target) app.nav.set(who.persona, replaceFlow(stackOf(), newFlowScreen(app, who, target, params)))
    },
    press() {
      const f = current()
      const i = f && impl(f)
      if (!f || !i) return
      const step = i.steps[f.step]
      if (!step) return
      const d = f.draft as D
      const ctx = ctxOf(f)
      const commit = commitOf(i, step.id)
      // A commit always asks the ledger, so a refusal says why (a code cancelled meanwhile).
      if (commit && (commit.when?.(d, ctx) ?? true)) return runCommit(app, who, api, f, commit, d, patch)
      // Otherwise the step's button is what Enter, the keypad and the dock all press: while it is
      // disabled (an empty or too large amount), nothing moves, not even back to the check from an Edit.
      if (!step.primary(d, ctx).enabled) return
      // A step opened from an Edit link goes back to the check, whatever its button usually does.
      if (f.editing) return api.goto(i.steps.find((s) => s.kind === 'review')?.id ?? step.id)
      if (step.onPrimary) return step.onPrimary(d, ctx, api)
      api.next()
    },
    fail(message) {
      patch((f) => (message === null ? withoutError(f) : { ...f, error: message }))
    },
  }
  return api
}

function withoutError(f: FlowScreen): FlowScreen {
  const { error: _cleared, ...rest } = f
  return rest
}

/** Dispatches a commit point's command. A refusal stays on the step as the error line. */
function runCommit<D>(
  app: AppState,
  who: Who,
  api: FlowApi<D>,
  f: FlowScreen,
  commit: CommitDef<D>,
  d: D,
  patch: (change: (f: FlowScreen) => FlowScreen) => void,
): void {
  const ctx = makeFlowCtx(app, who, f.params)
  const cmd = commit.command(d, ctx, cmdIdFor(f.instanceId, commit.cmdStep?.(d) ?? commit.step))
  if (!cmd) return
  const result = app.runtime.dispatch(cmd)
  if (!result.ok) {
    // A repeat of the same command (a double tap) is refused silently: it was already accepted.
    const message = errorText(result.error, commit.refusal?.(d, ctx))
    commit.onRefused?.(result.error, d, ctx, api)
    if (message !== null) api.fail(message)
    return
  }
  if (commit.await === 'tx') patch((x) => ({ ...withoutError(x), sent: true }))
  if (commit.onAccepted) commit.onAccepted(d, ctx, api, cmd.cmdId)
  else if (commit.await === 'none') api.next()
}
