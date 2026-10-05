import type { Content } from '@content/schema'
import { fillTemplate } from '@domain/counter'
import { entryOf } from '@domain/ledger'
import { formatMinor } from '@domain/money'
import type { LedgerState, Minor, PaymentLink, PaymentRequest, PersonaId, Ramp, SimTime, Tx } from '@domain/types'
import { type IsoDate, dayLabel, formatTime, formatWeekday, instantOfAt, localDateOf } from '@sim/tz'
import type { ReadMarks } from './record'

// Notifications are derived from the ledger, never stored (content/notifications.yaml): a
// settled payment, a request that arrives, is declined or cancelled, a payment link sent to you, a
// bank transfer on its way and the like create one for the account it concerns. Read marks are UI
// state (UiState.read: `readIds` per notification, `readUpTo` for "Mark all as read"). What the
// starting ledger holds creates none, except the entries of seed.yaml `unread` (Ana's Lunch request,
// the café's Thursday conversion and its invoice), which start unread.

export type NotificationKind =
  | 'p2p.received'
  | 'sale.received'
  | 'request.received'
  | 'request.paid'
  | 'request.declined'
  | 'request.cancelled'
  | 'link.received'
  | 'link.paid'
  | 'split.received'
  | 'split.completed'
  | 'refund.received'
  | 'topup.completed'
  | 'topup.pending'
  | 'topup.arrived'
  | 'cashout.sent'
  | 'invoice.received'
  | 'invoice.declined'
  | 'invoice.cancelled'
  | 'conversion.auto'

/** What a notification is about (the screen it opens is `opens`). */
export type NotificationSubject =
  | { type: 'tx'; id: string }
  | { type: 'request'; id: string }
  | { type: 'link'; id: string }
  | { type: 'split'; id: string }
  | { type: 'ramp'; id: string }
  | { type: 'none' }

export interface Notification {
  /** Stable id, also the read mark: `tx:<reference>`, `request:<id>`, `link:<id>:<person>`, … */
  id: string
  kind: NotificationKind
  persona: PersonaId
  /** When it happened (a payment: when it settled). */
  at: SimTime
  /** The payment it is about, or null for one that concerns a request, a link or a bank transfer. */
  txId: string | null
  subject: NotificationSubject
  title: string
  line: string | null
  /** The stage's toast when it is drawn shorter than the banner (null: none of its own). */
  toastTitle: string | null
  toastLine: string | null
  /** The amount the title names (a payment as its payer sent it). */
  amount: Minor
  /** What tapping it opens (content/notifications.yaml `opens`). */
  opens: Content['notifications'][string]['opens']
  banner: boolean
  toast: boolean
}

/** "2 × flat white · 2 × croissant" (the sale's items; the payment note when there are none). */
export function itemsLine(tx: Tx, content: Content): string {
  if (tx.items && tx.items.length > 0) {
    return tx.items
      .map((it) => fillTemplate(content.copy.tx.items, { qty: it.qty, name: it.name.toLocaleLowerCase('en') }))
      .join(' · ')
  }
  return tx.note ?? ''
}

/** The @handle of an account or off-stage person without the @ ("marko"), or "" when unknown. */
function handleOf(s: LedgerState, id: string): string {
  const handle = entryOf(s.directory, id)?.handle ?? (id.startsWith('@') ? id : '')
  return handle.replace(/^@/, '')
}

const nameOf = (s: LedgerState, id: string): string => entryOf(s.directory, id)?.displayName ?? ''

/** The @handle of the account or off-stage person a payment came from, without the @. */
function payerOf(s: LedgerState, tx: Tx): string {
  const handle = tx.from === 'sys:offstage' ? tx.party : s.directory[tx.from]?.handle
  return (handle ?? '').replace(/^@/, '')
}

const personaOf = (content: Content, id: PersonaId) => content.personas.personas.find((p) => p.id === id)

type Values = Record<string, string | number>

/** A notification of `kind` for `persona`, its texts filled from `values` (null when the kind has no entry). */
function build(
  content: Content,
  kind: NotificationKind,
  persona: PersonaId,
  at: SimTime,
  id: string,
  subject: NotificationSubject,
  amount: Minor,
  values: Values,
): Notification | null {
  const entry = content.notifications[kind]
  if (!entry) return null
  const line = entry.line ? fillTemplate(entry.line, values).replace(/^[\s·]+|[\s·]+$/g, '') : ''
  return {
    id,
    kind,
    persona,
    at,
    txId: subject.type === 'tx' ? subject.id : null,
    subject,
    title: fillTemplate(entry.title, values),
    line: line.length > 0 ? line : null,
    toastTitle: entry.toastTitle ? fillTemplate(entry.toastTitle, values) : null,
    toastLine: entry.toastLine ? fillTemplate(entry.toastLine, values) : null,
    amount,
    opens: entry.opens,
    banner: entry.banner,
    toast: entry.toast,
  }
}

/** A payment method as a line names it: "Card •• 7719", "Bank transfer", "Local payment method". */
function methodText(content: Content, persona: PersonaId, method: Ramp['method']): string {
  const labels = content.copy.methodLabels
  if (method === 'card') return fillTemplate(labels.card, { last4: personaOf(content, persona)?.methods?.card ?? '' })
  return method === 'bank-transfer' ? labels['bank-transfer'] : labels['local-method']
}

/** "Fri 14:15" in the account's own zone. */
function whenText(content: Content, persona: PersonaId, t: SimTime): string {
  const tz = personaOf(content, persona)?.tz ?? content.config.t0.tz
  return `${formatWeekday(t, tz)} ${formatTime(t, tz)}`
}

const eurText = (eur: number): string => formatMinor(eur as Minor)

/**
 * The kind a settled transaction has for the account it concerns, or null when it has none (yet).
 * A request payment tells the requester (the split's owner hears once everyone paid), a link payment
 * the owner, a refund the customer, a top-up its account, a cash-out the account that made it.
 */
function kindOfTx(s: LedgerState, tx: Tx, persona: PersonaId): NotificationKind | null {
  if (tx.seed || tx.status !== 'confirmed') return null
  if (tx.kind === 'off-ramp') return tx.from === persona ? 'cashout.sent' : null
  if (tx.to !== persona) return null
  switch (tx.kind) {
    case 'purchase':
      return tx.channel === 'qr' || tx.channel === 'pos' ? 'sale.received' : null
    case 'refund':
      return 'refund.received'
    case 'on-ramp': {
      const ramp = tx.rampId !== undefined ? entryOf(s.ramps, tx.rampId) : undefined
      return ramp?.method === 'bank-transfer' ? 'topup.arrived' : 'topup.completed'
    }
    case 'transfer': {
      if (tx.from === 'sys:issuance') return null
      const request = tx.links?.requestId !== undefined ? entryOf(s.requests, tx.links.requestId) : undefined
      if (request?.channel === 'invoice') return null
      if (request?.channel === 'split') return completesSplit(s, tx, request) ? 'split.completed' : 'request.paid'
      if (request) return 'request.paid'
      if (tx.links?.linkId !== undefined) return 'link.paid'
      return 'p2p.received'
    }
    default:
      return null
  }
}

/** Whether a share's payment is the one that makes everyone in its split paid (the last to settle). */
function completesSplit(s: LedgerState, tx: Tx, request: PaymentRequest): boolean {
  const split = request.splitId !== undefined ? entryOf(s.splits, request.splitId) : undefined
  if (!split) return false
  let last: Tx | undefined
  for (const share of split.shares) {
    const r = entryOf(s.requests, share.requestId)
    const paid = r?.txId !== undefined ? entryOf(s.txs, r.txId) : undefined
    if (r?.status !== 'paid' || !paid) return false
    // A payment that has not settled yet is later than any that has.
    const at = paid.confirmedAt ?? Number.POSITIVE_INFINITY
    if (!last || at > (last.confirmedAt ?? Number.POSITIVE_INFINITY)) last = paid
  }
  return last?.id === tx.id
}

/** The notification a settled transaction creates for `persona`, or null. */
export function notificationOf(s: LedgerState, tx: Tx, persona: PersonaId, content: Content): Notification | null {
  const kind = kindOfTx(s, tx, persona)
  if (!kind) return null
  const at = tx.confirmedAt ?? tx.createdAt
  const subject: NotificationSubject = { type: 'tx', id: tx.id }
  const request = tx.links?.requestId !== undefined ? entryOf(s.requests, tx.links.requestId) : undefined
  const ramp = tx.rampId !== undefined ? entryOf(s.ramps, tx.rampId) : undefined
  const split = request?.splitId !== undefined ? entryOf(s.splits, request.splitId) : undefined
  const link = tx.links?.linkId !== undefined ? entryOf(s.links, tx.links.linkId) : undefined
  const owner = link?.owner
  const note = request?.note ?? link?.note ?? tx.note ?? ''
  const values: Values = {
    payer: payerOf(s, tx),
    owner: owner !== undefined ? handleOf(s, owner) : '',
    merchant: nameOf(s, tx.from),
    amount: formatMinor(tx.amount),
    note: kind === 'split.completed' ? (split?.note ?? note) : note,
    items: itemsLine(tx, content),
    eur: eurText(kind === 'cashout.sent' ? (tx.fee.eurOut ?? 0) : (ramp?.eur ?? 0)),
    method: ramp ? methodText(content, persona, ramp.method) : '',
    bank: personaOf(content, persona)?.methods?.bank ?? '',
    collected: split ? formatMinor(split.shares.reduce((sum, sh) => sum + sh.amount, 0) as Minor) : '',
  }
  const amount = kind === 'split.completed' && split ? ((split.total - split.ownShare) as Minor) : tx.amount
  return build(content, kind, persona, at, `tx:${tx.id}`, subject, amount, values)
}

/** How a request came to be looked at: it arrived, was turned down or was withdrawn. */
export type RequestEvent = 'created' | 'declined' | 'cancelled'

/**
 * The notification a request creates for `persona` when it is made (the payer), declined (the
 * requester) or cancelled (the payer); null for a payment code (it has no payer) or when the
 * persona is not the one concerned. Split shares and invoices use their own kinds.
 */
export function requestNotification(
  s: LedgerState,
  request: PaymentRequest,
  persona: PersonaId,
  content: Content,
  event: RequestEvent,
): Notification | null {
  if (request.channel === 'pos' || request.payer === undefined) return null
  const invoice = request.channel === 'invoice'
  const subject: NotificationSubject = { type: 'request', id: request.id }
  const base: Values = {
    requester: handleOf(s, request.requester),
    owner: handleOf(s, request.requester),
    payer: handleOf(s, request.payer),
    issuer: nameOf(s, request.requester),
    name: nameOf(s, request.payer),
    amount: formatMinor(request.amount),
    note: request.note ?? '',
    number: request.invoice?.number ?? '',
    reason: request.declineReason ?? '',
  }
  if (event === 'created') {
    if (request.payer !== persona) return null
    const kind: NotificationKind = invoice
      ? 'invoice.received'
      : request.channel === 'split'
        ? 'split.received'
        : 'request.received'
    const tz = personaOf(content, persona)?.tz ?? content.config.t0.tz
    const due: Values = request.invoice ? { date: dayLabel(localDateOf(request.invoice.dueAt, tz)) } : {}
    return build(content, kind, persona, request.createdAt, `request:${request.id}`, subject, request.amount, {
      ...base,
      ...due,
    })
  }
  const at = request.closedAt ?? request.createdAt
  if (event === 'declined') {
    if (request.requester !== persona) return null
    const kind: NotificationKind = invoice ? 'invoice.declined' : 'request.declined'
    return build(content, kind, persona, at, `declined:${request.id}`, subject, request.amount, base)
  }
  if (request.payer !== persona) return null
  const kind: NotificationKind = invoice ? 'invoice.cancelled' : 'request.cancelled'
  return build(content, kind, persona, at, `cancelled:${request.id}`, { type: 'none' }, request.amount, base)
}

/** The notification of a payment link sent to `sharedWith[index]`, or null. */
export function linkNotification(
  s: LedgerState,
  link: PaymentLink,
  index: number,
  persona: PersonaId,
  content: Content,
): Notification | null {
  const to = link.sharedWith[index]
  const at = link.sharedAt[index]
  if (to === undefined || at === undefined || to !== persona) return null
  return build(
    content,
    'link.received',
    persona,
    at,
    `link:${link.id}:${to}`,
    { type: 'link', id: link.id },
    link.amount,
    {
      owner: handleOf(s, link.owner),
      amount: formatMinor(link.amount),
      note: link.note ?? '',
    },
  )
}

/** "Top-up on its way": a bank transfer that was asked for. */
export function rampNotification(ramp: Ramp, content: Content): Notification | null {
  if (ramp.method !== 'bank-transfer' || ramp.direction !== 'on' || ramp.arrivesAt === undefined) return null
  return build(
    content,
    'topup.pending',
    ramp.persona,
    ramp.requestedAt,
    `ramp:${ramp.id}`,
    { type: 'ramp', id: ramp.id },
    ramp.amount,
    {
      eur: eurText(ramp.eur),
      arrivesAt: whenText(content, ramp.persona, ramp.arrivesAt),
    },
  )
}

/** A reference of seed.yaml `unread`: `request:r_seed_lunch`, `invoice:PZ-0412`, `tx:cafe-autoconvert-thu`. */
function seedRefs(content: Content, persona: PersonaId): { kind: string; id: string }[] {
  return (content.seed.unread[persona] ?? []).map((ref) => {
    const [kind = '', id = ''] = ref.split(/:(.*)/)
    return { kind, id }
  })
}

/** The Thursday conversion of the starting ledger, as its own notification ("Auto-converted 175.73 BCPS"). */
function seedConversion(s: LedgerState, key: string, persona: PersonaId, content: Content): Notification | null {
  const tx = s.txOrder.map((id) => s.txs[id]).find((t) => t?.seed && t.seedMeta?.key === key)
  if (tx?.kind !== 'off-ramp' || tx.from !== persona) return null
  const values: Values = {
    amount: formatMinor(tx.amount),
    eur: eurText(tx.fee.eurOut ?? 0),
    fee: formatMinor(tx.fee.fee),
  }
  return build(
    content,
    'conversion.auto',
    persona,
    tx.confirmedAt ?? tx.createdAt,
    `tx:${tx.id}`,
    { type: 'tx', id: tx.id },
    tx.amount,
    values,
  )
}

/**
 * Every notification of an account, newest first: those of settled payments and of what happened
 * to its requests, links and bank transfers since the start, and the ones the starting ledger
 * lists as unread.
 */
export function notificationsFor(s: LedgerState, persona: PersonaId, content: Content): Notification[] {
  const out: Notification[] = []
  const add = (n: Notification | null) => {
    if (n) out.push(n)
  }
  for (const id of s.txOrder) {
    const tx = s.txs[id]
    if (tx) add(notificationOf(s, tx, persona, content))
  }
  const listed = seedRefs(content, persona)
  const seededUnread = (kind: string, id: string) => listed.some((r) => r.kind === kind && r.id === id)
  for (const request of Object.values(s.requests)) {
    // A request the starting ledger holds is a notification only when it is listed as unread.
    const live = request.cmdId !== undefined
    const listedAs = request.channel === 'invoice' ? 'invoice' : 'request'
    if (live || seededUnread(listedAs, request.id)) add(requestNotification(s, request, persona, content, 'created'))
    if (request.status === 'declined') add(requestNotification(s, request, persona, content, 'declined'))
    if (request.status === 'cancelled') add(requestNotification(s, request, persona, content, 'cancelled'))
  }
  for (const link of Object.values(s.links)) {
    for (let i = 0; i < link.sharedWith.length; i++) add(linkNotification(s, link, i, persona, content))
  }
  for (const ramp of Object.values(s.ramps)) if (ramp.persona === persona) add(rampNotification(ramp, content))
  for (const r of listed) if (r.kind === 'tx') add(seedConversion(s, r.id, persona, content))
  return out.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function isRead(n: Notification, marks: ReadMarks | undefined, t0Date: IsoDate, tz: string): boolean {
  if (!marks) return false
  if (marks.readIds.includes(n.id)) return true
  return marks.readUpTo !== null && instantOfAt(t0Date, marks.readUpTo, tz) >= n.at
}

/** The number on the bell and in the account menu. */
export function unreadCount(
  s: LedgerState,
  persona: PersonaId,
  content: Content,
  marks: ReadMarks | undefined,
  t0Date: IsoDate,
  tz: string,
): number {
  return notificationsFor(s, persona, content).filter((n) => !isRead(n, marks, t0Date, tz)).length
}
