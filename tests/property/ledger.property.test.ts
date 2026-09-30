// Property tests of the ledger node: random sequences of the milestone A1
// command set (payments of every kind, valid and invalid, repeated command ids), Clock jumps,
// late timers and catch-up points, at the three golden epochs.
//
//   - every invariant holds after every event;
//   - a refused command changes nothing; an accepted one submits exactly one transaction whose
//     fee follows D29 (1 % round half-up, no minimum) and whose debit is what the review showed;
//   - jumps are refused exactly while a payment is pending, and never go backwards;
//   - the saved record replays headlessly to byte-identical JSON (state and events), twice, and
//     restores through the production path without a recalculation.
//
// FC_SEED=<n> reproduces a run; FC_RUNS=<n> changes the number of sequences (at least 200 in CI).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import { evolve } from '@domain/ledger'
import type { LedgerEvent, LedgerState, SimTime, Tx, PayCommand } from '@domain/types'
import { buildSeed } from '@sim/seed'
import { createLogEncoder } from '@store/log-codec'
import { createLedgerNode } from '@store/node'
import { snapshotRecord } from '@store/persistence'
import { freshUi, serializeRecord } from '@store/record'
import { replay } from '@store/replay'
import { restoreText } from '@store/restore'
import { manualTime } from '../support/manual-time'
import { STATE_VERSION } from '../support/records'
import { content } from '../unit/helpers'
import {
  EPOCHS,
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
const RUNS = Number(process.env.FC_RUNS ?? 250)
const SEED = process.env.FC_SEED === undefined ? undefined : Number(process.env.FC_SEED)
const params = (numRuns: number): fc.Parameters<unknown> => ({ numRuns, ...(SEED === undefined ? {} : { seed: SEED }) })

/** D29: 1 % of the amount in hundredths, rounded half-up, no minimum. */
const onePercent = (amount: number) => Math.floor((amount + 50) / 100)

/** What happened across all runs, so the test can show the generators reach the paths. */
const stats = {
  accepted: 0,
  refused: new Map<string, number>(),
  lunchPaid: 0,
  jumps: 0,
  jumpsRefused: 0,
  events: 0,
  charges: 0,
  replacedCodes: 0,
  cancels: 0,
  codesPaid: 0,
  codesRefused: new Map<string, number>(),
  asks: 0,
  declines: 0,
  requestCancels: 0,
  requestsPaid: 0,
  linksMade: 0,
  linksShared: 0,
  linksPaid: 0,
  splitsMade: 0,
  splitsReasked: 0,
  splitsCancelled: 0,
  topUpsPaidIn: 0,
  topUpsRequested: 0,
  topUpsArrived: 0,
  cashOuts: 0,
}
const countRefusal = (code: string) => stats.refused.set(code, (stats.refused.get(code) ?? 0) + 1)

interface Outcome {
  state: LedgerState
  events: readonly LedgerEvent[]
  record: string
}

/** Runs one sequence on a live node with manual timers; asserts the per-step properties. */
function runSequence(epoch: string, steps: readonly Step[]): Outcome {
  const seed = buildSeed(content, epoch)
  const time = manualTime()
  const node = createLedgerNode({ seed: seed.state, t0: seed.t0, timers: time.timers })
  const ids = cmdIds()
  const problems: string[] = []
  node.onEvent((e, s) => {
    stats.events++
    // A bank transfer arrives at or after its time, whichever way the clock reached it.
    if (e.type === 'ramp.completed' && e.ramp.method === 'bank-transfer') {
      stats.topUpsArrived++
      expect(e.at).toBeGreaterThanOrEqual(e.ramp.arrivesAt ?? Number.POSITIVE_INFINITY)
    }
    const p = invariants(s)
    if (p.length > 0) problems.push(`after ${e.type} #${e.seq}: ${p.join('; ')}`)
  })

  for (const step of steps) {
    switch (step.kind) {
      case 'pay':
      case 'pay-lunch': {
        const cmdId = step.kind === 'pay' ? ids.next(step.cmdId) : ids.next({ kind: 'new' })
        // The review step is computed on the state the command will be decided on: catch up first
        // half of the time, and the other half let dispatch catch up by itself.
        if (cmdId.charCodeAt(15) % 2 === 0) node.run(node.now(), 'catch-up')
        const before = node.getState()
        const cmd: PayCommand =
          step.kind === 'pay' ? payCommand(content, before, step, cmdId) : lunchCommand(before, step.expect, cmdId)
        const r = node.dispatch(cmd)
        const mine = node.events().filter((e) => e.cmdId === cmd.cmdId && e.type === 'tx.submitted')
        if (!r.ok) {
          countRefusal(r.error.code)
          // Nothing of a refused command reaches the ledger or the log.
          if (r.error.code !== 'duplicate') expect(mine).toHaveLength(0)
          expect(node.log().some((l) => 'cmd' in l && l.cmd === cmd)).toBe(false)
          break
        }
        stats.accepted++
        expect(mine).toHaveLength(1)
        const tx = (mine[0] as Extract<LedgerEvent, { type: 'tx.submitted' }>).tx as Tx
        expect(tx.amount).toBe(cmd.amount)
        expect(tx.fee.fee).toBe(onePercent(cmd.amount))
        expect(tx.fee.senderDebit).toBe(cmd.expect.senderDebit)
        expect(tx.fee.senderDebit - tx.fee.recipientCredit).toBe(tx.fee.fee)
        if (tx.fee.payer === 'sender') expect(tx.fee.senderDebit).toBe(cmd.amount + tx.fee.fee)
        else expect(tx.fee.recipientCredit).toBe(cmd.amount - tx.fee.fee)
        if (cmd.requestId === 'r_seed_lunch') stats.lunchPaid++
        break
      }
      case 'charge': {
        const cmdId = ids.next({ kind: 'new' })
        const before = node.getState()
        const cmd = chargeCommand(content, step, cmdId)
        const r = node.dispatch(cmd)
        if (!r.ok) {
          countRefusal(r.error.code)
          // A refused code changes nothing and is not logged.
          expect(node.events().filter((e) => e.cmdId === cmdId)).toHaveLength(0)
          expect(node.log().some((l) => 'cmd' in l && l.cmd === cmd)).toBe(false)
          break
        }
        stats.charges++
        const created = r.value.filter((e) => e.type === 'request.created')
        expect(created).toHaveLength(1)
        // The merchant's earlier codes that are still good are cancelled in the same batch, before
        // the new one; one that ran out keeps its status.
        const open = posCodes(before)
          .filter(
            (c) =>
              c.requester === cmd.actor &&
              c.status === 'open' &&
              node.now() < c.createdAt + before.config.posCodeValidityMs,
          )
          .map((c) => c.id)
        const cancelled = r.value.flatMap((e) => (e.type === 'request.status' ? [e.requestId] : []))
        expect([...cancelled].sort()).toEqual(open)
        stats.replacedCodes += open.length
        expect(r.value.at(-1)?.type).toBe('request.created')
        const code = (created[0] as Extract<LedgerEvent, { type: 'request.created' }>).request
        expect(code).toMatchObject({ requester: cmd.actor, channel: 'pos', status: 'open', policy: 'merchant' })
        expect(code.payer).toBeUndefined()
        break
      }
      case 'cancel-code': {
        const cmdId = ids.next({ kind: 'new' })
        const cmd = cancelCodeCommand(content, node.getState(), step, cmdId)
        const r = node.dispatch(cmd)
        if (!r.ok) {
          countRefusal(r.error.code)
          break
        }
        stats.cancels++
        expect(r.value).toHaveLength(1)
        expect(r.value[0]).toMatchObject({ type: 'request.status', status: 'cancelled' })
        break
      }
      case 'pay-code': {
        const cmdId = ids.next({ kind: 'new' })
        const cmd = payCodeCommand(content, node.getState(), step, cmdId)
        if (!cmd) break
        const r = node.dispatch(cmd)
        if (!r.ok) {
          const why = r.error.status ? `${r.error.code}:${r.error.status}` : r.error.code
          stats.codesRefused.set(why, (stats.codesRefused.get(why) ?? 0) + 1)
          countRefusal(r.error.code)
          break
        }
        stats.codesPaid++
        const tx = (r.value[0] as Extract<LedgerEvent, { type: 'tx.submitted' }>).tx
        expect(tx).toMatchObject({ kind: 'purchase', channel: 'qr' })
        expect(tx.fee.fee).toBe(onePercent(cmd.amount))
        expect(tx.fee.payer).toBe('recipient')
        expect(tx.fee.senderDebit).toBe(cmd.amount)
        expect(node.getState().requests[cmd.requestId ?? '']).toMatchObject({ status: 'paid', txId: tx.id })
        break
      }
      case 'ask': {
        const cmd = askCommand(content, step, ids.next({ kind: 'new' }))
        const before = node.getState()
        const r = node.dispatch(cmd)
        if (!r.ok) {
          countRefusal(r.error.code)
          expect(node.events().filter((e) => e.cmdId === cmd.cmdId)).toHaveLength(0)
          expect(node.log().some((l) => 'cmd' in l && l.cmd === cmd)).toBe(false)
          expect(node.getState().counters.requestSeq).toBe(before.counters.requestSeq)
          break
        }
        stats.asks++
        expect(r.value).toHaveLength(1)
        const request = (r.value[0] as Extract<LedgerEvent, { type: 'request.created' }>).request
        expect(request).toMatchObject({
          requester: cmd.actor,
          channel: 'username',
          status: 'open',
          feePayer: 'sender',
          policy: 'transfer',
        })
        expect(request.amount).toBe(cmd.type === 'request.create' ? cmd.amount : Number.NaN)
        // Between people only: a person asks a person other than themselves.
        expect(before.directory[cmd.actor]?.kind).toBe('person')
        expect(before.directory[request.payer ?? '']?.kind).toBe('person')
        expect(request.payer).not.toBe(cmd.actor)
        break
      }
      case 'answer': {
        const cmd = answerCommand(content, node.getState(), step, ids.next({ kind: 'new' }))
        if (!cmd) break
        const before = node.getState()
        const r = node.dispatch(cmd)
        if (!r.ok) {
          countRefusal(r.error.code)
          expect(node.events().filter((e) => e.cmdId === cmd.cmdId)).toHaveLength(0)
          expect(JSON.stringify(node.getState().requests)).toBe(JSON.stringify(before.requests))
          break
        }
        if (cmd.type === 'pay') {
          stats.requestsPaid++
          const tx = (r.value[0] as Extract<LedgerEvent, { type: 'tx.submitted' }>).tx as Tx
          expect(tx.fee.fee).toBe(onePercent(cmd.amount))
          expect(tx.fee.senderDebit).toBe(cmd.expect.senderDebit)
          expect(tx.fee.payer).toBe(before.requests[cmd.requestId ?? '']?.feePayer)
        } else if (cmd.type === 'request.decline' || cmd.type === 'request.cancel') {
          expect(r.value).toHaveLength(1)
          const e = r.value[0] as Extract<LedgerEvent, { type: 'request.status' }>
          expect(e.type).toBe('request.status')
          if (cmd.type === 'request.decline') {
            stats.declines++
            expect(e.status).toBe('declined')
            expect(before.requests[cmd.requestId]?.payer).toBe(cmd.actor)
          } else {
            stats.requestCancels++
            expect(e.status).toBe('cancelled')
            expect(before.requests[cmd.requestId]?.requester).toBe(cmd.actor)
          }
          expect(before.requests[cmd.requestId]?.status).toBe('open')
        }
        break
      }
      case 'link': {
        const before = node.getState()
        const cmd = linkCommand(content, before, step, ids.next({ kind: 'new' }))
        if (!cmd) break
        const r = node.dispatch(cmd)
        if (!r.ok) {
          countRefusal(r.error.code)
          expect(node.events().filter((e) => e.cmdId === cmd.cmdId)).toHaveLength(0)
          expect(JSON.stringify(node.getState().links)).toBe(JSON.stringify(before.links))
          break
        }
        const after = node.getState()
        if (cmd.type === 'link.create') {
          stats.linksMade++
          expect(r.value.map((e) => e.type)).toEqual(['link.created'])
          const link = (r.value[0] as Extract<LedgerEvent, { type: 'link.created' }>).link
          expect(link).toMatchObject({
            owner: cmd.actor,
            amount: cmd.amount,
            reusable: false,
            policy: 'transfer',
            feePayer: 'sender',
            status: 'open',
          })
          expect(before.directory[cmd.actor]?.kind).toBe('person')
        } else if (cmd.type === 'link.share') {
          stats.linksShared++
          expect(r.value.map((e) => e.type)).toEqual(['link.shared'])
          const link = after.links[cmd.linkId]
          expect(link?.owner).toBe(cmd.actor)
          expect(link?.sharedWith).toHaveLength((before.links[cmd.linkId]?.sharedWith.length ?? -1) + 1)
          expect(link?.sharedWith).not.toContain(cmd.actor)
        } else if (cmd.type === 'pay') {
          stats.linksPaid++
          const tx = (r.value[0] as Extract<LedgerEvent, { type: 'tx.submitted' }>).tx as Tx
          expect(tx.channel).toBe('link')
          expect(tx.fee.fee).toBe(onePercent(cmd.amount))
          expect(tx.fee.payer).toBe('sender')
          expect(tx.fee.senderDebit).toBe(cmd.expect.senderDebit)
          expect(after.links[cmd.linkId ?? '']).toMatchObject({ status: 'paid', payments: [tx.id] })
          expect(before.links[cmd.linkId ?? '']?.owner).not.toBe(cmd.actor)
        }
        break
      }
      case 'split': {
        const before = node.getState()
        const cmd = splitCommand(content, before, step, ids.next({ kind: 'new' }))
        if (!cmd) break
        const r = node.dispatch(cmd)
        if (!r.ok) {
          countRefusal(r.error.code)
          expect(node.events().filter((e) => e.cmdId === cmd.cmdId)).toHaveLength(0)
          expect(JSON.stringify(node.getState().splits)).toBe(JSON.stringify(before.splits))
          expect(JSON.stringify(node.getState().requests)).toBe(JSON.stringify(before.requests))
          break
        }
        const after = node.getState()
        if (cmd.type === 'split.create') {
          stats.splitsMade++
          const events = r.value
          expect(events[0]?.type).toBe('split.created')
          expect(events.slice(1).every((e) => e.type === 'request.created')).toBe(true)
          const split = (events[0] as Extract<LedgerEvent, { type: 'split.created' }>).split
          expect(events).toHaveLength(1 + cmd.shares.length)
          const sum = cmd.shares.reduce((acc, sh) => acc + sh.amount, 0)
          expect(sum).toBeLessThanOrEqual(cmd.total)
          expect(split.ownShare).toBe(cmd.total - sum)
          expect(split.owner).toBe(cmd.actor)
          for (const sh of split.shares) {
            expect(after.requests[sh.requestId]).toMatchObject({
              status: 'open',
              channel: 'split',
              splitId: split.id,
              payer: sh.party,
              amount: sh.amount,
              feePayer: 'sender',
            })
            expect(after.directory[sh.party]?.kind).toBe('person')
            expect(sh.party).not.toBe(cmd.actor)
          }
          if (cmd.sourceTxId !== undefined) {
            expect(before.txs[cmd.sourceTxId]?.from).toBe(cmd.actor)
            expect(before.txs[cmd.sourceTxId]?.refundedBy).toBeUndefined()
          }
        } else if (cmd.type === 'split.reask') {
          stats.splitsReasked++
          expect(r.value.map((e) => e.type)).toEqual(['request.created', 'split.share-updated'])
          const updated = r.value[1] as Extract<LedgerEvent, { type: 'split.share-updated' }>
          const oldShare = before.splits[cmd.splitId]?.shares.find((sh) => sh.party === updated.party)
          expect(['declined', 'cancelled']).toContain(before.requests[oldShare?.requestId ?? '']?.status)
          expect(after.requests[updated.requestId]?.status).toBe('open')
          expect(after.splits[cmd.splitId]?.shares.find((sh) => sh.party === updated.party)?.requestId).toBe(
            updated.requestId,
          )
        } else if (cmd.type === 'split.cancel') {
          stats.splitsCancelled++
          const open = (before.splits[cmd.splitId]?.shares ?? [])
            .filter((sh) => before.requests[sh.requestId]?.status === 'open')
            .map((sh) => sh.requestId)
          expect(r.value.map((e) => (e.type === 'request.status' ? e.requestId : e.type))).toEqual(open)
          for (const id of open) expect(after.requests[id]?.status).toBe('cancelled')
        }
        break
      }
      case 'ramp': {
        const before = node.getState()
        const cmd = rampCommand(content, before, step, ids.next({ kind: 'new' }))
        const r = node.dispatch(cmd)
        if (!r.ok) {
          countRefusal(r.error.code)
          expect(node.events().filter((e) => e.cmdId === cmd.cmdId)).toHaveLength(0)
          expect(JSON.stringify(node.getState().ramps)).toBe(JSON.stringify(before.ramps))
          break
        }
        const party = before.directory[cmd.actor]
        if (cmd.type === 'ramp.on') {
          // A method that is on file, whole euros within the limit, no fee, 1.10 BCPS per euro.
          if (cmd.method === 'card') expect(party?.methods?.card).toBe(true)
          if (cmd.method === 'bank-transfer') expect(party?.methods?.bank).toBe(true)
          expect(cmd.eur).toBeGreaterThanOrEqual(1)
          expect(cmd.eur).toBeLessThanOrEqual(party?.kind === 'business' ? 100_000 : 10_000)
          if (cmd.method === 'bank-transfer') {
            stats.topUpsRequested++
            expect(r.value.map((e) => e.type)).toEqual(['ramp.requested'])
            const ramp = (r.value[0] as Extract<LedgerEvent, { type: 'ramp.requested' }>).ramp
            expect(ramp.arrivesAt).toBeGreaterThan(node.now())
            expect(ramp.amount).toBe(cmd.eur * 110)
          } else {
            stats.topUpsPaidIn++
            expect(r.value.map((e) => e.type)).toEqual(['tx.submitted', 'ramp.completed'])
            const tx = (r.value[0] as Extract<LedgerEvent, { type: 'tx.submitted' }>).tx as Tx
            expect(tx).toMatchObject({ kind: 'on-ramp', from: 'sys:issuance', to: cmd.actor, amount: cmd.eur * 110 })
            expect(tx.fee.fee).toBe(0)
          }
        } else if (cmd.type === 'ramp.off') {
          stats.cashOuts++
          expect(party?.methods?.bank).toBe(true)
          expect(cmd.amount).toBeGreaterThanOrEqual(before.config.limits.cashOutMin)
          const tx = (r.value[0] as Extract<LedgerEvent, { type: 'tx.submitted' }>).tx as Tx
          // D29: 1.5 % of the amount, round half-up; the euros are the remainder at 10 per 11.
          const fee = Math.floor((cmd.amount * 150 * 2 + 10_000) / 20_000)
          expect(tx.fee.fee).toBe(fee)
          expect(tx.fee.recipientCredit).toBe(cmd.amount - fee)
          expect(tx.fee.eurOut).toBe(Math.floor(((cmd.amount - fee) * 10 * 2 + 11) / 22))
          expect(tx).toMatchObject({ kind: 'off-ramp', from: cmd.actor, to: 'sys:issuance' })
        }
        break
      }
      case 'advance':
        node.clock.advance(step.ms)
        break
      case 'fire':
        node.clock.advance(step.ms)
        time.fireNext()
        break
      case 'catch-up':
        node.run(node.now(), 'catch-up')
        break
      case 'jump': {
        stats.jumps++
        const pending = node.hasPending()
        const r = node.jump((node.now() + step.ms) as SimTime)
        expect(r.ok).toBe(!pending)
        if (!r.ok) {
          stats.jumpsRefused++
          expect(r.error).toBe('pending')
        }
        break
      }
      case 'jump-back': {
        const now = node.now()
        const r = node.jump((now - step.ms) as SimTime)
        expect(r.ok).toBe(false)
        expect(node.now()).toBe(now)
        break
      }
      case 'reset':
      case 'undo':
        break // runtime-level steps (tests/property/runtime.property.test.ts)
    }
  }
  expect(problems).toEqual([])

  // The live session's due work up to now, as the record's clock implies.
  node.run(node.now(), 'catch-up')
  const rec = snapshotRecord({
    node,
    meta: { stateVersion: STATE_VERSION, build: 'dev', t0Date: seed.t0Date },
    ui: freshUi(),
    writerEpoch: 1,
    encoder: createLogEncoder(),
  })
  if (!rec.ok) throw new Error(`snapshot: ${rec.error}`)
  const record = serializeRecord(rec.value)

  // Headless replay of the stored log: the same bytes as the live session, and again.
  const input = {
    seed: seed.state,
    t0: seed.t0,
    t0Date: seed.t0Date,
    content,
    log: rec.value.log,
    clock: rec.value.clock,
  }
  const r1 = replay(input)
  if (!r1.ok) throw new Error(`replay: ${JSON.stringify(r1.error)}`)
  expect(JSON.stringify(r1.value.state)).toBe(JSON.stringify(node.getState()))
  expect(JSON.stringify(r1.value.events)).toBe(JSON.stringify(node.events()))
  expect(r1.value.clock).toBe(node.now())
  const r2 = replay(input)
  expect(r2.ok && JSON.stringify(r2.value.state)).toBe(JSON.stringify(r1.value.state))

  // Folding the events over the seed gives the same state (evolve is the only writer).
  let folded = seed.state
  for (const e of node.events()) folded = evolve(folded, e)
  expect(JSON.stringify(folded)).toBe(JSON.stringify(node.getState()))

  // The production restore path: parse, validate, replay, invariants, fingerprint.
  const restored = restoreText(record, { content }, { acceptOlder: false })
  if (!restored.ok) throw new Error(`restore: ${JSON.stringify(restored.error)}`)
  expect(restored.value.recalculated).toBe(false)
  expect(JSON.stringify(restored.value.session.state)).toBe(JSON.stringify(node.getState()))
  node.dispose()
  return { state: node.getState(), events: node.events(), record }
}

describe('ledger properties over random A1 command sequences', () => {
  it(`invariants after every event; live equals replay (${RUNS} sequences)`, { timeout: TIMEOUT }, () => {
    fc.assert(
      fc.property(fc.constantFrom(...EPOCHS), sequenceArb(content), (epoch, steps) => {
        runSequence(epoch, steps)
      }),
      params(RUNS),
    )
    if (process.env.FC_STATS) {
      console.log(
        JSON.stringify({
          ...stats,
          refused: Object.fromEntries(stats.refused),
          codesRefused: Object.fromEntries(stats.codesRefused),
        }),
      )
    }
    // The generators reach both sides of every decision.
    expect(stats.accepted).toBeGreaterThan(RUNS)
    expect(stats.events).toBeGreaterThan(RUNS)
    for (const code of [
      'insufficient-funds',
      'unknown-recipient',
      'invalid-amount',
      'quote-changed',
      'duplicate',
      'not-allowed',
      'invalid-state',
      'self-payment',
    ]) {
      expect(stats.refused.get(code) ?? 0, code).toBeGreaterThan(0)
    }
    expect(stats.lunchPaid).toBeGreaterThan(0)
    // Payment codes: shown, replaced, cancelled and paid; and refused as expired, cancelled or paid.
    expect(stats.charges).toBeGreaterThan(0)
    expect(stats.replacedCodes).toBeGreaterThan(0)
    expect(stats.cancels).toBeGreaterThan(0)
    expect(stats.codesPaid).toBeGreaterThan(0)
    for (const why of ['invalid-state:paid', 'invalid-state:cancelled', 'invalid-state:expired']) {
      expect(stats.codesRefused.get(why) ?? 0, why).toBeGreaterThan(0)
    }
    // Requests between people: asked, declined, cancelled and paid.
    expect(stats.asks).toBeGreaterThan(0)
    expect(stats.declines).toBeGreaterThan(0)
    expect(stats.requestCancels).toBeGreaterThan(0)
    expect(stats.requestsPaid).toBeGreaterThan(0)
    // Payment links and splits.
    expect(stats.linksMade).toBeGreaterThan(0)
    expect(stats.linksShared).toBeGreaterThan(0)
    expect(stats.linksPaid).toBeGreaterThan(0)
    expect(stats.splitsMade).toBeGreaterThan(0)
    expect(stats.splitsReasked).toBeGreaterThan(0)
    expect(stats.splitsCancelled).toBeGreaterThan(0)
    // Top-ups (card or local paid in, bank transfers requested and arriving) and cash-outs.
    expect(stats.topUpsPaidIn).toBeGreaterThan(0)
    expect(stats.topUpsRequested).toBeGreaterThan(0)
    expect(stats.topUpsArrived).toBeGreaterThan(0)
    expect(stats.cashOuts).toBeGreaterThan(0)
    expect(stats.jumpsRefused).toBeGreaterThan(0)
    expect(stats.jumps).toBeGreaterThan(stats.jumpsRefused)
  })

  it('the same sequence gives the same bytes on every run (determinism)', { timeout: TIMEOUT }, () => {
    fc.assert(
      fc.property(fc.constantFrom(...EPOCHS), sequenceArb(content, {}, 30), (epoch, steps) => {
        const a = runSequence(epoch, steps)
        const b = runSequence(epoch, steps)
        expect(b.record).toBe(a.record)
        expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state))
      }),
      params(Math.max(20, Math.floor(RUNS / 5))),
    )
  })
})
