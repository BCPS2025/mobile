import { formatTime } from '@sim/tz'
import { useClockMinute } from '@store/useLedger'
import { usePhone } from '../PhoneContext'

/** The in-app status bar (44 px): the virtual time in the account's zone; no carrier or battery. */
export function StatusBar({ tone }: { tone: 'light' | 'navy' | 'navy800' }) {
  const { tz, statusBar } = usePhone()
  const now = useClockMinute()
  if (!statusBar) return null
  return (
    <div
      data-testid="status-bar"
      className={`flex h-11 shrink-0 items-center px-5 font-display text-[15px] font-semibold tnum ${
        tone === 'light'
          ? 'bg-bg text-navy-900'
          : `on-navy text-white ${tone === 'navy800' ? 'bg-navy-800' : 'bg-navy-900'}`
      }`}
    >
      {formatTime(now, tz)}
    </div>
  )
}
