import { settleOrder } from './ledger'
import { isSystemAccount } from './types'
import type { AccountId, LedgerState, PaymentRequest, Tx } from './types'

// Ledger health checks, numbered 1–16. Checked after every event in tests and in
// development. An empty list means healthy; each string names one violation and its number.
// Determinism is a property of replay and is asserted by the replay tests.

/** Accounts allowed a negative available balance: money enters and leaves the network there. */
const MAY_GO_NEGATIVE: ReadonlySet<AccountId> = new Set(['sys:issuance', 'sys:offstage'])

const sumBy = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((acc, x) => acc + f(x), 0)
/** Own entries only: an id such as "constructor" must never resolve to an Object.prototype member. */
const own = <V>(o: Readonly<Record<string, V>>, k: string): V | undefined => (Object.hasOwn(o, k) ? o[k] : undefined)

export function invariants(s: LedgerState): string[] {
  const problems: string[] = []
  const bad = (n: number, message: string) => problems.push(`[${n}] ${message}`)

  // ---- transactions: structure, fees, held funds (1, 3, 4, 6)
  const txs: Tx[] = []
  const expectedHeld = new Map<AccountId, number>()
  let confirmedFees = 0
  for (const id of s.txOrder) {
    const tx = s.txs[id]
    if (!tx) {
      bad(1, `txOrder references missing tx ${id}`)
      continue
    }
    txs.push(tx)
    if (tx.id !== id) bad(1, `tx ${id} is stored under another id (${tx.id})`)
    const sum = sumBy(tx.postings, (p) => p.delta)
    if (sum !== 0) bad(1, `tx ${id} postings sum to ${sum}, not 0`)
    for (const p of tx.postings) {
      if (!Number.isSafeInteger(p.delta)) bad(1, `tx ${id} has a non-integer posting`)
      if (p.party !== undefined && p.account !== 'sys:offstage') bad(13, `tx ${id} names a party on ${p.account}`)
    }
    if (tx.fee.fee < 0) bad(3, `tx ${id} has a negative fee`)
    const feeToFees = sumBy(
      tx.postings.filter((p) => p.account === 'sys:fees'),
      (p) => p.delta,
    )
    if (feeToFees !== tx.fee.fee) bad(3, `tx ${id} fee ${tx.fee.fee} but sys:fees receives ${feeToFees}`)
    if (tx.from === tx.to) bad(6, `tx ${id} is a self-payment`)
    if (!(tx.amount > 0)) bad(6, `tx ${id} has a non-positive amount`)
    if (tx.status === 'confirmed') {
      confirmedFees += tx.fee.fee
      if (tx.confirmedAt === undefined || tx.confirmedAt < tx.createdAt)
        bad(6, `tx ${id} confirmedAt precedes createdAt`)
    } else {
      expectedHeld.set(tx.from, (expectedHeld.get(tx.from) ?? 0) + tx.fee.senderDebit)
    }
  }
  if (new Set(s.txOrder).size !== s.txOrder.length) bad(1, 'txOrder has duplicate ids')
  const pendingInOrder = txs
    .filter((tx) => tx.status === 'pending')
    .sort(settleOrder)
    .map((tx) => tx.id)
  if (pendingInOrder.join(',') !== s.pending.join(','))
    bad(4, 'the pending index does not list exactly the pending txs in settle order')
  if (Object.keys(s.txs).length !== s.txOrder.length) bad(1, 'txs and txOrder differ in size')

  // ---- balances (1, 2, 3, 4)
  let total = 0
  for (const [account, b] of Object.entries(s.balances) as [AccountId, { confirmed: number; held: number }][]) {
    total += b.confirmed
    if (!Number.isSafeInteger(b.confirmed) || !Number.isSafeInteger(b.held))
      bad(1, `${account} has a non-integer balance`)
    if (b.held < 0) bad(4, `${account} held is negative`)
    if (b.held !== (expectedHeld.get(account) ?? 0)) {
      bad(4, `${account} held ${b.held} does not match pending debits ${expectedHeld.get(account) ?? 0}`)
    }
    if (!MAY_GO_NEGATIVE.has(account) && b.confirmed - b.held < 0) bad(2, `${account} available balance is negative`)
  }
  if (total !== 0) bad(1, `confirmed balances sum to ${total}, not 0`)
  const fees = s.balances['sys:fees']?.confirmed ?? 0
  if (fees !== confirmedFees) bad(3, `sys:fees holds ${fees} but confirmed fees add up to ${confirmedFees}`)

  const txOf = (id: string | undefined) => (id === undefined ? undefined : s.txs[id])
  const amountOf = (id: string | undefined) => txOf(id)?.amount ?? 0

  // ---- escrow account and escrows (5, 10)
  let escrowOwed = 0
  for (const e of Object.values(s.escrows)) {
    const released = sumBy(e.milestones, (m) => amountOf(m.releasedTxId)) + amountOf(e.settlementTxId)
    const refunded = sumBy(e.refundTxIds ?? [], (id) => amountOf(id))
    if (released > e.amount) bad(10, `escrow ${e.id} releases ${released} of ${e.amount}`)
    if (
      (e.status === 'released' || e.status === 'settled' || e.status === 'refunded') &&
      released + refunded !== e.amount
    ) {
      bad(10, `escrow ${e.id} is closed but releases and refunds add up to ${released + refunded} of ${e.amount}`)
    }
    if ((e.status === 'disputed') !== (e.dispute !== undefined))
      bad(10, `escrow ${e.id} dispute does not match its status`)
    if (e.proposal !== undefined && e.status !== 'disputed') bad(10, `escrow ${e.id} has a proposal while ${e.status}`)
    if (e.status === 'locked' || e.status === 'disputed') escrowOwed += e.amount - released - refunded
  }
  for (const tx of txs) {
    const touches = tx.from === 'sys:escrow' || tx.to === 'sys:escrow'
    const escrowKind = tx.kind === 'escrow-lock' || tx.kind === 'escrow-release' || tx.kind === 'escrow-refund'
    if (touches !== escrowKind) bad(5, `tx ${tx.id} (${tx.kind}) and sys:escrow do not match`)
  }
  const escrowBal = s.balances['sys:escrow']
  const escrowAvailable = escrowBal ? escrowBal.confirmed - escrowBal.held : 0
  if (escrowAvailable !== escrowOwed) {
    bad(5, `sys:escrow has ${escrowAvailable} available but locked and disputed escrows are owed ${escrowOwed}`)
  }

  // ---- requests (7, 17)
  const txsByRequest = new Map<string, Tx[]>()
  for (const tx of txs) {
    const r = tx.links?.requestId
    if (r === undefined) continue
    if (tx.kind === 'refund') bad(7, `refund ${tx.id} carries a request id`)
    txsByRequest.set(r, [...(txsByRequest.get(r) ?? []), tx])
  }
  for (const [rid, list] of txsByRequest) {
    const req = s.requests[rid]
    if (!req) {
      bad(7, `tx ${list[0]?.id} pays unknown request ${rid}`)
      continue
    }
    if (list.length > 1) bad(7, `request ${rid} is paid ${list.length} times`)
  }
  for (const req of Object.values(s.requests)) {
    const paid = txsByRequest.get(req.id) ?? []
    if (req.status === 'paid') {
      if (paid.length !== 1 || req.txId !== paid[0]?.id)
        bad(7, `request ${req.id} is paid without exactly one matching tx`)
      const tx = paid[0]
      if (tx && req.items && JSON.stringify(tx.items) !== JSON.stringify(req.items)) {
        bad(7, `request ${req.id} was paid with other items`)
      }
      if (tx && (tx.fee.payer !== req.feePayer || tx.fee.policy !== req.policy)) {
        bad(17, `request ${req.id} was charged with another fee payer or policy than its snapshot`)
      }
    } else if (paid.length > 0) {
      bad(7, `request ${req.id} is ${req.status} but has a payment`)
    }
  }

  // A request between people, a split share or an invoice names a payer other than its requester,
  // and the payer pays the 1 % on top (the transfer snapshot).
  for (const req of Object.values(s.requests)) {
    if (req.channel === 'pos') continue
    if (req.payer === undefined || req.payer === req.requester) {
      bad(7, `request ${req.id} names no payer other than its requester`)
    }
    if (req.policy !== 'transfer' || req.feePayer !== 'sender') {
      bad(17, `request ${req.id} does not use the transfer policy with the sender paying`)
    }
  }

  // A merchant has at most one good payment code: of its open codes, every one but the newest had
  // run out when the next was made (codes that ran out keep the status open). A code has no payer
  // and the merchant policy.
  const openCodes = new Map<string, PaymentRequest[]>()
  for (const req of Object.values(s.requests)) {
    if (req.channel !== 'pos') continue
    if (req.payer !== undefined) bad(7, `payment code ${req.id} names a payer`)
    if (req.policy !== 'merchant') bad(17, `payment code ${req.id} does not use the merchant fee policy`)
    if (req.status === 'open') openCodes.set(req.requester, [...(openCodes.get(req.requester) ?? []), req])
  }
  for (const [merchant, codes] of openCodes) {
    const byAge = [...codes].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
    for (let i = 1; i < byAge.length; i++) {
      const older = byAge[i - 1] as PaymentRequest
      const newer = byAge[i] as PaymentRequest
      if (newer.createdAt < older.createdAt + s.config.posCodeValidityMs) {
        bad(7, `${merchant} has two good payment codes: ${older.id} and ${newer.id}`)
      }
    }
  }

  // ---- links (7, 17)
  for (const link of Object.values(s.links)) {
    for (const id of link.payments) {
      const tx = s.txs[id]
      if (!tx || tx.links?.linkId !== link.id) bad(7, `link ${link.id} lists payment ${id} that does not pay it`)
      else if (tx.fee.payer !== link.feePayer || tx.fee.policy !== link.policy) {
        bad(17, `link ${link.id} was charged with another fee payer or policy than its snapshot`)
      }
    }
    if (link.sharedAt.length !== link.sharedWith.length || new Set(link.sharedWith).size !== link.sharedWith.length) {
      bad(7, `link ${link.id} lists its shares inconsistently`)
    }
    if (link.sharedWith.includes(link.owner)) bad(7, `link ${link.id} is shared with its owner`)
    if (!link.reusable && link.payments.length > 1)
      bad(7, `single-use link ${link.id} is paid ${link.payments.length} times`)
    if (!link.reusable && (link.status === 'paid') !== (link.payments.length === 1)) {
      bad(7, `single-use link ${link.id} status ${link.status} does not match its payments`)
    }
  }

  // ---- splits (8). A split's requests are created right after the split itself, so a share
  // whose request is not there yet is skipped; every request that is there matches its share.
  for (const split of Object.values(s.splits)) {
    const paid = sumBy(
      split.shares.filter((sh) => s.requests[sh.requestId]?.status === 'paid'),
      (sh) => sh.amount,
    )
    if (paid > split.total) bad(8, `split ${split.id} has ${paid} paid of ${split.total}`)
    if (sumBy(split.shares, (sh) => sh.amount) + split.ownShare !== split.total) {
      bad(8, `split ${split.id} shares and its own share do not add up to the total`)
    }
    if (new Set(split.shares.map((sh) => sh.party)).size !== split.shares.length) {
      bad(8, `split ${split.id} lists a person twice`)
    }
    for (const sh of split.shares) {
      const req = s.requests[sh.requestId]
      if (!req) continue
      if (
        req.channel !== 'split' ||
        req.splitId !== split.id ||
        req.requester !== split.owner ||
        req.payer !== sh.party ||
        req.amount !== sh.amount
      ) {
        bad(8, `split ${split.id} share of ${sh.party} does not match its request ${req.id}`)
      }
    }
  }
  for (const req of Object.values(s.requests)) {
    if (req.channel === 'split' && (req.splitId === undefined || !s.splits[req.splitId])) {
      bad(8, `request ${req.id} belongs to an unknown split`)
    }
  }

  // ---- subscriptions (9)
  for (const sub of Object.values(s.subscriptions)) {
    if (new Set(sub.charges).size !== sub.charges.length) bad(9, `subscription ${sub.id} lists a charge twice`)
    let last = Number.NEGATIVE_INFINITY
    for (const id of sub.charges) {
      const tx = s.txs[id]
      if (!tx) {
        bad(9, `subscription ${sub.id} lists missing charge ${id}`)
        continue
      }
      if (tx.createdAt <= last) bad(9, `subscription ${sub.id} is charged twice for one period`)
      last = tx.createdAt
    }
    if (sub.status === 'past-due' && sub.retryAt === undefined)
      bad(9, `subscription ${sub.id} is past due without a retry`)
    if (sub.status === 'active' && sub.nextChargeAt <= last)
      bad(9, `subscription ${sub.id} next charge is not after the last`)
  }

  // ---- refunds (11)
  const refundsOf = new Map<string, Tx[]>()
  for (const tx of txs) {
    const of = tx.links?.refundOf
    if (of === undefined) continue
    refundsOf.set(of, [...(refundsOf.get(of) ?? []), tx])
  }
  for (const [of, list] of refundsOf) {
    const original = s.txs[of]
    if (list.length > 1) bad(11, `tx ${of} is refunded ${list.length} times`)
    for (const r of list) if (original && r.amount !== original.amount) bad(11, `refund ${r.id} is not the full amount`)
    if (original && original.refundedBy !== list[0]?.id) bad(11, `tx ${of} does not point at its refund`)
  }
  for (const tx of txs) {
    if (tx.refundedBy !== undefined && !refundsOf.has(tx.id)) bad(11, `tx ${tx.id} names a refund that does not exist`)
  }

  // ---- ramps (12, 15)
  for (const ramp of Object.values(s.ramps)) {
    const tx = txOf(ramp.txId)
    if (ramp.status === 'pending' && ramp.txId !== undefined) bad(15, `pending ramp ${ramp.id} has a tx`)
    if (ramp.status === 'completed' && (!tx || tx.rampId !== ramp.id)) bad(15, `completed ramp ${ramp.id} has no tx`)
    if (
      ramp.status === 'completed' &&
      ramp.method === 'bank-transfer' &&
      ramp.direction === 'on' &&
      tx &&
      (ramp.arrivesAt === undefined || tx.createdAt < ramp.arrivesAt)
    ) {
      bad(12, `bank top-up ${ramp.id} completed before it arrived`)
    }
  }
  const rampTxs = txs.filter((tx) => tx.rampId !== undefined)
  if (new Set(rampTxs.map((tx) => tx.rampId)).size !== rampTxs.length) bad(15, 'a ramp has more than one tx')

  // ---- directory (13)
  for (const account of Object.keys(s.balances)) {
    if (isSystemAccount(account)) continue
    const p = own(s.directory, account)
    if (!p || p.offstage) bad(13, `balance ${account} does not resolve to a ledger persona`)
  }
  for (const tx of txs) {
    for (const a of [tx.from, tx.to])
      if (!own(s.balances, a)) bad(13, `tx ${tx.id} moves money for unknown account ${a}`)
    if (tx.party !== undefined && !own(s.directory, tx.party)?.offstage)
      bad(13, `tx ${tx.id} names unknown party ${tx.party}`)
  }
  const handles = Object.values(s.directory).map((p) => p.handle)
  if (new Set(handles).size !== handles.length) bad(13, 'handles are not unique')
  for (const p of Object.values(s.directory)) {
    if (own(s.handles, p.handle) !== p.id) bad(13, `handle ${p.handle} does not resolve to ${p.id}`)
  }
  if (Object.keys(s.handles).length !== handles.length) bad(13, 'the handle index has entries outside the directory')
  for (const [id, acc] of Object.entries(s.accounts)) {
    if (own(s.directory, id)?.guest?.poolIndex !== acc.poolIndex)
      bad(13, `account ${id} does not resolve from the pool`)
  }

  // ---- ownership (16)
  for (const [owner, skus] of Object.entries(s.ownership)) {
    for (const sku of skus) {
      const bought = txs.some(
        (tx) =>
          tx.from === owner &&
          tx.kind === 'purchase' &&
          tx.refundedBy === undefined &&
          (tx.items ?? []).some((it) => it.sku === sku),
      )
      if (!bought) bad(16, `${owner} owns ${sku} without an unrefunded purchase`)
    }
  }

  return problems
}
