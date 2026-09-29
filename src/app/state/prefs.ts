import { PREFS_KEY, type StorageLike, safeGet, safeSet } from '@store/persistence'
import { type Store, createStore } from './store'

// Presenter preferences: large text on navy, the payment tape, reduced motion and sound. Kept
// in the browser under `bcps:prefs`, read and written inside try/catch, and never touched by
// Reset (they are not part of the saved session). Reduced motion follows the operating system
// until it is switched by hand.

export interface Prefs {
  largeText: boolean
  tape: boolean
  /** null = follow the operating system. */
  reduceMotion: boolean | null
  sound: boolean
}

export const DEFAULT_PREFS: Prefs = { largeText: false, tape: true, reduceMotion: null, sound: false }

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

/** Reads stored preferences; anything odd falls back to the defaults, key by key. */
export function parsePrefs(raw: string | null): Prefs {
  if (raw === null || raw.length > 2000) return DEFAULT_PREFS
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null
    if (!v || typeof v !== 'object') return DEFAULT_PREFS
    return {
      largeText: bool(v.largeText, DEFAULT_PREFS.largeText),
      tape: bool(v.tape, DEFAULT_PREFS.tape),
      reduceMotion: typeof v.reduceMotion === 'boolean' ? v.reduceMotion : null,
      sound: bool(v.sound, DEFAULT_PREFS.sound),
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export type PrefsStore = Store<Prefs>

export function createPrefsStore(storage: StorageLike | null): PrefsStore {
  const store = createStore<Prefs>(storage ? parsePrefs(safeGet(storage, PREFS_KEY)) : DEFAULT_PREFS)
  if (storage) {
    store.subscribe(() => {
      safeSet(storage, PREFS_KEY, JSON.stringify(store.get()))
    })
  }
  return store
}
