import { ui } from '../copy'

/** Roadmap badge (dashed outline) for planned features and controls that are not built yet. */
export function PlannedTag({ onNavy = false, className = '' }: { onNavy?: boolean; className?: string }) {
  return (
    <span
      className={`inline-block border border-dashed px-1.5 py-px font-body text-caption font-medium uppercase tracking-[0.12em] ${
        onNavy ? 'border-muted-navy text-muted-navy' : 'border-grey-500 text-grey-600'
      } ${className}`}
    >
      {ui.common.planned}
    </span>
  )
}
