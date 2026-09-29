import type { Party } from '@domain/types'
import { initials } from '../format'

/** A directory entry's avatar: a circle with initials for people, a navy square for businesses. */
export function PartyAvatar({ party, size = 40 }: { party: Pick<Party, 'kind' | 'displayName'>; size?: number }) {
  const business = party.kind === 'business'
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center font-display font-semibold ${
        business ? 'bg-navy-900 text-white' : 'rounded-full bg-line-200 text-navy-900'
      }`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.325) }}
    >
      {initials(party.displayName)}
    </span>
  )
}
