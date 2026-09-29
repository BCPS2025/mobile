import { BadgeCheck } from 'lucide-react'
import { useState } from 'react'
import { ui } from '../copy'

/** ✓ Verified tick; a tap shows the word. */
export function VerifiedTick({ onNavy = false }: { onNavy?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <button
        type="button"
        aria-label={ui.common.verifiedLabel}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex size-7 items-center justify-center ${onNavy ? 'text-green-500' : 'text-green-700'}`}
      >
        <BadgeCheck size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <span className={`anim-fade font-body text-caption ${onNavy ? 'text-green-500' : 'text-green-700'}`}>
          {ui.common.verified}
        </span>
      )}
    </span>
  )
}
