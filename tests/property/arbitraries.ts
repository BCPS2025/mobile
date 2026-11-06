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
import { available, feeContextOfSnapshot, quoteWith } from '@domain/ledger'
import type {
  Handle,
  LedgerState,
  Minor,
  PayChannel,
  PayCommand,
  PaymentLink,
  PaymentRequest,
  PersonaId,
  Split,
  TxItem,
  UserCommand,
} from '@domain/types'
import { quoteFor, quoteForRequest } from '@store/selectors'

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

/** A merchant shows a payment code (mostly the café; sometimes another account, which is refused). */
export interface ChargeStep {
  kind: 'charge'
  actor: { kind: 'cafe' } | { kind: 'any'; index: number }
  amount: AmountPick
  items: ItemsPick
  note: string | null
}

/** The requester cancels a code (the latest, one that does not exist, or the seeded Lunch request). */
export interface CancelCodeStep {
  kind: 'cancel-code'
  actor: { kind: 'cafe' } | { kind: 'any'; index: number }
  which: 'latest' | 'oldest' | 'bogus' | 'lunch'
}

/** Someone pays a code exactly as the review step shows it (or with a wrong debit). */
export interface PayCodeStep {
  kind: 'pay-code'
  payer: number
  which: 'latest' | 'oldest'
  expect: ExpectPick
}

/** A person asks someone (mostly a person, sometimes a business, themselves or an unknown handle) for money. */
export interface AskStep {
  kind: 'ask'
  actor: number
  payer: number
  amount: AmountPick
  note: string | null
}

/**
 * An answer to one of the ledger's requests (by index into the requests in id order): the payer
 * declines or pays it, or the requester cancels it; `by: 'other'` lets someone else try.
 */
export interface AnswerStep {
  kind: 'answer'
  how: 'decline' | 'cancel' | 'pay'
  by: 'right' | 'other'
  which: number
  expect: ExpectPick
  reason: string | null
}

/** A payment link: made, sent to someone, or paid (by its owner too, and by people who were not sent it). */
export interface LinkStep {
  kind: 'link'
  op: 'create' | 'share' | 'pay'
  actor: number
  other: number
  amount: AmountPick
  note: string | null
  which: number
  expect: ExpectPick
}

/** A bill split: made from an outgoing payment or an entered amount, asked again, or cancelled. */
export interface SplitStep {
  kind: 'split'
  op: 'create' | 'reask' | 'cancel'
  actor: number
  source: 'pick' | 'none' | 'bogus'
  total: AmountPick
  parties: number[]
  shares: 'equal' | 'custom' | 'over'
  note: string | null
  which: number
}

/** A top-up (card, bank transfer or local method, with method and amount as valid as not) or a cash-out. */
export interface RampStep {
  kind: 'ramp'
  op: 'on' | 'off'
  actor: number
  method: 'card' | 'bank-transfer' | 'local-method' | 'cheque'
  eur: number
  cash: { kind: 'amount'; amount: AmountPick } | { kind: 'all' } | { kind: 'min' } | { kind: 'below-min' }
}

/** A merchant refunds a payment (mostly a sale it received; sometimes anything, or someone else tries). */
export interface RefundStep {
  kind: 'refund'
  by: 'right' | 'other'
  actor: number
  which: number
  sales: boolean
}

/** A business changes its settings: valid patches and ones the sheet cannot make. */
export interface SettingsStep {
  kind: 'settings'
  actor: number
  patch:
    | 'customer-pays'
    | 'business-pays'
    | 'share'
    | 'time'
    | 'schedule'
    | 'switch'
    | 'only-sales'
    | 'bad-share'
    | 'bad-time'
    | 'bad-schedule'
    | 'empty'
  value: number
}

export type Step =
  | PayStep
  | ChargeStep
  | CancelCodeStep
  | PayCodeStep
  | AskStep
  | AnswerStep
  | LinkStep
  | SplitStep
  | RampStep
  | RefundStep
  | SettingsStep
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
  /** Reset and at once Undo (the one moment Undo always works). */
  | { kind: 'reset-undo' }

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

const merchantArb = fc.oneof(
  { weight: 6, arbitrary: fc.constant({ kind: 'cafe' as const }) },
  { weight: 1, arbitrary: fc.nat(11).map((index) => ({ kind: 'any' as const, index })) },
)

export function chargeStepArb(opts: StepOptions = {}): fc.Arbitrary<ChargeStep> {
  return fc.record({
    kind: fc.constant('charge' as const),
    actor: merchantArb,
    amount: fc.oneof(
      { weight: 4, arbitrary: fc.integer({ min: 1, max: 3000 }).map((value) => ({ kind: 'small' as const, value })) },
      { weight: 1, arbitrary: amountArb },
    ),
    items: fc.oneof(
      { weight: 3, arbitrary: fc.constant({ kind: 'none' as const }) },
      { weight: 4, arbitrary: picksArb.map((picks) => ({ kind: 'catalogue' as const, picks })) },
      { weight: 1, arbitrary: itemsArb(opts.runtime === true) },
    ),
    note: fc.oneof(
      { weight: 3, arbitrary: fc.constant('Table 4') },
      { weight: 1, arbitrary: noteArb(opts.runtime === true) },
    ),
  })
}

export const cancelCodeStepArb: fc.Arbitrary<CancelCodeStep> = fc.record({
  kind: fc.constant('cancel-code' as const),
  actor: merchantArb,
  which: fc.constantFrom<CancelCodeStep['which']>('latest', 'latest', 'latest', 'oldest', 'bogus', 'lunch'),
})

export function payCodeStepArb(content: Content): fc.Arbitrary<PayCodeStep> {
  return fc.record({
    kind: fc.constant('pay-code' as const),
    payer: fc.nat(actorsOf(content).length - 1),
    which: fc.constantFrom<PayCodeStep['which']>('latest', 'latest', 'latest', 'oldest'),
    expect: fc.constantFrom<ExpectPick>('right', 'right', 'right', 'right', 'off-by-one'),
  })
}

export function askStepArb(content: Content, opts: StepOptions = {}): fc.Arbitrary<AskStep> {
  return fc.record({
    kind: fc.constant('ask' as const),
    actor: fc.oneof(
      { weight: 5, arbitrary: fc.constantFrom(0, 1) }, // Ana, Marko
      { weight: 1, arbitrary: fc.nat(actorsOf(content).length - 1) },
    ),
    payer: fc.oneof(
      { weight: 5, arbitrary: fc.constantFrom(0, 1) },
      { weight: 1, arbitrary: fc.nat(recipientCount(content, opts.runtime === true) - 1) },
    ),
    amount: fc.oneof(
      { weight: 4, arbitrary: fc.integer({ min: 1, max: 3000 }).map((value) => ({ kind: 'small' as const, value })) },
      { weight: 1, arbitrary: amountArb },
    ),
    note: noteArb(opts.runtime === true),
  })
}

export function answerStepArb(): fc.Arbitrary<AnswerStep> {
  return fc.record({
    kind: fc.constant('answer' as const),
    how: fc.constantFrom<AnswerStep['how']>('pay', 'pay', 'decline', 'decline', 'cancel'),
    by: fc.constantFrom<AnswerStep['by']>('right', 'right', 'right', 'other'),
    which: fc.nat(30),
    expect: fc.constantFrom<ExpectPick>('right', 'right', 'right', 'right', 'off-by-one'),
    reason: fc.oneof(
      { weight: 2, arbitrary: fc.constant(null) },
      { weight: 2, arbitrary: fc.constantFrom('Wrong amount', 'Already paid', 'Not ordered', 'Something else') },
      { weight: 1, arbitrary: fc.constantFrom('', 'y'.repeat(41)) },
    ),
  })
}

export function linkStepArb(content: Content, opts: StepOptions = {}): fc.Arbitrary<LinkStep> {
  return fc.record({
    kind: fc.constant('link' as const),
    op: fc.constantFrom<LinkStep['op']>('create', 'create', 'share', 'share', 'pay', 'pay'),
    actor: fc.oneof(
      { weight: 5, arbitrary: fc.constantFrom(0, 1) },
      { weight: 1, arbitrary: fc.nat(actorsOf(content).length - 1) },
    ),
    other: fc.oneof(
      { weight: 5, arbitrary: fc.constantFrom(0, 1) },
      { weight: 1, arbitrary: fc.nat(recipientCount(content, opts.runtime === true) - 1) },
    ),
    amount: fc.oneof(
      { weight: 4, arbitrary: fc.integer({ min: 1, max: 3000 }).map((value) => ({ kind: 'small' as const, value })) },
      { weight: 1, arbitrary: amountArb },
    ),
    note: noteArb(opts.runtime === true),
    which: fc.nat(30),
    expect: fc.constantFrom<ExpectPick>('right', 'right', 'right', 'right', 'off-by-one'),
  })
}

export function splitStepArb(content: Content, opts: StepOptions = {}): fc.Arbitrary<SplitStep> {
  return fc.record({
    kind: fc.constant('split' as const),
    op: fc.constantFrom<SplitStep['op']>('create', 'create', 'create', 'reask', 'reask', 'cancel'),
    actor: fc.oneof(
      { weight: 5, arbitrary: fc.constantFrom(0, 1) },
      { weight: 1, arbitrary: fc.nat(actorsOf(content).length - 1) },
    ),
    source: fc.constantFrom<SplitStep['source']>('pick', 'pick', 'none', 'bogus'),
    total: fc.oneof(
      { weight: 4, arbitrary: fc.integer({ min: 1, max: 3000 }).map((value) => ({ kind: 'small' as const, value })) },
      { weight: 1, arbitrary: amountArb },
    ),
    parties: fc.array(fc.nat(recipientCount(content, opts.runtime === true) - 1), { minLength: 0, maxLength: 3 }),
    shares: fc.constantFrom<SplitStep['shares']>('equal', 'equal', 'equal', 'custom', 'over'),
    note: noteArb(opts.runtime === true),
    which: fc.nat(30),
  })
}

export function rampStepArb(content: Content): fc.Arbitrary<RampStep> {
  return fc.record({
    kind: fc.constant('ramp' as const),
    op: fc.constantFrom<RampStep['op']>('on', 'on', 'off', 'off'),
    actor: fc.oneof(
      { weight: 5, arbitrary: fc.nat(actorsOf(content).length - 2) },
      { weight: 1, arbitrary: fc.constant(actorsOf(content).length - 1) }, // nobody
    ),
    method: fc.constantFrom<RampStep['method']>(
      'card',
      'card',
      'bank-transfer',
      'bank-transfer',
      'local-method',
      'cheque',
    ),
    eur: fc.oneof(
      { weight: 6, arbitrary: fc.constantFrom(1, 5, 50, 250, 1000) },
      { weight: 2, arbitrary: fc.constantFrom(10_000, 10_001, 100_000, 100_001) },
      { weight: 1, arbitrary: fc.constantFrom(0, -3, 1.5, Number.NaN) },
    ),
    cash: fc.oneof(
      {
        weight: 5,
        arbitrary: fc
          .integer({ min: 1, max: 30_000 })
          .map((value) => ({ kind: 'amount' as const, amount: { kind: 'small' as const, value } })),
      },
      { weight: 2, arbitrary: amountArb.map((amount) => ({ kind: 'amount' as const, amount })) },
      { weight: 1, arbitrary: fc.constant({ kind: 'all' as const }) },
      { weight: 1, arbitrary: fc.constant({ kind: 'min' as const }) },
      { weight: 1, arbitrary: fc.constant({ kind: 'below-min' as const }) },
    ),
  })
}

export function refundStepArb(content: Content): fc.Arbitrary<RefundStep> {
  return fc.record({
    kind: fc.constant('refund' as const),
    by: fc.constantFrom<RefundStep['by']>('right', 'right', 'right', 'other'),
    actor: fc.nat(actorsOf(content).length - 1),
    which: fc.nat(200),
    sales: fc.constantFrom(true, true, true, false),
  })
}

export function settingsStepArb(content: Content): fc.Arbitrary<SettingsStep> {
  return fc.record({
    kind: fc.constant('settings' as const),
    actor: fc.oneof(
      { weight: 4, arbitrary: fc.constantFrom(2, 3) }, // café, studio
      { weight: 2, arbitrary: fc.nat(actorsOf(content).length - 1) },
    ),
    patch: fc.constantFrom<SettingsStep['patch']>(
      'customer-pays',
      'business-pays',
      'share',
      'time',
      'schedule',
      'switch',
      'only-sales',
      'bad-share',
      'bad-time',
      'bad-schedule',
      'empty',
    ),
    value: fc.nat(9),
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
    { weight: 3, arbitrary: chargeStepArb(opts) },
    { weight: 1, arbitrary: cancelCodeStepArb },
    { weight: 3, arbitrary: payCodeStepArb(content) },
    { weight: 4, arbitrary: askStepArb(content, opts) },
    { weight: 5, arbitrary: answerStepArb() },
    { weight: 4, arbitrary: linkStepArb(content, opts) },
    { weight: 5, arbitrary: splitStepArb(content, opts) },
    { weight: 4, arbitrary: rampStepArb(content) },
    { weight: 4, arbitrary: refundStepArb(content) },
    { weight: 3, arbitrary: settingsStepArb(content) },
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
    arbs.push({ weight: 1, arbitrary: fc.constant({ kind: 'reset-undo' }) })
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

/**
 * Items of a pick for one merchant's catalogue, and the amount they make (the picked amount when
 * there are none, or one hundredth more for a `mismatch`).
 */
function applyItems(
  content: Content,
  recipient: string | undefined,
  pick: ItemsPick,
  amount: number,
): { items: TxItem[] | undefined; amount: number } {
  let items: TxItem[] | undefined
  switch (pick.kind) {
    case 'none':
      break
    case 'catalogue':
      items = itemsFor(content, recipient, pick.picks)
      if (items.length > 0) amount = sum(items)
      else items = undefined
      break
    case 'mismatch':
      items = itemsFor(content, recipient, pick.picks)
      if (items.length > 0) amount = sum(items) + 1
      else items = undefined
      break
    case 'foreign': {
      const other = recipient === 'cafe' ? 'studio' : 'cafe'
      items = itemsFor(content, other, pick.picks)
      amount = sum(items)
      break
    }
    case 'repriced':
      items = itemsFor(content, recipient ?? 'cafe', pick.picks).map((it) => ({
        ...it,
        price: (it.price + 10) as Minor,
      }))
      amount = sum(items)
      break
    case 'no-sku':
      items = [{ name: 'Custom', qty: pick.qty, price: 110 as Minor }]
      amount = sum(items)
      break
  }
  return { items, amount }
}

/** The engine command of a pay step against `s` (the state it will be decided on). */
export function payCommand(content: Content, s: LedgerState, step: PayStep, cmdId: string): PayCommand {
  const actor = actorsOf(content)[step.actor] as PersonaId
  const to = handlesOf(content)[step.to] as Handle
  const recipient = content.personas.personas.find((p) => p.handle === to)
  const { items, amount } = applyItems(content, recipient?.id, step.items, step.amount.value)
  let channel = step.channel
  let requestId: string | undefined
  let linkId: string | undefined
  if (step.request === 'lunch') requestId = 'r_seed_lunch'
  if (step.request === 'bogus') requestId = 'r_nothing'
  if (step.link === 'bogus') linkId = 'l_nothing'
  if (requestId !== undefined) channel = 'request'
  const debit = expectedDebit(s, to, channel, amount, step.expect)
  const cmd: PayCommand = {
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

const merchantOf = (content: Content, actor: ChargeStep['actor']): PersonaId =>
  actor.kind === 'cafe' ? 'cafe' : (actorsOf(content)[actor.index % actorsOf(content).length] as PersonaId)

/** The command that shows a payment code. */
export function chargeCommand(content: Content, step: ChargeStep, cmdId: string): UserCommand {
  const actor = merchantOf(content, step.actor)
  const { items, amount } = applyItems(content, actor, step.items, step.amount.value)
  const cmd: UserCommand = { type: 'request.create', actor, cmdId, channel: 'pos', amount: amount as Minor }
  if (items !== undefined) cmd.items = items
  if (step.note !== null) cmd.note = step.note
  return cmd
}

/** The payment codes of the state, oldest first. */
export const posCodes = (s: LedgerState): PaymentRequest[] =>
  Object.values(s.requests)
    .filter((r) => r.channel === 'pos')
    .sort((a, b) => (a.id < b.id ? -1 : 1))

export function cancelCodeCommand(content: Content, s: LedgerState, step: CancelCodeStep, cmdId: string): UserCommand {
  const actor = merchantOf(content, step.actor)
  const codes = posCodes(s)
  const requestId =
    step.which === 'bogus'
      ? 'R-999999'
      : step.which === 'lunch'
        ? 'r_seed_lunch'
        : ((step.which === 'oldest' ? codes[0] : codes[codes.length - 1])?.id ?? 'R-999999')
  return { type: 'request.cancel', actor, cmdId, requestId }
}

/** A payment of a code as the payer's review shows it, or null when no code was ever made. */
export function payCodeCommand(content: Content, s: LedgerState, step: PayCodeStep, cmdId: string): PayCommand | null {
  const codes = posCodes(s)
  const code = step.which === 'oldest' ? codes[0] : codes[codes.length - 1]
  if (!code) return null
  const actor = actorsOf(content)[step.payer] as PersonaId
  const to = s.directory[code.requester]?.handle as Handle
  const q = quoteForRequest(s, code)
  const right = q ? q.senderDebit : code.amount
  return {
    type: 'pay',
    actor,
    cmdId,
    to,
    amount: code.amount,
    channel: 'qr',
    requestId: code.id,
    ...(code.note ? { note: code.note } : {}),
    expect: { senderDebit: (step.expect === 'off-by-one' ? right + 1 : right) as Minor },
  }
}

/** The command of an ask step. */
export function askCommand(content: Content, step: AskStep, cmdId: string): UserCommand {
  const actor = actorsOf(content)[step.actor] as PersonaId
  const payer = handlesOf(content)[step.payer] as Handle
  const cmd: UserCommand = {
    type: 'request.create',
    actor,
    cmdId,
    channel: 'username',
    payer,
    amount: step.amount.value as Minor,
  }
  if (step.note !== null) cmd.note = step.note
  return cmd
}

/** Requests that are between people (not payment codes), oldest first. */
export const personRequests = (s: LedgerState): PaymentRequest[] =>
  Object.values(s.requests)
    .filter((r) => r.channel !== 'pos')
    .sort((a, b) => (a.id < b.id ? -1 : 1))

/**
 * The command of an answer step against `s`, or null when the ledger has no request to answer.
 * `right` is the party the rule names (the payer to decline or pay, the requester to cancel);
 * `other` is someone else.
 */
export function answerCommand(content: Content, s: LedgerState, step: AnswerStep, cmdId: string): UserCommand | null {
  const everything = personRequests(s)
  // Mostly a request that is still open, so answers are accepted often; sometimes any.
  const open = everything.filter((r) => r.status === 'open')
  const openShares = open.filter((r) => r.channel === 'split')
  // Every third answer goes to a split share, so splits see declines and cancels (ask again).
  const all =
    step.which % 3 === 0 && openShares.length > 0
      ? openShares
      : open.length > 0 && step.which % 4 !== 0
        ? open
        : everything
  const request = all[step.which % Math.max(all.length, 1)]
  if (!request) return null
  const names = actorsOf(content)
  const rightActor = step.how === 'cancel' ? request.requester : request.payer
  const other = names.find((a) => a !== rightActor && a !== request.requester && a !== request.payer) ?? 'nobody'
  // An off-stage payer cannot act; the requester answers in their place.
  const actor = (
    step.by === 'right' && rightActor !== undefined && names.includes(rightActor) ? rightActor : other
  ) as PersonaId
  switch (step.how) {
    case 'cancel':
      return { type: 'request.cancel', actor, cmdId, requestId: request.id }
    case 'decline':
      return {
        type: 'request.decline',
        actor,
        cmdId,
        requestId: request.id,
        ...(step.reason !== null ? { reason: step.reason } : {}),
      }
    case 'pay': {
      const to = s.directory[request.requester]?.handle as Handle
      const q = quoteForRequest(s, request)
      const right = q ? q.senderDebit : request.amount
      return {
        type: 'pay',
        actor,
        cmdId,
        to,
        amount: request.amount,
        channel: 'request',
        requestId: request.id,
        ...(request.note ? { note: request.note } : {}),
        expect: { senderDebit: (step.expect === 'off-by-one' ? right + 1 : right) as Minor },
      }
    }
  }
}

export const linksInOrder = (s: LedgerState): PaymentLink[] =>
  Object.values(s.links).sort((a, b) => (a.id < b.id ? -1 : 1))
export const splitsInOrder = (s: LedgerState): Split[] => Object.values(s.splits).sort((a, b) => (a.id < b.id ? -1 : 1))

/** The command of a link step against `s`, or null when the ledger has no link to work on. */
export function linkCommand(content: Content, s: LedgerState, step: LinkStep, cmdId: string): UserCommand | null {
  const actor = actorsOf(content)[step.actor] as PersonaId
  if (step.op === 'create') {
    const cmd: UserCommand = { type: 'link.create', actor, cmdId, amount: step.amount.value as Minor }
    if (step.note !== null) cmd.note = step.note
    return cmd
  }
  const all = linksInOrder(s)
  const link = all[step.which % Math.max(all.length, 1)]
  if (!link) return null
  if (step.op === 'share') {
    // Mostly the owner sends it; sometimes someone else tries.
    const by = step.which % 5 === 0 ? actor : link.owner
    return { type: 'link.share', actor: by, cmdId, linkId: link.id, to: handlesOf(content)[step.other] as Handle }
  }
  const to = s.directory[link.owner]?.handle as Handle
  const q = quoteWith(s, feeContextOfSnapshot(s, link), link.amount)
  const right = q.ok ? q.value.senderDebit : link.amount
  return {
    type: 'pay',
    actor,
    cmdId,
    to,
    amount: link.amount,
    channel: 'link',
    linkId: link.id,
    expect: { senderDebit: (step.expect === 'off-by-one' ? right + 1 : right) as Minor },
  }
}

/**
 * Before some ask-again steps, the payer of an open share turns it down first (so there is a share
 * to ask again): the decline command, or null when this step needs no prelude.
 */
export function splitPrelude(content: Content, s: LedgerState, step: SplitStep, cmdId: string): UserCommand | null {
  if (step.op !== 'reask' || step.which % 2 !== 0) return null
  const names = actorsOf(content)
  for (const split of splitsInOrder(s)) {
    for (const sh of split.shares) {
      const request = s.requests[sh.requestId]
      if (request?.status === 'open' && names.includes(sh.party)) {
        return { type: 'request.decline', actor: sh.party, cmdId, requestId: request.id }
      }
    }
  }
  return null
}

/** The command of a split step against `s`, or null when the ledger has no split to work on. */
export function splitCommand(content: Content, s: LedgerState, step: SplitStep, cmdId: string): UserCommand | null {
  const names = actorsOf(content)
  if (step.op !== 'create') {
    const everything = splitsInOrder(s)
    // Mostly a split the command can act on (one with a share to ask again, or one still open).
    const status = (sp: Split) => sp.shares.map((sh) => s.requests[sh.requestId]?.status)
    const actionable = everything.filter((sp) =>
      step.op === 'reask'
        ? status(sp).some((x) => x === 'declined' || x === 'cancelled')
        : status(sp).some((x) => x === 'open'),
    )
    const all = actionable.length > 0 && step.which % 6 !== 0 ? actionable : everything
    const split = all[step.which % Math.max(all.length, 1)]
    if (!split) return null
    // Mostly the owner; sometimes someone else tries.
    const by = (step.which % 5 === 0 ? names[step.actor] : split.owner) as PersonaId
    if (step.op === 'cancel') return { type: 'split.cancel', actor: by, cmdId, splitId: split.id }
    const share = split.shares[step.which % Math.max(split.shares.length, 1)]
    const party = (share ? s.directory[share.party]?.handle : undefined) ?? ('@nobody' as Handle)
    return { type: 'split.reask', actor: by, cmdId, splitId: split.id, party }
  }
  const actor = names[step.actor] as PersonaId
  let sourceTxId: string | undefined
  let total = step.total.value
  if (step.source === 'bogus') sourceTxId = 'BC-NOTHNG'
  else if (step.source === 'pick') {
    const outgoing = s.txOrder.map((id) => s.txs[id]).filter((t) => t?.from === actor)
    const tx = outgoing[step.which % Math.max(outgoing.length, 1)]
    if (tx) {
      sourceTxId = tx.id
      total = tx.amount
    }
  }
  const handles = step.parties.map((i) => handlesOf(content)[i] as Handle)
  const n = handles.length
  const each = step.shares === 'over' ? total : Math.max(0, Math.floor(total / (n + 1)))
  const shares = handles.map((party, i) => ({
    party,
    amount: (step.shares === 'custom' ? Math.max(0, Math.floor((total * (i + 1)) / (n * 3 + 1))) : each) as Minor,
  }))
  const cmd: UserCommand = {
    type: 'split.create',
    actor,
    cmdId,
    total: total as Minor,
    note: step.note ?? 'Split',
    shares,
  }
  if (sourceTxId !== undefined) cmd.sourceTxId = sourceTxId
  return cmd
}

/** The command of a refund step against `s`, or null when the ledger has nothing to refund. */
export function refundCommand(content: Content, s: LedgerState, step: RefundStep, cmdId: string): UserCommand | null {
  const all = s.txOrder.map((id) => s.txs[id]).filter((t): t is NonNullable<typeof t> => t !== undefined)
  const sales = all.filter(
    (t) =>
      (t.kind === 'purchase' || t.kind === 'subscription-charge') &&
      t.summary === undefined &&
      t.status === 'confirmed' &&
      t.refundedBy === undefined,
  )
  const from = step.sales && sales.length > 0 ? sales : all
  const tx = from[step.which % Math.max(from.length, 1)]
  if (!tx) return null
  const names = actorsOf(content)
  const other = names[step.actor] as PersonaId
  const actor = step.by === 'right' && !tx.to.startsWith('sys:') ? tx.to : other
  return { type: 'refund', actor, cmdId, txId: tx.id }
}

/** The command of a settings step. */
export function settingsCommand(content: Content, step: SettingsStep, cmdId: string): UserCommand {
  const actor = actorsOf(content)[step.actor] as PersonaId
  const times = ['18:00', '20:00', '22:00', '23:00']
  const schedules = ['daily', 'weekdays', 'weekly']
  let patch: unknown
  switch (step.patch) {
    case 'customer-pays':
      patch = { feePayer: 'sender' }
      break
    case 'business-pays':
      patch = { feePayer: 'recipient' }
      break
    case 'share':
      patch = { autoConvert: { sharePct: ((step.value % 10) + 1) * 10 } }
      break
    case 'time':
      patch = { autoConvert: { atLocal: times[step.value % 4] } }
      break
    case 'schedule':
      patch = { autoConvert: { schedule: schedules[step.value % 3] } }
      break
    case 'switch':
      patch = { autoConvert: { enabled: step.value % 2 === 0 } }
      break
    case 'only-sales':
      patch = { autoConvert: { onlyOnDaysWithSales: step.value % 2 === 0 } }
      break
    case 'bad-share':
      patch = { autoConvert: { sharePct: [5, 15, 0, 110, 55][step.value % 5] } }
      break
    case 'bad-time':
      patch = { autoConvert: { atLocal: ['21:00', '07:00', '24:00'][step.value % 3] } }
      break
    case 'bad-schedule':
      patch = { autoConvert: { schedule: 'custom' } }
      break
    case 'empty':
      patch = step.value % 2 === 0 ? {} : { autoConvert: {} }
      break
  }
  return { type: 'merchant.settings', actor, cmdId, patch } as UserCommand
}

/** The command of a ramp step against `s`. */
export function rampCommand(content: Content, s: LedgerState, step: RampStep, cmdId: string): UserCommand {
  const actor = actorsOf(content)[step.actor] as PersonaId
  if (step.op === 'on') return { type: 'ramp.on', actor, cmdId, method: step.method as never, eur: step.eur }
  let amount = 0
  switch (step.cash.kind) {
    case 'amount':
      amount = step.cash.amount.value
      break
    case 'all':
      amount = available(s, actor)
      break
    case 'min':
      amount = s.config.limits.cashOutMin
      break
    case 'below-min':
      amount = s.config.limits.cashOutMin - 1
      break
  }
  return { type: 'ramp.off', actor, cmdId, amount: amount as Minor }
}

/** The Lunch request as the payer's review step shows it. */
export function lunchCommand(s: LedgerState, expect: ExpectPick, cmdId: string): PayCommand {
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
