import { encodePaymentUri } from '@domain/uri'
import type { Handle, Minor } from '@domain/types'
import { currentPaymentBaseUrl } from '@store/env'

/**
 * What a payment code (the café's POS code) encodes: the recipient, the amount and the request it
 * pays, as a link into the app. Never a local file address: off https it points to the public page.
 */
export function posCodePayload(merchant: Handle, amount: Minor, requestId: string): string {
  return encodePaymentUri({ v: 1, to: merchant, amount, req: requestId }, currentPaymentBaseUrl())
}

/** What a person's payment link encodes (and what "Copy link" puts on the clipboard): the owner, the amount and the link. */
export function linkPayload(owner: Handle, amount: Minor, linkId: string): string {
  return encodePaymentUri({ v: 1, to: owner, amount, link: linkId }, currentPaymentBaseUrl())
}

/** What a person's own code encodes: just their handle. */
export function personPayload(handle: Handle): string {
  return encodePaymentUri({ v: 1, to: handle }, currentPaymentBaseUrl())
}
