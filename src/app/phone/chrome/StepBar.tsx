import { fill, ui } from '../../copy'

// "Step 2 of 4" over a segmented 3 px bar: finished segments green, the current one navy (white on
// navy screens), the rest line grey. One segment per screen.

export function StepBar({ n, total, tone = 'light' }: { n: number; total: number; tone?: 'light' | 'navy' }) {
  const navy = tone === 'navy'
  return (
    <div className={`shrink-0 px-5 pt-2.5 ${navy ? 'on-navy bg-navy-900' : 'bg-bg'}`}>
      <p className={`font-body text-caption font-medium ${navy ? 'text-line-300' : 'text-grey-600'}`}>
        {fill(ui.nav.step, { n, total })}
      </p>
      <div aria-hidden="true" className="mt-1.5 flex gap-1">
        {Array.from({ length: total }, (_, i) => {
          const at = i + 1
          const done = at < n
          const current = at === n
          const color = done
            ? navy
              ? 'bg-green-500'
              : 'bg-green-600'
            : current
              ? navy
                ? 'bg-white'
                : 'bg-navy-900'
              : navy
                ? 'bg-navy-700'
                : 'bg-line-200'
          return <span key={at} className={`h-[3px] flex-1 ${color}`} />
        })}
      </div>
    </div>
  )
}
