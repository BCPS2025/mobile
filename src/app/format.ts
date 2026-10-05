import { content } from '@content/load'
import { formatHundredths, formatMinor } from '@domain/money'
import { approxEur } from '@domain/rate'
import type { AccountId, Minor, Party, Persona, Rate, SimTime, Tx, TxItem } from '@domain/types'
import { LJUBLJANA, daysBetween, formatTime, formatWeekday, localDateOf, zonedParts } from '@sim/tz'
import { copy, fill, ui } from './copy'

// Display helpers shared by the apps and the stage. Pure functions of state and copy.

export const personas = content.personas.personas as Persona[]

export function persona(id: AccountId): Persona | undefined {
  return personas.find((p) => p.id === id)
}

/** Off-stage people by handle. */
const offstage = new Map(content.personas.offstage.map((o) => [o.handle, o]))

/**
 * People by @handle, businesses by name (as on the reference rows: "From @marko", "Café Lipa · …").
 * A sys:offstage leg names the person behind it (`party`).
 */
export function counterpartyLabel(id: AccountId, party?: string): string {
  if (id === 'sys:offstage') return party !== undefined && offstage.has(party) ? party : ''
  const p = persona(id)
  if (!p) return ''
  return p.kind === 'person' ? p.handle : p.displayName
}

export const eur = (m: Minor, rate: Rate): string => formatHundredths(approxEur(m, rate))
export const approx = (m: Minor, rate: Rate): string => fill(ui.common.approxEur, { eur: eur(m, rate) })

/** Rate as shown on the chip: 11/10 -> "1.10". */
export function rateText(rate: Rate): string {
  return formatHundredths(Math.round((rate.bcps * 100) / rate.eur))
}

/** Visible transaction reference: the transaction id is already "BC-" plus six characters. */
export function txRef(tx: Tx): string {
  return tx.id
}

export function timeText(t: SimTime, seconds = false): string {
  return formatTime(t, LJUBLJANA, seconds)
}

export function dayTimeText(t: SimTime): string {
  return `${formatWeekday(t, LJUBLJANA)} ${formatTime(t, LJUBLJANA)}`
}

/** A bank account as a row names it: its first and last groups ("SI56 •••• •••• 1934" → "SI56 •••• 1934"). */
export function shortBank(bank: string): string {
  const parts = bank.trim().split(/\s+/)
  if (parts.length < 3) return bank
  return `${parts[0]} ${parts[1]} ${parts[parts.length - 1]}`
}

/** Row label from one account's point of view. */
export function txLabel(tx: Tx, viewer: AccountId): string {
  const meta = tx.seedMeta
  if (meta?.labelKey) {
    const template = (copy.seedRows as Record<string, unknown>)[meta.labelKey]
    if (typeof template === 'string') {
      const method = meta.method ? copy.seedRows.methods[meta.method] : ''
      return fill(template, {
        count: tx.summary?.count ?? 0,
        method,
        eur: meta.eur !== undefined ? formatHundredths(meta.eur) : '',
        amount: formatMinor(tx.amount),
        fee: formatMinor(tx.fee.fee),
        sharePct: meta.sharePct ?? 0,
      })
    }
  }
  const outgoing = tx.from === viewer
  const other = outgoing ? tx.to : tx.from
  const name = counterpartyLabel(other, tx.party)
  let label: string
  if (tx.kind === 'purchase') label = name
  else label = fill(outgoing ? ui.tx.to : ui.tx.from, { name })
  const note = tx.note ?? itemsSummary(tx)
  return note ? fill(ui.tx.withNote, { label, note }) : label
}

export function itemsSummary(tx: Tx): string {
  if (!tx.items || tx.items.length === 0) return ''
  return tx.items.map((it) => fill(ui.tx.items, { qty: it.qty, name: it.name })).join(', ')
}

/** Short payer name for the fee chip: "café" for Café Lipa, the display name otherwise. */
export function payerShort(id: AccountId): string {
  const p = persona(id)
  if (!p) return ''
  return p.kind === 'business' && p.roleLabel ? p.roleLabel.toLocaleLowerCase('en') : p.displayName
}

/** Initials for avatars: "Ana Novak" -> "AN". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

/** Seven bullets: the masked domain of an email on screen. */
const MASKED_DOMAIN = '•••••••'

/**
 * An email as the screens show it (decision D24): the local part and a masked domain,
 * "ana.novak@example.com" -> "ana.novak@•••••••". Content keeps the full reserved address; the
 * reserved domain never shows, and check-banned fails on any readable address in rendered text.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  return at < 0 ? email : `${email.slice(0, at)}@${MASKED_DOMAIN}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Fri 25 Sep · 12:15": the date chip of the stage (virtual clock, Ljubljana). */
export const dateChipText = (t: SimTime): string => dateTimeText(t, false)

/** "Fri 25 Sep · 12:15:32": a date and time with seconds (receipts). */
export function dateTimeText(t: SimTime, seconds = true): string {
  const { date } = zonedParts(t, LJUBLJANA)
  const [, month = '1', day = '1'] = date.split('-')
  return `${formatWeekday(t, LJUBLJANA)} ${Number(day)} ${MONTHS[Number(month) - 1] ?? ''} · ${formatTime(t, LJUBLJANA, seconds)}`
}

/** "Tue 22 Sep": a day heading. */
export function dayText(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
    new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  ]
  return `${weekday} ${day} ${MONTHS[month - 1] ?? ''}`
}

/** How a party is named in a line: people by @handle, businesses by name ("to @marko", "to Café Lipa"). */
export const partyLabel = (p: Pick<Party, 'kind' | 'handle' | 'displayName'>): string =>
  p.kind === 'person' ? p.handle : p.displayName

/** "2 × flat white · 2 × croissant": a sale's items. */
export function itemsText(items: readonly TxItem[] | undefined): string {
  return (items ?? [])
    .map((it) => fill(copy.tx.items, { qty: it.qty, name: it.name.toLocaleLowerCase('en') }))
    .join(' · ')
}

/**
 * When something happened, as a row or a sentence reads it, in the viewer's zone: "today 11:40" /
 * "today at 11:40", "yesterday …", or the day ("Thu 24 Sep 10:12" / "Thu 24 Sep at 10:12"). A detail
 * names it "Today · 11:40"; a status line "today · 11:40".
 */
export function whenText(
  t: SimTime,
  now: SimTime,
  tz: string,
  form: 'row' | 'sentence' | 'detail' | 'dot' = 'row',
): string {
  const date = localDateOf(t, tz)
  const age = daysBetween(date, localDateOf(now, tz))
  const time = formatTime(t, tz)
  const w = ui.when
  const pick = <K extends keyof typeof w>(row: K, sentence: K, detail: K, dot: K) =>
    w[form === 'row' ? row : form === 'sentence' ? sentence : form === 'detail' ? detail : dot]
  if (age === 0) return fill(pick('today', 'todayAt', 'detailToday', 'dotToday'), { time })
  if (age === 1) return fill(pick('yesterday', 'yesterdayAt', 'detailYesterday', 'dotYesterday'), { time })
  return fill(pick('day', 'dayAt', 'detailDay', 'dotDay'), { day: dayText(date), time })
}

/** How long ago: "today", "yesterday", "2 days ago" (a day count, in the viewer's zone). */
export function agoText(t: SimTime, now: SimTime, tz: string): string {
  const age = daysBetween(localDateOf(t, tz), localDateOf(now, tz))
  if (age <= 0) return ui.when.agoToday
  if (age === 1) return ui.when.agoYesterday
  return fill(ui.when.agoDays, { n: age })
}

/** The first word of a person's name ("Marko Kovač" → "Marko"); a business keeps its name. */
export function firstName(p: Pick<Party, 'kind' | 'displayName'>): string {
  return p.kind === 'person' ? (p.displayName.split(/\s+/)[0] ?? p.displayName) : p.displayName
}
