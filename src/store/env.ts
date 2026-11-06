import { paymentBaseUrl } from '@domain/uri'

// Platform glue: where payment codes point, from the page location and build constants.

export function currentPaymentBaseUrl(
  loc: { protocol: string; href: string } | undefined = typeof location === 'undefined' ? undefined : location,
): string {
  if (!loc) return __CANONICAL_URL__
  return paymentBaseUrl(loc, import.meta.env.BASE_URL, __CANONICAL_URL__)
}
