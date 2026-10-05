import { z } from 'zod'
import { type UiCopy, UiCopySchema } from './copy-schema'

// Schemas for content/*.yaml (content schema v2). They run at build time in
// vite-plugin-content and in scripts/check-content.ts; the client receives validated JSON and
// only the types from this file (zod never enters the client bundle).

/** BCPS/EUR amounts are strings with exactly two decimals and no grouping ("1100.00"). */
export const AmountString = z.string().regex(/^\d+\.\d{2}$/, 'amount must be a string like "12.40" (no grouping)')

const Int = z.number().int()
const NonNegInt = Int.nonnegative()
const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be "HH:MM"')
export const HandleString = z.string().regex(/^@[a-z0-9_]{2,30}$/, 'handle must look like "@name"')
/** Persona ids are open strings (guest-1 … guest-5 are added by sign-up); lower-case words. */
export const PersonaIdString = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,31}$/, 'persona id must be a lower-case word')
  .refine((id) => !(id in Object.prototype), 'persona id must not be an Object.prototype name')
const SystemAccountEnum = z.enum(['sys:issuance', 'sys:fees', 'sys:escrow', 'sys:offstage'])
const AccountIdSchema = z.union([SystemAccountEnum, PersonaIdString])
const Weekday = Int.min(0).max(6)
const WeekdayKey = z.enum(['0', '1', '2', '3', '4', '5', '6'])
export const FeePolicyIdEnum = z.enum([
  'merchant',
  'web-checkout',
  'subscription',
  'transfer',
  'escrow-lock',
  'escrow-release',
  'refund',
  'on-ramp',
  'off-ramp',
])
const FeePayerEnum = z.enum(['sender', 'recipient'])
const DayTime = z.strictObject({ day: Int.min(-400).max(0), time: LocalTime })
const Tz = z.enum(['Europe/Ljubljana', 'Asia/Seoul'])
const Sku = z.string().regex(/^[a-z0-9-]+$/)

// ---- config.yaml
const FlatPolicy = z.strictObject({
  kind: z.literal('flat'),
  flatEurCents: NonNegInt,
  payer: FeePayerEnum,
  cardCompareMinEurCents: NonNegInt.nullable(),
})
const PercentPolicy = z.strictObject({
  kind: z.literal('percent'),
  rateBps: Int.min(0).max(9_999),
  payer: FeePayerEnum,
  cardCompareMinEurCents: NonNegInt.nullable().default(null),
})
const ZeroPolicy = z.strictObject({ kind: z.literal('zero') })
const FeePolicyConfig = z.discriminatedUnion('kind', [FlatPolicy, PercentPolicy, ZeroPolicy])

export const MerchantSettingsSchema = z.strictObject({
  feePayer: FeePayerEnum,
  autoConvert: z
    .strictObject({
      enabled: z.boolean(),
      schedule: z.enum(['daily', 'weekdays', 'weekly']),
      weekdays: z.array(Weekday),
      atLocal: z.enum(['18:00', '20:00', '22:00', '23:00']),
      sharePct: Int.min(10).max(100).multipleOf(10),
      onlyOnDaysWithSales: z.boolean(),
    })
    .superRefine((a, ctx) => {
      // The days follow the schedule: none every day, Monday to Friday, or one day a week.
      const want = { daily: '', weekdays: '1,2,3,4,5' } as const
      if (a.schedule === 'weekly') {
        if (a.weekdays.length !== 1) ctx.addIssue({ code: 'custom', message: 'a weekly schedule names one weekday' })
      } else if (a.weekdays.join(',') !== want[a.schedule]) {
        ctx.addIssue({ code: 'custom', message: `a ${a.schedule} schedule has the days ${want[a.schedule] || 'none'}` })
      }
    }),
})

const JumpTo = z.discriminatedUnion('kind', [
  z.strictObject({ id: z.string(), kind: z.literal('relative'), minutes: Int.positive() }),
  z.strictObject({ id: z.string(), kind: z.literal('next-local'), time: LocalTime }),
  z.strictObject({ id: z.string(), kind: z.literal('next-weekday'), weekday: Weekday, time: LocalTime }),
])
const BankingHours = z.strictObject({ days: z.array(Weekday).min(1), open: LocalTime, close: LocalTime, tz: Tz })
const CafeDay = z.strictObject({ count: Int.positive(), gross: AmountString })
const StudioDay = z.strictObject({ r: NonNegInt, g: NonNegInt, s: NonNegInt })

export const ConfigSchema = z.strictObject({
  stateVersion: Int.positive(),
  rate: z.strictObject({ bcps: Int.positive(), eur: Int.positive() }),
  settleMs: Int.positive(),
  t0: z.strictObject({ weekday: Weekday, time: LocalTime, tz: z.literal('Europe/Ljubljana') }),
  clock: z.strictObject({
    idlePauseMs: Int.positive(),
    farJumpConfirmDays: Int.positive(),
    jumpTo: z.array(JumpTo).min(1),
  }),
  cardRange: z.strictObject({ lowBps: NonNegInt, highBps: NonNegInt }),
  fees: z.strictObject(
    Object.fromEntries(FeePolicyIdEnum.options.map((id) => [id, FeePolicyConfig])) as Record<
      z.infer<typeof FeePolicyIdEnum>,
      typeof FeePolicyConfig
    >,
  ),
  limits: z.strictObject({
    consumerMax: AmountString,
    businessMax: AmountString,
    topUpMaxEur: z.strictObject({ person: Int.positive(), business: Int.positive() }),
    cashOutMin: AmountString,
    noteMaxChars: Int.positive(),
  }),
  bankingHours: z.strictObject({ SI: BankingHours, KR: BankingHours }),
  bankTransferTopUp: z.strictObject({ withinHoursDelayMin: Int.positive(), nextDayArrival: LocalTime }),
  posCodeValidityMin: Int.positive(),
  invoiceNumbers: z.record(
    PersonaIdString,
    z.strictObject({ prefix: z.string().regex(/^[A-Z]{2}$/), next: Int.min(1).max(9999) }),
  ),
  background: z.strictObject({
    cafe: z.strictObject({
      open: z.partialRecord(WeekdayKey, z.tuple([LocalTime, LocalTime])),
      slotEnds: z.array(LocalTime).min(1),
      days: z.partialRecord(WeekdayKey, CafeDay),
    }),
    studio: z.strictObject({
      renewalsAt: LocalTime,
      slotEnds: z.array(LocalTime).min(1),
      days: z.partialRecord(WeekdayKey, StudioDay),
    }),
  }),
  merchants: z.record(PersonaIdString, MerchantSettingsSchema),
})
export type ConfigContent = z.infer<typeof ConfigSchema>

// ---- personas.yaml
export const PersonaSchema = z
  .strictObject({
    id: PersonaIdString,
    handle: HandleString,
    displayName: z.string().min(1),
    subtitle: z.string().optional(),
    roleLabel: z.string().min(1).optional(),
    segment: z.enum(['merchant', 'customer', 'saas', 'xborder']).optional(),
    shell: z.enum(['consumer', 'pos', 'studio', 'trade']).optional(),
    kind: z.enum(['person', 'business']),
    verified: z.boolean(),
    country: z.enum(['SI', 'KR']),
    tz: Tz,
    onStage: z.boolean(),
    login: z.strictObject({ email: z.string(), code: z.string().regex(/^\d{6}$/, 'code must be 6 digits') }).optional(),
    methods: z
      .strictObject({
        card: z
          .string()
          .regex(/^\d{4}$/)
          .optional(),
        bank: z.string().min(1),
      })
      .optional(),
  })
  .superRefine((p, ctx) => {
    if (p.id.startsWith('guest-')) ctx.addIssue({ code: 'custom', message: `${p.id}: guest ids are made by sign-up` })
    if (p.onStage) {
      for (const k of ['roleLabel', 'segment', 'shell', 'login', 'methods'] as const) {
        if (p[k] === undefined) ctx.addIssue({ code: 'custom', message: `${p.id}: an on-stage persona needs ${k}` })
      }
    }
  })
const OffstageSchema = z.strictObject({ handle: HandleString, displayName: z.string().min(1) })
export const PersonasSchema = z
  .strictObject({ personas: z.array(PersonaSchema).min(1), offstage: z.array(OffstageSchema) })
  .superRefine((v, ctx) => {
    const ids = new Set<string>()
    for (const p of v.personas) {
      if (ids.has(p.id)) ctx.addIssue({ code: 'custom', message: `duplicate persona id ${p.id}` })
      ids.add(p.id)
    }
  })
export type PersonasContent = z.infer<typeof PersonasSchema>
export type PersonaContent = z.infer<typeof PersonaSchema>

// ---- catalogue.yaml
const Product = z.strictObject({
  sku: Sku,
  name: z.string().min(1),
  price: AmountString,
  oneOff: z.literal(true).optional(),
  plan: z.string().optional(),
})
const Milestone = z.strictObject({
  shareBps: Int.positive().max(10_000),
  condition: z.enum(['shipping-document', 'delivery-confirmed']),
})
const InvoiceTemplate = z.strictObject({
  description: z.string().min(1),
  amount: AmountString,
  defaultPayer: PersonaIdString.optional(),
})
export const CatalogueSchema = z.strictObject({
  products: z.record(PersonaIdString, z.array(Product)),
  plans: z.array(
    z.strictObject({
      id: z.string().min(1),
      merchant: PersonaIdString,
      sku: Sku,
      amount: AmountString,
      interval: z.literal('month'),
      chargeAtLocal: LocalTime,
    }),
  ),
  templates: z.strictObject({
    supplierPayment: z.strictObject({
      from: PersonaIdString,
      to: PersonaIdString,
      amount: AmountString,
      note: z.string().min(1),
    }),
    invoices: z.record(PersonaIdString, z.array(InvoiceTemplate)),
    escrow: z.strictObject({
      orders: z.array(z.strictObject({ description: z.string().min(1), amount: AmountString })).min(1),
      presets: z.array(z.strictObject({ id: z.string().min(1), milestones: z.array(Milestone).min(1) })).min(1),
      deadlineDays: z.array(Int.positive()).min(1),
      defaultDeadlineDays: Int.positive(),
      document: z.strictObject({ name: z.string().min(1), sizeKb: Int.positive() }),
    }),
  }),
  noteChips: z.strictObject({ person: z.array(z.string().min(1)), business: z.array(z.string().min(1)) }),
  declineReasons: z.strictObject({ invoice: z.array(z.string().min(1)), dispute: z.array(z.string().min(1)) }),
})
export type CatalogueContent = z.infer<typeof CatalogueSchema>

// ---- seed.yaml
const ItemRef = z.strictObject({ sku: Sku, qty: Int.positive() })
export const SeedRowSchema = z
  .strictObject({
    key: z.string().regex(/^[a-z0-9-]+$/),
    at: DayTime,
    startedAt: LocalTime.optional(),
    kind: z.enum(['transfer', 'purchase', 'subscription-charge', 'on-ramp', 'off-ramp']),
    channel: z.enum(['username', 'qr', 'link', 'web-checkout', 'auto', 'pos', 'request']),
    policy: FeePolicyIdEnum.optional(),
    from: AccountIdSchema,
    to: AccountIdSchema,
    party: HandleString.optional(),
    amount: AmountString.optional(),
    fee: AmountString.optional(),
    feePayer: FeePayerEnum.optional(),
    note: z.string().min(1).max(40).optional(),
    items: z.array(ItemRef).min(1).optional(),
    summary: z
      .strictObject({ count: Int.positive(), gross: AmountString, mix: z.record(Sku, Int.positive()).optional() })
      .optional(),
    eur: AmountString.optional(),
    method: z.enum(['bank-transfer', 'card', 'local-method']).optional(),
    sharePct: Int.min(10).max(100).optional(),
    labelKey: z.string().optional(),
  })
  .superRefine((r, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message: `seed row ${r.key}: ${message}` })
    if (r.from === r.to) issue('from equals to')
    if ((r.amount === undefined) === (r.summary === undefined)) issue('needs exactly one of amount or summary')
    if (r.summary && r.policy === undefined) issue('a summary row needs a policy')
    if (r.fee !== undefined && r.policy === undefined) issue('a fee needs a policy')
    if (r.party !== undefined && r.from !== 'sys:offstage' && r.to !== 'sys:offstage') {
      issue('party is only for rows to or from sys:offstage')
    }
    if (r.startedAt !== undefined && r.startedAt > r.at.time) issue('startedAt is after the row time')
  })
export type SeedRow = z.infer<typeof SeedRowSchema>

export const SeedSchema = z
  .strictObject({
    rows: z.array(SeedRowSchema),
    requests: z.array(
      z.strictObject({
        id: z.string().regex(/^r_[a-z0-9_]+$/),
        requester: PersonaIdString,
        payer: PersonaIdString,
        amount: AmountString,
        note: z.string().min(1).max(40).optional(),
        channel: z.literal('username'),
        at: DayTime,
      }),
    ),
    invoices: z.array(
      z.strictObject({
        id: z.string().regex(/^[A-Z]{2}-\d{4}$/),
        issuer: PersonaIdString,
        payer: PersonaIdString,
        amount: AmountString,
        description: z.string().min(1).max(40),
        issuedAt: DayTime,
        dueDays: Int.min(0).max(60),
      }),
    ),
    stats: z.strictObject({
      studio: z.strictObject({ activeSubscribers: NonNegInt, namedSubscribers: z.array(HandleString) }),
    }),
    ownership: z.record(PersonaIdString, z.array(Sku)),
    unread: z.record(PersonaIdString, z.array(z.string().regex(/^[a-z-]+:.+$/))),
  })
  .superRefine((v, ctx) => {
    const keys = new Set<string>()
    for (const r of v.rows) {
      if (keys.has(r.key)) ctx.addIssue({ code: 'custom', message: `duplicate seed row key ${r.key}` })
      keys.add(r.key)
    }
  })
export type SeedContent = z.infer<typeof SeedSchema>

// ---- homes.yaml (D28: 4 tiles per shell and the list behind each)
export const TILE_IDS = [
  'scan',
  'payRequest',
  'wallet',
  'history',
  'charge',
  'sales',
  'pay',
  'cashOut',
  'overview',
  'products',
  'customers',
  'money',
  'invoices',
  'escrow',
] as const
export const HUB_IDS = [...TILE_IDS, 'profile', 'settings'] as const
export const ROW_IDS = [
  'send',
  'request',
  'paymentLink',
  'splitBill',
  'shopOnline',
  'subscriptions',
  'topup',
  'cashOut',
  'myCode',
  'saveInvest',
  'paymentMethods',
  'biometrics',
  'reduceMotion',
  'notifications',
  'roadmap',
  'about',
  'logout',
  'refundSale',
  'allPayments',
  'paySupplier',
  'invoices',
  'autoConvert',
  'payoutHistory',
  'feePayer',
  'payoutAccount',
  'integrations',
  'subscribers',
  'refundPurchase',
  'sendPayment',
  'invoicesToPay',
  'newInvoice',
  'newEscrow',
] as const
export const SECTION_IDS = ['toPay', 'waiting', 'todayKpis', 'invoicesToPay', 'sent', 'escrows'] as const
export const BADGE_IDS = ['toPay', 'invoicesToPay', 'escrowAction'] as const
export const SUBLINE_IDS = [
  'toPay',
  'sendHint',
  'requestHint',
  'linkHint',
  'splitHint',
  'shopHint',
  'activeSubscription',
  'salesToday',
  'invoicesToPay',
  'autoConvert',
  'supplierHint',
  'nextInvoice',
  'payoutsThisWeek',
  'revenueToday',
  'activeSubscribers',
  'subscribersSummary',
  'lockedForYou',
] as const

const Icon = z.string().regex(/^[a-z0-9-]+$/, 'icon must be a lucide icon name')
const HubId = z.enum(HUB_IDS)
const Tile = z.strictObject({
  tile: z.enum(TILE_IDS),
  icon: Icon,
  opens: z.enum(['flow', 'hub', 'view']),
  badge: z.enum(BADGE_IDS).optional(),
  subline: z.enum(SUBLINE_IDS).optional(),
})
const HubEntry = z.union([
  z.strictObject({
    row: z.enum(ROW_IDS),
    icon: Icon,
    subline: z.enum(SUBLINE_IDS).optional(),
    badge: z.enum(BADGE_IDS).optional(),
    planned: z.literal(true).optional(),
  }),
  z.strictObject({ section: z.enum(SECTION_IDS) }),
])
const ShellHome = z
  .strictObject({
    avatar: HubId,
    tiles: z.array(Tile).min(1).max(4),
    hubs: z.partialRecord(HubId, z.array(HubEntry).min(1)),
  })
  .superRefine((h, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    const tiles = new Set<string>()
    for (const t of h.tiles) {
      if (tiles.has(t.tile)) issue(`duplicate tile ${t.tile}`)
      tiles.add(t.tile)
      if (t.opens === 'hub' && !h.hubs[t.tile]) issue(`tile ${t.tile} opens a hub but hubs.${t.tile} is missing`)
      if (t.opens !== 'hub' && h.hubs[t.tile]) issue(`tile ${t.tile} does not open a hub but hubs.${t.tile} exists`)
    }
    if (!h.hubs[h.avatar]) issue(`the avatar opens hubs.${h.avatar}, which is missing`)
    for (const [hub, entries] of Object.entries(h.hubs)) {
      if (hub !== h.avatar && !tiles.has(hub)) issue(`hubs.${hub} is not opened by any tile or the avatar`)
      const seen = new Set<string>()
      for (const e of entries ?? []) {
        const id = 'row' in e ? `row:${e.row}` : `section:${e.section}`
        if (seen.has(id)) issue(`hubs.${hub} lists ${id} twice`)
        seen.add(id)
      }
    }
  })
export type ShellHomeContent = z.infer<typeof ShellHome>

type HomeShellName = 'consumer' | 'pos' | 'studio' | 'trade.firm' | 'trade.supplier'
interface HomeReference {
  avatar: (typeof HUB_IDS)[number]
  /** The 4 tiles, in order. */
  tiles: readonly (typeof TILE_IDS)[number][]
  /** Every row and section each hub lists (`row:id` / `section:id`). */
  hubs: Readonly<Partial<Record<(typeof HUB_IDS)[number], readonly string[]>>>
}
const SETTINGS_BUSINESS = [
  'row:feePayer',
  'row:autoConvert',
  'row:payoutAccount',
  'row:biometrics',
  'row:integrations',
  'row:roadmap',
  'row:about',
  'row:logout',
]
const SETTINGS_TRADE = [
  'row:autoConvert',
  'row:payoutAccount',
  'row:biometrics',
  'row:roadmap',
  'row:about',
  'row:logout',
]
/** The complete homes of decision D28: what `complete: true` checks each shell against. */
export const COMPLETE_HOMES: Readonly<Record<HomeShellName, HomeReference>> = {
  consumer: {
    avatar: 'profile',
    tiles: ['scan', 'payRequest', 'wallet', 'history'],
    hubs: {
      payRequest: [
        'section:toPay',
        'row:send',
        'row:request',
        'row:paymentLink',
        'row:splitBill',
        'row:shopOnline',
        'row:subscriptions',
        'section:waiting',
      ],
      wallet: ['row:topup', 'row:cashOut', 'row:myCode', 'row:saveInvest'],
      profile: [
        'row:myCode',
        'row:subscriptions',
        'row:paymentMethods',
        'row:biometrics',
        'row:reduceMotion',
        'row:notifications',
        'row:roadmap',
        'row:about',
        'row:logout',
      ],
    },
  },
  pos: {
    avatar: 'settings',
    tiles: ['charge', 'sales', 'pay', 'cashOut'],
    hubs: {
      sales: ['section:todayKpis', 'row:refundSale', 'row:allPayments'],
      pay: ['section:invoicesToPay', 'row:paySupplier', 'row:invoices'],
      cashOut: ['row:cashOut', 'row:autoConvert', 'row:topup', 'row:payoutHistory'],
      settings: SETTINGS_BUSINESS,
    },
  },
  studio: {
    avatar: 'settings',
    tiles: ['overview', 'products', 'customers', 'money'],
    hubs: {
      customers: ['row:subscribers', 'row:refundPurchase'],
      money: ['row:sendPayment', 'row:invoicesToPay', 'row:cashOut', 'row:payoutHistory'],
      settings: SETTINGS_BUSINESS,
    },
  },
  'trade.firm': {
    avatar: 'settings',
    tiles: ['invoices', 'escrow', 'money', 'history'],
    hubs: {
      invoices: ['row:newInvoice', 'section:toPay', 'section:sent'],
      escrow: ['row:newEscrow', 'section:escrows'],
      money: ['row:sendPayment', 'row:topup', 'row:cashOut'],
      settings: SETTINGS_TRADE,
    },
  },
  'trade.supplier': {
    avatar: 'settings',
    tiles: ['invoices', 'escrow', 'money', 'history'],
    hubs: {
      invoices: ['row:newInvoice', 'section:toPay', 'section:sent'],
      escrow: ['section:escrows'],
      money: ['row:sendPayment', 'row:cashOut', 'row:topup'],
      settings: SETTINGS_TRADE,
    },
  },
}

/** Where a shell's home differs from the complete D28 home (tiles in order, avatar, every hub entry). */
export function completeHomeProblems(name: HomeShellName, h: ShellHomeContent): string[] {
  const ref = COMPLETE_HOMES[name]
  const out: string[] = []
  if (h.tiles.length !== 4) out.push(`${name}: a complete home has exactly 4 tiles`)
  const tiles = h.tiles.map((t) => t.tile)
  if (tiles.join(',') !== ref.tiles.join(','))
    out.push(`${name}: tiles must be ${ref.tiles.join(', ')} in this order (found ${tiles.join(', ')})`)
  if (h.avatar !== ref.avatar) out.push(`${name}: the avatar opens ${ref.avatar}, not ${h.avatar}`)
  for (const [hub, want] of Object.entries(ref.hubs)) {
    const have = new Set(
      (h.hubs[hub as keyof typeof h.hubs] ?? []).map((e) => ('row' in e ? `row:${e.row}` : `section:${e.section}`)),
    )
    const missing = (want ?? []).filter((id) => !have.has(id))
    if (missing.length > 0) out.push(`${name}: hubs.${hub} is missing ${missing.join(', ')}`)
  }
  return out
}

/**
 * The homes of the shells that are live. A shell's home is added when its first tile is live;
 * `complete: true` (the last milestone) requires every shell, exactly the D28 tiles in order and
 * every hub row.
 */
export const HomesSchema = z
  .strictObject({
    complete: z.boolean().optional(),
    consumer: ShellHome,
    pos: ShellHome,
    studio: ShellHome.optional(),
    trade: z.strictObject({ firm: ShellHome, supplier: ShellHome }).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.complete) return
    // Strict from milestone F: exactly the D28 tiles in order, and every row present.
    for (const [name, h] of [
      ['consumer', v.consumer],
      ['pos', v.pos],
      ['studio', v.studio],
      ['trade.firm', v.trade?.firm],
      ['trade.supplier', v.trade?.supplier],
    ] as const) {
      if (!h) ctx.addIssue({ code: 'custom', message: `${name}: a complete home needs this shell` })
      else for (const message of completeHomeProblems(name, h)) ctx.addIssue({ code: 'custom', message })
    }
  })
export type HomesContent = z.infer<typeof HomesSchema>

// ---- notifications.yaml (one entry per kind; the kinds are derived from the ledger, never stored)
export const NOTIFICATION_TO = [
  'payee',
  'payer',
  'requester',
  'merchant',
  'customer',
  'owner',
  'participant',
  'issuer',
  'buyer',
  'seller',
  'both',
  'account',
] as const
export const NOTIFICATION_OPENS = [
  'tx',
  'payItem',
  'request',
  'link',
  'split',
  'subscription',
  'subscriber',
  'invoice',
  'escrow',
  'payouts',
  'ramp',
  'home',
  'none',
] as const
/** Placeholders a notification title or line may use (filled from the ledger by store/notifications). */
export const NOTIFICATION_PLACEHOLDERS = [
  'payer',
  'requester',
  'owner',
  'merchant',
  'customer',
  'issuer',
  'buyer',
  'seller',
  'name',
  'amount',
  'note',
  'items',
  'item',
  'plan',
  'number',
  'date',
  'reason',
  'escrowId',
  'condition',
  'eur',
  'fee',
  'method',
  'bank',
  'arrivesAt',
  'retryDay',
  'collected',
] as const
const NotificationKind = z
  .string()
  .regex(/^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/, 'a notification kind looks like "p2p.received"')
const NotificationEntry = z.strictObject({
  to: z.enum(NOTIFICATION_TO),
  title: z.string().min(1),
  line: z.string().min(1).optional(),
  /** The stage's toast when it is drawn shorter than the banner ("Payment received" / "11.00 BCPS from @ana"). */
  toastTitle: z.string().min(1).optional(),
  toastLine: z.string().min(1).optional(),
  opens: z.enum(NOTIFICATION_OPENS),
  banner: z.boolean(),
  toast: z.boolean(),
})
export const NotificationsSchema = z.record(NotificationKind, NotificationEntry)
export type NotificationsContent = z.infer<typeof NotificationsSchema>
export type NotificationEntryContent = z.infer<typeof NotificationEntry>

// ---- copy.en.yaml (the sections the engine reads; src/content/copy-schema.ts adds the interface sections)
export const CopySchema = z.looseObject({
  app: z.looseObject({ title: z.string() }),
  tape: z.looseObject({
    row: z.string(),
    status: z.strictObject({ pending: z.string(), confirmed: z.string() }),
  }),
  fee: z.looseObject({ chip: z.string(), transaction: z.string(), paidBy: z.string(), paidByYou: z.string() }),
  txDetail: z.looseObject({
    net: z.string(),
    cards: z.string(),
    payout: z.string(),
    final: z.string(),
  }),
  errors: z.looseObject({ insufficientFunds: z.string(), unknownRecipient: z.string() }),
  seedRows: z.strictObject({
    topUp: z.string(),
    methods: z.strictObject({ 'bank-transfer': z.string(), card: z.string(), 'local-method': z.string() }),
    carriedOver: z.string(),
    dailySales: z.string(),
    todaySoFar: z.string(),
    autoConverted: z.string(),
    cashOut: z.string(),
  }),
})
export type CopyContent = z.infer<typeof CopySchema>

export interface Content {
  config: ConfigContent
  personas: PersonasContent
  catalogue: CatalogueContent
  seed: SeedContent
  homes: HomesContent
  notifications: NotificationsContent
  /** Engine and interface sections, both validated. */
  copy: CopyContent & UiCopy
}

export type RawContent = Record<keyof Content, unknown>

export const CONTENT_FILES: Record<keyof Content, string> = {
  config: 'config.yaml',
  personas: 'personas.yaml',
  catalogue: 'catalogue.yaml',
  seed: 'seed.yaml',
  homes: 'homes.yaml',
  notifications: 'notifications.yaml',
  copy: 'copy.en.yaml',
}

/** One problem in one content file; `path` points into the file's data (for a line number). */
export interface ContentProblem {
  file: string
  path: (string | number)[]
  message: string
}

export type ContentResult = { ok: true; content: Content } | { ok: false; problems: ContentProblem[] }

/** Validate raw content file by file with the zod schemas; collects every issue. */
export function safeParseContent(raw: RawContent): ContentResult {
  const problems: ContentProblem[] = []
  const parse = <T>(key: keyof Content, schema: z.ZodType<T>): T | undefined => {
    const r = schema.safeParse(raw[key])
    if (r.success) return r.data
    for (const i of r.error.issues) {
      problems.push({
        file: CONTENT_FILES[key],
        path: i.path.map((p) => (typeof p === 'number' ? p : String(p))),
        message: i.message,
      })
    }
    return undefined
  }
  const config = parse('config', ConfigSchema)
  const personas = parse('personas', PersonasSchema)
  const catalogue = parse('catalogue', CatalogueSchema)
  const seed = parse('seed', SeedSchema)
  const homes = parse('homes', HomesSchema)
  const notifications = parse('notifications', NotificationsSchema)
  const engineCopy = parse('copy', CopySchema)
  const uiCopy = parse('copy', UiCopySchema)
  if (
    !config ||
    !personas ||
    !catalogue ||
    !seed ||
    !homes ||
    !notifications ||
    !engineCopy ||
    !uiCopy ||
    problems.length > 0
  ) {
    return { ok: false, problems }
  }
  // Both copy schemas are loose at the top level, so each parse keeps every section of the file.
  return {
    ok: true,
    content: { config, personas, catalogue, seed, homes, notifications, copy: engineCopy as CopyContent & UiCopy },
  }
}

export function formatProblems(problems: readonly ContentProblem[]): string {
  return problems.map((p) => `  content/${p.file} ${p.path.join('.') || '(root)'}: ${p.message}`).join('\n')
}

/** Validate raw content; throws with the file names and issues on failure. */
export function parseContent(raw: RawContent): Content {
  const r = safeParseContent(raw)
  if (!r.ok) throw new Error(`content is invalid:\n${formatProblems(r.problems)}`)
  return r.content
}
