import type { Content } from '@content/schema'
import { invariants } from '@domain/invariants'
import { isLedgerPersona } from '@domain/ledger'
import type { LedgerState, PersonaId } from '@domain/types'
import { buildSeed } from '@sim/seed'
import { migrate } from './migrations'
import type { LoadedSession } from './node'
import {
  type LogEntry,
  type ParseResult,
  type RecordProblem,
  type Slot,
  type StateRecord,
  type UiState,
  fingerprintOf,
  parseRecord,
  sameFingerprint,
} from './record'
import { type ReplayFailure, replay } from './replay'

// Load: parse → validate → stateVersion → rebuild the seed with the stored T0
// date → replay (every command must succeed) → invariants → fingerprint → UI checked against
// the replayed state. The same path serves the localStorage record, imported files and the
// shipped starting states. A fingerprint mismatch, or an older version whose log still replays,
// loads with `recalculated` set; everything else is refused.

/** Guest ids sign-up can create (a pool of five). */
export const GUEST_IDS: readonly string[] = ['guest-1', 'guest-2', 'guest-3', 'guest-4', 'guest-5']

export interface RestoreEnv {
  content: Content
  /** Screen ids the phone runtime knows (A2's registry); unknown ones are dropped. All allowed when omitted. */
  isScreen?: (id: string) => boolean
  tz?: string
}

export interface Restored {
  record: StateRecord
  session: LoadedSession
  /** The stored form of each entry of `session.log` (same index). */
  stored: readonly LogEntry[]
  ui: UiState
  /** The replayed state differs from what the record says it produced, or the record is from an older version. */
  recalculated: boolean
}

export type RestoreFailure =
  | { stage: 'parse'; problem: RecordProblem }
  | { stage: 'replay'; failure: ReplayFailure }
  | { stage: 'invariants'; problems: string[] }

export type RestoreResult = { ok: true; value: Restored } | { ok: false; error: RestoreFailure }

/** Persona ids a persona-keyed map in a record may use. */
export function personaIdsOf(content: Content): ReadonlySet<string> {
  return new Set([...content.personas.personas.map((p) => p.id), ...GUEST_IDS])
}

export function parseFor(content: Content, text: string, acceptOlder: boolean): ParseResult {
  return parseRecord(text, {
    stateVersion: content.config.stateVersion,
    acceptOlder,
    t0Weekday: content.config.t0.weekday,
    personaIds: personaIdsOf(content),
    tz: content.config.t0.tz,
  })
}

/**
 * The UI of a record, fitted to the replayed state: personas that do not exist (or cannot act)
 * leave their phone on Welcome, the same persona never sits on both stage phones (the right one
 * falls back), unknown screens are dropped, and maps keep known personas only.
 */
export function reconcileUi(ui: UiState, s: LedgerState, isScreen: (id: string) => boolean = () => true): UiState {
  const ok = (id: PersonaId | null): id is PersonaId => id !== null && isLedgerPersona(s, id)
  const fitSlot = (slot: Slot): Slot => ({
    persona: ok(slot.persona) ? slot.persona : null,
    remembered: ok(slot.remembered) ? slot.remembered : null,
  })
  const left = fitSlot(ui.phones.stage.left)
  const right = fitSlot(ui.phones.stage.right)
  if (left.persona !== null && left.persona === right.persona) right.persona = null
  const keep = <V>(m: ReadonlyMap<PersonaId, V>): Map<PersonaId, V> => new Map([...m].filter(([k]) => ok(k)))
  const nav = new Map<PersonaId, string[]>()
  for (const [k, stack] of ui.nav) {
    if (!ok(k)) continue
    const known = stack.filter(isScreen)
    if (known.length > 0) nav.set(k, known)
  }
  return {
    phones: { stage: { left, right }, phone: fitSlot(ui.phones.phone) },
    sessions: keep(ui.sessions),
    nav,
    read: keep(ui.read),
    logins: keep(ui.logins),
  }
}

/** Replays a parsed record on the seed of its own T0 date. Never throws: a record that makes
 *  anything throw is refused (and so quarantined at boot) instead of crashing the page. */
export function restoreRecord(parsed: StateRecord, olderVersion: boolean, env: RestoreEnv): RestoreResult {
  try {
    return restoreUnguarded(parsed, olderVersion, env)
  } catch {
    return { ok: false, error: { stage: 'replay', failure: { code: 'exception', index: null } } }
  }
}

function restoreUnguarded(parsed: StateRecord, olderVersion: boolean, env: RestoreEnv): RestoreResult {
  const record = olderVersion ? migrate(parsed, env.content.config.stateVersion) : parsed
  const seed = buildSeed(env.content, record.t0Date)
  const r = replay({
    seed: seed.state,
    t0: seed.t0,
    t0Date: seed.t0Date,
    content: env.content,
    log: record.log,
    clock: record.clock,
    ...(env.tz !== undefined ? { tz: env.tz } : {}),
  })
  if (!r.ok) return { ok: false, error: { stage: 'replay', failure: r.error } }
  const problems = invariants(r.value.state)
  if (problems.length > 0) return { ok: false, error: { stage: 'invariants', problems } }
  const recalculated = olderVersion || !sameFingerprint(fingerprintOf(r.value.state), record.fingerprint)
  return {
    ok: true,
    value: {
      record,
      session: {
        seed: seed.state,
        t0: seed.t0,
        state: r.value.state,
        events: r.value.events,
        log: r.value.log,
        clock: r.value.clock,
      },
      stored: record.log,
      ui: reconcileUi(record.ui, r.value.state, env.isScreen),
      recalculated,
    },
  }
}

/** Parse, validate and replay a record's text. Never throws. */
export function restoreText(text: string, env: RestoreEnv, opts: { acceptOlder: boolean }): RestoreResult {
  let parsed: ParseResult
  try {
    parsed = parseFor(env.content, text, opts.acceptOlder)
  } catch {
    return { ok: false, error: { stage: 'parse', problem: { code: 'shape', path: '$' } } }
  }
  if (!parsed.ok) return { ok: false, error: { stage: 'parse', problem: parsed.problem } }
  return restoreRecord(parsed.record, parsed.olderVersion, env)
}
