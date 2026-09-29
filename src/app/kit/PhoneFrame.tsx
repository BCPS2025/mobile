import type { ReactNode } from 'react'
import type { Persona } from '@domain/types'
import { useClockMinute } from '@store/useLedger'
import { fill, ui } from '../copy'
import { timeText } from '../format'
import { formatWeekday } from '@sim/tz'

// One phone: <section data-phone=…> with a logical size. On stage it has no notch or home
// indicator; phone mode on a laptop adds a device frame; real devices drop both.

export type FrameKind = 'stage' | 'device' | 'bare'

export function PhoneFrame({
  persona,
  kind,
  width = 390,
  height = 700,
  children,
  className = '',
}: {
  persona: Persona
  kind: FrameKind
  width?: number | string
  height?: number | string
  children: ReactNode
  className?: string
}) {
  const role = persona.kind === 'person' ? ui.common.roleCustomer : ui.common.roleBusiness
  return (
    <section
      data-phone={persona.id}
      aria-label={fill(ui.common.phoneLabel, { name: persona.displayName, role })}
      className={`relative flex flex-col overflow-hidden bg-bg ${
        kind === 'device' ? 'rounded-[36px] border-[10px] border-navy-800' : ''
      } ${className}`}
      style={{ width, height }}
    >
      {kind !== 'bare' && <StatusBar />}
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

function StatusBar() {
  const now = useClockMinute()
  return (
    <div className="flex h-7 shrink-0 items-center justify-between bg-bg px-5 font-body text-caption text-ink tnum">
      <span className="font-semibold">{timeText(now)}</span>
      <span className="text-grey-600">{formatWeekday(now, 'Europe/Ljubljana')}</span>
    </div>
  )
}
