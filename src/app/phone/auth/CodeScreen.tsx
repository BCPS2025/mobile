import { Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import { codeForLogin, personaOn } from '@store/sessions'
import { fill, ui } from '../../copy'
import { maskEmail } from '../../format'
import { Emblem } from '../../kit/Emblem'
import { useApp, useTransient, useUi } from '../../state/AppContext'
import { useReducedMotion } from '../../state/motion'
import { Dock } from '../chrome/Dock'
import { PhoneScreen } from '../chrome/PhoneScreen'
import { usePhone } from '../PhoneContext'
import { CHIP_DELAY_MS, CHIP_DWELL_MS, CODE_DIGITS, DIGIT_MS, VERIFY_MS, formatCode } from './timing'

// Log in › Enter the code (auth.code): "Sent to ana.novak@•••••••", six display boxes (text, never
// inputs) and, 700 ms after the screen opens, a chip "From Mail · 482 916" that slides up and
// fills the boxes at 80 ms per digit (all at once with reduced motion, with no chip). The code
// rotates with every login and every "Send again". [Verify and log in] spins for 400 ms, then Home.

type Phase = 'wait' | 'chip' | 'filling' | 'filled'

const BOX_IDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'] as const

/** The code screen's sequence: wait, chip, digit by digit, filled; it begins again for every new code. */
function useCodeSequence(code: string, reduced: boolean): { phase: Phase; digits: number; fillNow: () => void } {
  const [state, setState] = useState<{ code: string; phase: Phase; digits: number }>({ code, phase: 'wait', digits: 0 })
  const current = state.code === code ? state : { code, phase: 'wait' as Phase, digits: 0 }

  useEffect(() => {
    if (reduced) {
      setState({ code, phase: 'filled', digits: CODE_DIGITS })
      return
    }
    setState({ code, phase: 'wait', digits: 0 })
    const timers: number[] = []
    let interval: number | undefined
    timers.push(
      window.setTimeout(() => setState({ code, phase: 'chip', digits: 0 }), CHIP_DELAY_MS),
      window.setTimeout(() => {
        let n = 0
        interval = window.setInterval(() => {
          n += 1
          setState({ code, phase: n >= CODE_DIGITS ? 'filled' : 'filling', digits: n })
          if (n >= CODE_DIGITS) window.clearInterval(interval)
        }, DIGIT_MS)
      }, CHIP_DELAY_MS + CHIP_DWELL_MS),
    )
    return () => {
      for (const t of timers) window.clearTimeout(t)
      window.clearInterval(interval)
    }
  }, [code, reduced])

  return {
    phase: current.phase,
    digits: current.digits,
    fillNow: () => setState({ code, phase: 'filled', digits: CODE_DIGITS }),
  }
}

export function CodeScreen() {
  const app = useApp()
  const { slot } = usePhone()
  const uiState = useUi()
  const reduced = useReducedMotion()
  const auth = useTransient((t) => t.auth[slot])
  const [verifying, setVerifying] = useState(false)

  const persona = auth.screen === 'code' ? auth.persona : null
  const resends = auth.screen === 'code' ? auth.resends : 0
  const login = persona ? app.content.personas.personas.find((p) => p.id === persona)?.login : undefined
  const code = persona && login ? codeForLogin(uiState, persona, login.code, resends) : ''
  const seq = useCodeSequence(code, reduced)
  const filled = seq.phase === 'filled'

  useEffect(() => {
    if (!verifying || !persona) return
    const id = window.setTimeout(() => {
      app.actions.completeLogin(slot, persona, resends)
      // The account may have gone to the other phone meanwhile: back to the account list.
      if (personaOn(app.runtime.ui.get(), slot) === null) {
        app.actions.setAuth(slot, { screen: 'login', chosen: null })
        setVerifying(false)
      }
    }, VERIFY_MS)
    return () => window.clearTimeout(id)
  }, [verifying, persona, resends, slot, app])

  if (!persona || !login) return null
  const email = maskEmail(login.email)
  const [chipLabel = ''] = ui.login.mailChip.split('{code}')
  const activeBox = seq.phase === 'wait' || seq.phase === 'chip' ? 0 : seq.digits

  return (
    <PhoneScreen
      id="auth.code"
      header="navy"
      body="navy"
      banner={false}
      title={ui.login.logIn}
      onBack={() => app.actions.setAuth(slot, { screen: 'login', chosen: persona })}
      backDisabled={verifying}
      dock={
        <Dock
          tone="navy"
          primary={{
            label: ui.login.verify,
            tone: 'white',
            enabled: filled && !verifying,
            sending: verifying,
            keepLabel: true,
            onPress: () => setVerifying(true),
          }}
        />
      }
    >
      <div className="pt-2.5 pb-1.5">
        <Emblem size="small" />
      </div>
      <h2 className="px-5 pt-4 text-center font-display text-display-m text-white">{ui.login.codeTitle}</h2>
      <div className="px-5 pt-1.5 text-center">
        <p className="font-body text-body text-line-300">{fill(ui.login.sentTo, { email })}</p>
        {(seq.phase === 'chip' || seq.phase === 'filling') && (
          <button
            type="button"
            data-testid="mail-chip"
            onClick={seq.fillNow}
            className="anim-sheet mt-4 inline-flex h-11 items-center gap-2 border border-green-500 bg-navy-800 px-4 font-body text-body font-medium text-white"
          >
            <Mail size={20} strokeWidth={1.75} aria-hidden="true" className="text-green-500" />
            <span>
              <span className="whitespace-pre">{chipLabel}</span>
              <span className="font-mono text-body font-medium tabular-nums">{formatCode(code)}</span>
            </span>
          </button>
        )}
        {/* biome-ignore lint/a11y/useSemanticElements: a row of display boxes; a fieldset's default box would break the layout */}
        <div
          role="group"
          aria-label={ui.login.codeLabel}
          data-testid="code-boxes"
          className="mx-auto mt-4 flex w-[304px] justify-between"
        >
          {BOX_IDS.map((id, i) => {
            const on = i < seq.digits
            return (
              // biome-ignore lint/a11y/useSemanticElements: the code is shown, never typed; the login screens have no input (no autofill, no password manager)
              <span
                key={`${id}-${resends}`}
                role="textbox"
                tabIndex={-1}
                aria-readonly="true"
                aria-label={fill(ui.login.codeBox, { n: i + 1, total: CODE_DIGITS })}
                className={`flex h-14 w-11 items-center justify-center bg-navy-800 ${
                  on
                    ? 'border border-green-500'
                    : i === activeBox && !filled
                      ? 'border-2 border-white'
                      : 'border border-navy-700'
                }`}
              >
                <span aria-hidden="true" className="font-display text-[26px] font-semibold text-white">
                  {on ? code[i] : ''}
                </span>
              </span>
            )
          })}
        </div>
        <p role="status" className="sr-only">
          {filled ? ui.login.codeFilled : ''}
        </p>
        <p className="mt-3 flex items-center justify-center gap-2 font-body text-caption text-[13px] leading-[18px] text-line-300">
          {ui.login.resendPrompt}
          <button
            type="button"
            data-testid="resend"
            disabled={verifying}
            onClick={() => app.actions.setAuth(slot, { screen: 'code', persona, resends: resends + 1 })}
            className="min-h-11 px-1 font-semibold text-green-500 underline underline-offset-2"
          >
            {ui.login.resendAction}
          </button>
        </p>
      </div>
    </PhoneScreen>
  )
}
