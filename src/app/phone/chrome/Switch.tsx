// An on/off switch with its label and an optional grey line under it (Auto-convert, "Only on days
// with sales"). The whole row is one button, so the target is the full width.

export function Switch({
  label,
  hint,
  on,
  onChange,
  testId,
}: {
  label: string
  hint?: string
  on: boolean
  onChange: (on: boolean) => void
  testId: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className="flex min-h-14 w-full items-center justify-between gap-4 py-2 text-left"
    >
      <span className="min-w-0">
        <span className="block font-body text-body font-semibold text-navy-900">{label}</span>
        {hint && <span className="block font-body text-body-s text-grey-600">{hint}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`relative h-7 w-[52px] shrink-0 border border-navy-900 ${on ? 'bg-navy-900' : 'bg-surface'}`}
      >
        <span
          className={`absolute top-[3px] size-5 transition-[left] duration-(--dur-fast) ${
            on ? 'left-[27px] bg-white' : 'left-[3px] bg-navy-900'
          }`}
        />
      </span>
    </button>
  )
}
