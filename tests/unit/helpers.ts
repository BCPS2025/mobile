import { content } from '@content/load'
import { mustParseMinor } from '@domain/money'
import type { Minor } from '@domain/types'

export { content }

/** A Thursday; T0 is then Friday 2026-09-18 12:15 Europe/Ljubljana. */
export const EPOCH = '2026-09-24'

/** "12.40" -> 1240 */
export const m = (s: string): Minor => mustParseMinor(s)
