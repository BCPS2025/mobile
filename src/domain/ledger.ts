import { maxSendable, quoteFee } from './fees'
import { nextRefSeq, requestId as requestIdOf, txRef } from './ids'
import { asMinor } from './money'
import type {
  AccountId,
  Balance,
  Command,
  DecideCtx,
  DomainError,
  DueItem,
  FeePayer,
  FeePolicy,
  FeePolicyId,
  FeeQuote,
  Handle,
  LedgerEvent,
  LedgerState,
  Minor,
  Party,
  PartyId,
  PayChannel,
  PayCommand,
  PaymentLink,
  PaymentRequest,
  PendingEvent,
  PersonaId,
  Posting,
  RequestCancelBody,
  RequestCreateBody,
  Result,
  SimTime,
  Tx,
  TxItem,
  TxKind,
} from './types'

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
    // A payment of a POS code is a QR payment, whatever channel the caller named.
    channel: request?.channel === 'pos' ? 'qr' : c.channel,
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
type RequestCancelCommand = RequestCancelBody & { cmdId: string; actor: PersonaId }

function decideRequestCreate(
  s: LedgerState,
  c: RequestCreateCommand,
  ctx: DecideCtx,
): Result<PendingEvent[], DomainError> {
  const actor: PersonaId = c.actor
  // Only a merchant shows payment codes; the café's is the only one the screens offer.
  if (c.channel !== 'pos') return err('invalid-state')
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

function decideRequestCancel(s: LedgerState, c: RequestCancelCommand): Result<PendingEvent[], DomainError> {
  const request = entryOf(s.requests, c.requestId)
  if (!request) return err('invalid-state')
  if (request.requester !== c.actor) return err('not-allowed')
  if (request.status !== 'open') return err('invalid-state', { status: request.status })
  return { ok: true, value: [{ type: 'request.status', cmdId: c.cmdId, requestId: request.id, status: 'cancelled' }] }
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
  }
}

// ---- scheduler work

/** Every piece of due work, derived from state (only settling in milestone A1). */
export function dueWork(s: LedgerState): DueItem[] {
  return pendingTxs(s).map(settleItem)
}

const settleItem = (tx: Tx): DueItem => ({ kind: 'settle', dueAt: tx.dueAt, persona: tx.from, entityId: tx.id })

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
  const tx = firstPending(s)
  return tx !== undefined && tx.dueAt <= until ? [settleItem(tx)] : []
}

/** The earliest due time of any work (for arming a timer), or null when nothing is scheduled. */
export function earliestDueAt(s: LedgerState): SimTime | null {
  return firstPending(s)?.dueAt ?? null
}

/** The events one due item produces now (empty when it no longer applies). */
export function decideDue(s: LedgerState, item: DueItem): PendingEvent[] {
  switch (item.kind) {
    case 'settle': {
      const tx = entryOf(s.txs, item.entityId)
      return tx && tx.status === 'pending' ? [{ type: 'tx.confirmed', txId: tx.id }] : []
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
type ContainerKey = 'balances' | 'txs' | 'txOrder' | 'pending' | 'requests' | 'links' | 'seenCmdIds'

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
    requests: { ...s.requests },
    links: { ...s.links },
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
