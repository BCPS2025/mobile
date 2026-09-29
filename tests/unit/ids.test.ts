import { describe, expect, it } from 'vitest'
import { cashOutRef, crockford6, escrowId, invoiceNumber, nextRefSeq, requestId, scrambleRef, txRef } from '@domain/ids'

// Transaction references: opaque, stable, unique, not countable.

describe('transaction references', () => {
  it('look like BC- plus six Crockford base-32 characters', () => {
    for (let n = 1; n <= 500; n++) expect(txRef(n)).toMatch(/^BC-[0-9A-HJKMNP-TV-Z]{6}$/)
  })

  it('the first 100,000 references are unique, and identical when computed again', () => {
    const first: string[] = []
    let n = 0
    for (let i = 0; i < 100_000; i++) {
      n = nextRefSeq(n)
      first.push(txRef(n))
    }
    expect(new Set(first).size).toBe(100_000)
    let again = 0
    for (let i = 0; i < 100_000; i++) {
      again = nextRefSeq(again)
      expect(txRef(again)).toBe(first[i])
    }
  })

  it('never spell an avoided letter run', () => {
    let n = 0
    for (let i = 0; i < 100_000; i++) {
      n = nextRefSeq(n)
      expect(txRef(n)).not.toMatch(/TEST|FAKE/)
    }
  })

  it('are not countable: neighbours are not in order and differ in most positions', () => {
    let ascending = 0
    let sharedPositions = 0
    for (let n = 1; n < 2000; n++) {
      const a = txRef(n)
      const b = txRef(n + 1)
      if (a < b) ascending++
      for (let k = 3; k < 9; k++) if (a[k] === b[k]) sharedPositions++
    }
    expect(ascending / 1999).toBeGreaterThan(0.4)
    expect(ascending / 1999).toBeLessThan(0.6)
    expect(sharedPositions / (1999 * 6)).toBeLessThan(0.1)
  })

  it('the scramble is a bijection on a sampled range and rejects out-of-range counters', () => {
    const seen = new Set<number>()
    for (let n = 0; n < 1 << 16; n++) seen.add(scrambleRef(n))
    expect(seen.size).toBe(1 << 16)
    expect(() => scrambleRef(-1)).toThrow()
    expect(() => scrambleRef(2 ** 30)).toThrow()
    expect(crockford6(0)).toBe('000000')
    expect(crockford6(2 ** 30 - 1)).toBe('ZZZZZZ')
  })

  it('cash-out bank references reuse the six characters', () => {
    expect(cashOutRef('BC-4F7K2Q')).toBe('BC-OUT-4F7K2Q')
  })

  it('other identifiers', () => {
    expect(requestId(1)).toBe('R-000001')
    expect(escrowId(1)).toBe('E-1042')
    expect(invoiceNumber('HB', 918)).toBe('HB-0918')
    expect(invoiceNumber('CL', 101)).toBe('CL-0101')
  })
})
