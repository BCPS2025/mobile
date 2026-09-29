import { ArrowLeftRight, ChevronDown, Clock, Maximize, RotateCcw, SlidersHorizontal, ZoomIn } from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { type StageKey, personaOn } from '@store/sessions'
import { useClockMinute } from '@store/useLedger'
import { fill, ui } from '../copy'
import { dateChipText } from '../format'
import { Avatar } from '../kit/Avatar'
import { SessionCounter, Tape } from '../kit/Tape'
import { Wordmark } from '../kit/Wordmark'
import { fitsStage } from '../router'
import { PhoneHost } from '../phone/PhoneHost'
import { AppProvider, useApp, usePrefs, useTransient, useUi } from '../state/AppContext'
import { getAppState } from '../state/boot'
import { AccountMenu } from './AccountMenu'
import { LiveRegion, NoticeBar, OtherTab, PrefsEffects, PresenterOverlays, ResetToast, ToastCard } from './Presenter'
import { toggleFullscreen } from './fullscreen'
import { usePresenterKeys } from './keys'
import { COUNTER_H, LABEL_COL_W, PHONE_H, PHONE_W, SWAP_W, TAPE_H, TOPBAR_H, stageLayout } from './layout'
import type { StageLayout } from './layout'
import { TokenTravel } from './TokenTravel'
import { useViewport } from './useViewport'

// The laptop stage (#/stage): two phones side by side over one ledger, the role labels with the
// account menu and zoom, ⇄ swap, the tape and the session counter, toasts in the gutter for
// accounts that are not on a phone, and the presenter's top bar. A free app: nothing plays by
// itself.

// ---- top bar

function TopBar({ layout, children }: { layout: StageLayout; children?: React.ReactNode }) {
  const app = useApp()
  const overlay = useTransient((t) => t.overlay)
  const now = useClockMinute()
  const wide = layout.labels === 'side'
  const button =
    'inline-flex h-9 items-center gap-2 px-2.5 font-body text-body-s text-white hover:bg-navy-800 aria-expanded:bg-white aria-expanded:text-navy-900'
  return (
    <header
      style={{ height: TOPBAR_H }}
      className="on-navy relative flex shrink-0 items-center gap-3 border-b border-navy-700 bg-navy-900 px-4 text-white"
    >
      <Wordmark className="text-[20px]" />
      <span
        data-testid="date-chip"
        className="inline-flex h-8 items-center gap-2 border border-navy-700 px-3 font-body text-body-s tnum"
      >
        <Clock size={15} strokeWidth={1.75} aria-hidden="true" />
        <span className="sr-only">{ui.stage.dateChip}: </span>
        {dateChipText(now)}
      </span>
      <span className="flex-1" />
      {children}
      <button
        type="button"
        data-testid="reset"
        aria-label={ui.stage.reset}
        onClick={() => app.actions.setOverlay('reset')}
        className={button}
      >
        <RotateCcw size={17} strokeWidth={1.75} aria-hidden="true" />
        {wide && ui.stage.reset}
      </button>
      <button
        type="button"
        data-testid="fullscreen"
        aria-label={ui.stage.fullscreen}
        onClick={() => void toggleFullscreen()}
        className={button}
      >
        <Maximize size={17} strokeWidth={1.75} aria-hidden="true" />
        {wide && ui.stage.fullscreen}
      </button>
      <button
        type="button"
        data-testid="settings"
        aria-label={ui.stage.settings}
        aria-expanded={overlay === 'settings'}
        onClick={() => app.actions.setOverlay(overlay === 'settings' ? null : 'settings')}
        className={button}
      >
        <SlidersHorizontal size={17} strokeWidth={1.75} aria-hidden="true" />
        {wide && ui.stage.settings}
      </button>
    </header>
  )
}

// ---- role labels

/** The label block of one phone: role, name with the account menu (▾), and the zoom button. */
function LabelBlock({
  slot,
  layout,
  alignEnd: forceEnd = false,
}: {
  slot: StageKey
  layout: StageLayout
  alignEnd?: boolean
}) {
  const app = useApp()
  const ui_ = useUi()
  const zoom = useTransient((t) => t.zoom)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const persona = personaOn(ui_, slot)
  const account = persona ? app.persona(persona) : undefined
  const name = account?.displayName ?? ui.stage.noOne
  const zoomed = zoom === slot
  const side = layout.labels === 'side'
  const alignEnd = forceEnd || slot === 'left'
  return (
    <div
      data-testid={`label-${slot}`}
      className={`relative flex ${side ? 'flex-col gap-3 pt-[26px]' : 'items-center justify-between gap-2'} ${
        side ? (alignEnd ? 'items-end text-right' : 'items-start text-left') : ''
      }`}
      style={side ? { width: LABEL_COL_W } : undefined}
    >
      <p
        data-testid={`role-${slot}`}
        className={`font-display font-semibold tracking-[0.16em] text-white uppercase ${side ? 'text-[24px] leading-[30px]' : 'text-[13px] leading-4'}`}
      >
        {account?.roleLabel ?? <span aria-hidden="true">&nbsp;</span>}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          data-testid={`account-menu-${slot}`}
          aria-label={fill(ui.stage.accountMenu, { name })}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex h-10 items-center gap-2 border border-navy-700 px-3 font-body text-body text-white hover:border-line-300"
        >
          {account && <Avatar persona={account} size={22} onNavy />}
          <span className="max-w-[150px] truncate">{name}</span>
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid={`zoom-${slot}`}
          aria-label={zoomed ? ui.stage.zoomOut : fill(ui.stage.zoom, { name })}
          aria-pressed={zoomed}
          onClick={() => app.actions.setZoom(zoomed ? null : slot)}
          className="inline-flex size-10 items-center justify-center border border-navy-700 text-white hover:border-line-300 aria-pressed:bg-white aria-pressed:text-navy-900"
        >
          <ZoomIn size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <AccountMenu
          slot={slot}
          onDone={close}
          className={`absolute top-full mt-1 ${alignEnd ? 'left-0' : 'right-0'}`}
        />
      )}
    </div>
  )
}

// ---- toasts in the gutter

/**
 * Toasts for accounts that are not on a phone, in the outer gutter beside the phone that would
 * open them (the right phone, unless it shows the payer), never over a phone; 3 s, paused on
 * hover or focus, at most 3. Tapping one opens that account on that phone. The Reset toast
 * ("Everything reset · Undo") stands in the right gutter too.
 */
function GutterToasts({ layout }: { layout: StageLayout }) {
  const app = useApp()
  const ui_ = useUi()
  const toasts = useTransient((t) => t.toasts)
  const reset = useTransient((t) => t.resetToast)
  const sideOf = (payer: string | null): StageKey =>
    payer !== null && personaOn(ui_, 'right') === payer ? 'left' : 'right'
  const cards = (side: StageKey) =>
    toasts
      .filter((t) => sideOf(t.payer) === side)
      .map((t) => (
        <ToastCard
          key={t.id}
          overline={fill(ui.stage.toastFor, { name: t.name })}
          title={t.title}
          line={t.line}
          restartKey={t.seq}
          onDismiss={() => app.actions.dismissToast(t.id)}
          onPress={() => {
            app.actions.choose(side, t.persona)
            app.actions.dismissToast(t.id)
          }}
        />
      ))
  if (layout.toasts === 'bar') return null
  const width = Math.max(120, Math.min(224, layout.gutter - 16))
  const top = layout.labels === 'side' ? 118 : 8
  const column = (side: StageKey, extra?: React.ReactNode) => (
    <div
      data-testid={`toasts-${side}`}
      className={`pointer-events-none absolute z-30 flex flex-col gap-2 [&>*]:pointer-events-auto ${side === 'left' ? 'left-2' : 'right-2'}`}
      style={{ top, width }}
    >
      {extra}
      {cards(side)}
    </div>
  )
  return (
    <>
      {column('left')}
      {column('right', reset ? <ResetToast /> : null)}
    </>
  )
}

/** The narrow-window variant: toasts sit in the top bar row. */
function BarToasts() {
  const app = useApp()
  const ui_ = useUi()
  const toasts = useTransient((t) => t.toasts)
  const reset = useTransient((t) => t.resetToast)
  if (toasts.length === 0 && !reset) return null
  return (
    <div data-testid="toasts-bar" className="flex max-w-[60%] items-stretch gap-2 overflow-hidden text-navy-900">
      {reset && (
        <div className="w-[200px] shrink-0">
          <ResetToast />
        </div>
      )}
      {toasts.map((t) => {
        const side: StageKey = t.payer !== null && personaOn(ui_, 'right') === t.payer ? 'left' : 'right'
        return (
          <div key={t.id} className="w-[220px] shrink-0">
            <ToastCard
              overline={fill(ui.stage.toastFor, { name: t.name })}
              title={t.title}
              restartKey={t.seq}
              onDismiss={() => app.actions.dismissToast(t.id)}
              onPress={() => {
                app.actions.choose(side, t.persona)
                app.actions.dismissToast(t.id)
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

// ---- the phones

function ScaledPhone({ slot, layout }: { slot: StageKey; layout: StageLayout }) {
  const style: CSSProperties = {
    width: PHONE_W,
    height: PHONE_H,
    transform: `scale(${layout.scale})`,
    transformOrigin: '0 0',
  }
  return (
    <div
      data-testid={`stage-phone-${slot}`}
      style={{ width: layout.width, height: layout.height }}
      className="shrink-0"
    >
      <div style={style}>
        <PhoneHost slot={slot} mode="stage" width={PHONE_W} height={PHONE_H} />
      </div>
    </div>
  )
}

function SwapButton() {
  const app = useApp()
  return (
    <div style={{ width: SWAP_W }} className="flex shrink-0 items-center justify-center self-center">
      <button
        type="button"
        data-testid="swap"
        aria-label={ui.stage.swap}
        onClick={() => app.actions.swap()}
        className="inline-flex size-11 items-center justify-center border border-navy-700 text-white hover:border-line-300"
      >
        <ArrowLeftRight size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  )
}

// ---- the page

function Stage() {
  const app = useApp()
  const { w, h } = useViewport()
  const prefs = usePrefs()
  const zoom = useTransient((t) => t.zoom)
  const lastUsed = useTransient((t) => t.lastUsed)
  const overlay = useTransient((t) => t.overlay)
  const root = useRef<HTMLDivElement>(null)
  const fits = fitsStage(w, h)

  useEffect(() => {
    app.actions.setMode('stage')
    return () => {
      app.actions.setMode('none')
      app.actions.setZoom(null)
      app.actions.setOverlay(null)
    }
  }, [app])
  // Below 768 px, or in portrait, there is no room for two phones: phone mode instead.
  useEffect(() => {
    if (!fits) location.replace('#/phone')
  }, [fits])

  usePresenterKeys(
    useCallback(
      (action) => {
        if (action === 'fullscreen') void toggleFullscreen()
        else if (action === 'zoom') app.actions.setZoom(zoom ? null : lastUsed)
        else if (action === 'help') app.actions.setOverlay('keys')
        else if (action === 'escape') {
          if (overlay) app.actions.setOverlay(null)
          else if (zoom) app.actions.setZoom(null)
        }
      },
      [app, zoom, lastUsed, overlay],
    ),
  )

  const layout = stageLayout(w, h, { tape: prefs.tape, zoomed: zoom !== null })
  const slots: StageKey[] = zoom ? [zoom] : ['left', 'right']
  const showTape = prefs.tape && zoom === null

  return (
    <div
      ref={root}
      data-testid="stage"
      data-scale={layout.scale.toFixed(3)}
      className={`on-navy relative flex h-dvh flex-col overflow-hidden bg-navy-900 text-white ${prefs.largeText ? 'projector' : ''}`}
    >
      <PrefsEffects />
      <LiveRegion />
      <TopBar layout={layout}>{layout.toasts === 'bar' && <BarToasts />}</TopBar>
      <NoticeBar />
      <main className="relative flex min-h-0 flex-1 justify-center pt-1">
        {layout.labels === 'side' && zoom ? (
          <div className="flex items-start">
            <div className="flex shrink-0 justify-end pr-3">
              <LabelBlock slot={zoom} layout={layout} alignEnd />
            </div>
            <ScaledPhone slot={zoom} layout={layout} />
            <div style={{ width: LABEL_COL_W + 12 }} className="shrink-0" />
          </div>
        ) : layout.labels === 'side' ? (
          <div className="flex items-start">
            <div className="flex shrink-0 justify-end pr-3">
              <LabelBlock slot="left" layout={layout} />
            </div>
            <ScaledPhone slot="left" layout={layout} />
            <SwapButton />
            <ScaledPhone slot="right" layout={layout} />
            <div className="flex shrink-0 justify-start pl-3">
              <LabelBlock slot="right" layout={layout} />
            </div>
          </div>
        ) : (
          <div className="flex items-start">
            {slots.map((slot, i) => (
              <div key={slot} className="flex shrink-0 items-start">
                {i > 0 && <SwapButton />}
                <div>
                  <div style={{ width: layout.width }} className="pb-2">
                    <LabelBlock slot={slot} layout={layout} />
                  </div>
                  <ScaledPhone slot={slot} layout={layout} />
                </div>
              </div>
            ))}
          </div>
        )}
        <GutterToasts layout={layout} />
        <TokenTravel />
      </main>
      {showTape && (
        <div className="shrink-0">
          <Tape height={TAPE_H} />
          <SessionCounter height={COUNTER_H} />
        </div>
      )}
      <PresenterOverlays mode="stage" />
      <OtherTab />
    </div>
  )
}

export default function StagePage() {
  const app = getAppState()
  return (
    <AppProvider app={app}>
      <Stage />
    </AppProvider>
  )
}
