import type { LucideIcon } from 'lucide-react'

// A Home tile: white, 1 px line, sharp corners, a centred icon, the label under it, an optional
// live line ("23 today · 111.38") and an optional count badge (navy square, top right). The whole
// tile is the button. Pressed: grey fill and an ink border.

export function Tile({
  id,
  icon: Icon,
  label,
  line,
  badge,
  onPress,
}: {
  id: string
  icon: LucideIcon
  label: string
  line?: string | null
  badge?: number
  onPress: () => void
}) {
  return (
    <button
      type="button"
      data-tile={id}
      onClick={onPress}
      className="relative flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 border border-line-200 bg-surface p-3 text-center transition-colors duration-(--dur-press) active:border-navy-900 active:bg-line-100"
    >
      <Icon size={36} strokeWidth={1.75} aria-hidden="true" className="text-navy-900" />
      <span>
        <span className="block font-display text-[18px] leading-6 font-semibold text-navy-900">{label}</span>
        {line && <span className="block font-body text-body-s text-grey-600 tnum">{line}</span>}
      </span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute top-2.5 right-2.5 flex h-6 min-w-6 items-center justify-center bg-navy-900 px-1.5 font-body text-[13px] font-semibold text-white">
          {badge}
        </span>
      )}
    </button>
  )
}

/** The tiles, two across, centred in the space under the balance band. */
export function TileGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <div className="grid h-full max-h-[358px] w-full max-w-[358px] grid-cols-2 grid-rows-2 gap-3">{children}</div>
    </div>
  )
}
