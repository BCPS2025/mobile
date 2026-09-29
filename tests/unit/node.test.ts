import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import { formatHundredths } from '@domain/money'
import type { DueItem, LedgerState, SimTime, Tx, UserCommand } from '@domain/types'
import { KIND_RANK, MAX_TIMER_MS, compareDue, nextDue, runDue, timerDelay } from '@sim/scheduler'
import { buildSeed } from '@sim/seed'
import { CMD_ID, cmdIdFor, newFlowInstanceId } from '@store/cmdIds'
import { type AppliedBatch, createLedgerNode } from '@store/node'
import { createNavStore } from '@store/nav'
import { EPOCH, content, m } from './helpers'

// The node after E3, E8, E9 and E12; the scheduler core; command ids; the nav store.

const seed = buildSeed(content, EPOCH)
let k = 0
const id = () => `${(++k).toString(16).padStart(16, '0')}:review`

const sale = (amount = '11.00'): UserCommand => ({
  type: 'pay',
  actor: 'ana',
  cmdId: id(),
  to: '@cafelipa',
  amount: m(amount),
  channel: 'qr',
  expect: { senderDebit: m(amount) },
})
const send = (amount: string, debit: string): UserCommand => ({
  type: 'pay',
  actor: 'ana',
  cmdId: id(),
  to: '@marko',
  amount: m(amount),
  channel: 'username',
  expect: { senderDebit: m(debit) },
})

function fakeTimers() {
  const queue: { fn: () => void; ms: number; cleared: boolean }[] = []
  return {
    queue,
    live: () => queue.filter((h) => !h.cleared),
    timers: {
      set: (fn: () => void, ms: number) => {
        const h = { fn, ms, cleared: false }
        queue.push(h)
        return h
      },
      clear: (h: unknown) => {
        ;(h as { cleared: boolean }).cleared = true
      },
    },
  }
}

describe('LedgerNode', () => {
  it('dispatch -> decide -> evolve -> notify, with the command logged at the clock time', () => {
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    let notified = 0
    node.subscribe(() => {
      notified += 1
    })
    const c = sale()
    const r = node.dispatch(c)
    expect(r.ok).toBe(true)
    expect(notified).toBeGreaterThan(0)
    expect(node.events().map((e) => e.seq)).toEqual([1])
    expect(node.events()[0]?.cmdId).toBe(c.cmdId)
    expect(node.commands()).toEqual([{ at: seed.t0, actor: 'ana', cmdId: c.cmdId, cmd: c }])
    expect(node.hasPending()).toBe(true)
    node.settleDue()
    expect(node.hasPending()).toBe(false)
    expect(node.now()).toBe(seed.t0 + 1400)
    expect(node.events().map((e) => e.type)).toEqual(['tx.submitted', 'tx.confirmed'])
    expect(node.events()[1]?.cmdId).toBeUndefined()
    expect(node.commands()).toHaveLength(1) // scheduler work is never logged
  })

  it('a failed command changes nothing and is not logged', () => {
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    const before = node.getState()
    const r = node.dispatch({ ...sale(), to: '@ana', expect: { senderDebit: m('11.11') } })
    expect(r.ok).toBe(false)
    expect(node.getState()).toBe(before)
    expect(node.events()).toHaveLength(0)
    expect(node.commands()).toHaveLength(0)
  })

  it('E1: a double tap (same cmdId) is refused as duplicate', () => {
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    const c = sale()
    expect(node.dispatch(c).ok).toBe(true)
    expect(node.dispatch(c)).toEqual({ ok: false, error: { code: 'duplicate' } })
    expect(node.commands()).toHaveLength(1)
  })

  it('E1: two phones commit at the same instant with their own ids; a refused id is retried later', () => {
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    const left = cmdIdFor(newFlowInstanceId(), 'review')
    const right = cmdIdFor(newFlowInstanceId(), 'review')
    expect(node.dispatch({ ...sale(), cmdId: left }).ok).toBe(true)
    const toBakery: UserCommand = {
      type: 'pay',
      actor: 'cafe',
      cmdId: right,
      to: '@pekarnazrno',
      amount: m('8.80'),
      channel: 'username',
      expect: { senderDebit: m('8.89') },
    }
    expect(node.dispatch(toBakery).ok).toBe(true)
    expect(node.commands().map((c) => c.at)).toEqual([seed.t0, seed.t0])
    // The bakery cannot pay yet; once the café's payment has settled the same id goes through.
    const onward: UserCommand = {
      ...toBakery,
      actor: 'bakery',
      cmdId: cmdIdFor(newFlowInstanceId(), 'review'),
      to: '@cafelipa',
      amount: m('5.00'),
      expect: { senderDebit: m('5.05') },
    }
    expect(node.dispatch(onward)).toMatchObject({ ok: false, error: { code: 'insufficient-funds' } })
    node.clock.advance(2000)
    expect(node.dispatch(onward).ok).toBe(true)
  })

  it('E3: commands are stamped with the current virtual clock', () => {
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    node.clock.advance(45_000)
    const r = node.dispatch(sale())
    expect(r.ok && r.value[0]?.at).toBe(seed.t0 + 45_000)
    expect(node.commands()[0]?.at).toBe(seed.t0 + 45_000)
  })

  it('E9: due work runs before a command is decided, each item at its own time (catch-up)', () => {
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    const batches: AppliedBatch[] = []
    node.onBatch((b) => batches.push(b))
    // The café pays the bakery (which starts at 0.00); a minute later the bakery pays 5.00 on.
    // The bakery's money only exists once the first payment has settled, so the second command
    // is accepted only because the settle ran first (at t0 + 1400), before the decision.
    const bakery = (actor: string, to: `@${string}`, amount: string, debit: string): UserCommand => ({
      type: 'pay',
      actor,
      cmdId: id(),
      to,
      amount: m(amount),
      channel: 'username',
      expect: { senderDebit: m(debit) },
    })
    node.dispatch(bakery('cafe', '@pekarnazrno', '8.80', '8.89'))
    node.clock.jumpTo((seed.t0 + 60_000) as SimTime)
    const r = node.dispatch(bakery('bakery', '@cafelipa', '5.00', '5.05'))
    expect(r.ok).toBe(true)
    const confirmed = node.events().find((e) => e.type === 'tx.confirmed')
    expect(confirmed?.at).toBe(seed.t0 + 1400)
    expect(batches.map((b) => [b.origin, b.events.map((e) => e.type)])).toEqual([
      ['user', ['tx.submitted']],
      ['catch-up', ['tx.confirmed']],
      ['user', ['tx.submitted']],
    ])
  })

  it('E9: sys.run runs the scheduler up to `until` and is never logged', () => {
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    node.dispatch(sale())
    node.clock.jumpTo((seed.t0 + 5000) as SimTime)
    const r = node.dispatch({ type: 'sys.run', until: (seed.t0 + 1399) as SimTime })
    expect(r.ok && r.value).toEqual([])
    const r2 = node.dispatch({ type: 'sys.run', until: (seed.t0 + 1400) as SimTime })
    expect(r2.ok && r2.value.map((e) => e.type)).toEqual(['tx.confirmed'])
    expect(node.commands()).toHaveLength(1)
  })

  it('E9: sys.run never runs due work ahead of the clock (live equals replay)', () => {
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    node.dispatch(sale())
    const r = node.dispatch({ type: 'sys.run', until: (seed.t0 + 1400) as SimTime })
    expect(r.ok && r.value).toEqual([])
    expect(node.now()).toBe(seed.t0)
    expect(node.hasPending()).toBe(true)
    expect(node.run((seed.t0 + 60_000) as SimTime)).toEqual([])
    expect(node.hasPending()).toBe(true)
    node.clock.jumpTo((seed.t0 + 1400) as SimTime)
    expect(node.run((seed.t0 + 60_000) as SimTime).map((e) => [e.type, e.at])).toEqual([
      ['tx.confirmed', seed.t0 + 1400],
    ])
  })

  it('E9: advanceTo moves forward only and runs what fell due (origin jump)', () => {
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    const origins: string[] = []
    node.onBatch((b) => origins.push(b.origin))
    node.dispatch(sale())
    const applied = node.advanceTo((seed.t0 + 3_600_000) as SimTime)
    expect(applied.map((e) => [e.type, e.at])).toEqual([['tx.confirmed', seed.t0 + 1400]])
    expect(origins).toEqual(['user', 'jump'])
    expect(() => node.advanceTo(seed.t0)).toThrow()
  })

  it('arms one timer for the next due item, capped at 60 s, and ignores stale generations', () => {
    const t = fakeTimers()
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0, timers: t.timers })
    const origins: string[] = []
    node.onBatch((b) => origins.push(b.origin))
    node.dispatch(sale())
    expect(t.live()).toHaveLength(1)
    expect(t.live()[0]?.ms).toBe(1400)
    t.live()[0]?.fn()
    expect(node.hasPending()).toBe(false)
    expect(node.now()).toBe(seed.t0 + 1400)
    expect(formatHundredths(node.getState().balances.cafe?.confirmed ?? -1)).toBe('296.89')
    expect(origins).toEqual(['user', 'timer'])
    expect(t.queue).toHaveLength(1) // nothing left to wait for, so no new timer

    node.dispatch(sale('1.10'))
    const stale = t.queue[t.queue.length - 1]
    node.resetToSeed()
    stale?.fn()
    expect(node.events()).toHaveLength(0)
  })

  it('E8: resetToSeed + undoReset replace checkpoints; undo is dropped by the next command', () => {
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    node.dispatch(sale())
    node.settleDue()
    const after = node.getState()
    const g = node.generation()
    node.resetToSeed()
    expect(node.generation()).toBe(g + 1)
    expect(node.getState()).toBe(seed.state)
    expect(node.events()).toHaveLength(0)
    expect(node.now()).toBe(seed.t0)
    expect(node.canUndoReset()).toBe(true)
    expect(node.undoReset()).toBe(true)
    expect(node.getState()).toBe(after)
    expect(node.commands()).toHaveLength(1)
    expect(node.now()).toBe(seed.t0 + 1400)
    expect(node.undoReset()).toBe(false)

    node.resetToSeed()
    node.dispatch(sale())
    expect(node.canUndoReset()).toBe(false)
  })

  it('E8: Reset can start from a recomputed seed (T0 of another Friday)', () => {
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    node.dispatch(sale())
    const other = buildSeed(content, '2026-10-30')
    node.resetToSeed({ seed: other.state, t0: other.t0 })
    expect(node.t0()).toBe(other.t0)
    expect(node.seedState()).toBe(other.state)
    expect(node.now()).toBe(other.t0)
    node.undoReset()
    expect(node.t0()).toBe(seed.t0)
  })

  it('invariants hold after every event of a mixed session', () => {
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    const problems: string[] = []
    node.onEvent((_e, s) => problems.push(...invariants(s)))
    node.dispatch(sale())
    node.clock.advance(500)
    node.dispatch(send('16.50', '16.67'))
    node.clock.advance(500)
    node.dispatch({
      type: 'pay',
      actor: 'ana',
      cmdId: id(),
      to: '@marko',
      amount: m('13.20'),
      channel: 'request',
      requestId: 'r_seed_lunch',
      expect: { senderDebit: m('13.33') },
    })
    node.settleDue()
    expect(problems).toEqual([])
    expect(formatHundredths(node.getState().balances.ana?.confirmed ?? -1)).toBe('206.50')
  })
})

describe('scheduler', () => {
  const item = (over: Partial<DueItem>): DueItem => ({
    kind: 'settle',
    dueAt: 1000 as SimTime,
    persona: 'ana',
    entityId: 'BC-000001',
    ...over,
  })

  it('total order: dueAt, kind rank, persona, entity', () => {
    const items = [
      item({ kind: 'auto-convert', persona: 'studio' }),
      item({ kind: 'auto-convert', persona: 'cafe' }),
      item({ kind: 'settle', entityId: 'BC-00000B' }),
      item({ kind: 'settle', entityId: 'BC-00000A' }),
      item({ dueAt: 999 as SimTime, kind: 'background' }),
      item({ kind: 'escrow-deadline' }),
      item({ kind: 'ramp-arrival' }),
    ]
    const sorted = [...items].sort(compareDue).map((i) => `${i.dueAt}/${i.kind}/${i.persona}/${i.entityId}`)
    expect(sorted).toEqual([
      '999/background/ana/BC-000001',
      '1000/settle/ana/BC-00000A',
      '1000/settle/ana/BC-00000B',
      '1000/ramp-arrival/ana/BC-000001',
      '1000/escrow-deadline/ana/BC-000001',
      '1000/auto-convert/cafe/BC-000001',
      '1000/auto-convert/studio/BC-000001',
    ])
    expect(KIND_RANK.settle).toBeLessThan(KIND_RANK['auto-convert'])
  })

  function pendingState(): LedgerState {
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    node.dispatch(sale())
    node.clock.advance(100)
    node.dispatch(send('1.00', '1.01'))
    return node.getState()
  }

  it('nextDue picks the earliest item at or before `until`; runDue runs them one at a time', () => {
    const s = pendingState()
    expect(nextDue(s, (seed.t0 + 1399) as SimTime)).toBeNull()
    expect(nextDue(s, (seed.t0 + 5000) as SimTime)?.dueAt).toBe(seed.t0 + 1400)
    const order: number[] = []
    runDue(s, (seed.t0 + 5000) as SimTime, (it, events, st) => {
      order.push(it.dueAt)
      expect(events).toHaveLength(1)
      const tx = st.txs[it.entityId] as Tx
      return { ...st, txs: { ...st.txs, [it.entityId]: { ...tx, status: 'confirmed' } } }
    })
    expect(order).toEqual([seed.t0 + 1400, seed.t0 + 1500])
  })

  it('stops at the iteration cap instead of looping', () => {
    const s = pendingState()
    expect(() => runDue(s, (seed.t0 + 5000) as SimTime, (_it, _e, st) => st, 5)).toThrow(/stopped after/)
  })

  it('timer delays are never negative and never above 60 s', () => {
    const s = pendingState()
    expect(timerDelay(s, seed.t0)).toBe(1400)
    expect(timerDelay(s, (seed.t0 + 9999) as SimTime)).toBe(0)
    expect(timerDelay(seed.state, seed.t0)).toBeNull()
    const far = {
      ...s,
      txs: Object.fromEntries(
        Object.entries(s.txs).map(([k2, tx]) => [
          k2,
          tx.status === 'pending' ? { ...tx, dueAt: (seed.t0 + 45 * 86_400_000) as SimTime } : tx,
        ]),
      ),
    }
    expect(timerDelay(far, seed.t0)).toBe(MAX_TIMER_MS)
  })
})

describe('command ids and navigation', () => {
  it('flow instance ids are 64 random bits; cmdId = instance:step', () => {
    const a = newFlowInstanceId()
    const b = newFlowInstanceId()
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(a).not.toBe(b)
    const fixed = newFlowInstanceId((bytes) => bytes.fill(0xab))
    expect(fixed).toBe('abababababababab')
    expect(cmdIdFor(fixed, 'review')).toBe('abababababababab:review')
    expect(CMD_ID.test('abababababababab:review')).toBe(true)
    expect(() => cmdIdFor('xyz', 'review')).toThrow()
  })

  it('the nav store keeps one stack per key, outside the ledger node', () => {
    const nav = createNavStore()
    let changes = 0
    nav.subscribe(() => {
      changes += 1
    })
    nav.set('ana', ['home', 'hub:payRequest'])
    expect(nav.stack('ana')).toEqual(['home', 'hub:payRequest'])
    expect(nav.stack('cafe')).toEqual([])
    nav.clear()
    expect(nav.get()).toEqual({})
    expect(changes).toBe(2)
  })

  it('the nav store holds any screen type and replaces every stack at once', () => {
    type Screen = { kind: 'home' } | { kind: 'hub'; id: string }
    const nav = createNavStore<Screen>({ ana: [{ kind: 'home' }] })
    let changes = 0
    nav.subscribe(() => {
      changes += 1
    })
    nav.replaceAll({ cafe: [{ kind: 'home' }, { kind: 'hub', id: 'sales' }] })
    expect(nav.stack('ana')).toEqual([])
    expect(nav.stack('cafe')).toHaveLength(2)
    expect(changes).toBe(1)
  })
})
