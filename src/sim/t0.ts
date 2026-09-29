import type { SimTime } from '@domain/types'
import { type IsoDate, LJUBLJANA, localDateOf } from './tz'

const EPOCH = /^\d{4}-\d{2}-\d{2}$/

/**
 * The date T0 is computed from: `?epoch=YYYY-MM-DD` when present and valid (tests),
 * otherwise today's date in Europe/Ljubljana for the given wall-clock instant
 * (the app reads wall time once, at boot, and passes it in).
 */
export function resolveEpochDate(search: string, wallNowMs: number): IsoDate {
  const epoch = new URLSearchParams(search).get('epoch')
  if (epoch && EPOCH.test(epoch)) return epoch
  return localDateOf(wallNowMs as SimTime, LJUBLJANA)
}
