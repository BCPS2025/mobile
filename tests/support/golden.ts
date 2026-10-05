// Golden journeys, driven by plain engine commands and checked at the three golden epochs (T0 = Friday
// 25 Sep 2026, Friday 23 Oct 2026 the week the clocks change back, Friday 26 Mar 2027 the week they
// change forward): the end balances, every invariant after every event (live, and again on replay),
// a replay of the stored record that is byte-identical, the production restore path, ten resets
// that give the same bytes, and the same stamped log at every epoch.
import { describe, expect, it } from 'vitest'
import type { Content } from '@content/schema'
import { invariants } from '@domain/invariants'
import { evolve } from '@domain/ledger'
import { formatHundredths } from '@domain/money'
import type { AccountId, LedgerState } from '@domain/types'
import { createLedgerNode } from '@store/node'
import { type StateRecord, serializeRecord, stableStringify } from '@store/record'
import { replay } from '@store/replay'
import { restoreText } from '@store/restore'
import { content } from '../unit/helpers'
import { type Headless, type Journey, headless, runJourney } from './journey'
import { recordOf } from './records'

export const EPOCHS = ['2026-09-25', '2026-10-23', '2027-03-26'] as const

export const bal = (s: LedgerState, a: AccountId): string => formatHundredths(s.balances[a]?.confirmed ?? Number.NaN)

export interface GoldenSpec {
  name: string
  journey: (content: Content) => Journey
  /** Confirmed balances after the journey (accounts not named keep their starting balance). */
  end: Record<string, string>
  /** What `sys:fees` gained since the start. */
  fees: string
  /** More assertions on the finished live session. */
  check?: (h: Headless, epoch: string) => void
}

const START: Record<string, string> = {
  ana: '247.50',
  marko: '132.98',
  cafe: '286.00',
  studio: '1,254.00',
  firm: '12,100.00',
  supplier: '880.00',
  bakery: '0.00',
}

const snapshot = (h: Headless) =>
  JSON.stringify({ state: h.node.getState(), events: h.node.events(), commands: h.node.commands(), now: h.node.now() })

function expectEnd(spec: GoldenSpec, s: LedgerState, seed: LedgerState) {
  for (const [account, want] of Object.entries({ ...START, ...spec.end })) expect(bal(s, account), account).toBe(want)
  const fees = (s.balances['sys:fees']?.confirmed ?? 0) - (seed.balances['sys:fees']?.confirmed ?? 0)
  expect(formatHundredths(fees)).toBe(spec.fees)
  expect(s.pending).toEqual([])
  expect(invariants(s)).toEqual([])
}

export function describeGolden(spec: GoldenSpec): void {
  const journey = spec.journey(content)
  const live = (epoch: string): { h: Headless; record: StateRecord } => {
    const h = headless(epoch)
    runJourney(h, journey)
    return { h, record: recordOf(h.node, h.seed.t0Date) }
  }
  const replayRecord = (h: Headless, record: StateRecord) => {
    const r = replay({
      seed: h.seed.state,
      t0: h.seed.t0,
      t0Date: record.t0Date,
      content,
      log: record.log,
      clock: record.clock,
    })
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    let s = h.seed.state
    for (const e of r.value.events) {
      s = evolve(s, e)
      expect(invariants(s)).toEqual([])
    }
    return r.value
  }

  describe.each(EPOCHS)(`${spec.name} at T0 = %s`, (epoch) => {
    it('ends on the golden balances with every invariant intact after every event', () => {
      const h = headless(epoch)
      const problems: string[][] = []
      h.node.onEvent((_e, s) => problems.push(invariants(s)))
      runJourney(h, journey)
      for (const p of problems) expect(p).toEqual([])
      expect(problems.length).toBeGreaterThan(0)
      expectEnd(spec, h.node.getState(), h.node.seedState())
      spec.check?.(h, epoch)
    })

    it('live and replayed from its record: byte-identical state and events; the restore path agrees', () => {
      const { h, record } = live(epoch)
      const replayed = replayRecord(h, record)
      expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(h.node.getState()))
      expect(JSON.stringify(replayed.events)).toBe(JSON.stringify(h.node.events()))
      expect(replayed.clock).toBe(h.node.now())
      expectEnd(spec, replayed.state, h.seed.state)
      const restored = restoreText(serializeRecord(record), { content }, { acceptOlder: false })
      if (!restored.ok) throw new Error(JSON.stringify(restored.error))
      expect(restored.value.recalculated).toBe(false)
      expect(JSON.stringify(restored.value.session.state)).toBe(JSON.stringify(h.node.getState()))
    })

    it('10 × (reset → journey) gives identical state', () => {
      const h = headless(epoch)
      const snapshots: string[] = []
      for (let i = 0; i < 10; i++) {
        h.node.resetToSeed()
        expect(h.node.events()).toHaveLength(0)
        expect(h.node.now()).toBe(h.seed.t0)
        runJourney(h, journey)
        expectEnd(spec, h.node.getState(), h.node.seedState())
        snapshots.push(snapshot(h))
      }
      expect(new Set(snapshots).size).toBe(1)
      const other = headless(epoch)
      runJourney(other, journey)
      expect(snapshot(other)).toBe(snapshots[0])
      // A node that loads the replayed session ends in the same bytes as one that ran it.
      const { h: ran, record } = live(epoch)
      const node = createLedgerNode({ seed: ran.seed.state, t0: ran.seed.t0 })
      const r = replayRecord(ran, record)
      node.loadSession({ seed: ran.seed.state, t0: ran.seed.t0, ...r })
      expect(serializeRecord(recordOf(node, ran.seed.t0Date))).toBe(serializeRecord(record))
    })
  })

  describe(`${spec.name} across the epochs`, () => {
    it('stores the same calendar-stamped log at every epoch, and each replays on the others', () => {
      const records = EPOCHS.map((epoch) => live(epoch))
      const logs = new Set(records.map(({ record }) => stableStringify({ log: record.log, clock: record.clock })))
      expect(logs.size).toBe(1)
      for (const { record } of records) {
        for (const epoch of EPOCHS) {
          const h = headless(epoch)
          const replayed = replayRecord(h, { ...record, t0Date: h.seed.t0Date })
          expectEnd(spec, replayed.state, h.seed.state)
        }
      }
    })
  })
}
