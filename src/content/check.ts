import { summaryFee } from '@domain/fees'
import { divRoundHalfUp, mustParseMinor } from '@domain/money'
import type { FeePolicy, FeePolicyId, Minor } from '@domain/types'
import { NOTIFICATION_PLACEHOLDERS, type Content, type ContentProblem } from './schema'

// Cross-file content rules (check-content). The zod schemas check each file on
// its own; these check that the files agree with each other. The seed arithmetic (every row
// zero-sum, start balances) is checked by src/sim/validate-content.ts, which builds the seed.

const RESERVED = ['example.com', 'example.org', 'example.net']
export const isReservedDomain = (email: string): boolean => {
  const at = email.lastIndexOf('@')
  if (at <= 0) return false
  const domain = email.slice(at + 1).toLowerCase()
  return RESERVED.includes(domain) || domain.endsWith('.example')
}

/** Count and gross of slot k (1-based) of n, by the cumulative rule of §2.7.1 (totals stay exact). */
export function slotShare(total: number, k: number, n: number): number {
  return divRoundHalfUp(total * k, n) - divRoundHalfUp(total * (k - 1), n)
}
function slotCount(count: number, k: number, n: number): number {
  return Math.floor((count * k) / n) - Math.floor((count * (k - 1)) / n)
}

const SYSTEM = new Set(['sys:issuance', 'sys:fees', 'sys:escrow', 'sys:offstage'])

/** Decision D29: the configured fee policies, exactly. */
const D29_FEES: Readonly<Record<FeePolicyId, string>> = {
  merchant: 'percent 100 recipient 500',
  'web-checkout': 'percent 100 recipient 500',
  subscription: 'percent 100 recipient 500',
  transfer: 'percent 100 sender null',
  'escrow-lock': 'percent 100 sender null',
  'escrow-release': 'zero',
  refund: 'zero',
  'on-ramp': 'zero',
  'off-ramp': 'percent 150 sender null',
}

type ConfigFee = Content['config']['fees'][FeePolicyId]
const describeFee = (p: ConfigFee): string =>
  p.kind === 'zero'
    ? 'zero'
    : `${p.kind} ${p.kind === 'percent' ? p.rateBps : p.flatEurCents} ${p.payer} ${p.cardCompareMinEurCents ?? 'null'}`

/** The domain policy of a configured fee (enough for fee arithmetic; card threshold left out). */
function policyOf(c: Content, id: FeePolicyId): FeePolicy {
  const p = c.config.fees[id]
  if (p.kind === 'zero') return { id, kind: 'zero' }
  if (p.kind === 'percent')
    return { id, kind: 'percent', rateBps: p.rateBps, payer: p.payer, cardCompareMinMinor: null }
  return { id, kind: 'flat', flatEurCents: p.flatEurCents, payer: p.payer, cardCompareMinMinor: null }
}

/**
 * Wording that D29 withdrew: any literal money figure in visible copy ("0.06",
 * "€0.05", but also a rate, minimum or amount such as "1.10"), or "flat" next to "fee". Money
 * figures in copy are always placeholders ({fee}, {rate}, {min}, {amount}, {total}).
 */
const LITERAL_MONEY = /(?:€\s?\d+[.,]\d{2}\b|\b\d+\.\d{2}\b)/
const FLAT_FEE = /\bflat\b[^.]{0,40}\bfees?\b|\bfees?\b[^.]{0,40}\bflat\b/i

function visibleStrings(value: unknown, path: (string | number)[], out: { path: (string | number)[]; text: string }[]) {
  if (typeof value === 'string') out.push({ path, text: value })
  else if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) visibleStrings(v, [...path, i], out)
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) visibleStrings(v, [...path, k], out)
  }
  return out
}

export function checkContent(c: Content): ContentProblem[] {
  const out: ContentProblem[] = []
  const add = (file: string, path: (string | number)[], message: string) => out.push({ file, path, message })

  // ---- personas: handles unique across personas and the off-stage directory; logins
  const personaIds = new Set(c.personas.personas.map((p) => p.id))
  const businessIds = new Set(c.personas.personas.filter((p) => p.kind === 'business').map((p) => p.id))
  const offstage = new Set(c.personas.offstage.map((o) => o.handle))
  const handles = new Map<string, string>()
  const seeHandle = (handle: string, path: (string | number)[]) => {
    const prev = handles.get(handle.toLowerCase())
    if (prev) add('personas.yaml', path, `handle ${handle} is already used at ${prev}`)
    else handles.set(handle.toLowerCase(), path.join('.'))
  }
  const codes = new Map<string, string>()
  c.personas.personas.forEach((p, i) => {
    seeHandle(p.handle, ['personas', i, 'handle'])
    if (p.login) {
      if (!isReservedDomain(p.login.email)) {
        add(
          'personas.yaml',
          ['personas', i, 'login', 'email'],
          'emails use reserved domains only (example.com, *.example)',
        )
      }
      const prev = codes.get(p.login.code)
      if (prev) add('personas.yaml', ['personas', i, 'login', 'code'], `code ${p.login.code} is also ${prev}'s`)
      codes.set(p.login.code, p.id)
    }
  })
  for (const [i, o] of c.personas.offstage.entries()) seeHandle(o.handle, ['offstage', i, 'handle'])

  // ---- config: merchants and invoice numbers belong to known businesses
  for (const id of Object.keys(c.config.merchants)) {
    if (!businessIds.has(id)) add('config.yaml', ['merchants', id], `${id} is not a business persona`)
  }
  const prefixes = new Set<string>()
  for (const [id, n] of Object.entries(c.config.invoiceNumbers)) {
    if (!businessIds.has(id)) add('config.yaml', ['invoiceNumbers', id], `${id} is not a business persona`)
    if (prefixes.has(n.prefix)) add('config.yaml', ['invoiceNumbers', id, 'prefix'], `prefix ${n.prefix} is used twice`)
    prefixes.add(n.prefix)
  }
  for (const inv of c.seed.invoices) {
    if (prefixes.has(inv.id.slice(0, 2)) && c.config.invoiceNumbers[inv.issuer]?.prefix !== inv.id.slice(0, 2)) {
      add('seed.yaml', ['invoices'], `invoice ${inv.id} uses another issuer's prefix`)
    }
  }

  // ---- config: the fee policies are D29's, exactly
  for (const [id, want] of Object.entries(D29_FEES) as [FeePolicyId, string][]) {
    const have = describeFee(c.config.fees[id])
    if (have !== want) add('config.yaml', ['fees', id], `fee policy ${id} is "${have}", decision D29 is "${want}"`)
  }

  // ---- copy and catalogue: no withdrawn fee wording
  const scan = (file: string, root: unknown, rootPath: (string | number)[]) => {
    for (const { path, text } of visibleStrings(root, rootPath, [])) {
      if (LITERAL_MONEY.test(text)) add(file, path, `a literal fee or money figure in copy: "${text}"`)
      else if (FLAT_FEE.test(text)) add(file, path, `flat-fee wording: "${text}"`)
    }
  }
  scan('copy.en.yaml', c.copy, [])
  scan('notifications.yaml', c.notifications, [])
  for (const [merchant, list] of Object.entries(c.catalogue.products)) {
    for (const [i, p] of list.entries()) scan('catalogue.yaml', p.name, ['products', merchant, i, 'name'])
  }
  for (const [issuer, list] of Object.entries(c.catalogue.templates.invoices)) {
    for (const [i, t] of list.entries()) {
      scan('catalogue.yaml', t.description, ['templates', 'invoices', issuer, i, 'description'])
    }
  }
  for (const [i, o] of c.catalogue.templates.escrow.orders.entries()) {
    scan('catalogue.yaml', o.description, ['templates', 'escrow', 'orders', i, 'description'])
  }
  scan('catalogue.yaml', c.catalogue.templates.supplierPayment.note, ['templates', 'supplierPayment', 'note'])

  // ---- notifications: only known placeholders in titles and lines
  const known = new Set<string>(NOTIFICATION_PLACEHOLDERS)
  for (const [kind, n] of Object.entries(c.notifications)) {
    for (const field of ['title', 'line'] as const) {
      for (const m of (n[field] ?? '').matchAll(/\{(\w+)\}/g)) {
        if (!known.has(m[1] ?? '')) add('notifications.yaml', [kind, field], `unknown placeholder {${m[1]}}`)
      }
    }
  }

  // ---- config: background patterns keep every slot's gross above its fees (§2.7.1; the fee
  // of a slot row is the policy fee on its gross, like a seeded summary row)
  const rate = c.config.rate
  const slotFee = (id: FeePolicyId, count: number, gross: number) =>
    summaryFee(count, gross as Minor, policyOf(c, id), rate)
  const cafe = c.config.background.cafe
  const cafeSlots = cafe.slotEnds.length + 1
  for (const [day, d] of Object.entries(cafe.days)) {
    if (!d) continue
    if (!cafe.open[day as keyof typeof cafe.open])
      add('config.yaml', ['background', 'cafe', 'days', day], 'a sales day needs opening hours')
    const gross = mustParseMinor(d.gross)
    for (let k = 1; k <= cafeSlots; k++) {
      const count = slotCount(d.count, k, cafeSlots)
      const share = slotShare(gross, k, cafeSlots)
      if (share <= slotFee('merchant', count, share)) {
        add('config.yaml', ['background', 'cafe', 'days', day], `slot ${k} does not cover its fees`)
      }
    }
  }
  const studioPrice = (sku: string) =>
    mustParseMinor(c.catalogue.products.studio?.find((p) => p.sku === sku)?.price ?? '0.00')
  const studio = c.config.background.studio
  const studioSlots = studio.slotEnds.length
  for (const [day, d] of Object.entries(studio.days)) {
    if (!d) continue
    for (let k = 1; k <= studioSlots; k++) {
      const g = slotCount(d.g, k, studioSlots)
      const sk = slotCount(d.s, k, studioSlots)
      const gross = g * studioPrice('gem-pack-500') + sk * studioPrice('aurora-wings')
      if (g + sk > 0 && gross <= slotFee('web-checkout', g + sk, gross)) {
        add('config.yaml', ['background', 'studio', 'days', day], `slot ${k} does not cover its fees`)
      }
    }
  }

  // ---- catalogue: products, plans and templates refer to each other and to personas
  const products = (merchant: string) => c.catalogue.products[merchant] ?? []
  for (const merchant of Object.keys(c.catalogue.products)) {
    if (!businessIds.has(merchant))
      add('catalogue.yaml', ['products', merchant], `${merchant} is not a business persona`)
    const skus = new Set<string>()
    products(merchant).forEach((p, i) => {
      if (skus.has(p.sku)) add('catalogue.yaml', ['products', merchant, i, 'sku'], `duplicate sku ${p.sku}`)
      skus.add(p.sku)
      if (p.plan !== undefined && !c.catalogue.plans.some((pl) => pl.id === p.plan && pl.sku === p.sku)) {
        add('catalogue.yaml', ['products', merchant, i, 'plan'], `no plan ${p.plan} for ${p.sku}`)
      }
    })
  }
  c.catalogue.plans.forEach((pl, i) => {
    const product = products(pl.merchant).find((p) => p.sku === pl.sku)
    if (!product) add('catalogue.yaml', ['plans', i, 'sku'], `${pl.merchant} has no product ${pl.sku}`)
    else if (product.price !== pl.amount)
      add('catalogue.yaml', ['plans', i, 'amount'], 'the plan amount differs from the price')
  })
  const tpl = c.catalogue.templates
  for (const who of [tpl.supplierPayment.from, tpl.supplierPayment.to]) {
    if (!personaIds.has(who)) add('catalogue.yaml', ['templates', 'supplierPayment'], `unknown persona ${who}`)
  }
  for (const [issuer, list] of Object.entries(tpl.invoices)) {
    if (!businessIds.has(issuer))
      add('catalogue.yaml', ['templates', 'invoices', issuer], `${issuer} is not a business persona`)
    list.forEach((t, i) => {
      if (t.defaultPayer !== undefined && (!businessIds.has(t.defaultPayer) || t.defaultPayer === issuer)) {
        add(
          'catalogue.yaml',
          ['templates', 'invoices', issuer, i, 'defaultPayer'],
          'the payer must be another business',
        )
      }
    })
  }
  tpl.escrow.presets.forEach((preset, i) => {
    const total = preset.milestones.reduce((acc, ms) => acc + ms.shareBps, 0)
    if (total !== 10_000)
      add('catalogue.yaml', ['templates', 'escrow', 'presets', i], `shares add up to ${total}, not 10000`)
  })
  if (!tpl.escrow.deadlineDays.includes(tpl.escrow.defaultDeadlineDays)) {
    add('catalogue.yaml', ['templates', 'escrow', 'defaultDeadlineDays'], 'the default is not one of the choices')
  }

  // ---- seed: accounts, parties, items and references resolve
  const account = (a: string) => SYSTEM.has(a) || personaIds.has(a)
  c.seed.rows.forEach((r, i) => {
    for (const k of ['from', 'to'] as const) {
      if (!account(r[k])) add('seed.yaml', ['rows', i, k], `unknown account ${r[k]}`)
    }
    if (r.party !== undefined && !offstage.has(r.party))
      add('seed.yaml', ['rows', i, 'party'], `unknown off-stage person ${r.party}`)
    for (const [j, it] of (r.items ?? []).entries()) {
      if (!products(r.to).some((p) => p.sku === it.sku))
        add('seed.yaml', ['rows', i, 'items', j], `${r.to} has no product ${it.sku}`)
    }
    for (const sku of Object.keys(r.summary?.mix ?? {})) {
      if (!products(r.to).some((p) => p.sku === sku))
        add('seed.yaml', ['rows', i, 'summary', 'mix'], `${r.to} has no product ${sku}`)
    }
    if (r.labelKey !== undefined && !Object.hasOwn(c.copy.seedRows, r.labelKey)) {
      add('seed.yaml', ['rows', i, 'labelKey'], `copy.en.yaml has no seedRows.${r.labelKey}`)
    }
  })
  const rowKeys = new Set(c.seed.rows.map((r) => r.key))
  const requestIds = new Set(c.seed.requests.map((r) => r.id))
  const invoiceIds = new Set(c.seed.invoices.map((r) => r.id))
  c.seed.requests.forEach((r, i) => {
    for (const k of ['requester', 'payer'] as const) {
      if (!personaIds.has(r[k])) add('seed.yaml', ['requests', i, k], `unknown persona ${r[k]}`)
    }
    if (r.requester === r.payer) add('seed.yaml', ['requests', i], 'requester and payer are the same')
  })
  c.seed.invoices.forEach((r, i) => {
    for (const k of ['issuer', 'payer'] as const) {
      if (!businessIds.has(r[k])) add('seed.yaml', ['invoices', i, k], `${r[k]} is not a business persona`)
    }
    if (r.issuer === r.payer) add('seed.yaml', ['invoices', i], 'issuer and payer are the same')
    if (requestIds.has(r.id)) add('seed.yaml', ['invoices', i, 'id'], `id ${r.id} is also a request`)
  })
  for (const [owner, skus] of Object.entries(c.seed.ownership)) {
    if (!personaIds.has(owner)) add('seed.yaml', ['ownership', owner], `unknown persona ${owner}`)
    for (const sku of skus) {
      const oneOff = Object.values(c.catalogue.products).some((list) => list.some((p) => p.sku === sku && p.oneOff))
      if (!oneOff) add('seed.yaml', ['ownership', owner], `${sku} is not a one-off product`)
    }
  }
  for (const h of c.seed.stats.studio.namedSubscribers) {
    if (!offstage.has(h)) add('seed.yaml', ['stats', 'studio', 'namedSubscribers'], `unknown off-stage person ${h}`)
  }
  for (const [who, refs] of Object.entries(c.seed.unread)) {
    if (!personaIds.has(who)) add('seed.yaml', ['unread', who], `unknown persona ${who}`)
    refs.forEach((ref, i) => {
      const [kind, id = ''] = ref.split(/:(.*)/)
      const ok =
        (kind === 'request' && requestIds.has(id)) ||
        (kind === 'invoice' && invoiceIds.has(id)) ||
        (kind === 'tx' && rowKeys.has(id)) ||
        (kind === 'subscription-started' && offstage.has(id))
      if (!ok) add('seed.yaml', ['unread', who, i], `${ref} does not refer to anything seeded`)
    })
  }
  return out
}
