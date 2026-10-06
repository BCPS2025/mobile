// Two or three choices side by side in one bordered bar, of which exactly one is on (Sales: Today
// | 7 days). The chosen one is navy with white text, the others white. It is a radio group, so a
// keyboard or screen reader says which one is chosen.

export function Segmented<T extends string>({
  group,
  options,
  value,
  label,
  onPick,
  testId,
}: {
  group: string
  options: readonly T[]
  value: T
  label: (o: T) => string
  onPick: (o: T) => void
  testId: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={group}
      className="grid h-[46px] border border-navy-900 bg-surface"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = o === value
        return (
          // biome-ignore lint/a11y/useSemanticElements: a segmented button that is a radio; the input would be hidden
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={on}
            data-testid={`${testId}-${o}`}
            onClick={() => onPick(o)}
            className={`font-display text-[15px] font-semibold ${on ? 'bg-navy-900 text-white' : 'bg-surface text-navy-900'}`}
          >
            {label(o)}
          </button>
        )
      })}
    </div>
  )
}
