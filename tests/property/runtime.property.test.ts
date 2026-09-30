// Property test of the page runtime: random sequences of the milestone A1
// command set through `createRuntime` with storage, the writer lock and manual timers, including
// Reset, Undo, commands the runtime must refuse as not storable (notes over 40 characters, items
// no screen sends, a persona id in place of a handle, a malformed cmdId), control characters in
// notes, Clock jumps (including one beyond the 400-day limit) and debounced writes firing at
// random points.
//
//   - invariants hold after every event;
//   - every accepted command is storable: a reload (a new tab on the same storage) restores the
//     byte-identical ledger and clock, with no notice;
//   - a note is saved without control or format characters.
//
// FC_SEED=<n> reproduces a run; FC_RUNS=<n> changes the number of sequences.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import type { SimTime, PayCommand } from '@domain/types'
import { stableStringify } from '@store/record'
import { createRuntime } from '@store/runtime'
import { manualLocks, settle } from '../support/manual-locks'
import { manualTime } from '../support/manual-time'
import { memoryStorage } from '../support/records'
import { content } from '../unit/helpers'
import {
  EPOCHS,
  type PayStep,
  type Step,
  answerCommand,
  askCommand,
  cancelCodeCommand,
  chargeCommand,
  cmdIds,
  linkCommand,
  lunchCommand,
  payCodeCommand,
  payCommand,
  posCodes,
  rampCommand,
  sequenceArb,
  splitCommand,
} from './arbitraries'

// Long runs (FC_RUNS in the thousands) need more than the default 5 s.
const TIMEOUT = 600_000
const RUNS = Number(process.env.FC_RUNS ?? 200)
const SEED = process.env.FC_SEED === undefined ? undefined : Number(process.env.FC_SEED)

// Cc and Cf characters, as the record format strips them from notes.
const CONTROL = /[\p{Cc}\p{Cf}]/u

/** Steps whose command no screen sends and the runtime must refuse whatever the ledger says. */
function mustRefuse(step: PayStep, cmd: PayCommand): boolean {
  if (step.cmdId.kind === 'malformed') return true
  if (step.items.kind === 'foreign' || step.items.kind === 'repriced' || step.items.kind === 'no-sku') {
    return cmd.items !== undefined && cmd.items.length > 0
  }
  if (!cmd.to.startsWith('@')) return true
  const cleaned = cmd.note?.replace(new RegExp(CONTROL, 'gu'), '').trim()
  return cleaned !== undefined && cleaned.length > 40
}

const stats = { accepted: 0, refusedAsUnstorable: 0, resets: 0, undos: 0, writes: 0 }

async function runSequence(epoch: string, steps: readonly Step[]): Promise<void> {
  const storage = memoryStorage()
  const locks = manualLocks()
  const time = manualTime()
  const deps = { content, build: 'dev', storage, locks, clock: { mode: 'manual' as const }, epochDate: epoch }
  const rt = createRuntime({ ...deps, timers: time.timers })
  await settle()
  expect(rt.lock?.status()).toBe('writer')
  const problems: string[] = []
  rt.node.onEvent((e, s) => {
    const p = invariants(s)
    if (p.length > 0) problems.push(`after ${e.type} #${e.seq}: ${p.join('; ')}`)
  })
  const ids = cmdIds()

  for (const step of steps) {
    switch (step.kind) {
      case 'pay':
      case 'pay-lunch': {
        const cmdId = step.kind === 'pay' ? ids.next(step.cmdId) : ids.next({ kind: 'new' })
        const s = rt.node.getState()
        const cmd = step.kind === 'pay' ? payCommand(content, s, step, cmdId) : lunchCommand(s, step.expect, cmdId)
        const r = rt.dispatch(cmd)
        if (step.kind === 'pay' && mustRefuse(step, cmd)) {
          expect(r.ok).toBe(false)
          if (!r.ok && r.error.code === 'not-storable') stats.refusedAsUnstorable++
        }
        if (r.ok) {
          stats.accepted++
          const tx = rt.node.getState().txs[(r.value[0] as { tx: { id: string } }).tx.id]
          if (tx?.note !== undefined) {
            expect(tx.note).not.toMatch(CONTROL)
            expect(tx.note.length).toBeLessThanOrEqual(40)
          }
        }
        break
      }
      case 'charge': {
        const r = rt.dispatch(chargeCommand(content, step, ids.next({ kind: 'new' })))
        if (r.ok) {
          stats.accepted++
          const code = posCodes(rt.node.getState()).at(-1)
          if (code?.note !== undefined) {
            expect(code.note).not.toMatch(CONTROL)
            expect(code.note.length).toBeLessThanOrEqual(40)
          }
        }
        break
      }
      case 'cancel-code':
        rt.dispatch(cancelCodeCommand(content, rt.node.getState(), step, ids.next({ kind: 'new' })))
        break
      case 'pay-code': {
        const cmd = payCodeCommand(content, rt.node.getState(), step, ids.next({ kind: 'new' }))
        if (cmd) rt.dispatch(cmd)
        break
      }
      case 'ask': {
        const cmd = askCommand(content, step, ids.next({ kind: 'new' }))
        const r = rt.dispatch(cmd)
        // A payer named by id instead of a handle, or a note the record cannot keep, is never stored.
        if (cmd.type === 'request.create' && cmd.channel === 'username' && !cmd.payer.startsWith('@')) {
          expect(r.ok).toBe(false)
        }
        if (r.ok) {
          stats.accepted++
          const made = Object.values(rt.node.getState().requests).at(-1)
          if (made?.note !== undefined) {
            expect(made.note).not.toMatch(CONTROL)
            expect(made.note.length).toBeLessThanOrEqual(40)
          }
        }
        break
      }
      case 'answer': {
        const cmd = answerCommand(content, rt.node.getState(), step, ids.next({ kind: 'new' }))
        if (!cmd) break
        const r = rt.dispatch(cmd)
        if (cmd.type === 'request.decline' && cmd.reason !== undefined && [...cmd.reason].length > 40) {
          expect(r.ok).toBe(false)
        }
        break
      }
      case 'link': {
        const cmd = linkCommand(content, rt.node.getState(), step, ids.next({ kind: 'new' }))
        if (!cmd) break
        const r = rt.dispatch(cmd)
        // A recipient named by id instead of a handle is never stored.
        if (cmd.type === 'link.share' && !cmd.to.startsWith('@')) expect(r.ok).toBe(false)
        if (r.ok) stats.accepted++
        break
      }
      case 'split': {
        const cmd = splitCommand(content, rt.node.getState(), step, ids.next({ kind: 'new' }))
        if (!cmd) break
        const r = rt.dispatch(cmd)
        // People named by id instead of a handle, and a note the record cannot keep, are never stored.
        if (cmd.type === 'split.create') {
          const cleaned = cmd.note.replace(new RegExp(CONTROL, 'gu'), '').trim()
          if (cmd.shares.some((sh) => !sh.party.startsWith('@')) || [...cleaned].length > 40 || cleaned.length === 0) {
            expect(r.ok).toBe(false)
          }
        }
        if (cmd.type === 'split.reask' && !cmd.party.startsWith('@')) expect(r.ok).toBe(false)
        if (r.ok) stats.accepted++
        break
      }
      case 'ramp': {
        const r = rt.dispatch(rampCommand(content, rt.node.getState(), step, ids.next({ kind: 'new' })))
        if (r.ok) stats.accepted++
        break
      }
      case 'advance':
        rt.node.clock.advance(step.ms)
        break
      case 'fire':
        // Wall time passes: the node's timer and the debounced write fire when due.
        time.advance(step.ms)
        stats.writes++
        break
      case 'catch-up':
        rt.node.run(rt.node.now(), 'catch-up')
        break
      case 'jump':
        rt.jump((rt.node.now() + step.ms) as SimTime)
        break
      case 'jump-back':
        expect(rt.jump((rt.node.now() - step.ms) as SimTime).ok).toBe(false)
        break
      case 'reset':
        stats.resets++
        rt.reset({ epochDate: epoch })
        break
      case 'undo':
        if (rt.undo()) stats.undos++
        break
    }
  }
  expect(problems).toEqual([])

  // A reload: the tab closes (pagehide flush) and a new one restores from the same storage.
  rt.node.run(rt.node.now(), 'catch-up')
  expect(rt.flush()).toBe('written')
  const before = JSON.stringify(rt.node.getState())
  const now = rt.node.now()
  const log = stableStringify(rt.node.log())
  rt.dispose()
  await settle()
  const next = createRuntime({ ...deps, timers: manualTime().timers })
  expect(next.notices()).toEqual([])
  expect(JSON.stringify(next.node.getState())).toBe(before)
  expect(next.node.now()).toBe(now)
  expect(stableStringify(next.node.log())).toBe(log)
  next.dispose()
  await settle()
}

describe('runtime properties over random A1 command sequences', () => {
  it(`accepted commands always reload byte-identical (${RUNS} sequences)`, { timeout: TIMEOUT }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...EPOCHS),
        sequenceArb(content, { runtime: true }, 50),
        async (epoch, steps) => {
          await runSequence(epoch, steps)
        },
      ),
      { numRuns: RUNS, ...(SEED === undefined ? {} : { seed: SEED }) },
    )
    if (process.env.FC_STATS) console.log(JSON.stringify(stats))
    expect(stats.accepted).toBeGreaterThan(RUNS)
    expect(stats.refusedAsUnstorable).toBeGreaterThan(0)
    expect(stats.resets).toBeGreaterThan(0)
    expect(stats.undos).toBeGreaterThan(0)
  })
})
