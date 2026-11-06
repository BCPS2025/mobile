// Deterministic identifiers. Nothing random: the same seed plus the same
// commands gives the same ids on every replay.
//
// Transaction references are "BC-" plus six Crockford base-32 characters. The six characters
// encode a fixed bijective scramble of the reference counter (refSeq) over 0 … 32⁶ − 1, so
// references are unique and stable but do not reveal how many transactions exist.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const BITS = 30 // 32⁶ = 2³⁰
const MASK = 2 ** BITS - 1
const K1 = 0x2545f491 & MASK
const K2 = 0x1b873593 & MASK
const K3 = 0x3c6ef373 & MASK

/** A bijection of 0 … 2³⁰ − 1 (odd multipliers, xor-shifts and a xor constant; all invertible). */
export function scrambleRef(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0 || n > MASK) throw new Error(`reference counter out of range: ${n}`)
  let x = n
  x = Math.imul(x, K1) & MASK
  x ^= x >>> 15
  x = (x ^ K2) & MASK
  x = Math.imul(x, K3) & MASK
  x ^= x >>> 13
  x = Math.imul(x, K1) & MASK
  x ^= x >>> 16
  return x
}

/** Six Crockford base-32 characters, most significant first. */
export function crockford6(x: number): string {
  let out = ''
  for (let i = 5; i >= 0; i--) out += CROCKFORD[Math.floor(x / 32 ** i) % 32]
  return out
}

/** Letter runs a reference may never contain (they would read as wording on a receipt). */
const AVOID = ['TEST', 'FAKE']

const refCode = (n: number): string => crockford6(scrambleRef(n))

/** The reference for counter value n (n ≥ 1): "BC-4F7K2Q". */
export function txRef(n: number): string {
  return `BC-${refCode(n)}`
}

/** The next usable counter value after `last`: skips the rare codes that spell an avoided run. */
export function nextRefSeq(last: number): number {
  let n = last + 1
  while (AVOID.some((w) => refCode(n).includes(w))) n += 1
  return n
}

/** Bank reference shown for a cash-out: "BC-OUT-" plus the transaction's six characters. */
export function cashOutRef(txId: string): string {
  return `BC-OUT-${txId.replace(/^BC-/, '')}`
}

const pad6 = (n: number) => String(n).padStart(6, '0')

export const requestId = (n: number): string => `R-${pad6(n)}`
export const linkId = (n: number): string => `L-${pad6(n)}`
export const splitId = (n: number): string => `S-${pad6(n)}`
export const subscriptionId = (n: number): string => `SUB-${pad6(n)}`
export const rampId = (n: number): string => `RP-${pad6(n)}`
/** Escrows count from E-1042. */
export const escrowId = (n: number): string => `E-${1041 + n}`
/** Invoice numbers per issuer: prefix plus four digits ("HB-0918"). */
export const invoiceNumber = (prefix: string, n: number): string => `${prefix}-${String(n).padStart(4, '0')}`
