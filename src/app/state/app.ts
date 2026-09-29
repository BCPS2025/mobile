import type { Content } from '@content/schema'
import { fillTemplate } from '@domain/counter'
import type { Minor, Persona, PersonaId } from '@domain/types'
import type { Timers } from '@sim/clock'
import type { IsoDate } from '@sim/tz'
import { attachEffects } from '@store/effects'
import { type Nav, type NavStore, createNavStore } from '@store/nav'
import type { StorageLike } from '@store/persistence'
import { type Runtime, createRuntime } from '@store/runtime'
import {
  type SlotKey,
  type StageKey,
  chooseForSlot,
  completeLogin,
  isVisible,
  logoutSlot,
  markAllRead,
  markRead,
  personaOn,
  remember,
  resetUi,
  swapStage,
} from '@store/sessions'
import type { LockManagerLike } from '@store/writer-lock'
import { type UiBus, createUiBus } from '@store/uiBus'
import { isPersistedScreenId } from '../phone/registry'
import { fromPersistedIds, persistedIds, samePersisted } from '../phone/stack'
import type { Screen } from '../phone/types'
import { type PrefsStore, createPrefsStore } from './prefs'
import { type Store, createStore } from './store'

// One app state per page: the runtime (ledger, clock, persisted UI, writer lock), the in-memory
// screen stacks per persona, the uiBus, the presenter preferences and the transient UI state
// (banners, toasts, the Welcome screens, zoom). Built by `createAppState`; the browser wiring is
// `bootAppState` (boot.ts). The pages and phones read it through the hooks in AppContext.

/** Which login screen a logged-out phone shows (the screens are built on top of these states). */
export type AuthScreenState =
  | { screen: 'welcome' }
  | { screen: 'login'; chosen: PersonaId | null }
  | { screen: 'code'; persona: PersonaId; resends: number }

export interface BannerState {
  /** Increments with every banner, so a new one restarts the timer. */
  seq: number
  persona: PersonaId
  /** The notification (its id is also its read mark). */
  notificationId: string
  txId: string
  kind: string
  title: string
  line: string | null
  amount: Minor
}

export interface ToastState {
  id: string
  seq: number
  persona: PersonaId
  notificationId: string
  txId: string
  kind: string
  name: string
  title: string
  line: string | null
  /** "On Marko Kovač's phone: @ana sent you 16.50 BCPS · Cinema". */
  text: string
}

export type PageMode = 'stage' | 'phone' | 'none'

export interface Transient {
  /** Which page shows phones now: decides banner or toast for an arriving notification. */
  mode: PageMode
  auth: Record<SlotKey, AuthScreenState>
  banners: Partial<Record<PersonaId, BannerState>>
  toasts: readonly ToastState[]
  /** The 600 ms handover card of a phone whose account changed. */
  handover: Partial<Record<SlotKey, { persona: PersonaId; seq: number }>>
  /** "Everything reset · Undo", shown for 10 s. */
  resetToast: { seq: number } | null
  /** The phone Z zooms (the one used last), and the zoomed one. */
  lastUsed: StageKey
  zoom: StageKey | null
}

const WELCOME: AuthScreenState = { screen: 'welcome' }
const freshTransient = (): Transient => ({
  mode: 'none',
  auth: { left: WELCOME, right: WELCOME, single: WELCOME },
  banners: {},
  toasts: [],
  handover: {},
  resetToast: null,
  lastUsed: 'left',
  zoom: null,
})

/** Toasts on screen at once. */
const MAX_TOASTS = 3

export interface AppDeps {
  content: Content
  build: string
  /** From openStorage(); null runs in memory ("This browser isn't saving changes."). */
  storage: StorageLike | null
  locks: LockManagerLike | null
  onStorage?: (listener: () => void) => () => void
  timers: Timers | null
  clock: { mode: 'live' | 'manual'; wallNow?: () => number }
  /** The date a fresh start computes T0 from; called again on every Reset. */
  epochDate: () => IsoDate
  isScreen?: (id: string) => boolean
  requestPersist?: () => unknown
  /** A short chime when a sale settles (Settings › Sound). */
  chime?: () => void
}

export interface AppActions {
  /** The account menu, a phone-mode link: the account goes on the phone at once (a swap when it is on the other phone). */
  choose(key: SlotKey, persona: PersonaId): void
  /** The login screens finished (code or biometrics): the account goes on the phone and its code counter moves. */
  completeLogin(key: SlotKey, persona: PersonaId, resends?: number): void
  /** Back to Welcome on this phone, remembering the account; its stack and drafts are discarded. */
  logout(key: SlotKey): void
  swap(): void
  /** The login screens: which account this phone remembers while it is on Welcome. */
  remember(key: SlotKey, persona: PersonaId): void
  setAuth(key: SlotKey, next: AuthScreenState): void
  reset(mode: 'stage' | 'phone', loginAgain: boolean): void
  undo(): void
  markRead(persona: PersonaId, notificationId: string): void
  markAllRead(persona: PersonaId): void
  setMode(mode: PageMode): void
  setLastUsed(key: StageKey): void
  setZoom(key: StageKey | null): void
  dismissBanner(persona: PersonaId): void
  dismissToast(id: string): void
  dismissResetToast(): void
}

export interface AppState {
  readonly runtime: Runtime
  readonly content: Content
  /** Screen stacks per persona, in memory; only Home and one hub are mirrored into the saved UI. */
  readonly nav: NavStore<Screen>
  readonly bus: UiBus
  readonly prefs: PrefsStore
  readonly transient: Store<Transient>
  readonly actions: AppActions
  /** Display data of an account (content/personas.yaml). */
  persona(id: PersonaId): Persona | undefined
  dispose(): void
}

function mirrorNav(nav: Nav<Screen>): Map<PersonaId, string[]> {
  const out = new Map<PersonaId, string[]>()
  for (const [persona, stack] of Object.entries(nav)) out.set(persona, persistedIds(stack))
  return out
}

function navFromUi(ui: ReturnType<Runtime['ui']['get']>): Nav<Screen> {
  const out: Record<string, readonly Screen[]> = {}
  for (const [persona, ids] of ui.nav) out[persona] = fromPersistedIds(ids)
  return out
}

function sameNav(a: ReadonlyMap<PersonaId, string[]>, b: ReadonlyMap<PersonaId, string[]>): boolean {
  for (const key of new Set([...a.keys(), ...b.keys()])) if (!samePersisted(a.get(key), b.get(key))) return false
  return true
}

export function createAppState(deps: AppDeps): AppState {
  const { content } = deps
  const runtime = createRuntime({
    content,
    build: deps.build,
    storage: deps.storage,
    locks: deps.locks,
    ...(deps.onStorage ? { onStorage: deps.onStorage } : {}),
    timers: deps.timers,
    clock: deps.clock.wallNow ? { mode: deps.clock.mode, wallNow: deps.clock.wallNow } : { mode: deps.clock.mode },
    epochDate: deps.epochDate(),
    isScreen: deps.isScreen ?? isPersistedScreenId,
    ...(deps.requestPersist ? { requestPersist: deps.requestPersist } : {}),
  })
  const bus = createUiBus()
  const prefs = createPrefsStore(deps.storage)
  const transient = createStore<Transient>(freshTransient())
  const nav = createNavStore<Screen>(navFromUi(runtime.ui.get()))
  const tz = content.config.t0.tz
  const personas = content.personas.personas as Persona[]

  // ---- the saved UI mirrors Home and one hub of every stack, and follows Reset, Undo and a
  // session taken over from another tab.
  const offs: (() => void)[] = []
  offs.push(
    nav.subscribe(() => {
      const ui = runtime.ui.get()
      const mirrored = mirrorNav(nav.get())
      if (!sameNav(ui.nav, mirrored)) runtime.ui.set({ ...ui, nav: mirrored })
    }),
  )
  offs.push(
    runtime.ui.subscribe(() => {
      const ui = runtime.ui.get()
      if (!sameNav(mirrorNav(nav.get()), ui.nav)) nav.replaceAll(navFromUi(ui))
    }),
  )

  // ---- notifications become banners (the account is on a phone) or toasts (it is not)
  let seq = 0
  const nameOf = (id: PersonaId) => personas.find((p) => p.id === id)?.displayName ?? id
  offs.push(attachEffects(runtime.node, bus, content))
  offs.push(
    bus.on('notification', (n) => {
      const mode = transient.get().mode
      if (mode === 'none') return
      const visible = isVisible(runtime.ui.get(), n.persona, mode)
      seq += 1
      if (visible) {
        if (!n.banner) return
        transient.update((t) => ({
          ...t,
          banners: {
            ...t.banners,
            [n.persona]: {
              seq,
              persona: n.persona,
              notificationId: n.id,
              txId: n.txId,
              kind: n.kind,
              title: n.title,
              line: n.line,
              amount: n.amount,
            },
          },
        }))
        if (prefs.get().sound && n.kind === 'sale.received') deps.chime?.()
      } else if (n.toast) {
        const name = nameOf(n.persona)
        const what = n.line ? `${n.title} · ${n.line}` : n.title
        const toast: ToastState = {
          id: `${n.id}:${n.persona}`,
          seq,
          persona: n.persona,
          notificationId: n.id,
          txId: n.txId,
          kind: n.kind,
          name,
          title: n.title,
          line: n.line,
          text: fillTemplate(content.copy.phoneMode.toast, { name, what }),
        }
        transient.update((t) => ({
          ...t,
          toasts: [...t.toasts.filter((x) => x.id !== toast.id), toast].slice(-MAX_TOASTS),
        }))
      }
    }),
  )

  // A persona that arrives on a phone no longer needs its banner or toasts.
  const clearFor = (persona: PersonaId) =>
    transient.update((t) => {
      const { [persona]: _gone, ...banners } = t.banners
      return { ...t, banners, toasts: t.toasts.filter((x) => x.persona !== persona) }
    })

  const handover = (key: SlotKey, persona: PersonaId) => {
    seq += 1
    transient.update((t) => ({ ...t, handover: { ...t.handover, [key]: { persona, seq } } }))
  }
  const setAuth = (key: SlotKey, next: AuthScreenState) =>
    transient.update((t) => ({ ...t, auth: { ...t.auth, [key]: next } }))
  const editUi = (f: (ui: ReturnType<Runtime['ui']['get']>) => ReturnType<Runtime['ui']['get']>) => {
    const before = runtime.ui.get()
    const after = f(before)
    if (after !== before) runtime.ui.set(after)
    return after !== before
  }
  /** The stack of an account that left a phone by logging out: drafts and screens are discarded. */
  const discardStack = (persona: PersonaId) => nav.set(persona, [{ kind: 'home' }])

  const actions: AppActions = {
    choose(key, persona) {
      const before = runtime.ui.get()
      if (!editUi((ui) => chooseForSlot(ui, key, persona))) return
      clearFor(persona)
      setAuth(key, WELCOME)
      // A swap moves both accounts; the card shows the account that arrived on this phone.
      const after = runtime.ui.get()
      handover(key, persona)
      if (key !== 'single') {
        const other: StageKey = key === 'left' ? 'right' : 'left'
        if (personaOn(before, other) !== personaOn(after, other)) {
          const moved = personaOn(after, other)
          if (moved) handover(other, moved)
        }
      }
    },
    completeLogin(key, persona, resends = 0) {
      if (!editUi((ui) => completeLogin(ui, key, persona, resends))) return
      clearFor(persona)
      setAuth(key, WELCOME)
    },
    logout(key) {
      const persona = personaOn(runtime.ui.get(), key)
      if (!persona) return
      editUi((ui) => logoutSlot(ui, key))
      discardStack(persona)
      setAuth(key, WELCOME)
    },
    swap() {
      editUi(swapStage)
      transient.update((t) => ({ ...t, auth: { ...t.auth, left: t.auth.right, right: t.auth.left } }))
    },
    remember(key, persona) {
      editUi((ui) => remember(ui, key, persona))
    },
    setAuth,
    reset(mode, loginAgain) {
      runtime.reset({ epochDate: deps.epochDate(), ui: resetUi({ mode, loginAgain }) })
      nav.clear()
      seq += 1
      transient.update((t) => ({
        ...freshTransient(),
        mode: t.mode,
        lastUsed: t.lastUsed,
        resetToast: { seq },
      }))
    },
    undo() {
      if (!runtime.undo()) return
      transient.update((t) => ({ ...t, resetToast: null }))
    },
    markRead(persona, notificationId) {
      editUi((ui) => markRead(ui, persona, notificationId))
    },
    markAllRead(persona) {
      editUi((ui) => markAllRead(ui, persona, runtime.node.now(), runtime.meta().t0Date, tz))
    },
    setMode(mode) {
      transient.update((t) => (t.mode === mode ? t : { ...t, mode }))
    },
    setLastUsed(key) {
      transient.update((t) => (t.lastUsed === key ? t : { ...t, lastUsed: key }))
    },
    setZoom(key) {
      transient.update((t) => (t.zoom === key ? t : { ...t, zoom: key }))
    },
    dismissBanner(persona) {
      transient.update((t) => {
        if (!t.banners[persona]) return t
        const { [persona]: _gone, ...banners } = t.banners
        return { ...t, banners }
      })
    },
    dismissToast(id) {
      transient.update((t) =>
        t.toasts.some((x) => x.id === id) ? { ...t, toasts: t.toasts.filter((x) => x.id !== id) } : t,
      )
    },
    dismissResetToast() {
      transient.update((t) => (t.resetToast ? { ...t, resetToast: null } : t))
    },
  }

  return {
    runtime,
    content,
    nav,
    bus,
    prefs,
    transient,
    actions,
    persona: (id) => personas.find((p) => p.id === id),
    dispose() {
      for (const off of offs) off()
      runtime.dispose()
    },
  }
}
