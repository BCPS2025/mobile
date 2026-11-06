import type { StateRecord } from './record'

// Record migrations: `MIGRATIONS[v]` turns a record of stateVersion v into one of
// v + 1. None are defined yet. An older record without a migration path is not rewritten: its
// log is replayed on the new seed as it stands, and it loads only if every command is still
// accepted and the invariants hold (store/restore); otherwise it is quarantined.

export type Migration = (r: StateRecord) => StateRecord

export const MIGRATIONS: Readonly<Record<number, Migration>> = {}

/** The record brought to `to` through every registered step (unregistered steps keep the log). */
export function migrate(
  r: StateRecord,
  to: number,
  steps: Readonly<Record<number, Migration>> = MIGRATIONS,
): StateRecord {
  let out = r
  for (let v = r.stateVersion; v < to; v++) {
    const step = steps[v]
    out = { ...(step ? step(out) : out), stateVersion: v + 1 }
  }
  return out
}
