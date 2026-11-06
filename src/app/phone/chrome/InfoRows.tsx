import type { ReactNode } from 'react'

// A bordered navy panel of label and value rows (44 px each): the café's PAID and Cancel charge.
// The label is small and light, the value right-aligned and white; `mono` sets a value in the
// monospace face (a reference).

export interface InfoRow {
  label: string
  value: ReactNode
  mono?: boolean
}

export function InfoRows({ rows, className = '' }: { rows: InfoRow[]; className?: string }) {
  return (
    <dl className={`border border-navy-700 bg-navy-800 ${className}`}>
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex min-h-11 items-center justify-between gap-4 border-b border-navy-700 px-3.5 py-1.5 last:border-b-0"
        >
          <dt className="shrink-0 font-body text-body-s text-line-300">{r.label}</dt>
          <dd
            className={`min-w-0 text-right text-body font-medium text-white tnum ${r.mono ? 'font-mono' : 'font-body'}`}
          >
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
