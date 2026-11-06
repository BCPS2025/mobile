import { isPersistedScreenId } from './registry'
import { type FlowScreen, HOME_SCREEN, type Screen } from './types'

// Pure rules of a persona's screen stack (D22/D27): `home › [hub] › [view] › [detail] › [detail]`
// before a flow, at most five screens; at most one hub, and only directly on Home; at most one
// view; a detail may link to one related detail, and a further link from a second detail
// replaces the top detail; a flow sits on top (its steps and success screen are one entry) and
// never opens a hub, a view or another flow. Every function returns a new stack, or the same one
// when the move is not allowed.

export const MAX_BEFORE_FLOW = 5

export type Stack = readonly Screen[]

/** A stack always starts with Home. */
export function normalise(stack: Stack): Stack {
  return stack[0]?.kind === 'home' ? stack : [HOME_SCREEN, ...stack]
}

export const topOf = (stack: Stack): Screen => stack[stack.length - 1] ?? HOME_SCREEN

const count = (stack: Stack, kind: Screen['kind']) => stack.filter((s) => s.kind === kind).length

/** Opens a screen on top of the stack, or leaves it unchanged when the rules do not allow it. */
export function push(stack: Stack, next: Screen): Stack {
  const s = normalise(stack)
  const top = topOf(s)
  if (next.kind === 'home') return [HOME_SCREEN]
  // Nothing opens over a flow: a banner during a step is informational, and a flow never opens a
  // hub, view or another flow (a hand-off replaces the flow, see `replaceFlow`).
  if (top.kind === 'flow') return s
  switch (next.kind) {
    case 'hub':
      return top.kind === 'home' && s.length === 1 ? [...s, next] : s
    case 'view':
      return (top.kind === 'home' || top.kind === 'hub') && count(s, 'view') === 0 ? [...s, next] : s
    case 'detail': {
      if (top.kind === 'detail' && count(s, 'detail') >= 2) return [...s.slice(0, -1), next]
      return s.length < MAX_BEFORE_FLOW ? [...s, next] : [...s.slice(0, -1), next]
    }
    case 'flow':
      return s.length <= MAX_BEFORE_FLOW ? [...s, next] : s
  }
}

/** A flow hands off to another by replacing itself, keeping the stack below it. */
export function replaceFlow(stack: Stack, next: FlowScreen): Stack {
  const s = normalise(stack)
  return topOf(s).kind === 'flow' ? [...s.slice(0, -1), next] : s
}

/** Back: pops one screen (Home stays). */
export function pop(stack: Stack): Stack {
  const s = normalise(stack)
  return s.length > 1 ? s.slice(0, -1) : s
}

export const home = (): Stack => [HOME_SCREEN]

/** Changes the top flow (its step, draft or error) when it is the flow instance given. */
export function updateFlow(stack: Stack, instanceId: string, patch: (f: FlowScreen) => FlowScreen): Stack {
  const s = normalise(stack)
  const top = topOf(s)
  if (top.kind !== 'flow' || top.instanceId !== instanceId) return s
  return [...s.slice(0, -1), patch(top)]
}

/** The flow on top of the stack, if any. */
export function topFlow(stack: Stack): FlowScreen | null {
  const top = topOf(normalise(stack))
  return top.kind === 'flow' ? top : null
}

/** Whether a flow of this id is anywhere on the stack. */
export const hasFlow = (stack: Stack, id: string): boolean => stack.some((s) => s.kind === 'flow' && s.id === id)

/** What a reload keeps of a stack: `home`, or `home` and the hub above it. */
export function persistedIds(stack: Stack): string[] {
  const hub = normalise(stack)[1]
  return hub?.kind === 'hub' ? ['home', `hub:${hub.id}`] : ['home']
}

/** The stack a persisted list of ids stands for (unknown ids are dropped). */
export function fromPersistedIds(ids: readonly string[]): Stack {
  const out: Screen[] = [HOME_SCREEN]
  for (const id of ids) {
    if (id.startsWith('hub:') && isPersistedScreenId(id) && out.length === 1) out.push({ kind: 'hub', id: id.slice(4) })
  }
  return out
}

/** Two persisted id lists stand for the same stack (an empty list is Home). */
export const samePersisted = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  (a ?? ['home']).join('|') === (b ?? ['home']).join('|')
