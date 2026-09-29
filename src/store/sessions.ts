import type { PersonaId, SimTime } from '@domain/types'
import { type At, type IsoDate, atOfInstant } from '@sim/tz'
import { LIMITS, type ReadMarks, type Slot, type UiState, freshUi } from './record'

// Pure reducers over the persisted UI state: who is logged in on which phone, the rotating login
// codes, read marks and the UI a Reset starts from. Nothing here touches the ledger, storage or
// React. Every reducer returns a new UiState (or the same one when nothing changes).
//
// A phone shows one account or Welcome (`persona: null`, remembering the last account). The same
// persona is never on both stage phones: the reducers refuse it, and the account menu swaps the
// phones instead when the chosen account is on the other one. `sessions` is derived (an account
// is logged in while it is on a phone of any mode) and recomputed by every reducer.

/** The phones of the UI: the two stage phones, and the one phone of phone mode. */
export type SlotKey = 'left' | 'right' | 'single'
export type StageKey = 'left' | 'right'

export const slotOf = (ui: UiState, key: SlotKey): Slot => (key === 'single' ? ui.phones.phone : ui.phones.stage[key])

export const otherStage = (key: StageKey): StageKey => (key === 'left' ? 'right' : 'left')

/** The account on a phone, or null on Welcome. */
export const personaOn = (ui: UiState, key: SlotKey): PersonaId | null => slotOf(ui, key).persona

function withSlot(ui: UiState, key: SlotKey, slot: Slot): UiState {
  const next: UiState =
    key === 'single'
      ? { ...ui, phones: { ...ui.phones, phone: slot } }
      : { ...ui, phones: { ...ui.phones, stage: { ...ui.phones.stage, [key]: slot } } }
  return withSessions(next)
}

/** `sessions` = the accounts that are on a phone now. */
export function withSessions(ui: UiState): UiState {
  const on = new Set<PersonaId>()
  for (const s of [ui.phones.stage.left, ui.phones.stage.right, ui.phones.phone]) if (s.persona) on.add(s.persona)
  const sessions = new Map<PersonaId, boolean>()
  for (const p of [...on].sort()) sessions.set(p, true)
  return { ...ui, sessions }
}

/** Where a persona is shown on the stage: 'left', 'right' or null. */
export function stageKeyOf(ui: UiState, persona: PersonaId): StageKey | null {
  if (ui.phones.stage.left.persona === persona) return 'left'
  if (ui.phones.stage.right.persona === persona) return 'right'
  return null
}

/** True when the persona is on a phone of the given mode (`stage` = either stage phone). */
export function isVisible(ui: UiState, persona: PersonaId, mode: 'stage' | 'phone'): boolean {
  return mode === 'phone' ? ui.phones.phone.persona === persona : stageKeyOf(ui, persona) !== null
}

// ---- login codes (D19): (seedCode + 7919 × n) mod 1,000,000, six digits

const CODE_STEP = 7919
const CODE_SPACE = 1_000_000
/** The record's limit on a login counter. */
const MAX_LOGINS = 1_000_000

/** The code shown for the n-th login attempt of an account whose first code is `seedCode`. */
export function loginCode(seedCode: string, n: number): string {
  const seed = Number.parseInt(seedCode, 10)
  const value = (((seed + CODE_STEP * n) % CODE_SPACE) + CODE_SPACE) % CODE_SPACE
  return String(value).padStart(6, '0')
}

/** Logins since Reset: the code index of the next login (0 = the seed code). */
export const loginsOf = (ui: UiState, persona: PersonaId): number => ui.logins.get(persona) ?? 0

/**
 * The code a login shows: the account's next unused code, plus one for every "Send again" of
 * this attempt (`resends`). The first login after Reset shows the seed code.
 */
export const codeForLogin = (ui: UiState, persona: PersonaId, seedCode: string, resends = 0): string =>
  loginCode(seedCode, loginsOf(ui, persona) + resends)

/**
 * Completes a login through the login screens (code or biometrics): the account goes on the
 * phone, and its login counter moves past every code that was shown, so the next login (and the
 * next "Send again") shows a different code. Refused (unchanged) for the account on the other
 * stage phone.
 */
export function completeLogin(ui: UiState, key: SlotKey, persona: PersonaId, resends = 0): UiState {
  const placed = loginInstant(ui, key, persona)
  if (placed === ui) return ui
  const logins = new Map(placed.logins)
  logins.set(persona, Math.min(loginsOf(ui, persona) + resends + 1, MAX_LOGINS))
  return { ...placed, logins }
}

/**
 * Puts an account on a phone without the login screens (the account menu, a phone-mode deep
 * link, Reset with the option on). The login counter does not move. Refused (unchanged) for the
 * account on the other stage phone.
 */
export function loginInstant(ui: UiState, key: SlotKey, persona: PersonaId): UiState {
  if (key !== 'single' && ui.phones.stage[otherStage(key)].persona === persona) return ui
  return withSlot(ui, key, { persona, remembered: persona })
}

/** Back to Welcome on this phone, remembering the account. */
export function logoutSlot(ui: UiState, key: SlotKey): UiState {
  const slot = slotOf(ui, key)
  if (slot.persona === null) return ui
  return withSlot(ui, key, { persona: null, remembered: slot.persona })
}

/** Swaps the two stage phones (accounts and what they remember). */
export function swapStage(ui: UiState): UiState {
  const { left, right } = ui.phones.stage
  return withSessions({ ...ui, phones: { ...ui.phones, stage: { left: right, right: left } } })
}

/**
 * The account menu's choice for a phone: the account on the other stage phone swaps the phones,
 * any other account goes on this phone at once (logged in, no login screens).
 */
export function chooseForSlot(ui: UiState, key: SlotKey, persona: PersonaId): UiState {
  if (slotOf(ui, key).persona === persona) return ui
  if (key !== 'single' && ui.phones.stage[otherStage(key)].persona === persona) return swapStage(ui)
  return loginInstant(ui, key, persona)
}

/** Sets what a phone remembers on Welcome (the login screens do this when a row is chosen). */
export function remember(ui: UiState, key: SlotKey, persona: PersonaId): UiState {
  const slot = slotOf(ui, key)
  if (slot.remembered === persona) return ui
  return withSlot(ui, key, { ...slot, remembered: persona })
}

export interface LoginChoice {
  persona: PersonaId
  remembered: boolean
  /** The account is on the other stage phone: shown greyed "On the other phone" and disabled. */
  disabled: boolean
}

/** The rows of the Log in screen: the remembered account first, the other stage phone's disabled. */
export function loginChoices(ui: UiState, key: SlotKey, live: readonly PersonaId[]): LoginChoice[] {
  const remembered = slotOf(ui, key).remembered
  const other = key === 'single' ? null : ui.phones.stage[otherStage(key)].persona
  const rows = live.map((persona) => ({ persona, remembered: persona === remembered, disabled: persona === other }))
  return [...rows.filter((r) => r.remembered), ...rows.filter((r) => !r.remembered)]
}

// ---- read marks

const emptyMarks = (): ReadMarks => ({ readUpTo: null, readIds: [] })

function withMarks(ui: UiState, persona: PersonaId, marks: ReadMarks): UiState {
  const read = new Map(ui.read)
  read.set(persona, marks)
  return { ...ui, read }
}

/** Marks one notification read (idempotent). */
export function markRead(ui: UiState, persona: PersonaId, id: string): UiState {
  const marks = ui.read.get(persona) ?? emptyMarks()
  if (marks.readIds.includes(id)) return ui
  return withMarks(ui, persona, { ...marks, readIds: [...marks.readIds, id].slice(-LIMITS.readIds) })
}

/** "Mark all as read": everything up to now is read. */
export function markAllRead(ui: UiState, persona: PersonaId, now: SimTime, t0Date: IsoDate, tz: string): UiState {
  const marks = ui.read.get(persona) ?? emptyMarks()
  const upTo: At = atOfInstant(t0Date, now, tz)
  return withMarks(ui, persona, { readUpTo: upTo, readIds: marks.readIds })
}

// ---- Reset

export interface ResetUiOptions {
  /** The page mode Reset was pressed in. */
  mode: 'stage' | 'phone'
  /** "Log Ana and Café Lipa in again": both stage phones (or the phone) come back logged in. */
  loginAgain: boolean
}

/**
 * The UI a Reset starts from: everyone logged out (Ana on the left, Café Lipa on the right,
 * Ana in phone mode remembered), or, with the option, logged in again at Home. The login
 * counters start again, so the first login shows the seed code.
 */
export function resetUi(o: ResetUiOptions): UiState {
  const ui = freshUi()
  if (!o.loginAgain) return ui
  if (o.mode === 'phone') return loginInstant(ui, 'single', 'ana')
  return loginInstant(loginInstant(ui, 'left', 'ana'), 'right', 'cafe')
}
