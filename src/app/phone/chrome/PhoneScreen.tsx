import type { ReactNode } from 'react'
import { usePhone } from '../PhoneContext'
import { BannerSlot } from './Banner'
import { StatusBar } from './StatusBar'
import { StepBar } from './StepBar'
import { TaskHeader, type TaskHeaderProps } from './TaskHeader'

// The layout of every task screen inside a phone: status bar, task header, optional step bar,
// a scrolling body, an optional error line and the dock. The root carries `data-screen`.

export interface PhoneScreenProps extends Omit<TaskHeaderProps, 'tone'> {
  /** data-screen of the screen (ids as in the registry). */
  id: string
  header?: TaskHeaderProps['tone']
  /** Body background: light, or navy (Scan, Charge, success screens). */
  body?: 'light' | 'navy' | 'navy-800'
  step?: { n: number; total: number } | null
  /** An error line above the dock. */
  error?: ReactNode
  dock?: ReactNode
  /** No header at all (Welcome). */
  bare?: boolean
  /** Whether the banner sits under the header (default). Home places it itself. */
  banner?: boolean
  children: ReactNode
}

export function PhoneScreen({
  id,
  header = 'light',
  body = 'light',
  step,
  error,
  dock,
  bare = false,
  banner = true,
  children,
  ...headerProps
}: PhoneScreenProps) {
  const { statusBar } = usePhone()
  const navyBody = body !== 'light'
  // The status bar follows the header (navy for business and navy screens); the step bar follows the
  // body, so a business flow on a light body has a light bar under its navy header.
  const navy = header !== 'light' || navyBody
  return (
    <section
      data-screen={id}
      tabIndex={-1}
      className={`flex h-full min-h-0 flex-col ${
        body === 'navy-800'
          ? 'on-navy bg-navy-800 text-white'
          : navyBody
            ? 'on-navy bg-navy-900 text-white'
            : 'bg-bg text-ink'
      }`}
    >
      {statusBar && <StatusBar tone={header === 'navy800' ? 'navy800' : navy ? 'navy' : 'light'} />}
      {!bare && <TaskHeader tone={header} {...headerProps} />}
      {step && <StepBar n={step.n} total={step.total} tone={navyBody ? 'navy' : 'light'} />}
      {banner && <BannerSlot />}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      {error && <div className={`shrink-0 px-5 pb-3 ${navyBody ? 'on-navy' : ''}`}>{error}</div>}
      {dock}
    </section>
  )
}
