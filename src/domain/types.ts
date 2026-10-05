// Domain model. The domain layer imports nothing outside src/domain and never uses Date,
// Math.random or the DOM. All money is integer hundredths.

declare const U: unique symbol
type Unit<T, N extends string> = T & { readonly [U]: N }

/** BCPS in integer hundredths: "12.40" -> 1240. */
export type Minor = Unit<number, 'BCPS/100'>
/** EUR in integer cents. */
export type EurCents = Unit<number, 'EUR/100'>
/** Epoch milliseconds of the VIRTUAL clock. */
export type SimTime = Unit<number, 'sim-ms'>
export type Bps = number
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

/** Integer ratio, e.g. { bcps: 11, eur: 10 }. */
export interface Rate {
  bcps: number
  eur: number
}

export type Handle = `@${string}`
/**
 * A ledger persona: the on-stage personas, the bakery and sign-up accounts (guest-1 … guest-5).
 * Open string, validated against content/personas.yaml and state.accounts.
 */
export type PersonaId = string
/** Anything in the directory: a persona id, or the handle of an off-stage person. */
export type PartyId = string
export type SystemAccount = 'sys:issuance' | 'sys:fees' | 'sys:escrow' | 'sys:offstage'
export type AccountId = PersonaId | SystemAccount

/** Display metadata of a persona (content/personas.yaml). */
export interface Persona {
  id: PersonaId
  handle: Handle
  displayName: string
  subtitle?: string
  roleLabel?: string
  segment?: 'merchant' | 'customer' | 'saas' | 'xborder'
  shell?: 'consumer' | 'pos' | 'studio' | 'trade'
  kind: 'person' | 'business'
  verified: boolean
  country: 'SI' | 'KR'
  tz: 'Europe/Ljubljana' | 'Asia/Seoul'
  onStage: boolean
}

/** Directory entry (state.directory): on-stage personas, the bakery, off-stage people, new accounts. */
export interface Party {
  id: PartyId
  handle: Handle
  displayName: string
  kind: 'person' | 'business'
  onStage: boolean
  /** Directory-only person: money to or from them moves through sys:offstage. */
  offstage?: true
  /** A business whose QR and checkout payments are sales (café, studio). */
  merchant?: true
  guest?: { poolIndex: number }
  /** Where the account's banks are (banking hours, bank-transfer arrival). */
  country?: 'SI' | 'KR'
  /** Payment methods on file: a card and a bank account (a local payment method is always there). */
  methods?: { card: boolean; bank: boolean }
}

// ---- fees
export type FeePayer = 'sender' | 'recipient'
export type FeePolicyId =
  | 'merchant'
  | 'web-checkout'
  | 'subscription'
  | 'transfer'
  | 'escrow-lock'
  | 'escrow-release'
  | 'refund'
  | 'on-ramp'
  | 'off-ramp'
/**
 * A fee policy. `percent` (the D29 policies: 1 % in the network, 1.5 % to convert to EUR) takes
 * round half-up of amount × rateBps / 10,000; `flat` is a fixed EUR-cent fee converted at the
 * rate (kept for completeness; no configured policy uses it). The payer is the default; a
 * merchant setting or a request/link snapshot may override it. Conversion policies (off-ramp)
 * always take the fee out of the converted amount.
 */
export type FeePolicy =
  | { id: FeePolicyId; kind: 'flat'; flatEurCents: number; payer: FeePayer; cardCompareMinMinor: number | null }
  | { id: FeePolicyId; kind: 'percent'; rateBps: Bps; payer: FeePayer; cardCompareMinMinor: number | null }
  | { id: FeePolicyId; kind: 'zero' }

export interface CardRange {
  lowEurCents: number
  highEurCents: number
}

export interface FeeQuote {
  /** Policy that produced the quote; null for rows that are not payments (carried-over balances). */
  policy: FeePolicyId | null
  fee: Minor
  payer: FeePayer | null
  rule: 'flat' | 'percent' | 'zero'
  senderDebit: Minor
  recipientCredit: Minor
  /** Off-ramp only: the EUR paid out (display figure). */
  eurOut?: EurCents
  /** Present only when the card comparison is shown (card-comparable policy, amount at or above threshold). */
  card?: CardRange
}

export interface Posting {
  account: AccountId
  delta: Minor
  /** Postings to or from sys:offstage name the person (when the row has one). */
  party?: Handle
}

export type TxKind =
  | 'transfer'
  | 'purchase'
  | 'subscription-charge'
  | 'escrow-lock'
  | 'escrow-release'
  | 'escrow-refund'
  | 'on-ramp'
  | 'off-ramp'
  | 'refund'
export type TxChannel = 'username' | 'qr' | 'link' | 'web-checkout' | 'auto' | 'pos' | 'request'
/** Channels a user's pay command may use. */
export type PayChannel = 'username' | 'qr' | 'link' | 'web-checkout' | 'request'

export interface TxItem {
  sku?: string
  name: string
  qty: number
  price: Minor
}

export interface TxLinks {
  requestId?: string
  linkId?: string
  splitId?: string
  subscriptionId?: string
  escrowId?: string
  refundOf?: string
}

export interface TxSummary {
  count: number
  /** Product mix of a studio summary row: sku -> count. */
  mix?: Record<string, number>
  slot?: number
  background?: true
}

export interface Tx {
  /** The visible reference, "BC-4F7K2Q". */
  id: string
  kind: TxKind
  channel: TxChannel
  status: 'pending' | 'confirmed'
  from: AccountId
  to: AccountId
  amount: Minor
  fee: FeeQuote
  postings: Posting[]
  createdAt: SimTime
  dueAt: SimTime
  confirmedAt?: SimTime
  /** Free-text payment note entered by the sender. */
  note?: string
  items?: TxItem[]
  links?: TxLinks
  refundedBy?: string
  /** The off-stage person behind a sys:offstage leg. */
  party?: Handle
  rampId?: string
  /** The user command that created the transaction (absent for scheduler work and the seed). */
  cmdId?: string
  /** Daily sales summary rows (and later background slot rows). */
  summary?: TxSummary
  /** Rows that come from the seed ledger. */
  seed?: true
  /** Seed rows only: display metadata for the row label. */
  seedMeta?: SeedMeta
}

export interface SeedMeta {
  key: string
  labelKey?: string
  eur?: EurCents
  method?: 'bank-transfer' | 'card' | 'local-method'
  sharePct?: number
  startedAt?: SimTime
  /** A daily summary row: the first sale and the busiest hour, for the day summary. */
  day?: {
    firstSale: { at: SimTime; party: Handle; sku: string }
    busiest: { from: SimTime; count: number }
  }
}

export interface PaymentUri {
  v: 1
  to: Handle
  amount?: Minor
  ref?: string
  req?: string
  /** A payment link of the recipient (the link's id in the browser that made it). */
  link?: string
}

/** When an account converts part of its balance to euros on its own (saved and shown; nothing runs). */
export interface AutoConvertSettings {
  enabled: boolean
  /** Every day, Monday to Friday, or one day a week (`weekdays` holds the days: none, 1–5, or one). */
  schedule: 'daily' | 'weekdays' | 'weekly'
  weekdays: number[]
  atLocal: '18:00' | '20:00' | '22:00' | '23:00'
  /** Share of the balance, 10 to 100 in steps of 10. */
  sharePct: number
  onlyOnDaysWithSales: boolean
}

export interface MerchantSettings {
  feePayer: FeePayer
  autoConvert: AutoConvertSettings
}

export interface Limits {
  consumerMax: Minor
  businessMax: Minor
  topUpMaxEur: { person: number; business: number }
  cashOutMin: Minor
  noteMaxChars: number
}

/** Opening hours of a country's banks: weekdays (0 = Sunday) and local "HH:MM" in the country's zone. */
export interface BankingHours {
  days: number[]
  open: string
  close: string
  tz: string
}

export interface SimConfig {
  settleMs: number
  /** How long a POS payment code can be paid, in milliseconds (a code older than this has expired). */
  posCodeValidityMs: number
  rate: Rate
  fees: Record<FeePolicyId, FeePolicy>
  cardRange: { lowBps: number; highBps: number }
  limits: Limits
  bankingHours: Record<'SI' | 'KR', BankingHours>
  /** Bank-transfer top-ups: minutes to arrive inside banking hours, and the local time of the next-day arrival. */
  bankTransfer: { withinHoursDelayMin: number; nextDayArrival: string }
}

export interface Balance {
  confirmed: Minor
  /** Funds reserved by the account's own pending outgoing transactions. */
  held: Minor
}

// ---- state slices
export type RequestChannel = 'username' | 'pos' | 'split' | 'invoice'
export type RequestStatus = 'open' | 'paid' | 'declined' | 'cancelled'

export interface PaymentRequest {
  id: string
  requester: PersonaId
  payer?: PartyId
  amount: Minor
  note?: string
  items?: TxItem[]
  channel: RequestChannel
  invoice?: { number: string; description: string; dueAt: SimTime }
  splitId?: string
  /** Snapshot at creation: what the payer is charged is what was shown. */
  feePayer: FeePayer
  policy: FeePolicyId
  status: RequestStatus
  txId?: string
  declineReason?: string
  createdAt: SimTime
  /** The creating user command (absent for seeded requests). */
  cmdId?: string
  closedAt?: SimTime
}

export interface PaymentLink {
  id: string
  owner: PersonaId
  amount: Minor
  note?: string
  sku?: string
  planId?: string
  reusable: boolean
  policy: 'transfer' | 'merchant' | 'web-checkout'
  feePayer: FeePayer
  status: 'open' | 'paid' | 'closed'
  payments: string[]
  /** People the owner sent the link to, in order, and when (same length). */
  sharedWith: PartyId[]
  sharedAt: SimTime[]
  createdAt: SimTime
  cmdId: string
}

export interface Split {
  id: string
  owner: PersonaId
  sourceTxId?: string
  total: Minor
  note: string
  ownShare: Minor
  shares: { party: PartyId; amount: Minor; requestId: string }[]
  createdAt: SimTime
  /** The creating user command. */
  cmdId: string
}

/** Most people a bill can be split with (the record keeps at most this many shares). */
export const MAX_SPLIT_SHARES = 10

export interface Plan {
  id: string
  merchant: PersonaId
  sku: string
  amount: Minor
  interval: 'month'
  chargeAtLocal: string
}

export interface Subscription {
  id: string
  planId: string
  customer: PersonaId
  merchant: PersonaId
  amount: Minor
  feePayer: FeePayer
  status: 'active' | 'past-due' | 'cancelled'
  startedAt: SimTime
  anchorDay: number
  nextChargeAt: SimTime
  retryAt?: SimTime
  charges: string[]
  endedAt?: SimTime
  endReason?: 'customer' | 'payment-failed'
}

export interface EscrowCondition {
  id: string
  kind: 'shipping-document' | 'delivery-confirmed'
  attestor: 'seller' | 'buyer'
  metAt?: SimTime
  evidence?: string
}

export interface EscrowMilestone {
  shareBps: number
  conditionIds: string[]
  releasedTxId?: string
}

export type EscrowStatus = 'funding' | 'locked' | 'disputed' | 'released' | 'settled' | 'expired' | 'refunded'

export interface EscrowHistoryEntry {
  at: SimTime
  what: string
  by?: PersonaId
  txId?: string
}

export interface Escrow {
  id: string
  buyer: PersonaId
  seller: PersonaId
  amount: Minor
  terms: string
  conditions: EscrowCondition[]
  milestones: EscrowMilestone[]
  status: EscrowStatus
  lockTxId: string
  /** Calendar deadline (date + local time), resolved to an instant; it never pauses. */
  deadline: SimTime
  deadlineDays: number
  dispute?: { by: PersonaId; reason: string; raisedAt: SimTime }
  proposal?: { by: PersonaId; releaseToSeller: Minor; proposedAt: SimTime }
  /** Refund and settlement transactions (releases sit on the milestones). */
  refundTxIds?: string[]
  settlementTxId?: string
  history: EscrowHistoryEntry[]
}

export interface Ramp {
  id: string
  persona: PersonaId
  direction: 'on' | 'off'
  method?: 'card' | 'bank-transfer' | 'local-method'
  eur: EurCents
  amount: Minor
  fee: Minor
  status: 'pending' | 'completed'
  requestedAt: SimTime
  arrivesAt?: SimTime
  txId?: string
  auto?: true
}

export interface GuestAccount {
  poolIndex: number
  handleIndex: number
  verified: true
  biometrics: boolean
  createdAt: SimTime
}

/** Counters behind the deterministic ids (named `counters`: `seq` is the event sequence). */
export interface Counters {
  refSeq: number
  requestSeq: number
  linkSeq: number
  splitSeq: number
  subSeq: number
  escrowSeq: number
  rampSeq: number
  invoiceSeq: Record<PersonaId, { prefix: string; next: number }>
}

export interface LedgerState {
  stateVersion: number
  /** Sequence number of the last applied event (0 = seed). */
  seq: number
  balances: Record<AccountId, Balance>
  txs: Record<string, Tx>
  txOrder: string[]
  /** Ids of the pending bank-transfer top-ups in arrival order: arrivesAt, then ramp id (an index over
   *  ramps, kept by evolve; the next to arrive is first). */
  pendingRamps: string[]
  /** Ids of the pending transactions in settle order: dueAt, then sender id, then transaction id
   *  (an index over txs, kept by evolve; the next to settle is first). */
  pending: string[]
  directory: Record<PartyId, Party>
  /** Handle index over the directory. */
  handles: Record<Handle, PartyId>
  requests: Record<string, PaymentRequest>
  links: Record<string, PaymentLink>
  splits: Record<string, Split>
  plans: Record<string, Plan>
  subscriptions: Record<string, Subscription>
  escrows: Record<string, Escrow>
  ramps: Record<string, Ramp>
  merchant: Record<PersonaId, MerchantSettings>
  accounts: Record<PersonaId, GuestAccount>
  ownership: Record<PartyId, string[]>
  stats: { studio: { activeSubscribers: number } }
  counters: Counters
  /** Accepted user commands (rebuilt by replay); a repeat is refused as `duplicate`. */
  seenCmdIds: Record<string, true>
  config: SimConfig
}

// ---- commands
/** What the payer saw on the review step; decide refuses the command when it differs. */
export interface Expect {
  senderDebit: Minor
}

export type PayCommandBody = {
  type: 'pay'
  to: Handle
  amount: Minor
  channel: PayChannel
  note?: string
  items?: TxItem[]
  requestId?: string
  linkId?: string
  expect: Expect
}
/**
 * A merchant shows a payment code for one amount (the café's Charge). The fee payer and policy are
 * fixed here from the merchant's settings; the previous open code of the merchant is cancelled.
 */
export type PosCodeBody = {
  type: 'request.create'
  channel: 'pos'
  amount: Minor
  items?: TxItem[]
  note?: string
}
/**
 * A person asks another person for money. The payer pays the 1 % fee when paying (policy
 * `transfer`, snapshot `sender`); nothing moves until they do.
 */
export type PersonRequestBody = {
  type: 'request.create'
  channel: 'username'
  payer: Handle
  amount: Minor
  note?: string
}
export type RequestCreateBody = PosCodeBody | PersonRequestBody
/** The requester withdraws an open request (its code stops working; no money moves). */
export type RequestCancelBody = { type: 'request.cancel'; requestId: string }
/** The payer turns an open request down, with an optional reason; no money moves. */
export type RequestDeclineBody = { type: 'request.decline'; requestId: string; reason?: string }
/** A person makes a payment link for one amount that one person can pay (single use). */
export type LinkCreateBody = { type: 'link.create'; amount: Minor; note?: string }
/** The owner sends an open link to one person, in the app. */
export type LinkShareBody = { type: 'link.share'; linkId: string; to: Handle }
/**
 * A person asks others to pay their shares of a bill: one request per share, created together
 * with the split. `sourceTxId` is the outgoing payment being split (none for an entered amount).
 */
export type SplitCreateBody = {
  type: 'split.create'
  sourceTxId?: string
  total: Minor
  note: string
  shares: { party: Handle; amount: Minor }[]
}
/** The owner asks again for a share whose request was declined or cancelled. */
export type SplitReaskBody = { type: 'split.reask'; splitId: string; party: Handle }
/** The owner cancels every share that is still open. */
export type SplitCancelBody = { type: 'split.cancel'; splitId: string }
/** Top up from a method on file: a card or local method arrives at once, a bank transfer when the bank sends it. */
export type RampOnBody = { type: 'ramp.on'; method: 'card' | 'bank-transfer' | 'local-method'; eur: number }
/** Convert BCPS to euros to the bank account on file; the converter pays 1.5 %. */
export type RampOffBody = { type: 'ramp.off'; amount: Minor }
/** A merchant returns a sale in full; no fee, and the original fee is not returned. */
export type RefundBody = { type: 'refund'; txId: string }
/** The fields of a business's settings a patch may change (`weekdays` follows the schedule). */
export type AutoConvertPatch = Partial<Omit<AutoConvertSettings, 'weekdays'>>
export type MerchantSettingsPatch = { feePayer?: FeePayer; autoConvert?: AutoConvertPatch }
/** A business changes its settings: who pays the fee on new sales, and the auto-convert schedule. */
export type MerchantSettingsBody = { type: 'merchant.settings'; patch: MerchantSettingsPatch }
export type UserCommandBody =
  | PayCommandBody
  | RequestCreateBody
  | RequestCancelBody
  | RequestDeclineBody
  | LinkCreateBody
  | LinkShareBody
  | SplitCreateBody
  | SplitReaskBody
  | SplitCancelBody
  | RampOnBody
  | RampOffBody
  | RefundBody
  | MerchantSettingsBody
/** A user command: `cmdId` is `${flowInstanceId}:${stepId}`; `actor` is a persona id. */
export type UserCommand = UserCommandBody & { cmdId: string; actor: PersonaId }
export type PayCommand = PayCommandBody & { cmdId: string; actor: PersonaId }
export type Command = UserCommand
export type CommandType = Command['type']

/** Internal: run the scheduler up to `until`, never beyond the clock (never logged, no cmdId). */
export interface SysRun {
  type: 'sys.run'
  until: SimTime
}

// ---- events
export type LedgerEventBody =
  /** Also marks a request paid (links.requestId) or records a link payment (links.linkId). */
  | { type: 'tx.submitted'; tx: Tx }
  | { type: 'tx.confirmed'; txId: string }
  | { type: 'request.created'; request: PaymentRequest }
  | {
      type: 'request.status'
      requestId: string
      status: Exclude<RequestStatus, 'open'>
      txId?: string
      reason?: string
    }
  | { type: 'link.status'; linkId: string; status: 'paid' | 'closed'; txId?: string }
  | { type: 'link.created'; link: PaymentLink }
  | { type: 'link.shared'; linkId: string; to: PartyId }
  /** Ordered before the split's `request.created` events, one per share. */
  | { type: 'split.created'; split: Split }
  /** A share now points at a new request (ask again). */
  | { type: 'split.share-updated'; splitId: string; party: PartyId; requestId: string }
  /** A bank-transfer top-up was asked for; the money arrives at `ramp.arrivesAt`. */
  | { type: 'ramp.requested'; ramp: Ramp }
  /** A refund takes away an item of a one-off product the buyer owned (ordered before the refund). */
  | { type: 'ownership.revoked'; party: PartyId; sku: string }
  /** The settings a business has from now on (the patch applied to what it had). */
  | { type: 'merchant.settings'; persona: PersonaId; settings: MerchantSettings }
  /** A ramp is done: a card or local top-up and a cash-out complete when they are made (the ramp is new
   *  then), a bank transfer when it arrives (the ramp is the pending one, now completed). */
  | { type: 'ramp.completed'; ramp: Ramp }
/** `cmdId` is set on events a user command produced; scheduler work has none. */
export type LedgerEvent = { seq: number; at: SimTime; cmdId?: string } & LedgerEventBody
export type LedgerEventType = LedgerEvent['type']
/** Output of decide(); the node stamps seq and at. */
export type PendingEvent = { cmdId?: string } & LedgerEventBody

/** Where an applied batch of events came from (effects coalesce by origin). */
export type BatchOrigin = 'user' | 'timer' | 'jump' | 'catch-up' | 'replay'

/**
 * When a bank transfer requested at `requestedAt` reaches an account of `country`. Local-time rules
 * need zones, which the domain cannot compute, so the node and replay supply them (sim/banking).
 */
export type BankArrival = (country: 'SI' | 'KR', requestedAt: SimTime) => SimTime

export interface DecideCtx {
  /** The current virtual clock (live or manual); every command is stamped with it. */
  now: SimTime
  bankArrival?: BankArrival
}

// ---- scheduler work (derived from state, never stored)
export type DueKind = 'settle' | 'ramp-arrival' | 'escrow-deadline' | 'subscription' | 'background' | 'auto-convert'
export interface DueItem {
  kind: DueKind
  dueAt: SimTime
  /** Account the item belongs to (total order tie-break). */
  persona: AccountId
  entityId: string
}

export type DomainErrorCode =
  | 'insufficient-funds'
  | 'unknown-recipient'
  | 'self-payment'
  | 'invalid-amount'
  | 'invalid-state'
  | 'already-refunded'
  | 'not-allowed'
  | 'duplicate'
  | 'handle-taken'
  | 'pool-exhausted'
  | 'quote-changed'
export interface DomainError {
  code: DomainErrorCode
  /** insufficient-funds: what the sender has available and how much is missing. */
  have?: Minor
  short?: Minor
  handle?: string
  /** invalid-state: the status the entity already has. */
  status?: string
  /** invalid-amount: the limit that was exceeded. */
  max?: Minor
  /** invalid-amount: the smallest amount accepted (the cash-out minimum). */
  min?: Minor
  /** invalid-amount: the top-up limit that was exceeded, in whole euros. */
  maxEur?: number
  /** quote-changed: the debit decide computed now. */
  senderDebit?: Minor
}

export const SYSTEM_ACCOUNTS: readonly SystemAccount[] = ['sys:issuance', 'sys:fees', 'sys:escrow', 'sys:offstage']
export const isSystemAccount = (a: AccountId): a is SystemAccount => a.startsWith('sys:')
