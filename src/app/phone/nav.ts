import { useMemo } from 'react'
import { createFlowApi, newFlowScreen } from '../flows/actions'
import type { Who } from '../flows/actions'
import { makeFlowCtx } from '../flows/ctx'
import { phaseOf } from '../flows/engine'
import type { AppState } from '../state/app'
import { usePersonaPhone } from './PhoneContext'
import { useApp } from '../state/AppContext'
import { flowImpl } from './implemented'
import type { FlowId, Target } from './registry'
import { type Stack, home, normalise, pop, push, replaceFlow, topOf } from './stack'
import { HOME_SCREEN, type Params, type Screen } from './types'
import { useNav } from '@store/nav'

// The controller of one persona's stack: opens screens under the stack rules, starts flows, and
// goes Back or Home. Back and Home do nothing while a payment is sending (at most 1.4 s).

export interface PhoneNav {
  stack(): Stack
  top(): Screen
  /** Opens a hub, view, detail or flow (a flow gets a new instance). Ignored when the rules forbid it. */
  open(target: Target, params?: Params): void
  openFlow(id: FlowId, params?: Params): void
  /** A flow replaces itself with another, keeping the stack below ("Can't scan? Pay by @username"). */
  handoff(id: FlowId, params?: Params): void
  /** From a success screen: Home first, then the next flow (allowed follow-ons only). */
  followOn(id: FlowId, params?: Params): void
  back(): void
  home(): void
  /** A payment is in flight on the top flow: Back and Home are disabled. */
  locked(): boolean
}

export function createPhoneNav(app: AppState, who: Who): PhoneNav {
  const stack = (): Stack => normalise(app.nav.stack(who.persona))
  const set = (next: Stack) => app.nav.set(who.persona, next)
  const locked = (): boolean => {
    const top = topOf(stack())
    if (top.kind !== 'flow') return false
    const impl = flowImpl(top.id)
    return impl ? phaseOf(top, impl, makeFlowCtx(app, who, top.params)) === 'sending' : false
  }
  const startFlow = (id: FlowId, params?: Params): Screen | null => {
    const impl = flowImpl(id)
    return impl ? newFlowScreen(app, who, impl, params) : null
  }
  const nav: PhoneNav = {
    stack,
    top: () => topOf(stack()),
    open(target, params) {
      switch (target.kind) {
        case 'hub':
          return set(push(stack(), { kind: 'hub', id: target.id }))
        case 'view':
          return set(push(stack(), { kind: 'view', id: target.id, ...(params ? { params } : {}) }))
        case 'detail':
          return set(push(stack(), { kind: 'detail', id: target.id, params: params ?? {} }))
        case 'flow':
          return nav.openFlow(target.id, params)
      }
    },
    openFlow(id, params) {
      const screen = startFlow(id, params)
      if (screen) set(push(stack(), screen))
    },
    handoff(id, params) {
      const screen = startFlow(id, params)
      if (screen?.kind === 'flow') set(replaceFlow(stack(), screen))
    },
    followOn(id, params) {
      const screen = startFlow(id, params)
      if (screen) set(push(home(), screen))
    },
    back() {
      if (locked()) return
      const top = topOf(stack())
      if (top.kind === 'flow') {
        const impl = flowImpl(top.id)
        if (impl && phaseOf(top, impl, makeFlowCtx(app, who, top.params)) === 'success') return set(home())
        return createFlowApi(app, who, top.instanceId).back()
      }
      set(pop(stack()))
    },
    home() {
      if (locked()) return
      set(home())
    },
    locked,
  }
  return nav
}

/** The stack controller of the phone this component is in. */
export function usePhoneNav(): PhoneNav {
  const app = useApp()
  const { persona, slot, shell } = usePersonaPhone()
  return useMemo(() => createPhoneNav(app, { persona, slot, shell }), [app, persona, slot, shell])
}

/** The persona's screen stack (re-renders on change); Home when nothing was opened. */
export function usePhoneStack(persona: string): Stack {
  const raw = useNav<Screen>(persona)
  return raw.length > 0 && raw[0]?.kind === 'home' ? raw : [HOME_SCREEN, ...raw]
}
