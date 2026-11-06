import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import { available, decide, decideDue, dueHeads, dueWork, evolve, selectParty } from '@domain/ledger'
import { formatHundredths } from '@domain/money'
import type {
  Command,
  LedgerEvent,
  LedgerState,
  Minor,
  PaymentLink,
  PaymentRequest,
  PendingEvent,
  SimTime,
} from '@domain/types'
import { buildSeed } from '@sim/seed'
import { EPOCH, content, m } from './helpers'

// decide/evolve for `pay` after the A1 refactors, fees per D29 (1 %).

const seed = buildSeed(content, EPOCH)

type PayCommand = Extract<Command, { type: 'pay' }>
let n = 0
const nextCmdId = () => `${(++n).toString(16).padStart(16, '0')}:review`

function pay(
  actor: string,
  to: `@${string}`,
  amount: string,
  debit: string = amount,
  extra: Partial<PayCommand> = {},
): PayCommand {
  return {
    type: 'pay',
    actor,
    to,
    amount: m(amount),
    channel: 'qr',
    cmdId: nextCmdId(),
    expect: { senderDebit: m(debit) },
    ...extra,
  }
}

function stamp(s: LedgerState, events: PendingEvent[], now: number): LedgerState {
  return events.reduce<LedgerState>(
    (st, e, i) => evolve(st, { ...e, seq: s.seq + 1 + i, at: now as SimTime } as LedgerEvent),
    s,
  )
}

function run(s: LedgerState, c: Command, now: number = seed.t0): LedgerState {
  const r = decide(s, c, { now: now as SimTime })
  if (!r.ok) throw new Error(r.error.code)
  return stamp(s, r.value, now)
}

function settle(s: LedgerState, now: number): LedgerState {
  let st = s
  for (const item of dueWork(s)) if (item.dueAt <= now) st = stamp(st, decideDue(st, item), item.dueAt)
  return st
}

const reject = (c: Command, s: LedgerState = seed.state) => decide(s, c, { now: seed.t0 })
const lastTx = (s: LedgerState) => s.txs[s.txOrder[s.txOrder.length - 1] ?? '']

describe('decide pay', () => {
  it('submits a pending tx that holds the sender funds; the recipient sees nothing confirmed yet', () => {
    const s1 = run(seed.state, pay('ana', '@cafelipa', '11.00'))
    const tx = lastTx(s1)
    expect(tx?.status).toBe('pending')
    expect(tx?.dueAt).toBe(seed.t0 + 1400)
    expect(tx?.fee.policy).toBe('merchant')
    expect(tx?.fee.payer).toBe('recipient')
    expect(formatHundredths(s1.balances.ana?.held ?? -1)).toBe('11.00')
    expect(formatHundredths(available(s1, 'ana'))).toBe('236.50')
    expect(formatHundredths(s1.balances.cafe?.confirmed ?? -1)).toBe('286.00')
    expect(invariants(s1)).toEqual([])
  })

  it('the settle item confirms at dueAt, not before', () => {
    const s1 = run(seed.state, pay('ana', '@cafelipa', '11.00'))
    expect(settle(s1, seed.t0 + 1399)).toBe(s1)
    const s2 = settle(s1, seed.t0 + 1400)
    expect(formatHundredths(s2.balances.ana?.confirmed ?? -1)).toBe('236.50')
    expect(formatHundredths(s2.balances.cafe?.confirmed ?? -1)).toBe('296.89')
    expect(s2.balances.ana?.held).toBe(0)
    expect(lastTx(s2)?.status).toBe('confirmed')
    expect(lastTx(s2)?.confirmedAt).toBe(seed.t0 + 1400)
    expect(invariants(s2)).toEqual([])
  })

  it('supplier payments are transfers paid by the sender', () => {
    const s1 = run(seed.state, pay('cafe', '@pekarnazrno', '8.80', '8.89', { channel: 'username' }))
    const tx = lastTx(s1)
    expect(tx?.fee.policy).toBe('transfer')
    expect(formatHundredths(tx?.fee.fee ?? 0)).toBe('0.09')
    expect(formatHundredths(tx?.fee.senderDebit ?? 0)).toBe('8.89')
    expect(tx?.fee.card).toBeUndefined()
  })

  it('E3: the command is stamped with the virtual clock it is decided at', () => {
    const later = seed.t0 + 95_000
    const s1 = run(seed.state, pay('ana', '@cafelipa', '11.00'), later)
    expect(lastTx(s1)?.createdAt).toBe(later)
    expect(lastTx(s1)?.dueAt).toBe(later + 1400)
  })

  it('E4: the new transaction continues the scrambled reference sequence', () => {
    const s1 = run(seed.state, pay('ana', '@cafelipa', '11.00'))
    const s2 = run(s1, pay('ana', '@marko', '1.00', '1.01', { channel: 'username' }))
    const [a, b] = s2.txOrder.slice(-2)
    expect(a).toMatch(/^BC-[0-9A-HJKMNP-TV-Z]{6}$/)
    expect(b).toMatch(/^BC-[0-9A-HJKMNP-TV-Z]{6}$/)
    expect(a).not.toBe(b)
    expect(s2.counters.refSeq).toBeGreaterThan(seed.state.counters.refSeq)
    expect(new Set(s2.txOrder).size).toBe(s2.txOrder.length)
  })

  it('rejects self-payment', () => {
    expect(reject(pay('ana', '@ana', '1.00', '1.01'))).toEqual({ ok: false, error: { code: 'self-payment' } })
  })
  it('rejects unknown recipients', () => {
    expect(reject(pay('ana', '@anaa', '1.00'))).toEqual({
      ok: false,
      error: { code: 'unknown-recipient', handle: '@anaa' },
    })
  })
  it('rejects insufficient funds with what is missing', () => {
    const r = reject(pay('bakery', '@cafelipa', '1.00'))
    expect(r).toEqual({ ok: false, error: { code: 'insufficient-funds', have: 0, short: 100 } })
  })
  it('counts held funds against availability', () => {
    const s1 = run(seed.state, pay('ana', '@cafelipa', '240.00'))
    const r = reject(pay('ana', '@cafelipa', '7.51'), s1)
    expect(!r.ok && r.error.code).toBe('insufficient-funds')
  })
  it('has no minimum: a 0.49 sale carries fee 0.00, 0.50 carries 0.01, 0.01 is accepted', () => {
    const fee = (amount: string) => {
      const s1 = run(seed.state, pay('ana', '@cafelipa', amount))
      return [lastTx(s1)?.fee.fee, lastTx(s1)?.fee.recipientCredit].map((v) => formatHundredths(v ?? -1))
    }
    expect(fee('0.49')).toEqual(['0.00', '0.49'])
    expect(fee('0.50')).toEqual(['0.01', '0.49'])
    expect(fee('0.01')).toEqual(['0.00', '0.01'])
  })
  it('rejects non-positive and non-integer amounts', () => {
    expect(reject({ ...pay('ana', '@cafelipa', '1.00'), amount: 0 as Minor }).ok).toBe(false)
    expect(reject({ ...pay('ana', '@cafelipa', '1.00'), amount: 1.5 as Minor }).ok).toBe(false)
  })
  it('rejects items that do not add up to the amount', () => {
    const c = pay('ana', '@cafelipa', '11.00', '11.00', { items: [{ name: 'Flat white', qty: 2, price: m('3.30') }] })
    expect(reject(c)).toEqual({ ok: false, error: { code: 'invalid-amount' } })
  })
  it('applies the limits: people 999.99, businesses 99,999.99', () => {
    const rich = {
      ...seed.state,
      balances: { ...seed.state.balances, ana: { confirmed: m('5000.00'), held: 0 as Minor } },
    }
    expect(reject(pay('ana', '@marko', '1000.00', '1010.00', { channel: 'username' }), rich)).toEqual({
      ok: false,
      error: { code: 'invalid-amount', max: m('999.99') },
    })
    expect(reject(pay('ana', '@marko', '999.99', '1009.99', { channel: 'username' }), rich).ok).toBe(true)
    expect(reject(pay('firm', '@hanbit', '1100.00', '1111.00', { channel: 'username' })).ok).toBe(true)
    const r = reject(pay('firm', '@hanbit', '100000.00', '101000.00', { channel: 'username' }))
    expect(!r.ok && r.error).toEqual({ code: 'invalid-amount', max: m('99999.99') })
  })
})

describe('E1: command ids', () => {
  it('a repeated accepted cmdId is a duplicate and changes nothing', () => {
    const c = pay('ana', '@cafelipa', '11.00')
    const s1 = run(seed.state, c)
    expect(s1.seenCmdIds[c.cmdId]).toBe(true)
    expect(lastTx(s1)?.cmdId).toBe(c.cmdId)
    expect(reject(c, s1)).toEqual({ ok: false, error: { code: 'duplicate' } })
  })

  it('a rejected command can be retried with the same id (only accepted ids are recorded)', () => {
    const c = pay('bakery', '@marko', '1.00', '1.01', { channel: 'username' })
    expect(reject(c)).toMatchObject({ ok: false, error: { code: 'insufficient-funds' } })
    const funded = {
      ...seed.state,
      balances: { ...seed.state.balances, bakery: { confirmed: m('5.00'), held: 0 as Minor } },
    }
    expect(funded.seenCmdIds[c.cmdId]).toBeUndefined()
    expect(reject(c, funded).ok).toBe(true)
  })

  it('a missing or oversized cmdId is not allowed', () => {
    expect(reject({ ...pay('ana', '@cafelipa', '1.00'), cmdId: '' })).toEqual({
      ok: false,
      error: { code: 'not-allowed' },
    })
    expect(reject({ ...pay('ana', '@cafelipa', '1.00'), cmdId: 'x'.repeat(81) }).ok).toBe(false)
  })

  it('seenCmdIds is rebuilt from the events alone (replay)', () => {
    const c1 = pay('ana', '@cafelipa', '11.00')
    const c2 = pay('ana', '@marko', '1.00', '1.01', { channel: 'username' })
    const s2 = settle(run(run(seed.state, c1), c2), seed.t0 + 2000)
    expect(Object.keys(s2.seenCmdIds)).toEqual([c1.cmdId, c2.cmdId])
  })
})

describe('E2: actors', () => {
  it('only ledger personas act: system, the directory-only people and unknown ids are refused', () => {
    for (const actor of ['system', 'director', 'carrier-feed', '@marta_k', 'guest-1', 'sys:fees']) {
      expect(reject(pay(actor, '@cafelipa', '1.00'))).toEqual({ ok: false, error: { code: 'not-allowed' } })
    }
  })
})

describe('E5/E6: directory and sys:offstage', () => {
  it('selectParty resolves ids and handles, including off-stage people', () => {
    expect(selectParty(seed.state, 'cafe')?.handle).toBe('@cafelipa')
    expect(selectParty(seed.state, '@cafelipa')?.id).toBe('cafe')
    expect(selectParty(seed.state, '@marta_k')).toMatchObject({ displayName: 'Marta K.', offstage: true })
    expect(selectParty(seed.state, '@nobody')).toBeUndefined()
  })

  it('paying an off-stage person moves the money to sys:offstage and names the person', () => {
    const s1 = settle(
      run(seed.state, pay('ana', '@marta_k', '7.44', '7.51', { channel: 'username', note: 'Pizza' })),
      seed.t0 + 2000,
    )
    const tx = lastTx(s1)
    expect(tx?.to).toBe('sys:offstage')
    expect(tx?.party).toBe('@marta_k')
    expect(tx?.fee.policy).toBe('transfer')
    expect(tx?.postings.find((p) => p.account === 'sys:offstage')).toMatchObject({ delta: 744, party: '@marta_k' })
    expect(formatHundredths(s1.balances.ana?.confirmed ?? -1)).toBe('239.99')
    expect(invariants(s1)).toEqual([])
  })
})

describe('E7: merchant settings come from state', () => {
  it('flipping the café fee payer in state changes the quote', () => {
    const cafe = seed.state.merchant.cafe
    if (!cafe) throw new Error('no café settings')
    const flipped = {
      ...seed.state,
      merchant: { ...seed.state.merchant, cafe: { ...cafe, feePayer: 'sender' as const } },
    }
    const s1 = run(flipped, pay('ana', '@cafelipa', '13.20', '13.33'))
    expect(lastTx(s1)?.fee.payer).toBe('sender')
    expect(formatHundredths(lastTx(s1)?.fee.recipientCredit ?? 0)).toBe('13.20')
  })

  it('a QR payment to a business that is not a merchant is a transfer', () => {
    const s1 = run(seed.state, pay('firm', '@hanbit', '10.00', '10.10'))
    expect(lastTx(s1)?.fee.policy).toBe('transfer')
  })
})

describe('E10: pay validates requests and links', () => {
  const lunch = (over: Partial<PayCommand> = {}) =>
    pay('ana', '@marko', '13.20', '13.33', { channel: 'request', requestId: 'r_seed_lunch', ...over })

  it('paying the seeded Lunch request: Ana 234.17 (13.20 + 0.13), Marko 146.18, request paid', () => {
    const s1 = settle(run(seed.state, lunch()), seed.t0 + 2000)
    const tx = lastTx(s1)
    expect(tx?.links).toEqual({ requestId: 'r_seed_lunch' })
    expect(s1.requests.r_seed_lunch).toMatchObject({ status: 'paid', txId: tx?.id })
    expect(formatHundredths(s1.balances.ana?.confirmed ?? -1)).toBe('234.17')
    expect(formatHundredths(s1.balances.marko?.confirmed ?? -1)).toBe('146.18')
    expect(invariants(s1)).toEqual([])
  })

  it('a request that is already paid is invalid-state with its status', () => {
    const s1 = run(seed.state, lunch())
    expect(reject(lunch(), s1)).toEqual({ ok: false, error: { code: 'invalid-state', status: 'paid' } })
  })

  it('unknown request, wrong payer, wrong recipient and wrong amount are refused', () => {
    const r1 = reject(lunch({ requestId: 'r_missing' }))
    expect(!r1.ok && r1.error.code).toBe('invalid-state')
    const r2 = reject(pay('cafe', '@marko', '13.20', '13.33', { channel: 'request', requestId: 'r_seed_lunch' }))
    expect(!r2.ok && r2.error.code).toBe('not-allowed')
    const r3 = reject(pay('ana', '@cafelipa', '13.20', '13.33', { channel: 'request', requestId: 'r_seed_lunch' }))
    expect(!r3.ok && r3.error.code).toBe('invalid-state')
    const r4 = reject(lunch({ amount: m('13.00'), expect: { senderDebit: m('13.13') } }))
    expect(!r4.ok && r4.error.code).toBe('invalid-amount')
  })

  it('declined and cancelled requests cannot be paid', () => {
    for (const status of ['declined', 'cancelled'] as const) {
      const req = seed.state.requests.r_seed_lunch as PaymentRequest
      const s = { ...seed.state, requests: { ...seed.state.requests, r_seed_lunch: { ...req, status } } }
      expect(reject(lunch(), s)).toEqual({ ok: false, error: { code: 'invalid-state', status } })
    }
  })

  it('the café pays PZ-0412 from the start: café 232.67 (52.80 + 0.53), bakery 52.80', () => {
    const c = pay('cafe', '@pekarnazrno', '52.80', '53.33', { channel: 'request', requestId: 'PZ-0412' })
    const s1 = settle(run(seed.state, c), seed.t0 + 2000)
    expect(formatHundredths(s1.balances.cafe?.confirmed ?? -1)).toBe('232.67')
    expect(formatHundredths(s1.balances.bakery?.confirmed ?? -1)).toBe('52.80')
    expect(s1.requests['PZ-0412']?.status).toBe('paid')
  })

  it('Kovina pays HB-0917: 1,111.00 (fee 11.00); Kovina 10,989.00, Hanbit 1,980.00', () => {
    const c = pay('firm', '@hanbit', '1100.00', '1111.00', { channel: 'request', requestId: 'HB-0917' })
    const s1 = settle(run(seed.state, c), seed.t0 + 2000)
    expect(formatHundredths(s1.balances.firm?.confirmed ?? -1)).toBe('10,989.00')
    expect(formatHundredths(s1.balances.supplier?.confirmed ?? -1)).toBe('1,980.00')
  })

  const withLink = (over: Partial<PaymentLink> = {}): LedgerState => {
    const link: PaymentLink = {
      id: 'L-000001',
      owner: 'studio',
      amount: m('5.50'),
      reusable: true,
      policy: 'web-checkout',
      feePayer: 'recipient',
      status: 'open',
      payments: [],
      sharedWith: [],
      sharedAt: [],
      createdAt: seed.t0,
      cmdId: '00000000000000aa:create',
      ...over,
    }
    return { ...seed.state, links: { [link.id]: link } }
  }
  const payLink = (over: Partial<PayCommand> = {}) =>
    pay('marko', '@lintvern', '5.50', '5.50', { channel: 'link', linkId: 'L-000001', ...over })

  it('a reusable link counts payments; a single-use link is paid once', () => {
    const s1 = run(withLink(), payLink())
    expect(s1.links['L-000001']?.payments).toHaveLength(1)
    expect(s1.links['L-000001']?.status).toBe('open')
    expect(lastTx(s1)?.fee.policy).toBe('web-checkout')
    const single = withLink({
      owner: 'ana',
      policy: 'transfer',
      feePayer: 'sender',
      reusable: false,
      amount: m('4.40'),
    })
    const s2 = run(single, pay('marko', '@ana', '4.40', '4.44', { channel: 'link', linkId: 'L-000001' }))
    expect(s2.links['L-000001']).toMatchObject({ status: 'paid' })
    const again = reject(pay('marko', '@ana', '4.40', '4.44', { channel: 'link', linkId: 'L-000001' }), s2)
    expect(again).toEqual({ ok: false, error: { code: 'invalid-state', status: 'paid' } })
  })

  it('own link, closed link, unknown link and a wrong amount are refused', () => {
    expect(
      reject(pay('studio', '@lintvern', '5.50', '5.50', { channel: 'link', linkId: 'L-000001' }), withLink()),
    ).toEqual({
      ok: false,
      error: { code: 'self-payment' },
    })
    expect(reject(payLink(), withLink({ status: 'closed' }))).toEqual({
      ok: false,
      error: { code: 'invalid-state', status: 'closed' },
    })
    const unknown = reject(payLink({ linkId: 'L-000009' }), withLink())
    expect(!unknown.ok && unknown.error.code).toBe('invalid-state')
    const wrong = reject(payLink({ amount: m('6.00'), expect: { senderDebit: m('6.00') } }), withLink())
    expect(!wrong.ok && wrong.error.code).toBe('invalid-amount')
  })
})

describe('E11: quotes', () => {
  it('a debit that differs from what decide computes is quote-changed and moves nothing', () => {
    const r = reject(pay('ana', '@cafelipa', '13.20', '13.33'))
    expect(r).toEqual({ ok: false, error: { code: 'quote-changed', senderDebit: m('13.20') } })
  })

  it('the café flips its fee payer between review and Pay: quote-changed', () => {
    const cafe = seed.state.merchant.cafe
    if (!cafe) throw new Error('no café settings')
    const reviewed = pay('ana', '@cafelipa', '13.20', '13.20')
    const flipped = {
      ...seed.state,
      merchant: { ...seed.state.merchant, cafe: { ...cafe, feePayer: 'sender' as const } },
    }
    expect(reject(reviewed, flipped)).toEqual({ ok: false, error: { code: 'quote-changed', senderDebit: m('13.33') } })
  })

  it('a request keeps the fee payer it was created with, whatever the settings say later', () => {
    const req: PaymentRequest = {
      id: 'R-000001',
      requester: 'cafe',
      amount: m('11.00'),
      channel: 'pos',
      feePayer: 'recipient',
      policy: 'merchant',
      status: 'open',
      createdAt: seed.t0,
      cmdId: '00000000000000bb:charge',
    }
    const cafe = seed.state.merchant.cafe
    if (!cafe) throw new Error('no café settings')
    const s = {
      ...seed.state,
      requests: { ...seed.state.requests, [req.id]: req },
      merchant: { ...seed.state.merchant, cafe: { ...cafe, feePayer: 'sender' as const } },
    }
    const s1 = run(s, pay('ana', '@cafelipa', '11.00', '11.00', { requestId: req.id }))
    expect(lastTx(s1)?.fee.payer).toBe('recipient')
    expect(s1.requests[req.id]?.status).toBe('paid')
  })
})

describe('ids that are Object.prototype names', () => {
  const PROTO_NAMES = ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']

  it('an actor named after a prototype member is not-allowed, never an exception', () => {
    for (const actor of PROTO_NAMES) {
      const r = decide(seed.state, pay(actor, '@marko', '11.00', '11.11', { channel: 'username' }), {
        now: seed.t0 as SimTime,
      })
      expect(r, actor).toEqual({ ok: false, error: { code: 'not-allowed' } })
    }
  })

  it('a recipient named after a prototype member is unknown', () => {
    for (const to of PROTO_NAMES) {
      const c = pay('ana', to as `@${string}`, '11.00', '11.11', { channel: 'username' })
      expect(decide(seed.state, c, { now: seed.t0 as SimTime }), to).toMatchObject({
        ok: false,
        error: { code: 'unknown-recipient' },
      })
      expect(selectParty(seed.state, to), to).toBeUndefined()
    }
  })

  it('a request or link id named after a prototype member is invalid-state', () => {
    for (const id of PROTO_NAMES) {
      const c = pay('ana', '@marko', '11.00', '11.11', { channel: 'username', requestId: id })
      expect(decide(seed.state, c, { now: seed.t0 as SimTime }), id).toMatchObject({
        ok: false,
        error: { code: 'invalid-state' },
      })
      const l = pay('ana', '@marko', '11.00', '11.11', { channel: 'username', linkId: id })
      expect(decide(seed.state, l, { now: seed.t0 as SimTime }), id).toMatchObject({
        ok: false,
        error: { code: 'invalid-state' },
      })
    }
  })

  it('a cmdId of "__proto__" is remembered, so the same command is a duplicate', () => {
    const c = pay('ana', '@marko', '11.00', '11.11', { channel: 'username', cmdId: '__proto__' })
    const s1 = run(seed.state, c)
    expect(Object.hasOwn(s1.seenCmdIds, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(s1.seenCmdIds)).toBe(Object.prototype)
    expect(decide(s1, c, { now: seed.t0 as SimTime })).toEqual({ ok: false, error: { code: 'duplicate' } })
    expect(invariants(s1)).toEqual([])
  })
})

describe('the pending index', () => {
  it('is kept in settle order (due time, sender, id), so the next to settle is first', () => {
    let s = run(seed.state, pay('marko', '@cafelipa', '1.10'))
    s = run(s, pay('ana', '@cafelipa', '1.10'))
    s = run(s, pay('ana', '@cafelipa', '2.20', '2.20'), seed.t0 + 10)
    const from = s.pending.map((id) => s.txs[id]?.from)
    expect(from).toEqual(['ana', 'marko', 'ana'])
    expect(invariants(s)).toEqual([])
    expect(dueHeads(s, (seed.t0 + 1399) as SimTime)).toEqual([])
    expect(dueHeads(s, (seed.t0 + 1400) as SimTime)).toEqual([
      { kind: 'settle', dueAt: seed.t0 + 1400, persona: 'ana', entityId: s.pending[0] },
    ])
    // Settling the head removes it; the invariant sees a broken order.
    const settled = settle(s, seed.t0 + 1400)
    expect(settled.pending.map((id) => settled.txs[id]?.from)).toEqual(['ana'])
    expect(invariants({ ...s, pending: [...s.pending].reverse() })).toContainEqual(
      expect.stringMatching(/^\[4\] the pending index/),
    )
  })
})
