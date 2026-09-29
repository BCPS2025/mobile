import { Check, ScanFace } from 'lucide-react'
import { useEffect, useState } from 'react'
import { loginChoices } from '@store/sessions'
import { fill, ui } from '../../copy'
import { maskEmail } from '../../format'
import { Emblem } from '../../kit/Emblem'
import { useApp, useTransient, useUi } from '../../state/AppContext'
import { useReducedMotion } from '../../state/motion'
import { Dock } from '../chrome/Dock'
import { PhoneScreen } from '../chrome/PhoneScreen'
import { usePhone } from '../PhoneContext'
import { LIVE_SHELLS } from '../registry'
import { BIOMETRIC_MS, typeInterval } from './timing'

// Log in › Choose your account (auth.login): the accounts of the live shells (the remembered one
// first; the one on the other phone greyed "On the other phone" and disabled), and under them a
// read-only EMAIL display. Tapping an account types its masked email into the display, 25 ms per
// character (600 ms at most), then [Continue] opens Enter the code. [Log in with biometrics]
// appears once an account is chosen. There is no field to type in: the display is text.

/** A text typed out character by character (all at once with reduced motion). */
function useTypedText(text: string | null, reduced: boolean): { shown: string; done: boolean } {
  const [state, setState] = useState<{ text: string | null; n: number }>({ text, n: 0 })
  const n = state.text === text ? state.n : 0
  useEffect(() => {
    if (text === null) return
    if (reduced) {
      setState({ text, n: text.length })
      return
    }
    let i = 0
    setState({ text, n: 0 })
    const id = window.setInterval(() => {
      i += 1
      setState({ text, n: i })
      if (i >= text.length) window.clearInterval(id)
    }, typeInterval(text.length))
    return () => window.clearInterval(id)
  }, [text, reduced])
  return { shown: text === null ? '' : text.slice(0, n), done: text !== null && n >= text.length }
}

export function LoginScreen() {
  const app = useApp()
  const { slot } = usePhone()
  const uiState = useUi()
  const reduced = useReducedMotion()
  const auth = useTransient((t) => t.auth[slot])
  const [bio, setBio] = useState(false)

  const live = app.content.personas.personas.filter((p) => p.login && p.shell && LIVE_SHELLS.includes(p.shell))
  const choices = loginChoices(
    uiState,
    slot,
    live.map((p) => p.id),
  )
  const chosen = auth.screen === 'login' ? auth.chosen : null
  const chosenRow = choices.find((c) => c.persona === chosen)
  const email = chosen ? maskEmail(live.find((p) => p.id === chosen)?.login?.email ?? '') : null
  const typed = useTypedText(email, reduced)

  // The account was taken to the other phone meanwhile: nothing is chosen any more.
  useEffect(() => {
    if (chosen && (chosenRow === undefined || chosenRow.disabled))
      app.actions.setAuth(slot, { screen: 'login', chosen: null })
  }, [chosen, chosenRow, app, slot])

  useEffect(() => {
    if (!bio || !chosen) return
    const id = window.setTimeout(() => app.actions.completeLogin(slot, chosen), BIOMETRIC_MS)
    return () => window.clearTimeout(id)
  }, [bio, chosen, slot, app])

  const choose = (persona: string) => {
    if (bio || persona === chosen) return
    app.actions.remember(slot, persona)
    app.actions.setAuth(slot, { screen: 'login', chosen: persona })
  }
  const next = () => {
    if (chosen && typed.done) app.actions.setAuth(slot, { screen: 'code', persona: chosen, resends: 0 })
  }

  return (
    <PhoneScreen
      id="auth.login"
      header="navy"
      body="navy"
      banner={false}
      title={ui.login.logIn}
      onBack={() => app.actions.setAuth(slot, { screen: 'welcome' })}
      backDisabled={bio}
      dock={
        chosen ? (
          <Dock
            tone="navy"
            stack={[
              { label: ui.login.continue, kind: 'white', onPress: next, disabled: !typed.done || bio },
              {
                label: ui.login.biometrics,
                kind: 'outline',
                icon: <ScanFace size={20} strokeWidth={1.75} aria-hidden="true" />,
                onPress: () => setBio(true),
                sending: bio,
                keepLabel: true,
              },
            ]}
          />
        ) : (
          <Dock tone="navy" primary={{ label: ui.login.continue, tone: 'white', enabled: false, onPress: next }} />
        )
      }
    >
      <div className="pt-2.5 pb-1.5">
        <Emblem size="small" />
      </div>
      <h2 className="px-5 pt-4 text-center font-display text-display-m text-white">{ui.login.chooseAccount}</h2>
      <div className="px-5 pt-2.5">
        <ul className="border-t border-navy-700">
          {choices.map((row) => {
            const p = live.find((x) => x.id === row.persona)
            if (!p?.login) return null
            const selected = row.persona === chosen
            return (
              <li key={p.id}>
                <button
                  type="button"
                  data-testid={`login-${p.id}`}
                  disabled={row.disabled}
                  aria-pressed={selected}
                  onClick={() => choose(p.id)}
                  className={`flex h-12 w-full items-center gap-2.5 border-b border-l-[3px] border-b-navy-700 pr-2 pl-[9px] text-left ${
                    selected ? 'border-l-green-500 bg-navy-800' : 'border-l-transparent'
                  } ${row.disabled ? 'opacity-45' : ''}`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex size-8 shrink-0 items-center justify-center bg-white font-display text-[12px] font-semibold text-navy-900 ${
                      p.kind === 'person' ? 'rounded-full' : ''
                    }`}
                  >
                    {p.displayName
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((w) => w[0]?.toUpperCase() ?? '')
                      .join('')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-body text-body font-semibold leading-[18px] text-white">
                      {p.displayName}
                    </span>
                    <span className="block truncate font-body text-caption leading-4 text-line-300">
                      {maskEmail(p.login.email)}
                    </span>
                  </span>
                  <span className="shrink-0 font-body text-[11px] leading-[14px] font-semibold uppercase tracking-[0.12em] text-grey-400">
                    {row.disabled ? ui.login.otherPhone : p.kind === 'person' ? ui.login.personal : ui.login.business}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <p className="pt-3.5 font-body text-caption leading-4 font-medium uppercase tracking-[0.16em] text-grey-400">
          {ui.login.emailLabel}
        </p>
        {/* biome-ignore lint/a11y/useSemanticElements: the email is shown, never typed; the login screens have no input (no autofill, no password manager) */}
        <div
          role="textbox"
          tabIndex={-1}
          aria-readonly="true"
          aria-label={ui.login.emailLabel}
          data-testid="login-email"
          className={`mt-2 flex h-12 items-center justify-between bg-navy-800 px-3 ${
            chosen ? 'border-2 border-green-500' : 'border border-navy-700'
          }`}
        >
          {chosen ? (
            <span aria-hidden="true" className="font-body text-body text-white">
              {typed.shown}
              {!typed.done && (
                <span className="ml-px inline-block h-[18px] w-0.5 translate-y-0.5 bg-white anim-pending" />
              )}
            </span>
          ) : (
            <span className="font-body text-body text-grey-400">{ui.login.tapAccount}</span>
          )}
          {typed.done && <Check size={24} strokeWidth={1.75} aria-hidden="true" className="text-green-500" />}
        </div>
        <p role="status" className="sr-only">
          {typed.done && email ? fill(ui.login.emailFilled, { email }) : ''}
        </p>
      </div>
    </PhoneScreen>
  )
}
