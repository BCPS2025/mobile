import { Delete } from 'lucide-react'
import { parseMinor } from '@domain/money'
import { ui } from '../copy'

// Amount keypad: at most two decimals and a maximum-amount guard. The value is a plain
// decimal string ("12.4"); parse it with parseMinor.

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const

/** Apply one key to a keypad value, or return the value unchanged if the key is not allowed. */
export function keypadInput(value: string, key: string, maxMinor: number): string {
  let next: string
  if (key === 'del') next = value.slice(0, -1)
  else if (key === '.') next = value.includes('.') ? value : `${value === '' ? '0' : value}.`
  else {
    const [, frac] = value.split('.')
    if (frac !== undefined && frac.length >= 2) return value
    next = value === '0' ? key : value + key
  }
  if (next === '' || next.endsWith('.')) return next
  const parsed = parseMinor(next)
  if (!parsed.ok || parsed.value > maxMinor) return value
  return next
}

export function Keypad({
  value,
  onChange,
  maxMinor,
  disabled = false,
  label,
  compact = false,
}: {
  value: string
  onChange: (v: string) => void
  maxMinor: number
  disabled?: boolean
  label?: string
  /** 48 px keys for short phone screens (default 64 px). */
  compact?: boolean
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a grid of keys, not a form group; a fieldset's default box breaks the grid
    <div role="group" aria-label={label} aria-disabled={disabled} className="grid grid-cols-3 gap-px bg-line-200">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          aria-label={k === 'del' ? ui.common.deleteKey : k}
          onClick={() => onChange(keypadInput(value, k, maxMinor))}
          className={`flex items-center ${compact ? 'h-12' : 'h-16'} justify-center bg-surface font-display text-display-m text-navy-900 tnum hover:bg-line-100 disabled:text-line-300`}
        >
          {k === 'del' ? <Delete size={24} strokeWidth={1.75} aria-hidden="true" /> : k}
        </button>
      ))}
    </div>
  )
}
