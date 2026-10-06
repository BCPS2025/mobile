import type { Content } from '@content/schema'
import { formatMinor } from '@domain/money'
import type { LedgerState, PersonaId, SimTime } from '@domain/types'
import { badges, salesToday } from '@store/selectors'
import { fill, ui } from '../copy'

// The grey line under a tile's label or a hub row's label, filled from state: "1 to pay", "23 today ·
// 111.38". Hints that never change are plain copy. A line with nothing to say (no payment to pay) is
// null and the tile or row shows none.

export interface SublineCtx {
  state: LedgerState
  content: Content
  persona: PersonaId
  now: SimTime
  tz: string
}

const hints = ui.hubs.sublines as Record<string, string>
const STATIC = new Set(['sendHint', 'requestHint', 'linkHint', 'splitHint', 'supplierHint', 'topUpHint'])

export function sublineOf(id: string | undefined, c: SublineCtx): string | null {
  if (id === undefined) return null
  if (STATIC.has(id)) return hints[id] ?? null
  switch (id) {
    case 'toPay': {
      const count = badges(c.state, c.persona).toPay
      return count > 0 ? fill(ui.hubs.sublines.toPay, { count }) : null
    }
    case 'salesToday': {
      const t = salesToday(c.state, c.persona, c.now, c.tz)
      return fill(ui.hubs.sublines.salesToday, { count: t.count, gross: formatMinor(t.gross) })
    }
    default:
      return null
  }
}
