import { Bell } from 'lucide-react'
import type { Persona } from '@domain/types'
import { Avatar } from '../../kit/Avatar'
import { Wordmark } from '../../kit/Wordmark'
import { fill, ui } from '../../copy'

// The Home header. People (56 px): the wordmark, the bell with its unread count, and a 40 px
// avatar in a 48 × 48 target labelled "Profile". Business (60 px, navy): a white avatar tile
// labelled "Settings", the name with the BUSINESS tag under it, and the bell.

function BellButton({ count, onPress, onNavy }: { count: number; onPress: () => void; onNavy: boolean }) {
  return (
    <button
      type="button"
      data-testid="bell"
      aria-label={count > 0 ? fill(ui.home.bellUnread, { count }) : ui.home.bell}
      onClick={onPress}
      className="relative flex size-12 items-center justify-center"
    >
      <Bell size={24} strokeWidth={1.75} aria-hidden="true" />
      {count > 0 && (
        <span
          data-testid="bell-count"
          className={`absolute top-[7px] right-[9px] flex h-[18px] min-w-[18px] items-center justify-center border-2 px-1 font-sans text-[11px] leading-none font-semibold ${
            onNavy ? 'border-navy-900 bg-white text-navy-900' : 'border-bg bg-navy-900 text-white'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}

export function HomeHeader({
  persona,
  unread,
  onAvatar,
  onBell,
}: {
  persona: Persona
  unread: number
  onAvatar: () => void
  onBell: () => void
}) {
  if (persona.kind === 'person') {
    return (
      <div className="flex h-14 shrink-0 items-center bg-bg pr-2.5 pl-5 text-navy-900">
        <Wordmark className="text-[22px]" />
        <span className="flex-1" />
        <BellButton count={unread} onPress={onBell} onNavy={false} />
        <button
          type="button"
          data-testid="avatar"
          aria-label={ui.home.profile}
          onClick={onAvatar}
          className="flex size-12 items-center justify-center"
        >
          <Avatar persona={persona} size={36} />
        </button>
      </div>
    )
  }
  return (
    <div className="on-navy flex h-[60px] shrink-0 items-center bg-navy-900 pr-2.5 pl-5 text-white">
      <button
        type="button"
        data-testid="avatar"
        aria-label={ui.home.settings}
        onClick={onAvatar}
        className="flex min-w-0 items-center gap-3 py-1 pr-2 text-left"
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center bg-white font-display text-[14px] font-semibold text-navy-900"
        >
          {persona.displayName
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase() ?? '')
            .join('')}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-[17px] leading-[22px] font-semibold">
            {persona.displayName}
          </span>
          <span className="block font-body text-[11px] leading-[14px] font-semibold uppercase tracking-[0.16em] text-green-500">
            {ui.home.business}
          </span>
        </span>
      </button>
      <span className="flex-1" />
      <BellButton count={unread} onPress={onBell} onNavy />
    </div>
  )
}
