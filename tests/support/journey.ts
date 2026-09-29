// Headless journeys: a journey is a list of user commands stamped with calendar times (a day
// offset from T0's date plus a local Europe/Ljubljana time), the shape the state-file log uses.
// runJourney drives a ledger node with plain commands and a manual clock: it moves the clock to
// each entry's time and dispatches it (the node first runs everything due by then, exactly as in
// live use); after the last entry it settles whatever is still pending.
import type { LedgerEvent, SimTime, UserCommand } from '@domain/types'
import { type SeedResult, buildSeed } from '@sim/seed'
import { type At, type IsoDate, instantOfAt } from '@sim/tz'
import { type LedgerNode, createLedgerNode } from '@store/node'
import { content } from '../unit/helpers'

export type { At }

export interface JourneyEntry {
  at: At
  cmd: UserCommand
}

export type Journey = readonly JourneyEntry[]

/** The instant of a calendar stamp for a given T0 date. */
export function instantOf(t0Date: IsoDate, at: At): SimTime {
  return instantOfAt(t0Date, at)
}

export interface Headless {
  seed: SeedResult
  node: LedgerNode
}

/** A ledger node over the seed for `epochDate`, with no wall-clock timers. */
export function headless(epochDate: IsoDate): Headless {
  const seed = buildSeed(content, epochDate)
  const node = createLedgerNode({ seed: seed.state, t0: seed.t0, timers: null })
  return { seed, node }
}

/** Replays a journey on a node; every entry must be accepted. Returns the events it produced. */
export function runJourney(h: Headless, journey: Journey): LedgerEvent[] {
  const start = h.node.events().length
  for (const [i, entry] of journey.entries()) {
    const at = instantOf(h.seed.t0Date, entry.at)
    if (at < h.node.now()) throw new Error(`Journey entry ${i} is earlier than the clock`)
    h.node.clock.jumpTo(at)
    const r = h.node.dispatch(entry.cmd)
    if (!r.ok) throw new Error(`Journey entry ${i} (${entry.cmd.type}) refused: ${r.error.code}`)
  }
  h.node.settleDue()
  return h.node.events().slice(start)
}
