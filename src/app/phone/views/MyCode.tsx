import { useEffect, useState } from 'react'
import { PartyAvatar } from '../../kit/PartyAvatar'
import { QrSvg } from '../../kit/QrCard'
import { copyText } from '../../clipboard'
import { fill, ui } from '../../copy'
import { personPayload } from '../../paymentCode'
import { useApp } from '../../state/AppContext'
import { Dock } from '../chrome/Dock'
import { PhoneScreen } from '../chrome/PhoneScreen'
import { usePhoneNav } from '../nav'
import { usePersonaPhone } from '../PhoneContext'
import { VIEWS } from '../registry'

// My code (c.mycode): a QR that holds only your @username, for others to scan and pay you. While it
// is on screen the phone beside this one (or this phone after switching account) can scan it for
// ten minutes: Scan then opens Send for you. [Copy @ana] copies the username; [Share payment link]
// starts a payment link.

export function MyCodeView() {
  const app = useApp()
  const { persona } = usePersonaPhone()
  const nav = usePhoneNav()
  const account = app.persona(persona)
  const [copied, setCopied] = useState(false)
  // Showing the code lets the other phone scan it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per time the code is shown
  useEffect(() => {
    app.actions.showQr(persona, 'code')
  }, [persona])
  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(id)
  }, [copied])
  if (!account) return null
  const screen = VIEWS.myCode.screen
  return (
    <PhoneScreen
      id={typeof screen === 'string' ? screen : (screen.consumer ?? '')}
      header="light"
      title={ui.hubs.rows.myCode}
      onBack={nav.back}
      onHome={nav.home}
      dock={
        <Dock
          secondary={{
            kind: 'outline',
            fit: true,
            label: copied ? ui.myCode.copied : fill(ui.myCode.copy, { handle: account.handle }),
            onPress: async () => setCopied(await copyText(account.handle)),
          }}
          primary={{ label: ui.myCode.share, tone: 'navy', onPress: () => nav.openFlow('paymentLink') }}
        />
      }
    >
      <div className="flex min-h-0 flex-1 flex-col items-center px-5 pt-5 text-center">
        <span className="border border-line-200 bg-white p-3" data-testid="my-code">
          <QrSvg
            payload={personPayload(account.handle)}
            size={200}
            label={fill(ui.myCode.qrLabel, { handle: account.handle })}
          />
        </span>
        <div className="mt-5 flex items-center gap-3">
          <PartyAvatar party={account} />
          <span className="text-left">
            <span className="block font-display text-title text-navy-900" data-testid="my-handle">
              {account.handle}
            </span>
            <span className="block font-body text-body text-grey-600">{account.displayName}</span>
          </span>
        </div>
        <p className="mt-4 font-body text-body-s text-grey-600">{ui.myCode.hint}</p>
        <span role="status" className="sr-only">
          {copied ? ui.myCode.copied : ''}
        </span>
      </div>
    </PhoneScreen>
  )
}
