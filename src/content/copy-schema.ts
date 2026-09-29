import { z } from 'zod'

// Interface sections of content/copy.en.yaml. Validated at build time together with the engine
// sections (schema.ts); the app imports only the UiCopy type.

const S = z.string().min(1)
const Pillar = z.strictObject({ title: S, body: S })

export const UiCopySchema = z.looseObject({
  app: z.looseObject({ title: S }),
  common: z.strictObject({
    bcps: S,
    deleteKey: S,
    approxEur: S,
    planned: S,
    verified: S,
    verifiedLabel: S,
    close: S,
    done: S,
    back: S,
    next: S,
    continue: S,
    toStart: S,
    about: S,
    sending: S,
    balance: S,
    incoming: S,
    rate: S,
    rateChip: S,
    rateInfo: S,
    rateInfoLabel: S,
    privacy: S,
    phoneLabel: S,
    roleCustomer: S,
    roleBusiness: S,
  }),
  pillars: z.array(Pillar).length(4),
  start: z.strictObject({
    overline: S,
    headline: S,
    lede: S,
    pillarsLabel: S,
    updateReady: S,
    updateApply: S,
  }),
  about: z.strictObject({
    title: S,
    intro: S,
    simple: S,
    pillarsTitle: S,
    feesTitle: S,
    fees: z.array(S).min(1),
    privacyTitle: S,
    safetyTitle: S,
    safety: S,
    build: S,
  }),
  pay: z.strictObject({ title: S, body: S, to: S, amount: S, invalid: S, open: S }),
  notFound: z.strictObject({ title: S, body: S, home: S }),
  fee: z.looseObject({
    chipShort: S,
    chipNone: S,
    chipConversion: S,
    chipCards: S,
    payerYou: S,
    transaction: S,
    paidBy: S,
    paidByYou: S,
    lineYou: S,
    lineOther: S,
    feeInfo: S,
    cardInfo: S,
    infoLabel: S,
    cardInfoLabel: S,
  }),
  tape: z.looseObject({ row: S, empty: S, status: z.strictObject({ pending: S, confirmed: S }) }),
  tx: z.strictObject({ to: S, from: S, withNote: S, items: S }),
})

export type UiCopy = z.infer<typeof UiCopySchema>
