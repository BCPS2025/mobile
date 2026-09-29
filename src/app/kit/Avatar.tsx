import type { Persona } from '@domain/types'
import { initials } from '../format'

/** Circles with initials for people, squares for businesses. */
export function Avatar({ persona, size = 40, onNavy = false }: { persona: Persona; size?: number; onNavy?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center font-display font-semibold ${
        persona.kind === 'person' ? 'rounded-full' : ''
      } ${onNavy ? 'bg-navy-700 text-white' : 'bg-navy-900 text-white'}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials(persona.displayName)}
    </span>
  )
}
