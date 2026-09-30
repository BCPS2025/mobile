import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import { decide, dueWork, decideDue, evolve } from '@domain/ledger'
import type {
  Escrow,
  LedgerEvent,
  LedgerState,
  Minor,
  Party,
  PaymentLink,
  PendingEvent,
  Ramp,
  SimTime,
  Split,
  Subscription,
  Tx,
  UserCommand,
} from '@domain/types'
import { buildSeed } from '@sim/seed'
import { EPOCH, content, m } from './helpers'

// Each restated invariant passes on a healthy ledger and names a planted fault.

const seed = buildSeed(content, EPOCH)
const t0 = seed.t0

function apply(s: LedgerState, events: PendingEvent[], at: number): LedgerState {
  return events.reduce<LedgerState>(
    (st, e, i) => evolve(st, { ...e, seq: s.seq + 1 + i, at: at as SimTime } as LedgerEvent),
    s,
  )
}
function run(s: LedgerState, c: UserCommand, settle = true): LedgerState {
  const r = decide(s, c, { now: t0 })
  if (!r.ok) throw new Error(r.error.code)
  let st = apply(s, r.value, t0)
  if (settle) for (const item of dueWork(st)) st = apply(st, decideDue(st, item), item.dueAt)
  return st
}

const lunch: UserCommand = {
  type: 'pay',
  actor: 'ana',
  cmdId: '00000000000000a1:review',
  to: '@marko',
  amount: m('13.20'),
  channel: 'request',
  requestId: 'r_seed_lunch',
  expect: { senderDebit: m('13.33') },
}
const paidLunch = run(seed.state, lunch)
const lunchTx = paidLunch.txs[paidLunch.requests.r_seed_lunch?.txId ?? ''] as Tx

const numbers = (s: LedgerState) => [...new Set(invariants(s).map((p) => Number(/^\[(\d+)\]/.exec(p)?.[1])))]

const setTx = (s: LedgerState, tx: Tx): LedgerState => ({ ...s, txs: { ...s.txs, [tx.id]: tx } })
const setBalance = (s: LedgerState, a: string, confirmed: number, held = 0): LedgerState => ({
  ...s,
  balances: { ...s.balances, [a]: { confirmed: confirmed as Minor, held: held as Minor } },
})

describe('healthy ledgers', () => {
  it('the seed, a paid request and a pending payment are healthy', () => {
    expect(invariants(seed.state)).toEqual([])
    expect(invariants(paidLunch)).toEqual([])
    expect(invariants(run(seed.state, lunch, false))).toEqual([])
  })
})

describe('each invariant names a planted fault', () => {
  it('[1] zero-sum', () => {
    const tx = lunchTx
    const bad = setTx(paidLunch, { ...tx, postings: [...tx.postings, { account: 'ana', delta: 1 as Minor }] })
    expect(numbers(bad)).toContain(1)
    expect(numbers(setBalance(paidLunch, 'marko', 1))).toContain(1)
  })

  it('[2] no negative available balance, except sys:issuance and sys:offstage', () => {
    const shifted = setBalance(
      setBalance(paidLunch, 'bakery', -1),
      'sys:issuance',
      (paidLunch.balances['sys:issuance']?.confirmed ?? 0) + 1,
    )
    expect(numbers(shifted)).toEqual([2])
    expect(invariants(seed.state).some((p) => p.includes('sys:offstage'))).toBe(false)
  })

  it('[3] fees are non-negative and sys:fees equals the confirmed fees', () => {
    const bad = setTx(paidLunch, { ...lunchTx, fee: { ...lunchTx.fee, fee: 7 as Minor } })
    expect(numbers(bad)).toContain(3)
  })

  it('[4] held equals pending debits', () => {
    const bad = setBalance(paidLunch, 'ana', paidLunch.balances.ana?.confirmed ?? 0, 5)
    expect(numbers(bad)).toContain(4)
  })

  const escrow = (over: Partial<Escrow> = {}): Escrow => ({
    id: 'E-1042',
    buyer: 'firm',
    seller: 'supplier',
    amount: m('5280.00'),
    terms: 'Precision parts, PO-2026-117',
    conditions: [],
    milestones: [{ shareBps: 10_000, conditionIds: [] }],
    status: 'locked',
    lockTxId: 'BC-000000',
    deadline: t0,
    deadlineDays: 45,
    history: [],
    ...over,
  })

  it('[5] sys:escrow available equals what locked and disputed escrows are owed', () => {
    const s = { ...paidLunch, escrows: { 'E-1042': escrow() } }
    expect(numbers(s)).toContain(5)
    expect(numbers({ ...paidLunch, escrows: { 'E-1042': escrow({ status: 'funding' }) } })).toEqual([])
  })

  it('[6] confirmedAt ≥ createdAt; no self-payment', () => {
    expect(numbers(setTx(paidLunch, { ...lunchTx, confirmedAt: (lunchTx.createdAt - 1) as SimTime }))).toContain(6)
    expect(numbers(setTx(paidLunch, { ...lunchTx, to: lunchTx.from }))).toContain(6)
  })

  it('[7] a paid request has exactly one tx; single-use links are paid once; refunds carry no request', () => {
    const req = paidLunch.requests.r_seed_lunch
    if (!req) throw new Error('request')
    expect(
      numbers({ ...paidLunch, requests: { ...paidLunch.requests, r_seed_lunch: { ...req, status: 'open' } } }),
    ).toContain(7)
    const noLink = setTx(paidLunch, { ...lunchTx, links: {} })
    expect(numbers(noLink)).toContain(7)
    const link: PaymentLink = {
      id: 'L-000001',
      owner: 'marko',
      amount: m('13.20'),
      reusable: false,
      policy: 'transfer',
      feePayer: 'sender',
      status: 'paid',
      payments: [lunchTx.id, lunchTx.id],
      sharedWith: [],
      createdAt: t0,
      cmdId: '00000000000000a2:create',
    }
    expect(numbers({ ...paidLunch, links: { [link.id]: link } })).toContain(7)
  })

  it('[8] paid shares of a split never exceed its total', () => {
    const split: Split = {
      id: 'S-000001',
      owner: 'marko',
      total: m('10.00'),
      note: 'Lunch',
      ownShare: 0 as Minor,
      shares: [{ party: 'ana', amount: m('13.20'), requestId: 'r_seed_lunch' }],
      createdAt: t0,
    }
    expect(numbers({ ...paidLunch, splits: { [split.id]: split } })).toEqual([8])
  })

  it('[9] subscriptions: charges exist, once per period; past-due has a retry', () => {
    const sub: Subscription = {
      id: 'SUB-000001',
      planId: 'season-pass',
      customer: 'marko',
      merchant: 'studio',
      amount: m('11.00'),
      feePayer: 'recipient',
      status: 'past-due',
      startedAt: t0,
      anchorDay: 25,
      nextChargeAt: t0,
      charges: ['BC-MISSNG'],
    }
    expect(numbers({ ...paidLunch, subscriptions: { [sub.id]: sub } })).toEqual([9])
  })

  it('[7] a merchant never has two good payment codes; one that ran out may stay open', () => {
    const code = (id: string, createdAt: number) => ({
      id,
      requester: 'cafe',
      amount: 1100 as Minor,
      channel: 'pos' as const,
      feePayer: 'recipient' as const,
      policy: 'merchant' as const,
      status: 'open' as const,
      createdAt: createdAt as SimTime,
      cmdId: `c-${id}`,
    })
    const validity = paidLunch.config.posCodeValidityMs
    const withCodes = (...codes: ReturnType<typeof code>[]) => ({
      ...paidLunch,
      requests: { ...paidLunch.requests, ...Object.fromEntries(codes.map((c) => [c.id, c])) },
    })
    expect(numbers(withCodes(code('R-1', t0), code('R-2', t0 + validity)))).not.toContain(7)
    expect(numbers(withCodes(code('R-1', t0), code('R-2', t0 + validity - 1)))).toContain(7)
  })

  it('[10] escrow releases never exceed the amount; a proposal only while disputed', () => {
    const s = {
      ...paidLunch,
      escrows: {
        'E-1042': escrow({
          status: 'released',
          proposal: { by: 'supplier', releaseToSeller: 0 as Minor, proposedAt: t0 },
        }),
      },
    }
    expect(numbers(s)).toContain(10)
  })

  it('[11] no tx is refunded twice; a refund is the full amount', () => {
    const refund: Tx = {
      ...lunchTx,
      id: 'BC-RFND01',
      kind: 'refund',
      links: { refundOf: lunchTx.id },
      amount: 1 as Minor,
    }
    const s = setTx({ ...paidLunch, txOrder: [...paidLunch.txOrder, refund.id] }, refund)
    expect(numbers(s)).toContain(11)
  })

  const ramp = (over: Partial<Ramp>): Ramp => ({
    id: 'RP-000001',
    persona: 'ana',
    direction: 'on',
    method: 'bank-transfer',
    eur: 5000 as never,
    amount: m('55.00'),
    fee: 0 as Minor,
    status: 'completed',
    requestedAt: t0,
    ...over,
  })

  it('[12] a bank top-up completes at or after it arrives', () => {
    const tx = { ...lunchTx, rampId: 'RP-000001' }
    const s = setTx(
      { ...paidLunch, ramps: { 'RP-000001': ramp({ txId: tx.id, arrivesAt: (tx.createdAt + 1) as SimTime }) } },
      tx,
    )
    expect(numbers(s)).toEqual([12])
  })

  it('[13] every balance resolves in the directory; handles are unique', () => {
    expect(numbers(setBalance(paidLunch, 'ghost', 0))).toContain(13)
    const eva = paidLunch.directory['@eva'] as Party
    const dir = { ...paidLunch.directory, '@eva': { ...eva, handle: '@ines' as const } }
    expect(numbers({ ...paidLunch, directory: dir })).toContain(13)
  })

  it('[15] a pending ramp has no tx, a completed ramp exactly one', () => {
    expect(numbers({ ...paidLunch, ramps: { 'RP-000001': ramp({ status: 'pending', txId: lunchTx.id }) } })).toContain(
      15,
    )
    expect(numbers({ ...paidLunch, ramps: { 'RP-000001': ramp({}) } })).toContain(15)
  })

  it('[16] an owned one-off item has an unrefunded purchase', () => {
    expect(numbers({ ...paidLunch, ownership: { ...paidLunch.ownership, ana: ['aurora-wings'] } })).toEqual([16])
  })

  it('[7][17] a request between people names another payer and uses the transfer snapshot', () => {
    const req = seed.state.requests.r_seed_lunch
    if (!req) throw new Error('request')
    const put = (r: typeof req) => ({ ...seed.state, requests: { ...seed.state.requests, r_seed_lunch: r } })
    expect(numbers(put({ ...req, payer: 'marko' }))).toEqual([7])
    const { payer: _payer, ...noPayer } = req
    expect(numbers(put(noPayer))).toEqual([7])
    expect(numbers(put({ ...req, policy: 'merchant' }))).toEqual([17])
    expect(numbers(put({ ...req, feePayer: 'recipient' }))).toEqual([17])
  })

  it('[17] a paid request keeps the fee payer it was created with', () => {
    const req = paidLunch.requests.r_seed_lunch
    if (!req) throw new Error('request')
    const s = {
      ...paidLunch,
      requests: { ...paidLunch.requests, r_seed_lunch: { ...req, feePayer: 'recipient' as const } },
    }
    expect(numbers(s)).toEqual([17])
  })
})
