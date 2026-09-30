import type { BankingHours } from '@domain/types'

// Banking hours: whether an instant falls inside a country's opening hours (the payment detail
// says "Outside banking hours · settled anyway"). The rule lives in the sim layer.

export type OpeningHours = BankingHours
export { withinHours } from '@sim/banking'
