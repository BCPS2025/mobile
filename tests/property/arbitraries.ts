// Generators for the property tests: random sequences of the milestone A1 command
// set, valid and invalid, with Clock jumps, late timers and catch-up points. Every other
// milestone extends `stepArb` as its commands arrive.
//
// A step is data only; `payCommand` turns a pay step into an engine command against the state it
// is about to be decided on, so "valid" steps carry the debit the review step would have shown and
// invalid ones differ from it in exactly one way.
import fc from 'fast-check'
import type { Content } from '@content/schema'
import { mustParseMinor } from '@domain/money'
import type { Handle, LedgerState, Minor, PayChannel, PersonaId, TxItem, UserCommand } from '@domain/types'
import { quoteFor } from '@store/selectors'

export const EPOCHS = ['2026-09-25', '2026-10-23', '2027-03-26'] as const

export const CHANNELS: readonly PayChannel[] = ['username', 'qr', 'link', 'web-checkout', 'request']

/**
 * Recipients: every persona, off-stage people, a handle that does not resolve, and a persona id
 * in place of a handle (the node resolves it; the log format only stores handles, so the
 * runtime must refuse it).
 */
export function handlesOf(content: Content): string[] {
  return [
    ...content.personas.personas.map((p) => p.handle),
    ...content.personas.offstage.slice(0, 3).map((o) => o.handle),
    '@nobody',
    'ana',
  ]
}

/** Recipient indexes a step may pick: without the bare id unless the runtime is under test. */
const recipientCount = (content: Content, runtime: boolean) => handlesOf(content).length - (runtime ? 0 : 1)

export function actorsOf(content: Content): string[] {
  return [...content.personas.personas.map((p) => p.id), 'nobody']
}

export type AmountPick =
  | { kind: 'small'; value: number } // 0.01 … 30.00
  | { kind: 'edge'; value: number } // 0.49, 0.50, 5.49, 5.50, …
  | { kind: 'large'; value: number } // up to 2,000.00
  | { kind: 'bad'; value: number } // 0, negative, fractional, huge

export type ItemsPick =
  | { kind: 'none' }
  /** Catalogue items of the recipient; the amount becomes their sum. */
  | { kind: 'catalogue'; picks: { index: number; qty: number }[] }
  /** Catalogue items with a wrong amount, or items of another merchant, or edited prices. */
  | { kind: 'mismatch'; picks: { index: number; qty: number }[] }
  | { kind: 'foreign'; picks: { index: number; qty: number }[] }
  | { kind: 'repriced'; picks: { index: number; qty: number }[] }
  | { kind: 'no-sku'; qty: number }

export type ExpectPick = 'right' | 'off-by-one' | 'amount'

export interface PayStep {
  kind: 'pay'
  actor: number
  to: number
  amount: AmountPick
  channel: PayChannel
  items: ItemsPick
  request: 'none' | 'lunch' | 'bogus'
  link: 'none' | 'bogus'
  expect: ExpectPick
  note: string | null
  /** New cmdId, a repeat of an earlier one (index into the ids used so far), or (runtime only)
   *  one that is not of the `${16 hex}:${step}` form and must be refused as not storable. */
  cmdId: { kind: 'new' } | { kind: 'repeat'; index: number } | { kind: 'malformed'; id: string }
}

export type Step =
  | PayStep
  /** The Lunch request exactly as Ana would pay it (so the paid-request paths are reached). */
  | { kind: 'pay-lunch'; expect: ExpectPick }
  /** Time passes on the clock without the timer firing (a late or throttled timer). */
  | { kind: 'advance'; ms: number }
  /** Time passes and the armed timer fires, possibly long after it was due. */
  | { kind: 'fire'; ms: number }
  /** A catch-up (visibilitychange, focus). */
  | { kind: 'catch-up' }
  /** The Clock control's jump, forward by `ms` (refused while a payment is pending). */
  | { kind: 'jump'; ms: number }
  /** A jump to the current time or earlier (always refused). */
  | { kind: 'jump-back'; ms: number }
  | { kind: 'reset' }
  | { kind: 'undo' }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const EDGE_AMOUNTS = [
  '0.01',
  '0.49',
  '0.50',
  '1.10',
  '5.49',
  '5.50',
  '8.80',
  '11.00',
  '13.20',
  '16.50',
  '245.05',
  '247.50',
]

export const amountArb: fc.Arbitrary<AmountPick> = fc.oneof(
  { weight: 5, arbitrary: fc.integer({ min: 1, max: 3000 }).map((value) => ({ kind: 'small' as const, value })) },
  {
    weight: 3,
    arbitrary: fc.constantFrom(...EDGE_AMOUNTS).map((s) => ({ kind: 'edge' as const, value: mustParseMinor(s) })),
  },
  { weight: 1, arbitrary: fc.integer({ min: 3001, max: 200_000 }).map((value) => ({ kind: 'large' as const, value })) },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom(0, -1, -1100, 0.5, 10.25, Number.MAX_SAFE_INTEGER, 1e12, Number.NaN)
      .map((value) => ({ kind: 'bad' as const, value })),
  },
)

const picksArb = fc.array(fc.record({ index: fc.nat(9), qty: fc.integer({ min: 1, max: 4 }) }), {
  minLength: 1,
  maxLength: 4,
})

/**
 * Items as the flow engine sends them (catalogue items of the recipient, or a wrong amount), and
 * with `unstorable`, items no screen sends: another merchant's, edited prices, no sku. The node
 * accepts those (the domain does not know the catalogue); the runtime must refuse them, because
 * their log entry would not replay to the same command.
 */
export function itemsArb(unstorable: boolean): fc.Arbitrary<ItemsPick> {
  const arbs: fc.WeightedArbitrary<ItemsPick>[] = [
    { weight: 6, arbitrary: fc.constant({ kind: 'none' as const }) },
    { weight: 4, arbitrary: picksArb.map((picks) => ({ kind: 'catalogue' as const, picks })) },
    { weight: 1, arbitrary: picksArb.map((picks) => ({ kind: 'mismatch' as const, picks })) },
  ]
  if (unstorable) {
    arbs.push(
      { weight: 1, arbitrary: picksArb.map((picks) => ({ kind: 'foreign' as const, picks })) },
      { weight: 1, arbitrary: picksArb.map((picks) => ({ kind: 'repriced' as const, picks })) },
      { weight: 1, arbitrary: fc.integer({ min: 1, max: 3 }).map((qty) => ({ kind: 'no-sku' as const, qty })) },
    )
  }
  return fc.oneof(...arbs)
}

const NOTES = ['Lunch', 'Croissant delivery', 'Kava ☕', 'x'.repeat(40), 'Rent share', 'Čaj in piškoti']

/**
 * Notes a person could type; with `runtime`, also ones the runtime must clean (control and format
 * characters, padding) or refuse (longer than 40 characters).
 */
export function noteArb(runtime: boolean): fc.Arbitrary<string | null> {
  const arbs: fc.WeightedArbitrary<string | null>[] = [
    { weight: 6, arbitrary: fc.constant(null) },
    { weight: 3, arbitrary: fc.constantFrom(...NOTES) },
  ]
  if (runtime) {
    arbs.push(
      { weight: 1, arbitrary: fc.constantFrom('Tab\there', 'Line\nbreak', '\u200bZero width', '  padded  ', '\u0007') },
      { weight: 1, arbitrary: fc.constantFrom('y'.repeat(41), 'z'.repeat(80)) },
    )
  }
  return fc.oneof(...arbs)
}

export function payStepArb(content: Content, opts: StepOptions = {}): fc.Arbitrary<PayStep> {
  return fc.record({
    kind: fc.constant('pay' as const),
    actor: fc.nat(actorsOf(content).length - 1),
    to: fc.nat(recipientCount(content, opts.runtime === true) - 1),
    amount: amountArb,
    channel: fc.constantFrom(...CHANNELS),
    items: itemsArb(opts.runtime === true),
    request: fc.oneof(
      { weight: 12, arbitrary: fc.constant('none' as const) },
      { weight: 1, arbitrary: fc.constant('lunch' as const) },
      { weight: 1, arbitrary: fc.constant('bogus' as const) },
    ),
    link: fc.oneof(
      { weight: 14, arbitrary: fc.constant('none' as const) },
      { weight: 1, arbitrary: fc.constant('bogus' as const) },
    ),
    expect: fc.constantFrom<ExpectPick>('right', 'right', 'right', 'right', 'right', 'off-by-one', 'amount'),
    note: noteArb(opts.runtime === true),
    cmdId: fc.oneof(
      { weight: 9, arbitrary: fc.constant({ kind: 'new' as const }) },
      { weight: 1, arbitrary: fc.nat(40).map((index) => ({ kind: 'repeat' as const, index })) },
      ...(opts.runtime === true
        ? [{ weight: 1, arbitrary: MALFORMED_CMD_IDS.map((id) => ({ kind: 'malformed' as const, id })) }]
        : []),
    ),
  })
}

/** Command ids the record format refuses (the runtime must refuse them before deciding). */
const MALFORMED_CMD_IDS = fc.constantFrom(
  'not-a-flow-id',
  '__proto__',
  'constructor',
  '3be07a9c11f45d62:Review',
  '3be07a9c11f45d6:review',
  '3be07a9c11f45d62:',
)

/** A payment the review step would allow in most states (keeps the ledger busy). */
export function likelyPayStepArb(content: Content): fc.Arbitrary<PayStep> {
  const people = content.personas.personas.length
  return fc.record({
    kind: fc.constant('pay' as const),
    actor: fc.nat(people - 1),
    to: fc.nat(people + 2),
    amount: fc.integer({ min: 1, max: 2500 }).map((value) => ({ kind: 'small' as const, value })),
    channel: fc.constantFrom<PayChannel>('username', 'qr', 'web-checkout'),
    items: fc.oneof(
      { weight: 3, arbitrary: fc.constant({ kind: 'none' as const }) },
      { weight: 1, arbitrary: picksArb.map((picks) => ({ kind: 'catalogue' as const, picks })) },
    ),
    request: fc.constant('none' as const),
    link: fc.constant('none' as const),
    expect: fc.constant('right' as const),
    note: fc.option(fc.constantFrom(...NOTES), { nil: null }),
    cmdId: fc.constant({ kind: 'new' as const }),
  })
}

export interface StepOptions {
  /** Runtime-level properties: Reset and Undo, and commands the runtime must refuse as not storable. */
  runtime?: boolean
}

export function stepArb(content: Content, opts: StepOptions = {}): fc.Arbitrary<Step> {
  const arbs: fc.WeightedArbitrary<Step>[] = [
    { weight: 6, arbitrary: payStepArb(content, opts) },
    { weight: 6, arbitrary: likelyPayStepArb(content) },
    {
      weight: 1,
      arbitrary: fc.constantFrom<ExpectPick>('right', 'off-by-one').map((expect) => ({ kind: 'pay-lunch', expect })),
    },
    { weight: 3, arbitrary: fc.integer({ min: 0, max: 5000 }).map((ms) => ({ kind: 'advance', ms })) },
    { weight: 3, arbitrary: fc.integer({ min: 0, max: 3000 }).map((ms) => ({ kind: 'fire', ms })) },
    { weight: 1, arbitrary: fc.constant({ kind: 'catch-up' }) },
    {
      weight: 2,
      arbitrary: fc
        .oneof(
          fc.integer({ min: 1, max: 5 * MINUTE }),
          fc.integer({ min: HOUR, max: 3 * DAY }),
          fc.constant(40 * DAY),
          // Beyond the 400-day limit of a record: the runtime refuses it.
          ...(opts.runtime ? [fc.constant(450 * DAY)] : []),
        )
        .map((ms) => ({ kind: 'jump', ms })),
    },
    { weight: 1, arbitrary: fc.integer({ min: 0, max: HOUR }).map((ms) => ({ kind: 'jump-back', ms })) },
  ]
  if (opts.runtime) {
    arbs.push({ weight: 1, arbitrary: fc.constant({ kind: 'reset' }) })
    arbs.push({ weight: 1, arbitrary: fc.constant({ kind: 'undo' }) })
  }
  return fc.oneof(...arbs)
}

export function sequenceArb(content: Content, opts: StepOptions = {}, maxLength = 60): fc.Arbitrary<Step[]> {
  return fc.array(stepArb(content, opts), { minLength: 1, maxLength, size: 'max' })
}

// ---- turning steps into commands

/** Fresh command ids: 16 hex characters and a step id, as the flow engine makes them. */
export function cmdIds() {
  const used: string[] = []
  let n = 0
  return {
    next(pick: PayStep['cmdId']): string {
      if (pick.kind === 'malformed') return pick.id
      if (pick.kind === 'repeat' && used.length > 0) return used[pick.index % used.length] as string
      const id = `${(++n).toString(16).padStart(16, '0')}:review`
      used.push(id)
      return id
    },
  }
}

function itemsFor(content: Content, merchant: string | undefined, picks: { index: number; qty: number }[]): TxItem[] {
  const list = (merchant && content.catalogue.products[merchant]) || []
  if (list.length === 0) return []
  return picks.map(({ index, qty }) => {
    const p = list[index % list.length] as { sku: string; name: string; price: string }
    return { sku: p.sku, name: p.name, qty, price: mustParseMinor(p.price) }
  })
}

const sum = (items: readonly TxItem[]) => items.reduce((acc, it) => acc + it.qty * it.price, 0)

/** The engine command of a pay step against `s` (the state it will be decided on). */
export function payCommand(content: Content, s: LedgerState, step: PayStep, cmdId: string): UserCommand {
  const actor = actorsOf(content)[step.actor] as PersonaId
  const to = handlesOf(content)[step.to] as Handle
  const recipient = content.personas.personas.find((p) => p.handle === to)
  let amount = step.amount.value
  let items: TxItem[] | undefined
  switch (step.items.kind) {
    case 'none':
      break
    case 'catalogue':
      items = itemsFor(content, recipient?.id, step.items.picks)
      if (items.length > 0) amount = sum(items)
      else items = undefined
      break
    case 'mismatch':
      items = itemsFor(content, recipient?.id, step.items.picks)
      if (items.length > 0) amount = sum(items) + 1
      else items = undefined
      break
    case 'foreign': {
      const other = recipient?.id === 'cafe' ? 'studio' : 'cafe'
      items = itemsFor(content, other, step.items.picks)
      amount = sum(items)
      break
    }
    case 'repriced':
      items = itemsFor(content, recipient?.id ?? 'cafe', step.items.picks).map((it) => ({
        ...it,
        price: (it.price + 10) as Minor,
      }))
      amount = sum(items)
      break
    case 'no-sku':
      items = [{ name: 'Custom', qty: step.items.qty, price: 110 as Minor }]
      amount = sum(items)
      break
  }
  let channel = step.channel
  let requestId: string | undefined
  let linkId: string | undefined
  if (step.request === 'lunch') requestId = 'r_seed_lunch'
  if (step.request === 'bogus') requestId = 'r_nothing'
  if (step.link === 'bogus') linkId = 'l_nothing'
  if (requestId !== undefined) channel = 'request'
  const debit = expectedDebit(s, to, channel, amount, step.expect)
  const cmd: UserCommand = {
    type: 'pay',
    actor,
    cmdId,
    to,
    amount: amount as Minor,
    channel,
    expect: { senderDebit: debit },
  }
  if (items !== undefined) cmd.items = items
  if (step.note !== null) cmd.note = step.note
  if (requestId !== undefined) cmd.requestId = requestId
  if (linkId !== undefined) cmd.linkId = linkId
  return cmd
}

/** The Lunch request as the payer's review step shows it. */
export function lunchCommand(s: LedgerState, expect: ExpectPick, cmdId: string): UserCommand {
  const amount = mustParseMinor('13.20')
  return {
    type: 'pay',
    actor: 'ana',
    cmdId,
    to: '@marko',
    amount,
    channel: 'request',
    requestId: 'r_seed_lunch',
    expect: { senderDebit: expectedDebit(s, '@marko', 'request', amount, expect) },
  }
}

function expectedDebit(s: LedgerState, to: Handle, channel: PayChannel, amount: number, pick: ExpectPick): Minor {
  const party = Object.hasOwn(s.handles, to) ? s.handles[to] : undefined
  const q = party && Number.isSafeInteger(amount) && amount > 0 ? quoteFor(s, party, channel, amount as Minor) : null
  const right = q ? q.senderDebit : amount
  if (pick === 'off-by-one') return (right + 1) as Minor
  if (pick === 'amount') return amount as Minor
  return right as Minor
}
