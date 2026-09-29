import { describe, expect, it } from 'vitest'
import { resolveEpochDate } from '@sim/t0'

describe('resolveEpochDate', () => {
  it('prefers ?epoch=YYYY-MM-DD', () => {
    expect(resolveEpochDate('?epoch=2026-01-09', 0)).toBe('2026-01-09')
  })
  it('falls back to today in Europe/Ljubljana', () => {
    // 2026-09-24 23:30 UTC is already 25 September in Ljubljana (UTC+2).
    expect(resolveEpochDate('', Date.UTC(2026, 8, 24, 23, 30))).toBe('2026-09-25')
    expect(resolveEpochDate('?epoch=bad', Date.UTC(2026, 8, 24, 12))).toBe('2026-09-24')
  })
})
