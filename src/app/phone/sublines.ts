import type { Content } from '@content/schema'
import { formatHundredths, formatMinor } from '@domain/money'
import type { AutoConvertSettings, LedgerState, PersonaId, SimTime } from '@domain/types'
import { badges, bankOf, invoices, payoutsOf, salesToday } from '@store/selectors'
import { fill, ui } from '../copy'

// The grey line under a tile's label or a hub row's label, filled from state: "1 to pay", "23 today ·
// 111.38", "Auto 50% · 23:00", "This week ≈ €913.89". Hints that never change are plain copy. A line
// with nothing to say (no bank on file, no payment to pay) is null and the tile or row shows none.

export interface SublineCtx {
  state: LedgerState
  content: Content
  persona: PersonaId
  now: SimTime
  tz: string
}

const hints = ui.hubs.sublines as Record<string, string>
const STATIC = new Set(['sendHint', 'requestHint', 'linkHint', 'splitHint', 'supplierHint', 'topUpHint'])

/** The auto-convert schedule an account has saved, if it is a business with one. */
export const autoConvertOf = (state: LedgerState, persona: PersonaId): AutoConvertSettings | undefined =>
  state.merchant[persona]?.autoConvert

export function sublineOf(id: string | undefined, c: SublineCtx): string | null {
  if (id === undefined) return null
  if (STATIC.has(id)) return hints[id] ?? null
  switch (id) {
    case 'toPay': {
      // Requests, links and split shares for a person; invoices for a business.
      const b = badges(c.state, c.persona)
      const count = b.toPay + b.invoicesToPay
      return count > 0 ? fill(ui.hubs.sublines.toPay, { count }) : null
    }
    case 'invoicesToPay': {
      // "PZ-0412 · 52.80" for one invoice, a count for several, nothing for none.
      const open = invoices(c.state, c.persona, 'toPay')
      const first = open[0]
      if (!first) return null
      return open.length === 1
        ? fill(ui.hubs.sublines.invoicesToPay, { number: first.number, amount: formatMinor(first.amount) })
        : fill(ui.hubs.sublines.invoicesToPayMany, { count: open.length })
    }
    case 'salesToday': {
      const t = salesToday(c.state, c.persona, c.now, c.tz)
      return fill(ui.hubs.sublines.salesToday, { count: t.count, gross: formatMinor(t.gross) })
    }
    case 'cashOutTo': {
      const bank = bankOf(c.content, c.persona)
      return bank ? fill(ui.hubs.sublines.cashOutTo, { bank }) : null
    }
    case 'autoConvert': {
      // On a tile: only while it is on.
      const a = autoConvertOf(c.state, c.persona)
      return a?.enabled ? fill(ui.hubs.sublines.autoConvert, { sharePct: a.sharePct, time: a.atLocal }) : null
    }
    case 'autoConvertOn': {
      // On a row: how it stands, on or off.
      const a = autoConvertOf(c.state, c.persona)
      if (!a) return null
      return a.enabled
        ? fill(ui.hubs.sublines.autoConvertOn, { sharePct: a.sharePct, time: a.atLocal })
        : ui.hubs.sublines.autoConvertOff
    }
    case 'feePayer': {
      // Who pays the fee on this business's sales, as the Settings list says it.
      const payer = c.state.merchant[c.persona]?.feePayer
      if (!payer) return null
      return payer === 'recipient' ? ui.hubs.sublines.feePayerYou : ui.hubs.sublines.feePayerCustomer
    }
    case 'payoutAccount':
      return bankOf(c.content, c.persona) ?? null
    case 'payoutsThisWeek': {
      const week = payoutsOf(c.state, c.persona, c.now, c.tz).week
      return fill(ui.hubs.sublines.payoutsThisWeek, { eur: formatHundredths(week.eur) })
    }
    default:
      return null
  }
}
