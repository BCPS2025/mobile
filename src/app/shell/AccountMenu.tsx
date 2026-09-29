import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { formatMinor } from '@domain/money'
import type { Persona } from '@domain/types'
import { selectAvailable } from '@store/selectors'
import { type SlotKey, otherStage, personaOn } from '@store/sessions'
import { useLedger } from '@store/useLedger'
import { ui } from '../copy'
import { Avatar } from '../kit/Avatar'
import { LIVE_SHELLS } from '../phone/registry'
import { useApp, useUi, useUnread } from '../state/AppContext'

// "Switch account": the accounts of the shells that are built, in groups (01 MERCHANTS,
// 02 END CUSTOMERS), each with its avatar, name, role, balance, unread badge and where it is
// shown. Choosing an account logs it in on this phone at once (a swap when it is on the other
// phone). The footer shows Welcome on this phone. Used by the stage's label blocks and by the
// phone-mode pill; presenter chrome, never inside a phone.

const GROUPS = [
  { segment: 'merchant', number: '01', title: () => ui.accountMenu.merchants },
  { segment: 'customer', number: '02', title: () => ui.accountMenu.customers },
  { segment: 'saas', number: '03', title: () => '' },
  { segment: 'xborder', number: '04', title: () => '' },
] as const

function Row({ persona, slot, onDone }: { persona: Persona; slot: SlotKey; onDone: () => void }) {
  const app = useApp()
  const ui_ = useUi()
  const balance = useLedger(selectAvailable(persona.id))
  const unread = useUnread(persona.id)
  const here = personaOn(ui_, slot) === persona.id
  const other = slot !== 'single' && personaOn(ui_, otherStage(slot)) === persona.id
  return (
    <li>
      <button
        type="button"
        data-testid={`account-${persona.id}`}
        aria-current={here || undefined}
        disabled={here}
        onClick={() => {
          app.actions.choose(slot, persona.id)
          onDone()
        }}
        className="flex min-h-14 w-full items-center gap-3 border-b border-line-100 py-2 text-left active:bg-line-100 disabled:bg-green-50"
      >
        <Avatar persona={persona} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-body text-body font-semibold text-navy-900">{persona.displayName}</span>
          <span className="block truncate font-body text-caption text-grey-600">
            {persona.roleLabel}
            {here ? ` · ${ui.accountMenu.onThisPhone}` : other ? ` · ${ui.accountMenu.onOtherPhone}` : ''}
          </span>
        </span>
        <span className="shrink-0 text-right font-body text-body-s text-navy-900 tnum">{formatMinor(balance)}</span>
        {unread > 0 && (
          <span
            role="img"
            aria-label={ui.accountMenu.unread.replace('{count}', String(unread))}
            className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center bg-navy-900 px-1 font-sans text-[11px] leading-none font-semibold text-white"
          >
            {unread}
          </span>
        )}
      </button>
    </li>
  )
}

export function AccountMenu({
  slot,
  onDone,
  children,
  className = '',
}: {
  slot: SlotKey
  /** Closes the menu. */
  onDone: () => void
  /** More rows under the accounts (phone mode: the time, Reset, Settings). */
  children?: ReactNode
  className?: string
}) {
  const app = useApp()
  const ui_ = useUi()
  const ref = useRef<HTMLDivElement>(null)
  const personas = useMemo(
    () =>
      (app.content.personas.personas as Persona[]).filter(
        (p) => p.onStage && p.shell !== undefined && LIVE_SHELLS.includes(p.shell),
      ),
    [app],
  )

  // Escape and a press outside close the menu (Escape here never reaches the page's own keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onDone()
    }
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onDone()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [onDone])
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }, [])

  const onPhone = personaOn(ui_, slot) !== null
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={ui.accountMenu.title}
      data-testid="account-menu"
      className={`anim-fade z-50 w-[320px] max-w-[calc(100vw-16px)] border border-line-200 bg-surface px-4 pt-3 pb-1 text-left text-ink shadow-(--shadow-sheet) ${className}`}
    >
      <h2 className="font-display text-[17px] leading-[22px] font-semibold text-navy-900">{ui.accountMenu.title}</h2>
      {GROUPS.map((g) => {
        const rows = personas.filter((p) => p.segment === g.segment)
        if (rows.length === 0) return null
        return (
          <section key={g.segment} aria-label={g.title()}>
            <div className="pt-3 pb-1">
              <h3 className="font-display text-[12px] leading-4 font-semibold uppercase tracking-[0.14em] text-navy-900">
                <span className="mr-2 text-grey-600">{g.number}</span>
                {g.title()}
              </h3>
              <span aria-hidden="true" className="mt-1.5 block h-[3px] w-6 bg-green-600" />
            </div>
            <ul>
              {rows.map((p) => (
                <Row key={p.id} persona={p} slot={slot} onDone={onDone} />
              ))}
            </ul>
          </section>
        )
      })}
      <button
        type="button"
        data-testid="show-welcome"
        disabled={!onPhone}
        onClick={() => {
          app.actions.logout(slot)
          onDone()
        }}
        className="flex min-h-12 w-full items-center py-2 text-left font-body text-body font-semibold text-green-700 disabled:opacity-40"
      >
        {ui.accountMenu.showWelcome}
      </button>
      {children}
    </div>
  )
}
