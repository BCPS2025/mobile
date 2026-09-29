import { useEffect, useState } from 'react'
import { fill, ui } from '../copy'
import { Avatar } from '../kit/Avatar'
import { useApp, useTransient, useUi } from '../state/AppContext'
import { FlowHost } from '../flows/FlowHost'
import { AuthRoot } from './AuthRoot'
import { HomeScreen } from './HomeScreen'
import { HubScreen } from './HubScreen'
import { PhoneContext, type PhoneContextValue, usePhone } from './PhoneContext'
import { detailScreen, viewScreen } from './implemented'
import { usePhoneStack } from './nav'
import './register'
import { HUBS } from './registry'
import { personaOn } from '@store/sessions'
import { LJUBLJANA } from '@sim/tz'
import type { Screen, Shell, SlotKey } from './types'

// One phone: the account (or Welcome) shown on a slot of the stage or in phone mode, and the top
// of that account's screen stack. Test hooks: data-slot, data-persona (and data-phone on a logged
// in phone).

function ScreenView({ screen, shell }: { screen: Screen; shell: Shell }) {
  switch (screen.kind) {
    case 'home':
      return <HomeScreen />
    case 'hub':
      return HUBS[screen.id as keyof typeof HUBS]?.shell === shell ? <HubScreen id={screen.id} /> : <HomeScreen />
    case 'view': {
      const View = viewScreen(screen.id, shell)
      return View ? <View params={screen.params ?? {}} /> : <HomeScreen />
    }
    case 'detail': {
      const Detail = detailScreen(screen.id)
      return Detail ? <Detail params={screen.params} /> : <HomeScreen />
    }
    case 'flow':
      return <FlowHost screen={screen} />
  }
}

function PersonaScreens({ persona, shell }: { persona: string; shell: Shell }) {
  const stack = usePhoneStack(persona)
  const top = stack[stack.length - 1] as Screen
  const key = `${stack.length}:${top.kind}:${'id' in top ? top.id : ''}${top.kind === 'flow' ? `:${top.instanceId}` : ''}`
  return (
    <div key={key} className="anim-fade h-full">
      <ScreenView screen={top} shell={shell} />
    </div>
  )
}

/** The 600 ms card when the account on a phone changes: avatar and name. */
function HandoverCard() {
  const app = useApp()
  const { slot } = usePhone()
  const handover = useTransient((t) => t.handover[slot])
  const seq = handover?.seq
  const [shown, setShown] = useState<number | null>(null)
  useEffect(() => {
    if (seq === undefined) return
    setShown(seq)
    const id = window.setTimeout(() => setShown((s) => (s === seq ? null : s)), 600)
    return () => window.clearTimeout(id)
  }, [seq])
  const account = handover ? app.persona(handover.persona) : undefined
  if (!account || shown === null || shown !== seq) return null
  return (
    <div
      data-testid="handover"
      role="status"
      className="on-navy anim-fade absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-navy-900 text-white"
    >
      <Avatar persona={account} size={64} onNavy />
      <p className="font-display text-title">{account.displayName}</p>
      <p className="font-body text-body-s text-line-300">{ui.stage.handover}</p>
    </div>
  )
}

export interface PhoneHostProps {
  slot: SlotKey
  mode: 'stage' | 'phone'
  /** Logical size; the stage scales the box around it. */
  width?: number | string
  height?: number | string
  /** The in-app status bar (off on a touch device in phone mode). */
  statusBar?: boolean
  className?: string
}

export function PhoneHost({ slot, mode, width = 390, height = 700, statusBar = true, className = '' }: PhoneHostProps) {
  const app = useApp()
  const ui_ = useUi()
  const persona = personaOn(ui_, slot)
  const account = persona ? app.persona(persona) : undefined
  const value: PhoneContextValue = {
    slot,
    persona: account ? persona : null,
    shell: account?.shell ?? null,
    mode,
    statusBar,
    tz: account?.tz ?? LJUBLJANA,
  }
  const label = account
    ? fill(ui.common.phoneLabel, {
        name: account.displayName,
        role: account.kind === 'person' ? ui.common.roleCustomer : ui.common.roleBusiness,
      })
    : ui.stage.noOne
  return (
    <PhoneContext.Provider value={value}>
      <section
        data-slot={slot}
        data-persona={value.persona ?? 'none'}
        {...(value.persona ? { 'data-phone': value.persona } : {})}
        aria-label={label}
        onPointerDownCapture={() => slot !== 'single' && app.actions.setLastUsed(slot)}
        className={`relative overflow-hidden bg-bg ${className}`}
        style={{ width, height }}
      >
        <div key={value.persona ?? 'auth'} className="h-full">
          {value.persona && value.shell ? <PersonaScreens persona={value.persona} shell={value.shell} /> : <AuthRoot />}
        </div>
        <HandoverCard />
      </section>
    </PhoneContext.Provider>
  )
}
