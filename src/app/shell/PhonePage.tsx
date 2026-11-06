import { ChevronDown, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { personaOn } from '@store/sessions'
import { useClockMinute } from '@store/useLedger'
import { fill, ui } from '../copy'
import { dateChipText } from '../format'
import { Avatar } from '../kit/Avatar'
import { Wordmark } from '../kit/Wordmark'
import { PhoneHost } from '../phone/PhoneHost'
import { openToast } from '../phone/notify'
import { LIVE_SHELLS } from '../phone/registry'
import { AppProvider, useApp, useTransient, useUi } from '../state/AppContext'
import { getAppState } from '../state/boot'
import { AccountMenu } from './AccountMenu'
import {
  LiveRegion,
  NoticeBar,
  OtherTab,
  PrefsEffects,
  PresenterOverlays,
  ResetToast,
  useAutoDismiss,
  TOAST_MS,
} from './Presenter'
import { useMediaQuery, useTouchDevice } from './device'
import { toggleFullscreen } from './fullscreen'
import { usePhoneHistory } from './history'
import { usePresenterKeys } from './keys'

// Phone mode (#/phone, #/phone/:persona, and #/pay links): one phone with an account switcher.
// On a touch device the in-app status bar goes (the device has its own), the pill row takes its
// place, and the page follows the visible viewport, so the dock stays above the soft keyboard. A
// push inside the phone adds a history entry and the browser's Back is the phone's Back.

/** Keeps `--app-h` at the visible height (the soft keyboard shrinks it), so the dock stays above the keyboard. */
function useVisibleHeight() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const set = () => {
      document.documentElement.style.setProperty('--app-h', `${Math.round(vv.height)}px`)
      if (vv.offsetTop > 0) window.scrollTo(0, 0)
    }
    set()
    vv.addEventListener('resize', set)
    vv.addEventListener('scroll', set)
    return () => {
      vv.removeEventListener('resize', set)
      vv.removeEventListener('scroll', set)
      document.documentElement.style.removeProperty('--app-h')
    }
  }, [])
}

/** "Turn your phone upright" on a touch device held sideways. */
function UprightHint() {
  return (
    <div
      role="alert"
      data-screen="page.phone.upright"
      className="on-navy fixed inset-0 z-[90] flex flex-col items-center justify-center gap-5 bg-navy-900 px-8 text-center text-white"
    >
      <Smartphone size={44} strokeWidth={1.5} aria-hidden="true" className="text-green-500" />
      <p className="font-display text-display-m">{ui.phoneMode.upright}</p>
      <Wordmark className="text-[20px] text-muted-navy" />
    </div>
  )
}

/** The pill row: the account on the phone, with its menu (accounts, the virtual time, Reset, Settings). */
function PillRow({ tone }: { tone: 'light' | 'navy' }) {
  const app = useApp()
  const ui_ = useUi()
  const now = useClockMinute()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const persona = personaOn(ui_, 'single')
  const account = persona ? app.persona(persona) : undefined
  const name = account?.displayName ?? ui.stage.noOne
  const navy = tone === 'navy'
  const row =
    'flex min-h-12 w-full items-center justify-between border-b border-line-100 py-2 text-left font-body text-body text-navy-900 disabled:opacity-40'
  return (
    <div
      className={`relative flex shrink-0 items-center px-3 pt-[env(safe-area-inset-top)] ${navy ? 'on-navy bg-navy-900 text-white' : 'bg-bg text-navy-900'}`}
    >
      <div className="flex h-12 items-center">
        <button
          type="button"
          data-testid="pill"
          aria-label={fill(ui.phoneMode.pill, { name })}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={`inline-flex h-10 items-center gap-2 border px-2.5 font-body text-body font-semibold ${
            navy ? 'border-navy-700 bg-navy-800 text-white' : 'border-line-300 bg-surface text-navy-900'
          }`}
        >
          {account && <Avatar persona={account} size={26} onNavy={navy} />}
          <span className="max-w-[200px] truncate">{name}</span>
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <AccountMenu slot="single" onDone={close} className="absolute top-full left-3 mt-0.5">
          <p className={`${row} justify-between`}>
            <span className="text-body-s text-grey-600">{ui.phoneMode.timeLabel}</span>
            <span data-testid="virtual-time" className="tnum">
              {dateChipText(now)}
            </span>
          </p>
          <button
            type="button"
            data-testid="menu-reset"
            onClick={() => {
              close()
              app.actions.setOverlay('reset')
            }}
            className={row}
          >
            {ui.phoneMode.reset}
          </button>
          <button
            type="button"
            data-testid="menu-settings"
            onClick={() => {
              close()
              app.actions.setOverlay('settings')
            }}
            className={row}
          >
            {ui.phoneMode.settings}
          </button>
        </AccountMenu>
      )}
    </div>
  )
}

/** "On Marko Kovač's phone: …" with [Switch], under the pill row, never over the dock. */
function PhoneToasts() {
  const app = useApp()
  const toasts = useTransient((t) => t.toasts)
  const latest = toasts[toasts.length - 1]
  const reset = useTransient((t) => t.resetToast)
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-30 flex flex-col gap-2 [&>*]:pointer-events-auto">
      {reset && <ResetToast />}
      {latest && <PhoneToast key={latest.id} toast={latest} onSwitch={() => openToast(app, 'single', latest)} />}
    </div>
  )
}

function PhoneToast({ toast, onSwitch }: { toast: { id: string; seq: number; text: string }; onSwitch: () => void }) {
  const app = useApp()
  const dismiss = () => app.actions.dismissToast(toast.id)
  const hover = useAutoDismiss(TOAST_MS, dismiss, toast.seq)
  return (
    <div
      role="status"
      data-testid="phone-toast"
      className="on-navy anim-sheet flex items-center justify-between gap-3 border border-navy-700 bg-navy-800 px-3 py-2 font-body text-body-s text-white"
      {...hover}
    >
      <span className="min-w-0">{toast.text}</span>
      <button
        type="button"
        data-testid="toast-switch"
        onClick={onSwitch}
        className="inline-flex min-h-10 shrink-0 items-center px-1 font-display text-button text-green-500"
      >
        {ui.phoneMode.switch}
      </button>
    </div>
  )
}

function PhoneMode({ persona: link }: { persona: string | undefined }) {
  const app = useApp()
  const ui_ = useUi()
  const overlay = useTransient((t) => t.overlay)
  const touch = useTouchDevice()
  const landscape = useMediaQuery('(orientation: landscape)')
  const persona = personaOn(ui_, 'single')
  const account = persona ? app.persona(persona) : undefined

  useEffect(() => {
    app.actions.setMode('phone')
    return () => {
      app.actions.setMode('none')
      app.actions.setOverlay(null)
    }
  }, [app])

  // #/phone/:persona logs that account in (a presenter shortcut like the account menu); an unknown
  // one, or none, leaves the phone as it is.
  useEffect(() => {
    if (link === undefined) return
    const p = app.persona(link)
    if (p?.onStage && p.shell !== undefined && LIVE_SHELLS.includes(p.shell)) app.actions.choose('single', p.id)
    location.replace('#/phone')
  }, [app, link])

  usePhoneHistory()
  useVisibleHeight()
  usePresenterKeys(
    useCallback(
      (action) => {
        if (action === 'fullscreen') void toggleFullscreen()
        else if (action === 'help') app.actions.setOverlay('keys')
        else if (action === 'escape' && overlay) app.actions.setOverlay(null)
      },
      [app, overlay],
    ),
  )

  const tone = account?.kind === 'person' ? 'light' : 'navy'
  return (
    <div
      data-testid="phone-mode"
      className="on-navy fixed inset-0 flex items-center justify-center overflow-hidden bg-navy-900"
      style={{ height: 'var(--app-h, 100dvh)' }}
    >
      <PrefsEffects />
      <LiveRegion />
      <div className="relative flex h-full max-h-[900px] w-full max-w-[430px] flex-col bg-bg text-ink">
        <NoticeBar />
        <PillRow tone={tone} />
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            <PhoneHost slot="single" mode="phone" width="100%" height="100%" statusBar={!touch} />
          </div>
          <PhoneToasts />
        </div>
      </div>
      <PresenterOverlays mode="phone" />
      <OtherTab />
      {touch && landscape && <UprightHint />}
    </div>
  )
}

export default function PhonePage({ persona }: { persona?: string }) {
  const app = getAppState()
  return (
    <AppProvider app={app}>
      <PhoneMode persona={persona} />
    </AppProvider>
  )
}
