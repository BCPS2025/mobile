import { maxSendable, quoteFee } from './fees'
import {
  linkId as linkIdOf,
  nextRefSeq,
  rampId as rampIdOf,
  requestId as requestIdOf,
  splitId as splitIdOf,
  txRef,
} from './ids'
import { asMinor } from './money'
import { eurToMinor } from './rate'
import type {
  AccountId,
  AutoConvertPatch,
  AutoConvertSettings,
  Balance,
  Command,
  DecideCtx,
  DomainError,
  DueItem,
  EurCents,
  FeePayer,
  FeePolicy,
  FeePolicyId,
  FeeQuote,
  Handle,
  LedgerEvent,
  LedgerState,
  LinkCreateBody,
  LinkShareBody,
  MerchantSettings,
  MerchantSettingsBody,
  Minor,
  Party,
  PartyId,
  PayChannel,
  PayCommand,
  PaymentLink,
  PaymentRequest,
  PendingEvent,
  PersonaId,
  PersonRequestBody,
  PosCodeBody,
  Posting,
  Ramp,
  RampOffBody,
  RampOnBody,
  RefundBody,
  RequestCancelBody,
  RequestCreateBody,
  RequestDeclineBody,
  Result,
  SimTime,
  Split,
  SplitCancelBody,
  SplitCreateBody,
  SplitReaskBody,
  Tx,
  TxItem,
  TxKind,
} from './types'
import { MAX_SPLIT_SHARES } from './types'

// decide: validate a command against state and return events (no mutation).
// evolve: apply one event to state, returning a new state (no mutation); a replay draft
// applies events in place (beginDraft / applyToDraft / finishDraft).
// dueWork / decideDue: the scheduler's work, derived from state (driven by src/sim/scheduler).

const ZERO = 0 as Minor

/**
 * An own entry of a state container. Ids come from commands and files, so a plain `o[id]` would
 * answer "constructor" or "toString" with an Object.prototype member; every lookup by an id that
 * is not the state's own goes through here.
 */
export function entryOf<V>(o: Readonly<Record<string, V>>, id: string): V | undefined {
  return Object.hasOwn(o, id) ? o[id] : undefined
}

/** Writes an own entry, also for "__proto__" (a plain assignment would set the prototype). */
function setEntry<V>(o: Record<string, V>, id: string, v: V): void {
  if (id === '__proto__')
    Object.defineProperty(o, id, { value: v, writable: true, enumerable: true, configurable: true })
  else o[id] = v
}

export function balanceOf(s: LedgerState, a: AccountId): Balance {
  return entryOf(s.balances, a) ?? { confirmed: ZERO, held: ZERO }
}

export function available(s: LedgerState, a: AccountId): Minor {
  const b = balanceOf(s, a)
  return asMinor(b.confirmed - b.held)
}

/** A directory entry by id or by @handle (on-stage personas, the bakery, off-stage people, new accounts). */
export function selectParty(s: LedgerState, idOrHandle: string): Party | undefined {
  const id = idOrHandle.startsWith('@') ? entryOf(s.handles, idOrHandle) : idOrHandle
  return id === undefined ? undefined : entryOf(s.directory, id)
}

/** A party that can hold money and act: in the directory, not off-stage, with a balance. */
export function isLedgerPersona(s: LedgerState, id: PartyId): boolean {
  const p = entryOf(s.directory, id)
  return p !== undefined && !p.offstage && entryOf(s.balances, id) !== undefined
}

/** A business whose QR and checkout payments are sales (café and studio). */
export function isMerchant(s: LedgerState, id: PartyId): boolean {
  return entryOf(s.directory, id)?.merchant === true && entryOf(s.merchant, id) !== undefined
}

export interface FeeContext {
  policyId: FeePolicyId
  policy: FeePolicy
  /** Payer override: a request's or link's snapshot, or the merchant's current setting. */
  override: FeePayer | undefined
}

/**
 * Fee policy and payer for a payment without a request or link: web checkout uses its own
 * policy; a QR payment to a merchant (the café's counter code) is a sale at the merchant's
 * current fee-payer setting; everything else (people, off-stage people, supplier payments) is a
 * transfer paid by the sender.
 */
export function feeContextFor(s: LedgerState, to: PartyId, channel: PayChannel): FeeContext {
  let policyId: FeePolicyId = 'transfer'
  if (channel === 'web-checkout' && isMerchant(s, to)) policyId = 'web-checkout'
  else if (channel === 'qr' && isMerchant(s, to)) policyId = 'merchant'
  const override = policyId === 'transfer' ? undefined : entryOf(s.merchant, to)?.feePayer
  return { policyId, policy: s.config.fees[policyId], override }
}

/** Fee context fixed by a request's or link's snapshot. */
export function feeContextOfSnapshot(s: LedgerState, snap: { policy: FeePolicyId; feePayer: FeePayer }): FeeContext {
  return { policyId: snap.policy, policy: s.config.fees[snap.policy], override: snap.feePayer }
}

export function quoteWith(s: LedgerState, ctx: FeeContext, amount: Minor) {
  return quoteFee(amount, ctx.policy, s.config.rate, ctx.override, s.config.cardRange)
}

/**
 * The Max button for a payment from `from` to `toHandle` over `channel`: the largest amount
 * decide would accept on funds. 0 when nothing can be sent (unknown handle, self, too little).
 */
export function maxPayable(s: LedgerState, from: PersonaId, toHandle: Handle, channel: PayChannel): Minor {
  const to = selectParty(s, toHandle)
  if (!to || to.id === from) return ZERO
  const { policy, override } = feeContextFor(s, to.id, channel)
  const max = maxSendable(available(s, from), policy, s.config.rate, override)
  return asMinor(Math.min(max, limitFor(s, from)))
}

/** The per-command amount limit for an actor: people 999.99, businesses 99,999.99. */
export function limitFor(s: LedgerState, actor: PersonaId): Minor {
  return entryOf(s.directory, actor)?.kind === 'business' ? s.config.limits.businessMax : s.config.limits.consumerMax
}

/** Postings for a quote; always sum to zero. The fee goes to sys:fees; sys:offstage legs name the party. */
export function postingsFor(from: AccountId, to: AccountId, q: FeeQuote, party?: Handle): Posting[] {
  const posting = (account: AccountId, delta: number): Posting =>
    account === 'sys:offstage' && party !== undefined
      ? { account, delta: asMinor(delta), party }
      : { account, delta: asMinor(delta) }
  const out: Posting[] = [posting(from, -q.senderDebit), posting(to, q.recipientCredit)]
  if (q.fee > 0) out.push(posting('sys:fees', q.fee))
  return out
}

/** Transaction kind of a payment under a policy. */
export function kindOfPolicy(policy: FeePolicyId): TxKind {
  if (policy === 'merchant' || policy === 'web-checkout') return 'purchase'
  if (policy === 'subscription') return 'subscription-charge'
  return 'transfer'
}

/** The id the k-th transaction submitted from state s gets (k = 0 for the next one). */
export function nextTxId(s: LedgerState, k = 0): string {
  let n = s.counters.refSeq
  for (let i = 0; i <= k; i++) n = nextRefSeq(n)
  return txRef(n)
}

function err(code: DomainError['code'], extra: Omit<DomainError, 'code'> = {}): { ok: false; error: DomainError } {
  return { ok: false, error: { code, ...extra } }
}

/** Pending transactions in due order (from the pending index, not a scan of history). */
export function pendingTxs(s: LedgerState): Tx[] {
  const out: Tx[] = []
  for (const id of s.pending) {
    const tx = entryOf(s.txs, id)
    if (tx && tx.status === 'pending') out.push(tx)
  }
  return out
}

const positiveInt = (n: number) => Number.isSafeInteger(n) && n > 0
const sameItems = (a: readonly TxItem[], b: readonly TxItem[]) => JSON.stringify(a) === JSON.stringify(b)

/** Checks shared by every user command: well-formed cmdId, not seen before, a known actor. */
function commonChecks(s: LedgerState, c: Command): DomainError | null {
  if (typeof c.cmdId !== 'string' || c.cmdId.length === 0 || c.cmdId.length > 80) return { code: 'not-allowed' }
  if (Object.hasOwn(s.seenCmdIds, c.cmdId)) return { code: 'duplicate' }
  if (typeof c.actor !== 'string' || !isLedgerPersona(s, c.actor)) return { code: 'not-allowed' }
  return null
}

function decidePay(s: LedgerState, c: PayCommand, ctx: DecideCtx): Result<PendingEvent[], DomainError> {
  const from: PersonaId = c.actor
  if (!positiveInt(c.amount)) return err('invalid-amount')
  const max = limitFor(s, from)
  if (c.amount > max) return err('invalid-amount', { max })
  if (c.items && c.items.length > 0) {
    if (!c.items.every((it) => positiveInt(it.qty) && positiveInt(it.price))) return err('invalid-amount')
    const sum = c.items.reduce((acc, it) => acc + it.qty * it.price, 0)
    if (sum !== c.amount) return err('invalid-amount')
  }
  const to = selectParty(s, c.to)
  if (!to) return err('unknown-recipient', { handle: c.to })
  if (to.id === from) return err('self-payment')
  if (c.requestId !== undefined && c.linkId !== undefined) return err('invalid-state')

  let fee: FeeContext
  let request: PaymentRequest | undefined
  let link: PaymentLink | undefined
  let items = c.items
  if (c.requestId !== undefined) {
    request = entryOf(s.requests, c.requestId)
    if (!request || request.requester !== to.id) return err('invalid-state')
    if (request.status !== 'open') return err('invalid-state', { status: request.status })
    if (isPosCodeExpired(s, request, ctx.now)) return err('invalid-state', { status: 'expired' })
    if (request.payer !== undefined && request.payer !== from) return err('not-allowed')
    if (request.amount !== c.amount) return err('invalid-amount')
    if (request.items) {
      if (c.items && !sameItems(c.items, request.items)) return err('invalid-amount')
      items = request.items
    }
    fee = feeContextOfSnapshot(s, request)
  } else if (c.linkId !== undefined) {
    link = entryOf(s.links, c.linkId)
    if (!link || link.owner !== to.id) return err('invalid-state')
    if (link.status !== 'open') return err('invalid-state', { status: link.status })
    if (link.amount !== c.amount) return err('invalid-amount')
    fee = feeContextOfSnapshot(s, link)
  } else {
    fee = feeContextFor(s, to.id, c.channel)
  }

  const q = quoteWith(s, fee, c.amount)
  if (!q.ok) return err('invalid-amount')
  if (c.expect?.senderDebit !== q.value.senderDebit) return err('quote-changed', { senderDebit: q.value.senderDebit })
  const have = available(s, from)
  if (have < q.value.senderDebit) return err('insufficient-funds', { have, short: asMinor(q.value.senderDebit - have) })

  const toAccount: AccountId = to.offstage ? 'sys:offstage' : to.id
  const party = to.offstage ? to.handle : undefined
  const tx: Tx = {
    id: nextTxId(s),
    kind: kindOfPolicy(fee.policyId),
    // The channel follows what is paid: a POS code is a QR payment, other requests are request
    // payments and a link is a link payment, whatever channel the caller named.
    channel: request ? (request.channel === 'pos' ? 'qr' : 'request') : link ? 'link' : c.channel,
    status: 'pending',
    from,
    to: toAccount,
    amount: c.amount,
    fee: q.value,
    postings: postingsFor(from, toAccount, q.value, party),
    createdAt: ctx.now,
    dueAt: (ctx.now + s.config.settleMs) as SimTime,
    cmdId: c.cmdId,
  }
  if (party !== undefined) tx.party = party
  if (c.note !== undefined) tx.note = c.note
  if (items !== undefined) tx.items = items.map((it) => ({ ...it }))
  if (request) tx.links = { requestId: request.id }
  if (link) tx.links = { linkId: link.id }

  // One event: evolve marks the request paid (or records the link payment) together with the
  // submission, so invariant 7 holds after every event.
  return { ok: true, value: [{ type: 'tx.submitted', cmdId: c.cmdId, tx }] }
}

/** A POS code is good for `posCodeValidityMs` after it was made; later it has expired (its status stays open). */
export function isPosCodeExpired(s: LedgerState, r: PaymentRequest, now: SimTime): boolean {
  return r.channel === 'pos' && now >= r.createdAt + s.config.posCodeValidityMs
}

type RequestCreateCommand = RequestCreateBody & { cmdId: string; actor: PersonaId }
type PosCodeCommand = PosCodeBody & { cmdId: string; actor: PersonaId }
type PersonRequestCommand = PersonRequestBody & { cmdId: string; actor: PersonaId }
type RequestCancelCommand = RequestCancelBody & { cmdId: string; actor: PersonaId }
type RequestDeclineCommand = RequestDeclineBody & { cmdId: string; actor: PersonaId }

function decideRequestCreate(
  s: LedgerState,
  c: RequestCreateCommand,
  ctx: DecideCtx,
): Result<PendingEvent[], DomainError> {
  if (c.channel === 'pos') return decidePosCode(s, c, ctx)
  if (c.channel === 'username') return decidePersonRequest(s, c, ctx)
  return err('invalid-state')
}

function decidePosCode(s: LedgerState, c: PosCodeCommand, ctx: DecideCtx): Result<PendingEvent[], DomainError> {
  const actor: PersonaId = c.actor
  // Only a merchant shows payment codes; the café's is the only one the screens offer.
  if (!isMerchant(s, actor)) return err('not-allowed')
  if (!positiveInt(c.amount)) return err('invalid-amount')
  const max = s.config.limits.consumerMax
  if (c.amount > max) return err('invalid-amount', { max })
  if (c.items && c.items.length > 0) {
    if (!c.items.every((it) => positiveInt(it.qty) && positiveInt(it.price))) return err('invalid-amount')
    const sum = c.items.reduce((acc, it) => acc + it.qty * it.price, 0)
    if (sum !== c.amount) return err('invalid-amount')
  }
  const settings = entryOf(s.merchant, actor)
  if (!settings) return err('not-allowed')
  const request: PaymentRequest = {
    id: requestIdOf(s.counters.requestSeq + 1),
    requester: actor,
    amount: c.amount,
    channel: 'pos',
    // What the payer is charged is fixed now, from the merchant's current setting.
    feePayer: settings.feePayer,
    policy: 'merchant',
    status: 'open',
    createdAt: ctx.now,
    cmdId: c.cmdId,
  }
  if (c.note !== undefined) request.note = c.note
  if (c.items && c.items.length > 0) request.items = c.items.map((it) => ({ ...it }))
  // A merchant has one code at a time: the previous one, while it is still good, is cancelled
  // first. One that ran out keeps its status (it has expired by time, nobody cancelled it).
  const replaced: PendingEvent[] = Object.values(s.requests)
    .filter(
      (r) => r.channel === 'pos' && r.requester === actor && r.status === 'open' && !isPosCodeExpired(s, r, ctx.now),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((r) => ({ type: 'request.status', cmdId: c.cmdId, requestId: r.id, status: 'cancelled' }))
  return { ok: true, value: [...replaced, { type: 'request.created', cmdId: c.cmdId, request }] }
}

/**
 * A person asks another person for money. People only: a business is not asked this way (it pays
 * by invoice), so a business payer, or a business asking, is `not-allowed`. The payer pays the
 * fee when paying, so the snapshot is `transfer` with the sender paying.
 */
function decidePersonRequest(
  s: LedgerState,
  c: PersonRequestCommand,
  ctx: DecideCtx,
): Result<PendingEvent[], DomainError> {
  const actor: PersonaId = c.actor
  if (entryOf(s.directory, actor)?.kind !== 'person') return err('not-allowed')
  if (!positiveInt(c.amount)) return err('invalid-amount')
  const max = s.config.limits.consumerMax
  if (c.amount > max) return err('invalid-amount', { max })
  const payer = typeof c.payer === 'string' ? selectParty(s, c.payer) : undefined
  if (!payer) return err('unknown-recipient', { handle: String(c.payer) })
  if (payer.id === actor) return err('self-payment')
  if (payer.kind !== 'person') return err('not-allowed')
  const request: PaymentRequest = {
    id: requestIdOf(s.counters.requestSeq + 1),
    requester: actor,
    payer: payer.id,
    amount: c.amount,
    channel: 'username',
    feePayer: 'sender',
    policy: 'transfer',
    status: 'open',
    createdAt: ctx.now,
    cmdId: c.cmdId,
  }
  if (c.note !== undefined) request.note = c.note
  return { ok: true, value: [{ type: 'request.created', cmdId: c.cmdId, request }] }
}

function decideRequestCancel(s: LedgerState, c: RequestCancelCommand): Result<PendingEvent[], DomainError> {
  const request = entryOf(s.requests, c.requestId)
  if (!request) return err('invalid-state')
  if (request.requester !== c.actor) return err('not-allowed')
  if (request.status !== 'open') return err('invalid-state', { status: request.status })
  return { ok: true, value: [{ type: 'request.status', cmdId: c.cmdId, requestId: request.id, status: 'cancelled' }] }
}

/** The payer turns an open request down. Only the payer can (a code has none), and only while it is open. */
function decideRequestDecline(s: LedgerState, c: RequestDeclineCommand): Result<PendingEvent[], DomainError> {
  const request = entryOf(s.requests, c.requestId)
  if (!request) return err('invalid-state')
  if (request.payer !== c.actor) return err('not-allowed')
  if (request.status !== 'open') return err('invalid-state', { status: request.status })
  if (c.reason !== undefined && !validNote(s, c.reason)) return err('invalid-state')
  const event: PendingEvent = { type: 'request.status', cmdId: c.cmdId, requestId: request.id, status: 'declined' }
  if (c.reason !== undefined) event.reason = c.reason
  return { ok: true, value: [event] }
}

type LinkCreateCommand = LinkCreateBody & { cmdId: string; actor: PersonaId }
type LinkShareCommand = LinkShareBody & { cmdId: string; actor: PersonaId }
type SplitCreateCommand = SplitCreateBody & { cmdId: string; actor: PersonaId }
type SplitReaskCommand = SplitReaskBody & { cmdId: string; actor: PersonaId }
type SplitCancelCommand = SplitCancelBody & { cmdId: string; actor: PersonaId }

/**
 * A person makes a link for one amount that one person can pay. It is single use, priced as a
 * transfer, and the person who pays the link pays the 1 % on top.
 */
function decideLinkCreate(s: LedgerState, c: LinkCreateCommand, ctx: DecideCtx): Result<PendingEvent[], DomainError> {
  const actor: PersonaId = c.actor
  if (entryOf(s.directory, actor)?.kind !== 'person') return err('not-allowed')
  if (!positiveInt(c.amount)) return err('invalid-amount')
  const max = s.config.limits.consumerMax
  if (c.amount > max) return err('invalid-amount', { max })
  const link: PaymentLink = {
    id: linkIdOf(s.counters.linkSeq + 1),
    owner: actor,
    amount: c.amount,
    reusable: false,
    policy: 'transfer',
    feePayer: 'sender',
    status: 'open',
    payments: [],
    sharedWith: [],
    sharedAt: [],
    createdAt: ctx.now,
    cmdId: c.cmdId,
  }
  if (c.note !== undefined) link.note = c.note
  return { ok: true, value: [{ type: 'link.created', cmdId: c.cmdId, link }] }
}

/** The owner sends an open link to one person (not themselves), once. */
function decideLinkShare(s: LedgerState, c: LinkShareCommand): Result<PendingEvent[], DomainError> {
  const link = entryOf(s.links, c.linkId)
  if (!link) return err('invalid-state')
  if (link.owner !== c.actor) return err('not-allowed')
  if (link.status !== 'open') return err('invalid-state', { status: link.status })
  const to = typeof c.to === 'string' ? selectParty(s, c.to) : undefined
  if (!to) return err('unknown-recipient', { handle: String(c.to) })
  if (to.id === link.owner) return err('self-payment')
  if (link.sharedWith.includes(to.id)) return err('invalid-state', { status: 'shared' })
  return { ok: true, value: [{ type: 'link.shared', cmdId: c.cmdId, linkId: link.id, to: to.id }] }
}

/** Outgoing payments a bill can be split from: what the actor paid for something. */
const SPLITTABLE: ReadonlySet<TxKind> = new Set<TxKind>(['transfer', 'purchase', 'subscription-charge'])

/** A request for one share of a split: a transfer the payer pays, with the sender paying the fee. */
function shareRequest(
  s: LedgerState,
  split: { id: string; owner: PersonaId; note: string },
  party: PartyId,
  amount: Minor,
  seq: number,
  now: SimTime,
  cmdId: string,
): PaymentRequest {
  return {
    id: requestIdOf(s.counters.requestSeq + seq),
    requester: split.owner,
    payer: party,
    amount,
    note: split.note,
    channel: 'split',
    splitId: split.id,
    feePayer: 'sender',
    policy: 'transfer',
    status: 'open',
    createdAt: now,
    cmdId,
  }
}

function decideSplitCreate(s: LedgerState, c: SplitCreateCommand, ctx: DecideCtx): Result<PendingEvent[], DomainError> {
  const actor: PersonaId = c.actor
  if (entryOf(s.directory, actor)?.kind !== 'person') return err('not-allowed')
  if (!positiveInt(c.total)) return err('invalid-amount')
  const max = s.config.limits.consumerMax
  if (c.total > max) return err('invalid-amount', { max })
  if (!validNote(s, c.note)) return err('invalid-state')
  if (!Array.isArray(c.shares) || c.shares.length === 0 || c.shares.length > MAX_SPLIT_SHARES) {
    return err('invalid-state')
  }
  let source: Tx | undefined
  if (c.sourceTxId !== undefined) {
    source = entryOf(s.txs, c.sourceTxId)
    if (!source) return err('invalid-state')
    if (source.from !== actor) return err('not-allowed')
    if (!SPLITTABLE.has(source.kind)) return err('invalid-state')
    if (source.refundedBy !== undefined) return err('invalid-state', { status: 'refunded' })
    const sourceId = source.id
    if (Object.values(s.splits).some((sp) => sp.sourceTxId === sourceId))
      return err('invalid-state', { status: 'split' })
  }
  const parties = new Set<PartyId>()
  const shares: { party: PartyId; amount: Minor }[] = []
  let sum = 0
  for (const sh of c.shares) {
    if (!positiveInt(sh?.amount)) return err('invalid-amount')
    const party = typeof sh.party === 'string' ? selectParty(s, sh.party) : undefined
    if (!party) return err('unknown-recipient', { handle: String(sh.party) })
    if (party.id === actor) return err('self-payment')
    if (party.kind !== 'person') return err('not-allowed')
    if (parties.has(party.id)) return err('invalid-state')
    parties.add(party.id)
    shares.push({ party: party.id, amount: sh.amount })
    sum += sh.amount
  }
  if (sum > c.total) return err('invalid-amount', { max: c.total })
  const id = splitIdOf(s.counters.splitSeq + 1)
  const owner = { id, owner: actor, note: c.note }
  const requests = shares.map((sh, i) => shareRequest(s, owner, sh.party, sh.amount, 1 + i, ctx.now, c.cmdId))
  const split: Split = {
    id,
    owner: actor,
    total: c.total,
    note: c.note,
    ownShare: asMinor(c.total - sum),
    shares: requests.map((r) => ({ party: r.payer as PartyId, amount: r.amount, requestId: r.id })),
    createdAt: ctx.now,
    cmdId: c.cmdId,
  }
  if (source) split.sourceTxId = source.id
  return {
    ok: true,
    value: [
      { type: 'split.created', cmdId: c.cmdId, split },
      ...requests.map((request): PendingEvent => ({ type: 'request.created', cmdId: c.cmdId, request })),
    ],
  }
}

/** The owner asks again for a share whose request was declined or cancelled: a new request replaces it. */
function decideSplitReask(s: LedgerState, c: SplitReaskCommand, ctx: DecideCtx): Result<PendingEvent[], DomainError> {
  const split = entryOf(s.splits, c.splitId)
  if (!split) return err('invalid-state')
  if (split.owner !== c.actor) return err('not-allowed')
  const party = typeof c.party === 'string' ? selectParty(s, c.party) : undefined
  if (!party) return err('unknown-recipient', { handle: String(c.party) })
  const share = split.shares.find((sh) => sh.party === party.id)
  if (!share) return err('invalid-state')
  const old = entryOf(s.requests, share.requestId)
  if (!old) return err('invalid-state')
  if (old.status !== 'declined' && old.status !== 'cancelled') return err('invalid-state', { status: old.status })
  const request = shareRequest(s, split, share.party, share.amount, 1, ctx.now, c.cmdId)
  return {
    ok: true,
    value: [
      { type: 'request.created', cmdId: c.cmdId, request },
      { type: 'split.share-updated', cmdId: c.cmdId, splitId: split.id, party: share.party, requestId: request.id },
    ],
  }
}

/** The owner cancels every share that is still open, in one batch. */
function decideSplitCancel(s: LedgerState, c: SplitCancelCommand): Result<PendingEvent[], DomainError> {
  const split = entryOf(s.splits, c.splitId)
  if (!split) return err('invalid-state')
  if (split.owner !== c.actor) return err('not-allowed')
  const open = split.shares.filter((sh) => entryOf(s.requests, sh.requestId)?.status === 'open')
  if (open.length === 0) return err('invalid-state')
  return {
    ok: true,
    value: open.map(
      (sh): PendingEvent => ({ type: 'request.status', cmdId: c.cmdId, requestId: sh.requestId, status: 'cancelled' }),
    ),
  }
}

type RampOnCommand = RampOnBody & { cmdId: string; actor: PersonaId }
type RampOffCommand = RampOffBody & { cmdId: string; actor: PersonaId }

/** The on-ramp transaction of a ramp: money issued to the account, no fee, settling like a payment. */
function onRampTx(s: LedgerState, ramp: Ramp, createdAt: SimTime, cmdId: string | undefined): Tx {
  const q = quoteFee(ramp.amount, s.config.fees['on-ramp'], s.config.rate, undefined, s.config.cardRange)
  if (!q.ok) throw new Error('on-ramp amount cannot be quoted')
  const tx: Tx = {
    id: nextTxId(s),
    kind: 'on-ramp',
    channel: 'auto',
    status: 'pending',
    from: 'sys:issuance',
    to: ramp.persona,
    amount: ramp.amount,
    fee: q.value,
    postings: postingsFor('sys:issuance', ramp.persona, q.value),
    createdAt,
    dueAt: (createdAt + s.config.settleMs) as SimTime,
    rampId: ramp.id,
  }
  if (cmdId !== undefined) tx.cmdId = cmdId
  return tx
}

/**
 * Top up from a method on file, in whole euros at the reference rate (€50 gives 55.00 BCPS), no fee.
 * A card or a local method pays in at once (a transaction that settles like a payment); a bank
 * transfer is only requested, and the scheduler pays it in when it arrives.
 */
function decideRampOn(s: LedgerState, c: RampOnCommand, ctx: DecideCtx): Result<PendingEvent[], DomainError> {
  const me = entryOf(s.directory, c.actor)
  if (!me) return err('not-allowed')
  if (c.method !== 'card' && c.method !== 'bank-transfer' && c.method !== 'local-method') return err('not-allowed')
  if (c.method === 'card' && !me.methods?.card) return err('not-allowed')
  if (c.method === 'bank-transfer' && !me.methods?.bank) return err('not-allowed')
  if (!positiveInt(c.eur)) return err('invalid-amount')
  const maxEur = me.kind === 'business' ? s.config.limits.topUpMaxEur.business : s.config.limits.topUpMaxEur.person
  if (c.eur > maxEur) return err('invalid-amount', { maxEur })
  const eur = (c.eur * 100) as EurCents
  const ramp: Ramp = {
    id: rampIdOf(s.counters.rampSeq + 1),
    persona: c.actor,
    direction: 'on',
    method: c.method,
    eur,
    amount: eurToMinor(eur, s.config.rate),
    fee: ZERO,
    status: 'pending',
    requestedAt: ctx.now,
    cmdId: c.cmdId,
  }
  if (c.method === 'bank-transfer') {
    if (!ctx.bankArrival || !me.country) return err('not-allowed')
    ramp.arrivesAt = ctx.bankArrival(me.country, ctx.now)
    return { ok: true, value: [{ type: 'ramp.requested', cmdId: c.cmdId, ramp }] }
  }
  const tx = onRampTx(s, ramp, ctx.now, c.cmdId)
  return {
    ok: true,
    value: [
      { type: 'tx.submitted', cmdId: c.cmdId, tx },
      { type: 'ramp.completed', cmdId: c.cmdId, ramp: { ...ramp, status: 'completed', txId: tx.id } },
    ],
  }
}

/**
 * Convert BCPS to euros to the bank account on file. The converter pays 1.5 % out of the amount and
 * the rest is paid out (110.00 gives ≈ €98.50); at least 1.10, and no more than is available
 * (funds locked elsewhere are not the account's).
 */
function decideRampOff(s: LedgerState, c: RampOffCommand, ctx: DecideCtx): Result<PendingEvent[], DomainError> {
  if (!entryOf(s.directory, c.actor)?.methods?.bank) return err('not-allowed')
  if (!positiveInt(c.amount)) return err('invalid-amount')
  const min = s.config.limits.cashOutMin
  if (c.amount < min) return err('invalid-amount', { min })
  const q = quoteFee(c.amount, s.config.fees['off-ramp'], s.config.rate, undefined, s.config.cardRange)
  if (!q.ok || q.value.eurOut === undefined) return err('invalid-amount')
  const have = available(s, c.actor)
  if (have < c.amount) return err('insufficient-funds', { have, short: asMinor(c.amount - have) })
  const ramp: Ramp = {
    id: rampIdOf(s.counters.rampSeq + 1),
    persona: c.actor,
    direction: 'off',
    eur: q.value.eurOut,
    amount: c.amount,
    fee: q.value.fee,
    status: 'completed',
    requestedAt: ctx.now,
    cmdId: c.cmdId,
  }
  const tx: Tx = {
    id: nextTxId(s),
    kind: 'off-ramp',
    channel: 'auto',
    status: 'pending',
    from: c.actor,
    to: 'sys:issuance',
    amount: c.amount,
    fee: q.value,
    postings: postingsFor(c.actor, 'sys:issuance', q.value),
    createdAt: ctx.now,
    dueAt: (ctx.now + s.config.settleMs) as SimTime,
    cmdId: c.cmdId,
    rampId: ramp.id,
  }
  return {
    ok: true,
    value: [
      { type: 'tx.submitted', cmdId: c.cmdId, tx },
      { type: 'ramp.completed', cmdId: c.cmdId, ramp: { ...ramp, txId: tx.id } },
    ],
  }
}

type RefundCommand = RefundBody & { cmdId: string; actor: PersonaId }
type MerchantSettingsCommand = MerchantSettingsBody & { cmdId: string; actor: PersonaId }

/**
 * A merchant returns a sale in full: the recipient of a named sale (a purchase at a merchant or
 * checkout, or a subscription charge; never a daily summary row), once, with funds for the whole
 * amount. No fee, and the fee of the sale is not given back. A one-off item the buyer owned is taken
 * away first.
 */
function decideRefund(s: LedgerState, c: RefundCommand, ctx: DecideCtx): Result<PendingEvent[], DomainError> {
  const original = entryOf(s.txs, c.txId)
  if (!original) return err('invalid-state')
  if (original.to !== c.actor) return err('not-allowed')
  if (original.refundedBy !== undefined) return err('already-refunded')
  const sale = original.kind === 'purchase' || original.kind === 'subscription-charge'
  const named = original.from !== 'sys:offstage' || original.party !== undefined
  if (!sale || original.summary !== undefined || !named) return err('invalid-state')
  if (original.status !== 'confirmed') return err('invalid-state', { status: original.status })
  const q = quoteFee(original.amount, s.config.fees.refund, s.config.rate, undefined, s.config.cardRange)
  if (!q.ok) return err('invalid-amount')
  const have = available(s, c.actor)
  if (have < q.value.senderDebit) {
    return err('insufficient-funds', { have, short: asMinor(q.value.senderDebit - have) })
  }
  const tx: Tx = {
    id: nextTxId(s),
    kind: 'refund',
    channel: 'auto',
    status: 'pending',
    from: c.actor,
    to: original.from,
    amount: original.amount,
    fee: q.value,
    postings: postingsFor(c.actor, original.from, q.value, original.party),
    createdAt: ctx.now,
    dueAt: (ctx.now + s.config.settleMs) as SimTime,
    links: { refundOf: original.id },
    cmdId: c.cmdId,
  }
  if (original.party !== undefined) tx.party = original.party
  if (original.note !== undefined) tx.note = original.note
  if (original.items !== undefined) tx.items = original.items.map((it) => ({ ...it }))
  const owned = entryOf(s.ownership, original.from) ?? []
  const revoked: PendingEvent[] = (original.items ?? [])
    .filter((it) => it.sku !== undefined && owned.includes(it.sku))
    .map((it) => ({ type: 'ownership.revoked', cmdId: c.cmdId, party: original.from, sku: it.sku as string }))
  // The item goes first, so a buyer never owns a one-off item whose purchase was refunded.
  return { ok: true, value: [...revoked, { type: 'tx.submitted', cmdId: c.cmdId, tx }] }
}

const AUTO_CONVERT_TIMES: readonly string[] = ['18:00', '20:00', '22:00', '23:00']
const AUTO_CONVERT_SCHEDULES: readonly string[] = ['daily', 'weekdays', 'weekly']
const AUTO_CONVERT_KEYS: readonly string[] = ['enabled', 'schedule', 'atLocal', 'sharePct', 'onlyOnDaysWithSales']

/** The settings after a valid auto-convert patch (the days follow the schedule), or null when a value is not allowed. */
function patchAutoConvert(current: AutoConvertSettings, patch: AutoConvertPatch): AutoConvertSettings | null {
  const next: AutoConvertSettings = { ...current, weekdays: [...current.weekdays] }
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') return null
    next.enabled = patch.enabled
  }
  if (patch.schedule !== undefined) {
    if (!AUTO_CONVERT_SCHEDULES.includes(patch.schedule)) return null
    next.schedule = patch.schedule
  }
  if (patch.atLocal !== undefined) {
    if (!AUTO_CONVERT_TIMES.includes(patch.atLocal)) return null
    next.atLocal = patch.atLocal
  }
  if (patch.sharePct !== undefined) {
    const p = patch.sharePct
    if (!Number.isSafeInteger(p) || p < 10 || p > 100 || p % 10 !== 0) return null
    next.sharePct = p
  }
  if (patch.onlyOnDaysWithSales !== undefined) {
    if (typeof patch.onlyOnDaysWithSales !== 'boolean') return null
    next.onlyOnDaysWithSales = patch.onlyOnDaysWithSales
  }
  if (next.schedule === 'daily') next.weekdays = []
  else if (next.schedule === 'weekdays') next.weekdays = [1, 2, 3, 4, 5]
  else if (!(current.schedule === 'weekly' && current.weekdays.length === 1)) next.weekdays = [1]
  return next
}

/**
 * A business changes who pays the fee on sales (café and studio only; it applies to codes, links and
 * mandates made afterwards, open ones keep their snapshot) and its auto-convert schedule. The
 * schedule is saved and shown; nothing converts by itself.
 */
function decideMerchantSettings(s: LedgerState, c: MerchantSettingsCommand): Result<PendingEvent[], DomainError> {
  const actor: PersonaId = c.actor
  const current = entryOf(s.merchant, actor)
  if (entryOf(s.directory, actor)?.kind !== 'business' || !current) return err('not-allowed')
  const patch = c.patch
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return err('invalid-state')
  if (Object.keys(patch).some((k) => k !== 'feePayer' && k !== 'autoConvert')) return err('invalid-state')
  if (patch.feePayer === undefined && patch.autoConvert === undefined) return err('invalid-state')
  const settings: MerchantSettings = { ...current, autoConvert: { ...current.autoConvert } }
  if (patch.feePayer !== undefined) {
    if (!isMerchant(s, actor)) return err('not-allowed')
    if (patch.feePayer !== 'sender' && patch.feePayer !== 'recipient') return err('invalid-state')
    settings.feePayer = patch.feePayer
  }
  if (patch.autoConvert !== undefined) {
    const a = patch.autoConvert
    if (typeof a !== 'object' || a === null || Array.isArray(a)) return err('invalid-state')
    if (Object.keys(a).length === 0 || Object.keys(a).some((k) => !AUTO_CONVERT_KEYS.includes(k))) {
      return err('invalid-state')
    }
    // Only businesses with sales have the "only on days with sales" choice.
    if (a.onlyOnDaysWithSales === true && !isMerchant(s, actor)) return err('not-allowed')
    const next = patchAutoConvert(current.autoConvert, a)
    if (!next) return err('invalid-state')
    settings.autoConvert = next
  }
  return { ok: true, value: [{ type: 'merchant.settings', cmdId: c.cmdId, persona: actor, settings }] }
}

/** Free text as the record can keep it: a non-empty string within the note limit. */
function validNote(s: LedgerState, text: unknown): boolean {
  return typeof text === 'string' && text.length > 0 && [...text].length <= s.config.limits.noteMaxChars
}

export function decide(s: LedgerState, c: Command, ctx: DecideCtx): Result<PendingEvent[], DomainError> {
  const common = commonChecks(s, c)
  if (common) return { ok: false, error: common }
  switch (c.type) {
    case 'pay':
      return decidePay(s, c, ctx)
    case 'request.create':
      return decideRequestCreate(s, c, ctx)
    case 'request.cancel':
      return decideRequestCancel(s, c)
    case 'request.decline':
      return decideRequestDecline(s, c)
    case 'link.create':
      return decideLinkCreate(s, c, ctx)
    case 'link.share':
      return decideLinkShare(s, c)
    case 'split.create':
      return decideSplitCreate(s, c, ctx)
    case 'split.reask':
      return decideSplitReask(s, c, ctx)
    case 'split.cancel':
      return decideSplitCancel(s, c)
    case 'ramp.on':
      return decideRampOn(s, c, ctx)
    case 'ramp.off':
      return decideRampOff(s, c, ctx)
    case 'refund':
      return decideRefund(s, c, ctx)
    case 'merchant.settings':
      return decideMerchantSettings(s, c)
    default:
      // A command type this build does not know (the record format refuses these before decide).
      return err('not-allowed')
  }
}

// ---- scheduler work

/** Every piece of due work, derived from state: settling payments and bank-transfer arrivals. */
export function dueWork(s: LedgerState): DueItem[] {
  return [...pendingTxs(s).map(settleItem), ...pendingRamps(s).map(arrivalItem)]
}

const settleItem = (tx: Tx): DueItem => ({ kind: 'settle', dueAt: tx.dueAt, persona: tx.from, entityId: tx.id })
const arrivalItem = (r: Ramp): DueItem => ({
  kind: 'ramp-arrival',
  dueAt: r.arrivesAt as SimTime,
  persona: r.persona,
  entityId: r.id,
})

/** Pending bank-transfer top-ups in arrival order (from the index, not a scan of all ramps). */
function pendingRamps(s: LedgerState): Ramp[] {
  const out: Ramp[] = []
  for (const id of s.pendingRamps) {
    const r = entryOf(s.ramps, id)
    if (r && r.status === 'pending' && r.arrivesAt !== undefined) out.push(r)
  }
  return out
}

/** The arrival order of two pending top-ups: when they arrive, then the ramp id. */
function arrivalOrder(a: Ramp, b: Ramp): number {
  return (a.arrivesAt ?? 0) - (b.arrivesAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** The first pending top-up in arrival order. */
function firstRamp(s: LedgerState): Ramp | undefined {
  for (const id of s.pendingRamps) {
    const r = entryOf(s.ramps, id)
    if (r && r.status === 'pending' && r.arrivesAt !== undefined) return r
  }
  return undefined
}

/**
 * The settle order of two pending transactions: the scheduler's total order within the settle
 * kind (dueAt, then the sender's id, then the transaction id). The pending index is kept in this
 * order by evolve, so the next item to settle is always its first entry.
 */
export function settleOrder(a: Tx, b: Tx): number {
  return (
    a.dueAt - b.dueAt || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

/** The first pending transaction in settle order. */
function firstPending(s: LedgerState): Tx | undefined {
  for (const id of s.pending) {
    const tx = entryOf(s.txs, id)
    if (tx && tx.status === 'pending') return tx
  }
  return undefined
}

/**
 * The first item of each kind in the scheduler's total order among the items due at or before
 * `until`; at most one per kind. The scheduler asks for this before every command and after every
 * item, so it costs one look per kind, never a scan of all pending work (a file with thousands of
 * payments pending at once would otherwise replay in quadratic time).
 */
export function dueHeads(s: LedgerState, until: SimTime): DueItem[] {
  const out: DueItem[] = []
  const tx = firstPending(s)
  if (tx !== undefined && tx.dueAt <= until) out.push(settleItem(tx))
  const ramp = firstRamp(s)
  if (ramp !== undefined && (ramp.arrivesAt as SimTime) <= until) out.push(arrivalItem(ramp))
  return out
}

/** The earliest due time of any work (for arming a timer), or null when nothing is scheduled. */
export function earliestDueAt(s: LedgerState): SimTime | null {
  const settle = firstPending(s)?.dueAt
  const arrival = firstRamp(s)?.arrivesAt
  if (settle === undefined) return arrival ?? null
  return (arrival === undefined ? settle : Math.min(settle, arrival)) as SimTime
}

/** The events one due item produces now (empty when it no longer applies). */
export function decideDue(s: LedgerState, item: DueItem): PendingEvent[] {
  switch (item.kind) {
    case 'settle': {
      const tx = entryOf(s.txs, item.entityId)
      return tx && tx.status === 'pending' ? [{ type: 'tx.confirmed', txId: tx.id }] : []
    }
    case 'ramp-arrival': {
      // A bank transfer arrives: the money is issued to the account (created when it arrives).
      const ramp = entryOf(s.ramps, item.entityId)
      if (ramp?.status !== 'pending') return []
      const tx = onRampTx(s, ramp, item.dueAt, undefined)
      return [
        { type: 'tx.submitted', tx },
        { type: 'ramp.completed', ramp: { ...ramp, status: 'completed', txId: tx.id } },
      ]
    }
    default:
      return []
  }
}

// ---- evolve
//
// One implementation serves two callers. `evolve(s, e)` is pure: it copies only the containers
// the event touches (copy on write) and returns a new state. A replay draft (`beginDraft`) owns
// every container, so `applyToDraft` writes in place and a long log replays in linear time; the
// draft is handed back once at the end (`finishDraft`). In both modes container entries (a
// balance, a transaction, a request) are replaced, never mutated, so states share entries safely.

/** Record-valued slices of the state that events write into. */
type ContainerKey =
  | 'balances'
  | 'txs'
  | 'txOrder'
  | 'pending'
  | 'pendingRamps'
  | 'ramps'
  | 'merchant'
  | 'ownership'
  | 'requests'
  | 'links'
  | 'splits'
  | 'seenCmdIds'

interface Writer {
  s: LedgerState
  /** Containers this writer may write in place; `all` for a replay draft. */
  owned: Set<ContainerKey> | 'all'
}

function own<K extends ContainerKey>(w: Writer, k: K): LedgerState[K] {
  if (w.owned !== 'all' && !w.owned.has(k)) {
    const v = w.s[k]
    w.s[k] = (Array.isArray(v) ? [...v] : { ...v }) as LedgerState[K]
    w.owned.add(k)
  }
  return w.s[k]
}

function withBalance(w: Writer, a: AccountId, f: (b: Balance) => Balance) {
  const balances = own(w, 'balances')
  setEntry(balances, a, f(entryOf(balances, a) ?? { confirmed: ZERO, held: ZERO }))
}

/** Adds a submitted transaction to the pending index at its place in settle order. New
 *  transactions settle last almost always (appended); a binary search places the others. */
function insertPending(w: Writer, tx: Tx): void {
  const pending = own(w, 'pending')
  const txs = w.s.txs
  const at = (i: number) => entryOf(txs, pending[i] as string) as Tx
  if (pending.length === 0 || settleOrder(at(pending.length - 1), tx) <= 0) {
    pending.push(tx.id)
    return
  }
  let lo = 0
  let hi = pending.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (settleOrder(at(mid), tx) <= 0) lo = mid + 1
    else hi = mid
  }
  pending.splice(lo, 0, tx.id)
}

/** Adds a bank-transfer top-up to the arrival index at its place in arrival order. */
function insertPendingRamp(w: Writer, ramp: Ramp): void {
  const pending = own(w, 'pendingRamps')
  const ramps = w.s.ramps
  let at = pending.length
  while (at > 0 && arrivalOrder(entryOf(ramps, pending[at - 1] as string) as Ramp, ramp) > 0) at -= 1
  pending.splice(at, 0, ramp.id)
}

function assertNever(x: never): never {
  throw new Error(`unhandled event ${JSON.stringify(x)}`)
}

function apply(w: Writer, e: LedgerEvent): void {
  const s = w.s
  s.seq = e.seq
  if (e.cmdId !== undefined && !Object.hasOwn(s.seenCmdIds, e.cmdId)) setEntry(own(w, 'seenCmdIds'), e.cmdId, true)
  switch (e.type) {
    case 'tx.submitted': {
      const tx = e.tx
      withBalance(w, tx.from, (b) => ({ ...b, held: asMinor(b.held + tx.fee.senderDebit) }))
      own(w, 'txs')[tx.id] = tx
      own(w, 'txOrder').push(tx.id)
      insertPending(w, tx)
      s.counters = { ...s.counters, refSeq: nextRefSeq(s.counters.refSeq) }
      const req =
        tx.links?.requestId !== undefined && tx.kind !== 'refund' ? entryOf(s.requests, tx.links.requestId) : undefined
      if (req) own(w, 'requests')[req.id] = { ...req, status: 'paid', txId: tx.id, closedAt: e.at }
      const refunded =
        tx.kind === 'refund' && tx.links?.refundOf !== undefined ? entryOf(s.txs, tx.links.refundOf) : undefined
      if (refunded) own(w, 'txs')[refunded.id] = { ...refunded, refundedBy: tx.id }
      const link = tx.links?.linkId !== undefined ? entryOf(s.links, tx.links.linkId) : undefined
      if (link) {
        const paid: PaymentLink = { ...link, payments: [...link.payments, tx.id] }
        if (!link.reusable) paid.status = 'paid'
        own(w, 'links')[link.id] = paid
      }
      return
    }
    case 'tx.confirmed': {
      const tx = entryOf(s.txs, e.txId)
      if (tx?.status !== 'pending') return
      for (const p of tx.postings) {
        withBalance(w, p.account, (b) => ({ ...b, confirmed: asMinor(b.confirmed + p.delta) }))
      }
      withBalance(w, tx.from, (b) => ({ ...b, held: asMinor(b.held - tx.fee.senderDebit) }))
      own(w, 'txs')[tx.id] = { ...tx, status: 'confirmed', confirmedAt: e.at }
      // Settling goes in settle order, so the id is almost always first: shift, not a search.
      const pending = own(w, 'pending')
      if (pending[0] === tx.id) pending.shift()
      else {
        const at = pending.indexOf(tx.id)
        if (at >= 0) pending.splice(at, 1)
      }
      return
    }
    case 'request.created': {
      setEntry(own(w, 'requests'), e.request.id, e.request)
      s.counters = { ...s.counters, requestSeq: s.counters.requestSeq + 1 }
      return
    }
    case 'request.status': {
      const req = entryOf(s.requests, e.requestId)
      if (!req) return
      const next: PaymentRequest = { ...req, status: e.status, closedAt: e.at }
      if (e.txId !== undefined) next.txId = e.txId
      if (e.reason !== undefined) next.declineReason = e.reason
      own(w, 'requests')[req.id] = next
      return
    }
    case 'link.status': {
      const link = entryOf(s.links, e.linkId)
      if (!link) return
      const payments = e.txId !== undefined ? [...link.payments, e.txId] : link.payments
      own(w, 'links')[link.id] = { ...link, status: e.status, payments }
      return
    }
    case 'link.created': {
      setEntry(own(w, 'links'), e.link.id, e.link)
      s.counters = { ...s.counters, linkSeq: s.counters.linkSeq + 1 }
      return
    }
    case 'link.shared': {
      const link = entryOf(s.links, e.linkId)
      if (!link) return
      own(w, 'links')[link.id] = {
        ...link,
        sharedWith: [...link.sharedWith, e.to],
        sharedAt: [...link.sharedAt, e.at],
      }
      return
    }
    case 'split.created': {
      setEntry(own(w, 'splits'), e.split.id, e.split)
      s.counters = { ...s.counters, splitSeq: s.counters.splitSeq + 1 }
      return
    }
    case 'ownership.revoked': {
      const owned = entryOf(s.ownership, e.party)
      if (!owned) return
      const at = owned.indexOf(e.sku)
      if (at >= 0) setEntry(own(w, 'ownership'), e.party, [...owned.slice(0, at), ...owned.slice(at + 1)])
      return
    }
    case 'merchant.settings': {
      setEntry(own(w, 'merchant'), e.persona, e.settings)
      return
    }
    case 'ramp.requested': {
      setEntry(own(w, 'ramps'), e.ramp.id, e.ramp)
      s.counters = { ...s.counters, rampSeq: s.counters.rampSeq + 1 }
      if (e.ramp.status === 'pending') insertPendingRamp(w, e.ramp)
      return
    }
    case 'ramp.completed': {
      const before = entryOf(s.ramps, e.ramp.id)
      setEntry(own(w, 'ramps'), e.ramp.id, e.ramp)
      if (!before) s.counters = { ...s.counters, rampSeq: s.counters.rampSeq + 1 }
      else {
        const pending = own(w, 'pendingRamps')
        const at = pending.indexOf(e.ramp.id)
        if (at >= 0) pending.splice(at, 1)
      }
      return
    }
    case 'split.share-updated': {
      const split = entryOf(s.splits, e.splitId)
      if (!split) return
      own(w, 'splits')[split.id] = {
        ...split,
        shares: split.shares.map((sh) => (sh.party === e.party ? { ...sh, requestId: e.requestId } : sh)),
      }
      return
    }
    default:
      assertNever(e)
  }
}

/** Applies one event and returns the new state; `s` is never modified. */
export function evolve(s: LedgerState, e: LedgerEvent): LedgerState {
  const w: Writer = { s: { ...s }, owned: new Set() }
  apply(w, e)
  return w.s
}

declare const DRAFT: unique symbol
/** A state being rebuilt in place (replay). Only `applyToDraft` may write to it. */
export interface LedgerDraft {
  readonly [DRAFT]: true
  /** The draft's current state, for decide and the scheduler (read only). */
  readonly state: LedgerState
}

interface DraftImpl {
  w: Writer
  done: boolean
}

const drafts = new WeakMap<LedgerDraft, DraftImpl>()

/** A mutable copy of `s`: the containers are copied once, `s` itself is never written. */
export function beginDraft(s: LedgerState): LedgerDraft {
  const copy: LedgerState = {
    ...s,
    balances: { ...s.balances },
    txs: { ...s.txs },
    txOrder: [...s.txOrder],
    pending: [...s.pending],
    pendingRamps: [...s.pendingRamps],
    ramps: { ...s.ramps },
    merchant: { ...s.merchant },
    ownership: { ...s.ownership },
    requests: { ...s.requests },
    links: { ...s.links },
    splits: { ...s.splits },
    seenCmdIds: { ...s.seenCmdIds },
  }
  const impl: DraftImpl = { w: { s: copy, owned: 'all' }, done: false }
  const draft = {
    get state() {
      return impl.w.s
    },
  } as LedgerDraft
  drafts.set(draft, impl)
  return draft
}

function implOf(d: LedgerDraft): DraftImpl {
  const impl = drafts.get(d)
  if (!impl) throw new Error('not a ledger draft')
  if (impl.done) throw new Error('the draft is already finished')
  return impl
}

/** Applies one event to the draft in place. */
export function applyToDraft(d: LedgerDraft, e: LedgerEvent): void {
  apply(implOf(d).w, e)
}

/** Ends the draft and returns its state; the draft cannot be written afterwards. */
export function finishDraft(d: LedgerDraft): LedgerState {
  const impl = implOf(d)
  impl.done = true
  return impl.w.s
}

/** Incoming (pending) credits for an account: the recipient shows these as "Incoming". */
export function incoming(s: LedgerState, a: AccountId): Minor {
  let sum = 0
  for (const tx of pendingTxs(s)) {
    if (tx.to === a) sum += tx.fee.recipientCredit
  }
  return asMinor(sum)
}
