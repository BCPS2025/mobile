import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ui } from '../../copy'
import { useApp, useTransient } from '../../state/AppContext'
import { openNotification } from '../notify'
import { usePhone } from '../PhoneContext'
import { usePhoneStack } from '../nav'

// The in-app banner under the header of the account shown on this phone: "@ana sent you 16.50
// BCPS · Cinema · Just now ›". Three seconds (paused while hovered or focused); an incoming
// payment of 100.00 BCPS or more stays until it is tapped or the next event. Tapping opens the
// payment; during a flow step it is informational only. It sits in the layout (it pushes the
// screen down) and never covers a control.

const AUTO_HIDE_MS = 3000
/** 100.00 BCPS in hundredths. */
const STICKY_FROM = 10_000

export function BannerSlot() {
  const app = useApp()
  const phone = usePhone()
  const { persona, shell } = phone
  const banner = useTransient((t) => (persona ? t.banners[persona] : undefined))
  const stack = usePhoneStack(persona ?? '')
  const [paused, setPaused] = useState(false)
  const seq = banner?.seq
  const sticky = (banner?.amount ?? 0) >= STICKY_FROM

  useEffect(() => {
    if (seq === undefined || sticky || paused || !persona) return
    const id = window.setTimeout(() => app.actions.dismissBanner(persona), AUTO_HIDE_MS)
    return () => window.clearTimeout(id)
  }, [seq, sticky, paused, persona, app])

  if (!banner || !persona || !shell) return null
  const interactive = stack[stack.length - 1]?.kind !== 'flow'
  const text = banner.line ? `${banner.title} · ${banner.line}` : banner.title
  const body = (
    <>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate font-body text-body font-semibold text-navy-900">{text}</span>
        <span className="block font-body text-body-s text-grey-600">{ui.notifications.justNow}</span>
      </span>
      {interactive && (
        <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-navy-700" />
      )}
    </>
  )
  const cls =
    'anim-sheet flex w-full shrink-0 items-center gap-3 border-y border-r-0 border-l-4 border-y-line-200 border-l-green-600 bg-surface py-2 pr-3 pl-4'
  const hover = {
    onMouseEnter: () => setPaused(true),
    onMouseLeave: () => setPaused(false),
    onFocus: () => setPaused(true),
    onBlur: () => setPaused(false),
  }
  return interactive ? (
    <button
      type="button"
      data-testid="banner"
      className={cls}
      onClick={() => {
        app.actions.dismissBanner(persona)
        openNotification(
          app,
          { persona, slot: phone.slot, shell },
          { id: banner.notificationId, txId: banner.txId, kind: banner.kind },
        )
      }}
      {...hover}
    >
      {body}
    </button>
  ) : (
    <div role="status" data-testid="banner" className={cls} {...hover}>
      {body}
    </div>
  )
}
