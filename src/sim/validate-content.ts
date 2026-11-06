import { checkContent } from '@content/check'
import type { ContentProblem, ContentResult, RawContent } from '@content/schema'
import { safeParseContent } from '@content/schema'

export { CONTENT_FILES } from '@content/schema'
import { quoteFee } from '@domain/fees'
import { invariants } from '@domain/invariants'
import { formatHundredths, mustParseMinor } from '@domain/money'
import { approxEur } from '@domain/rate'
import type { FeePolicyId } from '@domain/types'
import { buildSeed, simConfigFrom } from './seed'

// The whole content check: the zod schemas, the cross-file rules and the seed
// arithmetic. Runs at build time inside vite-plugin-content (through Vite's module runner, so
// the client bundle gets plain JSON and never zod) and from scripts/check-content.ts.

/** Start balances of the seed (sys:fees 46.10 = 21.78 in the network + 24.32 conversion). */
export const EXPECTED_START: Readonly<Record<string, string>> = {
  ana: '247.50',
  marko: '132.98',
  cafe: '286.00',
  studio: '1254.00',
  firm: '12100.00',
  supplier: '880.00',
  bakery: '0.00',
  'sys:fees': '46.10',
}

/** Balances right after a given seed row (the café holds 44.75 after C11). */
export const EXPECTED_AFTER_ROW: readonly { row: string; account: string; balance: string }[] = [
  { row: 'cafe-autoconvert-wed', account: 'cafe', balance: '44.75' },
]

/** The golden epochs: an ordinary Friday, the fold week and the gap week. */
export const CHECK_EPOCHS = ['2026-09-25', '2026-10-23', '2027-03-26'] as const

const CARD_POLICIES: readonly FeePolicyId[] = ['merchant', 'web-checkout', 'subscription']

export function validateContent(raw: RawContent): ContentResult {
  const parsed = safeParseContent(raw)
  if (!parsed.ok) return parsed
  const content = parsed.content
  const problems: ContentProblem[] = checkContent(content)
  const rowIndex = (key: string) => content.seed.rows.findIndex((r) => r.key === key)
  const seedProblem = (message: string) => {
    const key = /^seed row ([a-z0-9-]+):/.exec(message)?.[1]
    const i = key === undefined ? -1 : rowIndex(key)
    problems.push({ file: 'seed.yaml', path: i >= 0 ? ['rows', i] : ['rows'], message })
  }

  for (const epoch of CHECK_EPOCHS) {
    let state: ReturnType<typeof buildSeed>['state']
    try {
      state = buildSeed(content, epoch).state
    } catch (e) {
      seedProblem(e instanceof Error ? e.message : String(e))
      break
    }
    for (const [account, want] of Object.entries(EXPECTED_START)) {
      const have = state.balances[account]?.confirmed
      if (have !== mustParseMinor(want)) {
        problems.push({
          file: 'seed.yaml',
          path: ['rows'],
          message: `${account} starts at ${have === undefined ? 'nothing' : formatHundredths(have)}, expected ${want} (T0 week of ${epoch})`,
        })
      }
    }
    for (const want of EXPECTED_AFTER_ROW) {
      let balance = 0
      let found = false
      for (const id of state.txOrder) {
        const tx = state.txs[id]
        for (const p of tx?.postings ?? []) if (p.account === want.account) balance += p.delta
        if (tx?.seedMeta?.key === want.row) {
          found = true
          break
        }
      }
      if (!found || balance !== mustParseMinor(want.balance)) {
        const i = rowIndex(want.row)
        problems.push({
          file: 'seed.yaml',
          path: i >= 0 ? ['rows', i] : ['rows'],
          message: `${want.account} holds ${formatHundredths(balance)} after ${want.row}, expected ${want.balance}`,
        })
      }
    }
    for (const v of invariants(state)) problems.push({ file: 'seed.yaml', path: ['rows'], message: `invariant ${v}` })
    if (problems.length > 0) break
  }

  // The catalogue guard: a shown card comparison always displays the BCPS fee
  // (in EUR) strictly below the card low end (items below the threshold never show one).
  const config = simConfigFrom(content)
  for (const [merchant, list] of Object.entries(content.catalogue.products)) {
    list.forEach((p, i) => {
      for (const id of CARD_POLICIES) {
        const policy = config.fees[id]
        const q = quoteFee(mustParseMinor(p.price), policy, config.rate, undefined, config.cardRange)
        if (!q.ok) {
          problems.push({
            file: 'catalogue.yaml',
            path: ['products', merchant, i, 'price'],
            message: `${id}: ${q.error}`,
          })
          continue
        }
        const card = q.value.card
        if (card && approxEur(q.value.fee, config.rate) >= card.lowEurCents) {
          problems.push({
            file: 'catalogue.yaml',
            path: ['products', merchant, i, 'price'],
            message: `${id}: the fee would not show below the card comparison`,
          })
        }
      }
    })
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, content }
}
