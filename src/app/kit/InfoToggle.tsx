import { Info } from 'lucide-react'
import { useId, useState } from 'react'

/** An (i) button that shows or hides a short explanation below its row. */
export function useInfoToggle() {
  const [open, setOpen] = useState(false)
  const id = useId()
  return { open, id, toggle: () => setOpen((o) => !o), close: () => setOpen(false) }
}

export function InfoButton({
  label,
  open,
  controls,
  onClick,
  onNavy = false,
}: {
  label: string
  open: boolean
  controls: string
  onClick: () => void
  onNavy?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onClick}
      className={`inline-flex size-7 shrink-0 items-center justify-center ${onNavy ? 'text-muted-navy hover:text-white' : 'text-grey-600 hover:text-navy-900'}`}
    >
      <Info size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  )
}

export function InfoText({
  id,
  open,
  children,
  onNavy = false,
}: {
  id: string
  open: boolean
  children: string
  onNavy?: boolean
}) {
  if (!open) return <span id={id} hidden />
  return (
    <p
      id={id}
      className={`anim-fade mt-2 border-l-4 px-3 py-2 font-body text-body-s ${
        onNavy ? 'border-green-500 bg-navy-800 text-white' : 'border-green-600 bg-surface text-ink'
      }`}
    >
      {children}
    </p>
  )
}
