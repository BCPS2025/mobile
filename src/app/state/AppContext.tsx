import { type ReactNode, createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { PersonaId } from '@domain/types'
import { type Notification, notificationsFor, isRead } from '@store/notifications'
import { NavContext } from '@store/nav'
import type { Notice } from '@store/runtime'
import type { UiState } from '@store/record'
import { LedgerContext, useLedgerState } from '@store/useLedger'
import type { WriterStatus } from '@store/writer-lock'
import type { Prefs } from './prefs'
import type { AppState, Transient } from './app'
import { useStore } from './store'

// React bindings of the app state. Wrap a page that shows phones in <AppProvider>.

export const AppContext = createContext<AppState | null>(null)

export function AppProvider({ app, children }: { app: AppState; children: ReactNode }) {
  // pagehide and visibility flush the saved session; input keeps the live clock running.
  useEffect(() => app.runtime.attach(window, document), [app])
  return (
    <AppContext.Provider value={app}>
      <LedgerContext.Provider value={app.runtime.node}>
        <NavContext.Provider value={app.nav}>{children}</NavContext.Provider>
      </LedgerContext.Provider>
    </AppContext.Provider>
  )
}

export function useApp(): AppState {
  const app = useContext(AppContext)
  if (!app) throw new Error('useApp: missing <AppProvider>')
  return app
}

/** The persisted UI: phones, sessions, read marks. */
export function useUi(): UiState {
  const { runtime } = useApp()
  return useSyncExternalStore(runtime.ui.subscribe, runtime.ui.get, runtime.ui.get)
}

export function useTransient<S = Transient>(select: (t: Transient) => S = (t) => t as unknown as S): S {
  return useStore(useApp().transient, select)
}

export function usePrefs(): Prefs {
  return useStore(useApp().prefs)
}

/** Whether another tab writes (`waiting`), so the page shows "BCPS is open in another tab.". */
export function useWriterStatus(): WriterStatus | null {
  const { runtime } = useApp()
  const lock = runtime.lock
  return useSyncExternalStore(
    (l) => (lock ? lock.subscribe(l) : () => {}),
    () => (lock ? lock.status() : null),
    () => null,
  )
}

/** The runtime's one-time notices ("Couldn't restore your last session…"). */
export function useNotices(): readonly Notice[] {
  const { runtime } = useApp()
  return useSyncExternalStore(runtime.subscribeNotices, cachedNotices(runtime), cachedNotices(runtime))
}

const noticeCache = new WeakMap<object, { key: string; value: readonly Notice[] }>()
function cachedNotices(runtime: AppState['runtime']): () => readonly Notice[] {
  return () => {
    const value = runtime.notices()
    const key = value.join('|')
    const hit = noticeCache.get(runtime)
    if (hit && hit.key === key) return hit.value
    noticeCache.set(runtime, { key, value })
    return value
  }
}

/** Every notification of an account, newest first, with whether it is read. */
export function useNotifications(persona: PersonaId): { notification: Notification; read: boolean }[] {
  const app = useApp()
  const state = useLedgerState()
  const ui = useUi()
  const marks = ui.read.get(persona)
  const t0Date = app.runtime.meta().t0Date
  const tz = app.content.config.t0.tz
  return useMemo(
    () =>
      notificationsFor(state, persona, app.content).map((notification) => ({
        notification,
        read: isRead(notification, marks, t0Date, tz),
      })),
    [state, persona, app.content, marks, t0Date, tz],
  )
}

/** The number on the bell and in the account menu. */
export function useUnread(persona: PersonaId): number {
  return useNotifications(persona).filter((n) => !n.read).length
}
