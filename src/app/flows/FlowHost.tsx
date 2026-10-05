import { useSyncExternalStore } from 'react'
import { useLedgerNode, useLedgerState } from '@store/useLedger'
import { ErrorLine } from '../phone/chrome/ErrorLine'
import { Dock, type DockPrimary } from '../phone/chrome/Dock'
import { PhoneScreen } from '../phone/chrome/PhoneScreen'
import { flowImpl } from '../phone/implemented'
import { usePhoneNav } from '../phone/nav'
import { usePersonaPhone } from '../phone/PhoneContext'
import type { FlowScreen } from '../phone/types'
import { ui } from '../copy'
import { useApp, useUi } from '../state/AppContext'
import { createFlowApi } from './actions'
import { makeFlowCtx } from './ctx'
import { phaseOf, stepBar, txOf } from './engine'
import type { FlowImpl } from './types'

// Renders the flow entry on top of a persona's stack: the current step inside the shared chrome
// (task header, step bar, error line, dock), or the flow's success screen once the ledger says
// the payment is confirmed (a persona that was away finds it when it comes back). Back and Home
// are disabled while the payment sends.

const NO_SUBSCRIPTION = () => () => {}

export function FlowHost({ screen }: { screen: FlowScreen }) {
  const app = useApp()
  const phone = usePersonaPhone()
  const nav = usePhoneNav()
  const node = useLedgerNode()
  const impl = flowImpl(screen.id) as FlowImpl<unknown> | undefined
  useLedgerState() // re-render on every ledger change: the phase comes from the ledger
  useUi() // and when who is on the other phone changes (Scan looks at it)
  // A step with something that expires re-renders every second, and only then.
  const live = impl?.steps[screen.step]?.live === true
  useSyncExternalStore(live ? node.clock.subscribeSecond : NO_SUBSCRIPTION, node.clock.second, node.clock.second)
  if (!impl) return null

  const who = { persona: phone.persona, slot: phone.slot, shell: phone.shell }
  const ctx = makeFlowCtx(app, who, screen.params)
  const d = screen.draft
  const phase = phaseOf(screen, impl, ctx)

  if (phase === 'success') {
    const Success = impl.Success
    if (!Success) return null
    return (
      <Success
        d={d}
        ctx={ctx}
        tx={txOf(screen, impl, ctx)}
        done={() => nav.home()}
        followOn={(id, params) => nav.followOn(id, params)}
      />
    )
  }

  const step = impl.steps[screen.step]
  if (!step) return null
  const api = createFlowApi<unknown>(app, who, screen.instanceId)
  const sending = phase === 'sending'
  const navyBody = step.body === 'navy' || step.body === 'navy-800'
  const lighterNavy = step.body === 'navy-800'
  const tone = step.header?.(d, ctx) ?? impl.tone(ctx)
  const overline = step.overline?.(d, ctx)
  const stack = screen.editing ? undefined : step.stack?.(d, ctx, api)

  const def = screen.editing
    ? { label: ui.steps.backToReview, tone: 'navy' as const, enabled: true }
    : step.primary(d, ctx)
  const primary: DockPrimary = {
    label: def.label,
    tone: navyBody && def.tone === 'navy' ? 'white' : def.tone,
    enabled: def.enabled && !sending,
    sending,
    onPress: api.press,
  }
  const secondary = screen.editing ? null : (step.secondary?.(d, ctx, api) ?? null)
  const Body = step.Screen
  // A new dock (and its settle guard) whenever its buttons start doing something else: another
  // step, an Edit detour, or a step whose buttons change role (the café's [New code] turns into
  // Cancel once a fresh code shows).
  const dockKey = [
    screen.instanceId,
    screen.step,
    screen.editing ? 'edit' : '',
    primary.tone,
    secondary?.kind ?? '',
    stack ? 'stack' : '',
  ].join(':')

  return (
    <PhoneScreen
      id={step.screen}
      header={tone}
      body={lighterNavy ? 'navy-800' : navyBody ? 'navy' : 'light'}
      title={step.title?.(d, ctx) ?? impl.title(ctx)}
      {...(overline ? { overline, overlineTone: 'muted' as const } : {})}
      businessName={app.persona(phone.persona)?.displayName ?? ''}
      onBack={nav.back}
      onHome={nav.home}
      backDisabled={sending}
      homeDisabled={sending}
      step={stepBar(impl, d, ctx, screen.step)}
      error={screen.error ? <ErrorLine onNavy={navyBody}>{screen.error}</ErrorLine> : null}
      dock={
        step.hideDock?.(d, ctx) ? undefined : (
          <Dock
            key={dockKey}
            settle
            tone={lighterNavy ? 'navy800' : navyBody ? 'navy' : 'light'}
            {...(stack ? { stack } : { primary, ...(secondary ? { secondary } : {}) })}
          />
        )
      }
    >
      <Body
        d={d}
        ctx={ctx}
        api={api}
        sending={sending}
        error={screen.error ?? null}
        editing={screen.editing === true}
      />
    </PhoneScreen>
  )
}
