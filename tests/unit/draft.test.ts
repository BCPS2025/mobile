import { describe, expect, it } from 'vitest'
import { applyToDraft, beginDraft, decide, decideDue, dueWork, evolve, finishDraft } from '@domain/ledger'
import type { LedgerEvent, LedgerState, PendingEvent, SimTime, UserCommand } from '@domain/types'
import { buildSeed } from '@sim/seed'
import { EPOCH, content, m } from './helpers'

// evolve is copy on write; a replay draft applies the same events in place.

const seed = buildSeed(content, EPOCH)
let k = 0
const pay = (
  actor: string,
  to: `@${string}`,
  amount: string,
  debit: string,
  extra: Partial<UserCommand> = {},
): UserCommand => ({
  type: 'pay',
  actor,
  cmdId: `${(++k).toString(16).padStart(16, '0')}:review`,
  to,
  amount: m(amount),
  channel: 'username',
  expect: { senderDebit: m(debit) },
  ...extra,
})

/** A session of events built with the pure evolve. */
function session(): { events: LedgerEvent[]; end: LedgerState } {
  let s = seed.state
  const events: LedgerEvent[] = []
  const push = (p: PendingEvent[], at: number) => {
    for (const e of p) {
      const ev = { ...e, seq: s.seq + 1, at: at as SimTime } as LedgerEvent
      s = evolve(s, ev)
      events.push(ev)
    }
  }
  const cmds = [
    pay('ana', '@cafelipa', '11.00', '11.00', { channel: 'qr' }),
    pay('ana', '@marko', '13.20', '13.33', { channel: 'request', requestId: 'r_seed_lunch' }),
    pay('cafe', '@pekarnazrno', '8.80', '8.89'),
  ]
  let now = seed.t0 as number
  for (const c of cmds) {
    const r = decide(s, c, { now: now as SimTime })
    if (!r.ok) throw new Error(r.error.code)
    push(r.value, now)
    now += 500
  }
  for (const item of dueWork(s)) push(decideDue(s, item), item.dueAt)
  return { events, end: s }
}

describe('ledger draft', () => {
  it('evolve copies only what an event touches and never writes its input', () => {
    const before = JSON.stringify(seed.state)
    const { events } = session()
    const first = events[0] as LedgerEvent
    const next = evolve(seed.state, first)
    expect(JSON.stringify(seed.state)).toBe(before)
    expect(next.txs).not.toBe(seed.state.txs)
    expect(next.directory).toBe(seed.state.directory)
    expect(next.links).toBe(seed.state.links)
    expect(next.requests).toBe(seed.state.requests)
  })

  it('a draft reaches byte-identical state to the pure fold, without touching the seed', () => {
    const before = JSON.stringify(seed.state)
    const { events, end } = session()
    const d = beginDraft(seed.state)
    for (const e of events) applyToDraft(d, e)
    const out = finishDraft(d)
    expect(JSON.stringify(out)).toBe(JSON.stringify(end))
    expect(JSON.stringify(seed.state)).toBe(before)
    expect(out.requests.r_seed_lunch?.status).toBe('paid')
    expect(seed.state.requests.r_seed_lunch?.status).toBe('open')
  })

  it('a finished draft cannot be written again', () => {
    const { events } = session()
    const d = beginDraft(seed.state)
    finishDraft(d)
    expect(() => applyToDraft(d, events[0] as LedgerEvent)).toThrow(/finished/)
  })
})
