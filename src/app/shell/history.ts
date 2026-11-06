import { useCallback, useEffect, useRef } from 'react'
import { personaOn } from '@store/sessions'
import { createPhoneNav, usePhoneStack } from '../phone/nav'
import { type Stack, normalise, topOf } from '../phone/stack'
import { useApp, useTransient, useUi } from '../state/AppContext'
import type { AuthScreenState } from '../state/app'

// Phone mode on a real phone: every push inside the phone adds a history entry, and the browser's
// Back (the Android button, the iOS swipe) is the phone's own Back: one screen, or one step of a
// flow; from a success screen it is Home; on Home it leaves the app. The stage keeps its state
// out of the history (two phones share one).
//
// The page keeps `pushed`, the number of entries it added above the entry it started on, equal to
// `unitsOf(...)` of what the phone shows. Moving forward pushes entries; moving back by the app's
// own buttons steps the history back the same distance (its popstate is ignored).

const KEY = 'bcps'

/** How far a persona's stack is from Home: one per screen above Home, plus the steps taken inside the flow on top. */
export function unitsOf(stack: Stack): number {
  const top = topOf(stack)
  return stack.length - 1 + (top.kind === 'flow' ? Math.max(0, top.step - top.openedOn) : 0)
}

/** The logged-out phone: Welcome, Log in, Enter the code. */
export function authUnits(auth: AuthScreenState): number {
  return auth.screen === 'welcome' ? 0 : auth.screen === 'login' ? 1 : 2
}

/** What the entry a popstate landed on stands for (0 for the entry the page started on). */
function landedOn(state: unknown): number {
  if (state && typeof state === 'object' && KEY in state) {
    const n = (state as Record<string, unknown>)[KEY]
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0) return n
  }
  return 0
}

export function usePhoneHistory(): void {
  const app = useApp()
  const ui = useUi()
  const persona = personaOn(ui, 'single')
  const stack = usePhoneStack(persona ?? '')
  const auth = useTransient((t) => t.auth.single)
  const units = persona ? unitsOf(stack) : authUnits(auth)

  const pushed = useRef(0)
  const skip = useRef(0)

  // Read from the stores, not from a render, so a handler sees what the last Back did.
  const now = useCallback(() => {
    const who = personaOn(app.runtime.ui.get(), 'single')
    return { who, units: who ? unitsOf(normalise(app.nav.stack(who))) : authUnits(app.transient.get().auth.single) }
  }, [app])

  const sync = useCallback(() => {
    const want = now().units
    const have = pushed.current
    if (want > have) {
      for (let i = have + 1; i <= want; i++) history.pushState({ [KEY]: i }, '', location.href)
    } else if (want < have) {
      skip.current += 1
      history.go(want - have)
    }
    pushed.current = want
  }, [now])

  // The entry the page starts on is the base, whatever an earlier visit left in its state.
  useEffect(() => {
    if (landedOn(history.state) > 0) history.replaceState(null, '', location.href)
    pushed.current = 0
  }, [])

  // A change of screen or account is the trigger; `sync` reads the stores itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: units and persona only trigger the effect
  useEffect(() => {
    sync()
  }, [units, persona, sync])

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (skip.current > 0) {
        skip.current -= 1
        return
      }
      const landed = landedOn(e.state)
      const before = pushed.current
      if (landed >= before) return // forward, or an entry from an earlier visit: nothing to do
      pushed.current = landed
      // One in-phone Back for every entry the browser stepped over.
      for (let i = 0; i < before - landed; i++) {
        const { who } = now()
        const shell = who ? app.persona(who)?.shell : undefined
        if (who && shell) createPhoneNav(app, { persona: who, slot: 'single', shell }).back()
        else {
          const a = app.transient.get().auth.single
          if (a.screen === 'code') app.actions.setAuth('single', { screen: 'login', chosen: a.persona })
          else if (a.screen === 'login') app.actions.setAuth('single', { screen: 'welcome' })
        }
      }
      // A Back that could not go (a payment is sending) leaves more screens than entries: restore them.
      sync()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [app, now, sync])
}
