import { entryOf, selectParty } from '@domain/ledger'
import type { DomainError, LedgerState, Party, PaymentLink, PaymentRequest, PaymentUri, PersonaId } from '@domain/types'

// What a payment address (a QR payload or the page behind "Copy link") points at in this browser's
// ledger. An address that names an id this browser does not know never reaches `pay`.

export type PayTarget =
  /** A person's payment link, by its id. */
  | { kind: 'link'; link: PaymentLink; owner: Party | undefined }
  /** A request, a split share, an invoice or a payment code, by its id. */
  | { kind: 'request'; request: PaymentRequest; requester: Party | undefined }
  /** Just a recipient: a person's or a business's code with no id (the amount, if any, is the address's). */
  | { kind: 'party'; party: Party }
  | { kind: 'unknown' }

/**
 * The thing an address points at. The recipient must be in the directory, and an id must be a link or
 * request of that recipient, for the amount the address names (if it names one); anything else is `unknown`.
 */
export function payTarget(s: LedgerState, uri: PaymentUri): PayTarget {
  const to = selectParty(s, uri.to)
  if (!to) return { kind: 'unknown' }
  if (uri.link !== undefined) {
    const link = entryOf(s.links, uri.link)
    if (!link || link.owner !== to.id || (uri.amount !== undefined && uri.amount !== link.amount)) {
      return { kind: 'unknown' }
    }
    return { kind: 'link', link, owner: to }
  }
  if (uri.req !== undefined) {
    const request = entryOf(s.requests, uri.req)
    if (!request || request.requester !== to.id || (uri.amount !== undefined && uri.amount !== request.amount)) {
      return { kind: 'unknown' }
    }
    return { kind: 'request', request, requester: to }
  }
  return { kind: 'party', party: to }
}

/**
 * Why `payer` cannot pay a target right now, as the refusal `pay` would give (so the words come from
 * errorText), or null when they can. A paid or closed link, a request that is not open, one's own
 * link or request, and a request made of someone else.
 */
export function payRefusal(target: PayTarget, payer: PersonaId): DomainError | null {
  if (target.kind === 'link') {
    if (target.link.owner === payer) return { code: 'self-payment' }
    if (target.link.status !== 'open') return { code: 'invalid-state', status: target.link.status }
    return null
  }
  if (target.kind === 'request') {
    const { request } = target
    if (request.requester === payer) return { code: 'self-payment' }
    if (request.status !== 'open') return { code: 'invalid-state', status: request.status }
    if (request.payer !== undefined && request.payer !== payer) return { code: 'not-allowed' }
    return null
  }
  if (target.kind === 'party') return target.party.id === payer ? { code: 'self-payment' } : null
  return { code: 'not-allowed' }
}
