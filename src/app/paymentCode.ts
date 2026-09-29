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
