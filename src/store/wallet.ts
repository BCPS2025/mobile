import type { Content } from '@content/schema'
import { available, entryOf } from '@domain/ledger'
import { quoteFee } from '@domain/fees'
import { asMinor } from '@domain/money'
import { eurToMinor } from '@domain/rate'
import type {
  AutoConvertSettings,
  EurCents,
  FeeQuote,
  LedgerState,
  Minor,
  PersonaId,
  Ramp,
  SimTime,
} from '@domain/types'
import { addDays, localDateOf, resolveLocal, weekdayOfDate } from '@sim/tz'

// Money in and out as the Wallet screens need it: what a top-up gives, what a cash-out costs, the
// most that can be cashed out, the euros that cover a shortfall, and what an auto-convert schedule
// would do next. Pure over the ledger.

/** The largest amount that limits top-ups, in whole euros, for an account. */
export function topUpLimitEur(s: LedgerState, persona: PersonaId): number {
  const limits = s.config.limits.topUpMaxEur
  return entryOf(s.directory, persona)?.kind === 'business' ? limits.business : limits.person
}

/** BCPS a top-up of whole euros gives, at the rate (€50 gives 55.00). */
export function topUpAmount(s: LedgerState, eur: number): Minor {
  return eurToMinor((eur * 100) as EurCents, s.config.rate)
}

/**
 * Whole euros that cover a shortfall: the shortfall converted at the rate and rounded up to a whole
 * euro, at least €1 (5.86 BCPS short is €5.33, so €6). Never above the account's top-up limit.
 */
export function topUpForShortfall(s: LedgerState, persona: PersonaId, short: Minor): number {
  const { bcps, eur } = s.config.rate
  const cents = Math.ceil((short * eur) / bcps)
  return Math.min(Math.max(1, Math.ceil(cents / 100)), topUpLimitEur(s, persona))
}

/** The conversion a cash-out of `amount` would have (fee and euros paid out), or null when it would be refused. */
export function quoteCashOut(s: LedgerState, amount: Minor): FeeQuote | null {
  if (amount < s.config.limits.cashOutMin) return null
  const q = quoteFee(amount, s.config.fees['off-ramp'], s.config.rate, undefined, s.config.cardRange)
  return q.ok ? q.value : null
}

/** The most an account can cash out (the Max button): what is available; locked funds never count. */
export function maxCashOut(s: LedgerState, persona: PersonaId): Minor {
  return available(s, persona)
}

/** Whether an account has a bank account on file to cash out to. */
export const hasBank = (s: LedgerState, persona: PersonaId): boolean =>
  entryOf(s.directory, persona)?.methods?.bank === true

/** The bank account on file as it is shown ("SI56 •••• •••• 1934"), or undefined without one. */
export const bankOf = (content: Content, persona: PersonaId): string | undefined =>
  content.personas.personas.find((p) => p.id === persona)?.methods?.bank

/** A way to top up that an account has on file. */
export type TopUpMethod =
  | { method: 'card' /** The last four digits. */; last4: string }
  | { method: 'bank-transfer' /** The account the money comes from, masked. */; bank: string }
  | { method: 'local-method' }

/**
 * The ways an account can top up, in the order they are listed: its card (if it has one), its bank
 * transfer (if a bank is on file), and a local payment method (always). A café has no card.
 */
export function topUpMethods(s: LedgerState, persona: PersonaId, content: Content): TopUpMethod[] {
  const me = entryOf(s.directory, persona)
  const on = content.personas.personas.find((p) => p.id === persona)?.methods
  const out: TopUpMethod[] = []
  if (me?.methods?.card && on?.card) out.push({ method: 'card', last4: on.card })
  if (me?.methods?.bank && on?.bank) out.push({ method: 'bank-transfer', bank: on.bank })
  out.push({ method: 'local-method' })
  return out
}

/**
 * The top-up or cash-out a command made (a flow finds its ramp by its command id; a bank transfer has no
 * payment yet, only this).
 */
export function rampByCmdId(s: LedgerState, cmdId: string): Ramp | undefined {
  return (Object.values(s.ramps) as Ramp[]).find((r) => r.cmdId === cmdId)
}

// ---- auto-convert

/** Local weekdays an auto-convert schedule runs on (0 = Sunday): every day, Monday to Friday, or its one day. */
export function convertDays(settings: AutoConvertSettings): number[] {
  return settings.schedule === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : settings.weekdays
}

/** The first moment at or after `now` a schedule would run (its time on the next day it applies). */
export function nextAutoConvert(settings: AutoConvertSettings, now: SimTime, tz: string): SimTime {
  const days = convertDays(settings)
  let date = localDateOf(now, tz)
  for (let i = 0; i < 8; i++, date = addDays(date, 1)) {
    if (!days.includes(weekdayOfDate(date))) continue
    const at = resolveLocal(date, settings.atLocal, tz)
    if (at >= now) return at
  }
  throw new Error('a schedule with no day')
}

export interface AutoConvertPreview {
  /** The next time it would run. */
  at: SimTime
  /** Half the balance, or whatever share: what would be converted, the fee and the euros. */
  amount: Minor
  fee: Minor
  eur: EurCents
}

/**
 * What the schedule would convert next from the balance now: `sharePct` of what is available, round
 * half-up, with the 1.5 % conversion (fresh café at 50 %: 143.00, ≈ €128.05). Null when the share of the
 * balance is below the cash-out minimum. It is only shown: nothing converts by itself.
 */
export function autoConvertPreview(
  s: LedgerState,
  persona: PersonaId,
  settings: AutoConvertSettings,
  now: SimTime,
  tz: string,
): AutoConvertPreview | null {
  const amount = asMinor(Math.floor((available(s, persona) * settings.sharePct * 2 + 100) / 200))
  const q = quoteCashOut(s, amount)
  if (!q) return null
  return { at: nextAutoConvert(settings, now, tz), amount, fee: q.fee, eur: q.eurOut ?? (0 as EurCents) }
}
