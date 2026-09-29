import { content } from '@content/load'
import type { SimTime, UserCommand } from '@domain/types'
import { resolveEpochDate } from '@sim/t0'
import { openStorage } from '@store/persistence'
import type { LockManagerLike } from '@store/writer-lock'
import { BUILD_SHA } from '../boot/build-info'
import { type AppState, createAppState } from './app'
import { chime } from './sound'

// The browser wiring of the app state: the real storage, Web Locks, timers and clock. One app
// state per page, created on first use (the landing and About pages never need it, so a tab
// showing them does not take the writer lock).

let app: AppState | null = null

/** `?clock=manual` (tests): virtual time moves only when told to, and by the settle delay. */
export const wantsManualClock = (search: string): boolean => new URLSearchParams(search).get('clock') === 'manual'

export function getAppState(win: Window = window): AppState {
  if (app) return app
  const manual = wantsManualClock(win.location.search)
  const created = createAppState({
    content,
    build: BUILD_SHA,
    storage: openStorage(() => win.localStorage),
    locks: (win.navigator as Navigator & { locks?: LockManagerLike }).locks ?? null,
    onStorage: (listener) => {
      win.addEventListener('storage', listener)
      return () => win.removeEventListener('storage', listener)
    },
    timers: { set: (fn, ms) => win.setTimeout(fn, ms), clear: (h) => win.clearTimeout(h as number) },
    clock: manual ? { mode: 'manual' } : { mode: 'live', wallNow: () => win.performance.now() },
    epochDate: () => resolveEpochDate(win.location.search, Date.now()),
    requestPersist: () => win.navigator.storage?.persist?.(),
    chime,
  })
  if (manual) {
    // A hook for the end-to-end tests, present only with ?clock=manual: move the virtual clock
    // forward (a code expires, a countdown runs out) and send a command as an account would
    // (for example a payment for a phone that is not on screen). Nothing else.
    ;(win as unknown as { __bcps: unknown }).__bcps = {
      advance: (ms: number) => created.runtime.node.advanceTo((created.runtime.node.now() + ms) as SimTime, 'timer'),
      now: () => created.runtime.node.now(),
      dispatch: (cmd: UserCommand) => created.runtime.dispatch(cmd),
    }
  }
  app = created
  return created
}
