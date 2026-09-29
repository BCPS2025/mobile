import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { fill, ui } from '../copy'
import { Wordmark } from '../kit/Wordmark'
import { useApp, useNotices, usePrefs, useTransient, useWriterStatus } from '../state/AppContext'
import type { Overlay } from '../state/app'
import { useLedgerState } from '@store/useLedger'
import { BUILD_SHA } from '../boot/build-info'
import { useDialog } from './useDialog'

// The presenter's chrome outside the phones, shared by the stage and phone mode: the Settings
// panel, the Reset question with its Undo toast, the shortcut list, the runtime notices and the
// "open in another tab" overlay. Nothing here is drawn inside a phone.

/** Reduced motion from Settings: writes data-reduce-motion on <html> ("true", "false", or unset to follow the system). */
export function PrefsEffects() {
  const { reduceMotion } = usePrefs()
  useEffect(() => {
    const root = document.documentElement
    if (reduceMotion === null) delete root.dataset.reduceMotion
    else root.dataset.reduceMotion = String(reduceMotion)
    return () => {
      delete root.dataset.reduceMotion
    }
  }, [reduceMotion])
  return null
}

/** The page's one aria-live region: what the effects announce ("On Café Lipa's phone: Payment received …"). */
export function LiveRegion() {
  const app = useApp()
  const [text, setText] = useState('')
  useEffect(
    () =>
      app.bus.on('aria-live', (e) => {
        // Cleared first, so the same words twice in a row are read twice.
        setText('')
        window.setTimeout(() => setText(e.text), 50)
      }),
    [app],
  )
  return (
    <div aria-live="polite" role="status" data-testid="live-region" className="sr-only">
      {text}
    </div>
  )
}

// ---- toasts (stage gutter, top bar, phone mode)

/** Runs `onExpire` after `ms`, unless the pointer or focus is on the element. */
export function useAutoDismiss(ms: number, onExpire: () => void, restartKey: unknown) {
  const [paused, setPaused] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new toast (restartKey) restarts the timer
  useEffect(() => {
    if (paused) return
    const id = window.setTimeout(onExpire, ms)
    return () => window.clearTimeout(id)
  }, [paused, ms, restartKey])
  return {
    onMouseEnter: () => setPaused(true),
    onMouseLeave: () => setPaused(false),
    onFocus: () => setPaused(true),
    onBlur: () => setPaused(false),
  }
}

export const TOAST_MS = 3000
export const RESET_TOAST_MS = 10_000

const CARD =
  'anim-sheet block w-full border-l-4 border-green-600 bg-surface px-3 py-2 text-left font-body text-navy-900'

/** A stage toast: a white card with a green edge. With `onPress` the whole card is a button. */
export function ToastCard({
  overline,
  title,
  line,
  onPress,
  onDismiss,
  ms = TOAST_MS,
  restartKey,
  testId = 'toast',
  children,
}: {
  overline?: string
  title: string
  line?: string | null
  onPress?: () => void
  onDismiss: () => void
  ms?: number
  restartKey: unknown
  testId?: string
  children?: ReactNode
}) {
  const hover = useAutoDismiss(ms, onDismiss, restartKey)
  const body = (
    <>
      {overline && <span className="block truncate text-caption text-grey-600">{overline}</span>}
      <span className="block text-body-s leading-[18px] font-semibold">{title}</span>
      {line && <span className="line-clamp-2 block text-body-s leading-[18px] text-grey-600">{line}</span>}
    </>
  )
  return onPress ? (
    <button type="button" data-testid={testId} onClick={onPress} className={CARD} {...hover}>
      {body}
    </button>
  ) : (
    <div role="status" data-testid={testId} className={CARD} {...hover}>
      {body}
      {children}
    </div>
  )
}

/** "Everything reset · Undo" for 10 s. */
export function ResetToast() {
  const app = useApp()
  const toast = useTransient((t) => t.resetToast)
  if (!toast) return null
  return (
    <ToastCard
      testId="reset-toast"
      title={ui.reset.done}
      restartKey={toast.seq}
      ms={RESET_TOAST_MS}
      onDismiss={() => app.actions.dismissResetToast()}
    >
      <button
        type="button"
        data-testid="undo-reset"
        onClick={() => app.actions.undo()}
        className="mt-1 inline-flex min-h-8 items-center font-body text-body-s font-semibold text-green-700 underline"
      >
        {ui.reset.undo}
      </button>
    </ToastCard>
  )
}

// ---- switches and panels

function Switch({
  label,
  on,
  onChange,
  testId,
}: {
  label: string
  on: boolean
  onChange: (on: boolean) => void
  testId: string
}) {
  return (
    <div className="flex min-h-[56px] items-center justify-between border-b border-navy-700">
      <span className="font-body text-body-l text-white">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        data-testid={testId}
        onClick={() => onChange(!on)}
        className={`relative h-8 w-[68px] shrink-0 border ${on ? 'border-line-300 bg-navy-900' : 'border-line-300 bg-line-300'}`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-[3px] size-6 bg-white transition-[left] duration-(--dur-fast) ${on ? 'left-[39px]' : 'left-[3px]'}`}
        />
      </button>
    </div>
  )
}

/** Settings: Reduce motion, Sound, Large text on navy, Payment tape, Undo reset, About BCPS, the build. */
export function SettingsPanel() {
  const app = useApp()
  const prefs = usePrefs()
  useLedgerState() // "Undo reset" follows the ledger's undo
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => app.actions.setOverlay(null), [app])
  useDialog(ref, close, { trap: false })
  const os = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const set = (patch: Partial<typeof prefs>) => app.prefs.update((p) => ({ ...p, ...patch }))
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={ui.settings.title}
      data-testid="settings-panel"
      className="on-navy anim-fade fixed top-11 right-0 bottom-0 z-40 w-[380px] max-w-full overflow-y-auto border-l border-navy-700 bg-navy-900 px-6 pt-5 pb-8 text-white"
    >
      <div className="flex items-center justify-between pb-2">
        <h2 className="font-display text-display-m text-white">{ui.settings.title}</h2>
        <button
          type="button"
          data-testid="settings-done"
          onClick={close}
          className="inline-flex min-h-11 items-center font-body text-body-l font-semibold text-white"
        >
          {ui.settings.done}
        </button>
      </div>
      <Switch
        testId="pref-motion"
        label={ui.settings.reduceMotion}
        on={prefs.reduceMotion ?? os}
        onChange={(on) => set({ reduceMotion: on })}
      />
      <Switch testId="pref-sound" label={ui.settings.sound} on={prefs.sound} onChange={(on) => set({ sound: on })} />
      <Switch
        testId="pref-large"
        label={ui.settings.largeText}
        on={prefs.largeText}
        onChange={(on) => set({ largeText: on })}
      />
      <Switch testId="pref-tape" label={ui.settings.tape} on={prefs.tape} onChange={(on) => set({ tape: on })} />
      {app.runtime.canUndo() && (
        <button
          type="button"
          data-testid="settings-undo"
          onClick={() => {
            app.actions.undo()
            close()
          }}
          className="flex min-h-[56px] w-full items-center border-b border-navy-700 text-left font-body text-body-l text-white"
        >
          {ui.settings.undoReset}
        </button>
      )}
      <a
        href="#/about"
        className="flex min-h-[56px] w-full items-center border-b border-navy-700 font-body text-body-l text-white"
      >
        {ui.settings.about}
      </a>
      <p className="pt-5 font-mono text-mono text-muted-navy">{fill(ui.settings.build, { sha: BUILD_SHA })}</p>
    </div>
  )
}

/** "Reset everything?": a question with the option to log Ana and Café Lipa in again. */
export function ResetDialog({ mode }: { mode: 'stage' | 'phone' }) {
  const app = useApp()
  const [again, setAgain] = useState(mode === 'stage')
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => app.actions.setOverlay(null), [app])
  useDialog(ref, close, { trap: true })
  return (
    <div className="on-navy fixed inset-0 z-50 flex items-center justify-center bg-navy-900/70 px-4">
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reset-title"
        aria-describedby="reset-body"
        data-testid="reset-dialog"
        className="anim-fade w-[400px] max-w-full border-t-4 border-navy-900 bg-surface px-6 pt-5 pb-6 text-ink"
      >
        <h2 id="reset-title" className="font-display text-display-m text-navy-900">
          {ui.reset.title}
        </h2>
        <p id="reset-body" className="mt-2 font-body text-body-l">
          {ui.reset.body}
        </p>
        <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 font-body text-body text-navy-900">
          <input
            type="checkbox"
            name="reset-login-again"
            data-testid="reset-login-again"
            checked={again}
            onChange={(e) => setAgain(e.target.checked)}
            className="size-5 accent-navy-900"
          />
          {ui.reset.option}
        </label>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            data-autofocus
            data-testid="reset-cancel"
            onClick={close}
            className="h-13 flex-1 border border-line-300 bg-surface font-display text-button text-navy-900"
          >
            {ui.reset.cancel}
          </button>
          <button
            type="button"
            data-testid="reset-confirm"
            onClick={() => app.actions.reset(mode, again)}
            className="h-13 flex-1 bg-navy-900 font-display text-button text-white"
          >
            {ui.reset.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}

/** The shortcut list (?). */
export function ShortcutList() {
  const app = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => app.actions.setOverlay(null), [app])
  useDialog(ref, close, { trap: true })
  const rows: [string, string][] = [
    ['F', ui.keys.fullscreen],
    ['Z', ui.keys.zoom],
    ['Esc', ui.keys.escape],
    ['?', ui.keys.help],
  ]
  return (
    <div className="on-navy fixed inset-0 z-50 flex items-center justify-center bg-navy-900/70 px-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keys-title"
        data-testid="shortcut-list"
        className="anim-fade w-[380px] max-w-full border-t-4 border-navy-900 bg-surface px-6 pt-5 pb-6 text-ink"
      >
        <h2 id="keys-title" className="font-display text-display-m text-navy-900">
          {ui.keys.title}
        </h2>
        <dl className="mt-3">
          {rows.map(([key, what]) => (
            <div key={key} className="flex min-h-11 items-center gap-4 border-b border-line-100">
              <dt>
                <kbd className="inline-flex min-w-9 items-center justify-center border border-line-300 bg-bg px-2 py-1 font-mono text-mono text-navy-900">
                  {key}
                </kbd>
              </dt>
              <dd className="font-body text-body text-ink">{what}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          data-autofocus
          onClick={close}
          className="mt-5 h-13 w-full bg-navy-900 font-display text-button text-white"
        >
          {ui.keys.close}
        </button>
      </div>
    </div>
  )
}

/** Whichever presenter panel is open. */
export function PresenterOverlays({ mode }: { mode: 'stage' | 'phone' }) {
  const overlay: Overlay | null = useTransient((t) => t.overlay)
  if (overlay === 'settings') return <SettingsPanel />
  if (overlay === 'reset') return <ResetDialog mode={mode} />
  if (overlay === 'keys') return <ShortcutList />
  return null
}

// ---- notices and the other-tab overlay

const NOTICE_TEXT = {
  recalculated: () => ui.notices.recalculated,
  'restore-failed': () => ui.notices.restoreFailed,
  'storage-unavailable': () => ui.notices.storageUnavailable,
  'write-failed': () => ui.notices.writeFailed,
} as const

/** One-time notices of the runtime ("Couldn't restore your last session. Started fresh."). */
export function NoticeBar({ onNavy = true }: { onNavy?: boolean }) {
  const app = useApp()
  const notices = useNotices()
  if (notices.length === 0) return null
  return (
    <div className={`shrink-0 ${onNavy ? 'on-navy bg-navy-800 text-white' : 'bg-navy-900 text-white'}`}>
      {notices.map((n) => (
        <div
          key={n}
          role="status"
          data-testid={`notice-${n}`}
          className="flex items-center justify-center gap-4 px-4 py-1.5 font-body text-body-s"
        >
          <span>{NOTICE_TEXT[n]()}</span>
          <button
            type="button"
            onClick={() => app.runtime.dismissNotice(n)}
            className="inline-flex min-h-8 items-center font-display text-button text-green-500"
          >
            {ui.notices.dismiss}
          </button>
        </div>
      ))}
    </div>
  )
}

const keep = () => {}

function OtherTabOverlay() {
  const app = useApp()
  const ref = useRef<HTMLDivElement>(null)
  // Escape does not dismiss it: only [Use here] (or the other tab closing) does.
  useDialog(ref, keep, { trap: true })
  return (
    <div
      ref={ref}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="other-tab-title"
      data-testid="other-tab"
      className="on-navy fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-navy-900 px-8 text-center text-white"
    >
      <Wordmark className="text-[28px]" />
      <h1 id="other-tab-title" className="max-w-[326px] font-display text-display-m">
        {ui.otherTab.title}
      </h1>
      <button
        type="button"
        data-autofocus
        data-testid="use-here"
        onClick={() => app.runtime.lock?.takeOver()}
        className="h-13 w-full max-w-[326px] bg-white font-display text-button text-navy-900"
      >
        {ui.otherTab.useHere}
      </button>
    </div>
  )
}

/** While another tab writes: "BCPS is open in another tab." with [Use here]. */
export function OtherTab() {
  return useWriterStatus() === 'waiting' ? <OtherTabOverlay /> : null
}
