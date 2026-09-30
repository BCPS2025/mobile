import type { Content, SeedRow } from '@content/schema'
import { cardCompareMinMinor, quoteFee, summaryFee } from '@domain/fees'
import { nextRefSeq, txRef } from '@domain/ids'
import { kindOfPolicy, postingsFor } from '@domain/ledger'
import { asMinor, mustParseEurCents, mustParseMinor } from '@domain/money'
import { eurToMinor } from '@domain/rate'
import type {
  AccountId,
  Balance,
  Counters,
  FeePolicy,
  FeePolicyId,
  FeeQuote,
  Handle,
  LedgerState,
  MerchantSettings,
  Minor,
  Party,
  PartyId,
  PaymentRequest,
  Persona,
  PersonaId,
  Plan,
  SimConfig,
  SimTime,
  Tx,
  TxItem,
} from '@domain/types'
import { SYSTEM_ACCOUNTS } from '@domain/types'
import { type IsoDate, addDays, mostRecentWeekdayOnOrBefore, resolveLocal } from './tz'

// Builds the starting ledger from validated content: the seed rows (chronological, references
// from refSeq in that order), the directory, the seeded requests and invoices, merchant
// settings, plans, ownership and counters. Throws on any arithmetic that does not add up.

export interface SeedResult {
  state: LedgerState
  /** T0: the most recent configured weekday on or before the epoch date, at the configured local time. */
  t0: SimTime
  t0Date: IsoDate
  personas: Persona[]
}

export function simConfigFrom(content: Content): SimConfig {
  const { config } = content
  const rate = { bcps: config.rate.bcps, eur: config.rate.eur }
  const fees = {} as Record<FeePolicyId, FeePolicy>
  for (const [id, p] of Object.entries(config.fees) as [FeePolicyId, (typeof config.fees)[FeePolicyId]][]) {
    switch (p.kind) {
      case 'flat':
        fees[id] = {
          id,
          kind: 'flat',
          flatEurCents: p.flatEurCents,
          payer: p.payer,
          cardCompareMinMinor:
            p.cardCompareMinEurCents === null ? null : cardCompareMinMinor(p.cardCompareMinEurCents, rate),
        }
        break
      case 'percent':
        fees[id] = {
          id,
          kind: 'percent',
          rateBps: p.rateBps,
          payer: p.payer,
          cardCompareMinMinor:
            p.cardCompareMinEurCents === null ? null : cardCompareMinMinor(p.cardCompareMinEurCents, rate),
        }
        break
      case 'zero':
        fees[id] = { id, kind: 'zero' }
        break
    }
  }
  const l = config.limits
  return {
    settleMs: config.settleMs,
    posCodeValidityMs: config.posCodeValidityMin * 60_000,
    rate,
    fees,
    cardRange: { ...config.cardRange },
    bankingHours: {
      SI: { ...config.bankingHours.SI, days: [...config.bankingHours.SI.days] },
      KR: { ...config.bankingHours.KR, days: [...config.bankingHours.KR.days] },
    },
    bankTransfer: { ...config.bankTransferTopUp },
    limits: {
      consumerMax: mustParseMinor(l.consumerMax),
      businessMax: mustParseMinor(l.businessMax),
      topUpMaxEur: { ...l.topUpMaxEur },
      cashOutMin: mustParseMinor(l.cashOutMin),
      noteMaxChars: l.noteMaxChars,
    },
  }
}

export function computeT0(content: Content, epochDate: IsoDate): { t0: SimTime; t0Date: IsoDate } {
  const { weekday, time, tz } = content.config.t0
  const t0Date = mostRecentWeekdayOnOrBefore(epochDate, weekday)
  return { t0: resolveLocal(t0Date, time, tz), t0Date }
}

/** Resolve catalogue item references into priced items. */
export function resolveItems(content: Content, merchant: PersonaId, refs: { sku: string; qty: number }[]): TxItem[] {
  const catalogue = content.catalogue.products[merchant] ?? []
  return refs.map((r) => {
    const item = catalogue.find((c) => c.sku === r.sku)
    if (!item) throw new Error(`Unknown catalogue item ${merchant}/${r.sku}`)
    return { sku: item.sku, name: item.name, qty: r.qty, price: mustParseMinor(item.price) }
  })
}

/** Gross of a studio product mix: Σ count × catalogue price. */
export function mixGross(content: Content, merchant: PersonaId, mix: Record<string, number>): Minor {
  const items = resolveItems(
    content,
    merchant,
    Object.entries(mix).map(([sku, qty]) => ({ sku, qty })),
  )
  return asMinor(items.reduce((acc, it) => acc + it.qty * it.price, 0))
}

/** The fee quote of a seed row: computed from its policy, then checked against the row's own figures. */
export function rowQuote(row: SeedRow, config: SimConfig): FeeQuote {
  const policy = row.policy ? config.fees[row.policy] : undefined
  let q: FeeQuote
  if (row.summary) {
    // Daily sales summary: the policy fee on the row's gross (1 % under D29, rounded once),
    // paid by the business; no card comparison.
    if (!policy || policy.kind === 'zero') throw new Error(`seed row ${row.key}: a summary needs a fee policy`)
    const gross = mustParseMinor(row.summary.gross)
    const fee = summaryFee(row.summary.count, gross, policy, config.rate)
    if (gross <= fee) throw new Error(`seed row ${row.key}: gross does not cover the fees`)
    q = {
      policy: policy.id,
      fee,
      payer: 'recipient',
      rule: policy.kind,
      senderDebit: gross,
      recipientCredit: asMinor(gross - fee),
    }
  } else {
    const amount = mustParseMinor(row.amount ?? '')
    if (policy) {
      const r = quoteFee(amount, policy, config.rate, row.feePayer, config.cardRange)
      if (!r.ok) throw new Error(`seed row ${row.key}: ${r.error}`)
      q = r.value
    } else {
      q = { policy: null, fee: asMinor(0), payer: null, rule: 'zero', senderDebit: amount, recipientCredit: amount }
    }
  }
  if (row.fee !== undefined && mustParseMinor(row.fee) !== q.fee) {
    throw new Error(`seed row ${row.key}: fee ${row.fee} is not the policy fee ${q.fee}`)
  }
  if (row.feePayer !== undefined && row.feePayer !== q.payer) {
    throw new Error(`seed row ${row.key}: feePayer ${row.feePayer} is not the policy payer ${q.payer}`)
  }
  if (row.eur !== undefined) {
    const eur = mustParseEurCents(row.eur)
    if (row.kind === 'on-ramp' && eurToMinor(eur, config.rate) !== q.senderDebit) {
      throw new Error(`seed row ${row.key}: €${row.eur} does not convert to the row amount`)
    }
    if (row.kind === 'off-ramp' && q.eurOut !== eur) {
      throw new Error(`seed row ${row.key}: €${row.eur} is not the converted amount ${q.eurOut}`)
    }
  }
  return q
}

/** The directory: every persona, then the off-stage people (id = their handle). */
export function directoryFrom(content: Content): {
  directory: Record<PartyId, Party>
  handles: Record<Handle, PartyId>
} {
  const directory: Record<PartyId, Party> = {}
  const handles: Record<Handle, PartyId> = {}
  for (const p of content.personas.personas) {
    const party: Party = {
      id: p.id,
      handle: p.handle as Handle,
      displayName: p.displayName,
      kind: p.kind,
      onStage: p.onStage,
    }
    if (p.shell === 'pos' || p.shell === 'studio') party.merchant = true
    party.country = p.country
    if (p.methods) party.methods = { card: p.methods.card !== undefined, bank: true }
    directory[p.id] = party
    handles[p.handle as Handle] = p.id
  }
  for (const o of content.personas.offstage) {
    const id = o.handle
    directory[id] = {
      id,
      handle: o.handle as Handle,
      displayName: o.displayName,
      kind: 'person',
      onStage: false,
      offstage: true,
    }
    handles[o.handle as Handle] = id
  }
  return { directory, handles }
}

export function buildSeed(content: Content, epochDate: IsoDate): SeedResult {
  const config = simConfigFrom(content)
  const { t0, t0Date } = computeT0(content, epochDate)
  const tz = content.config.t0.tz
  const personas = content.personas.personas as Persona[]
  const { directory, handles } = directoryFrom(content)

  const balances = {} as Record<AccountId, Balance>
  const zero = { confirmed: 0 as Minor, held: 0 as Minor }
  for (const p of personas) balances[p.id] = { ...zero }
  for (const s of SYSTEM_ACCOUNTS) balances[s] = { ...zero }

  const at = (dt: { day: number; time: string }): SimTime => resolveLocal(addDays(t0Date, dt.day), dt.time, tz)

  const rows = content.seed.rows
    .map((row, index) => ({ row, index, time: at(row.at) }))
    .sort((a, b) => a.time - b.time || a.index - b.index)

  const txs: Record<string, Tx> = {}
  const txOrder: string[] = []
  let refSeq = 0
  for (const { row, time } of rows) {
    if (time > t0) throw new Error(`seed row ${row.key} is after T0`)
    for (const a of [row.from, row.to]) {
      if (!balances[a]) throw new Error(`seed row ${row.key}: unknown account ${a}`)
    }
    const q = rowQuote(row, config)
    refSeq = nextRefSeq(refSeq)
    const id = txRef(refSeq)
    const party = row.party as Handle | undefined
    if (party !== undefined && !directory[party]?.offstage)
      throw new Error(`seed row ${row.key}: unknown party ${party}`)
    const tx: Tx = {
      id,
      kind: row.kind,
      channel: row.channel,
      status: 'confirmed',
      from: row.from,
      to: row.to,
      amount: mustParseMinor(row.summary ? row.summary.gross : (row.amount ?? '')),
      fee: q,
      postings: postingsFor(row.from, row.to, q, party),
      createdAt: time,
      dueAt: time,
      confirmedAt: time,
      seed: true,
      seedMeta: { key: row.key },
    }
    if (row.policy && row.kind !== kindOfPolicy(row.policy) && row.kind !== 'on-ramp' && row.kind !== 'off-ramp') {
      throw new Error(`seed row ${row.key}: kind ${row.kind} does not match policy ${row.policy}`)
    }
    const meta = tx.seedMeta ?? { key: row.key }
    if (row.labelKey !== undefined) meta.labelKey = row.labelKey
    if (row.eur !== undefined) meta.eur = mustParseEurCents(row.eur)
    if (row.method !== undefined) meta.method = row.method
    if (row.sharePct !== undefined) meta.sharePct = row.sharePct
    if (row.startedAt !== undefined) meta.startedAt = at({ day: row.at.day, time: row.startedAt })
    if (party !== undefined) tx.party = party
    if (row.note !== undefined) tx.note = row.note
    if (row.summary) {
      tx.summary = { count: row.summary.count }
      if (row.summary.mix) {
        tx.summary.mix = { ...row.summary.mix }
        const gross = mixGross(content, row.to, row.summary.mix)
        if (gross !== tx.amount) throw new Error(`seed row ${row.key}: gross is not Σ mix × price (${gross})`)
        const count = Object.values(row.summary.mix).reduce((a, b) => a + b, 0)
        if (count !== row.summary.count) throw new Error(`seed row ${row.key}: count is not Σ mix`)
      }
    }
    if (row.items) {
      tx.items = resolveItems(content, row.to, row.items)
      const sum = tx.items.reduce((acc, it) => acc + it.qty * it.price, 0)
      if (sum !== tx.amount) throw new Error(`seed row ${row.key}: items add up to ${sum}, not the amount`)
    }
    for (const p of tx.postings) {
      const b = balances[p.account] ?? { ...zero }
      const next = { ...b, confirmed: asMinor(b.confirmed + p.delta) }
      balances[p.account] = next
      if (!p.account.startsWith('sys:') && next.confirmed < 0) {
        throw new Error(`seed row ${row.key}: ${p.account} goes below zero`)
      }
    }
    txs[id] = tx
    txOrder.push(id)
  }

  const requests: Record<string, PaymentRequest> = {}
  for (const r of content.seed.requests) {
    requests[r.id] = {
      id: r.id,
      requester: r.requester,
      payer: r.payer,
      amount: mustParseMinor(r.amount),
      ...(r.note !== undefined ? { note: r.note } : {}),
      channel: r.channel,
      feePayer: 'sender',
      policy: 'transfer',
      status: 'open',
      createdAt: at(r.at),
    }
  }
  for (const inv of content.seed.invoices) {
    const issuedAt = at(inv.issuedAt)
    requests[inv.id] = {
      id: inv.id,
      requester: inv.issuer,
      payer: inv.payer,
      amount: mustParseMinor(inv.amount),
      channel: 'invoice',
      invoice: {
        number: inv.id,
        description: inv.description,
        dueAt: at({ day: inv.issuedAt.day + inv.dueDays, time: inv.issuedAt.time }),
      },
      feePayer: 'sender',
      policy: 'transfer',
      status: 'open',
      createdAt: issuedAt,
    }
  }

  const merchant: Record<PersonaId, MerchantSettings> = {}
  for (const [id, m] of Object.entries(content.config.merchants)) {
    merchant[id] = { feePayer: m.feePayer, autoConvert: { ...m.autoConvert, weekdays: [...m.autoConvert.weekdays] } }
  }

  const plans: Record<string, Plan> = {}
  for (const p of content.catalogue.plans) {
    plans[p.id] = { ...p, amount: mustParseMinor(p.amount) }
  }

  const ownership: Record<PartyId, string[]> = {}
  for (const [id, skus] of Object.entries(content.seed.ownership)) ownership[id] = [...skus]

  const invoiceSeq: Counters['invoiceSeq'] = {}
  for (const [id, n] of Object.entries(content.config.invoiceNumbers)) invoiceSeq[id] = { ...n }

  const state: LedgerState = {
    stateVersion: content.config.stateVersion,
    seq: 0,
    balances,
    txs,
    txOrder,
    pendingRamps: [],
    pending: [],
    directory,
    handles,
    requests,
    links: {},
    splits: {},
    plans,
    subscriptions: {},
    escrows: {},
    ramps: {},
    merchant,
    accounts: {},
    ownership,
    stats: { studio: { activeSubscribers: content.seed.stats.studio.activeSubscribers } },
    counters: { refSeq, requestSeq: 0, linkSeq: 0, splitSeq: 0, subSeq: 0, escrowSeq: 0, rampSeq: 0, invoiceSeq },
    seenCmdIds: {},
    config,
  }
  return { state, t0, t0Date, personas }
}
