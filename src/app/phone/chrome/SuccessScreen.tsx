import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatMinor } from '@domain/money'
import type { Minor } from '@domain/types'
import { ui } from '../../copy'
import { usePhoneNav } from '../nav'
import { Dock, type DockSecondary } from './Dock'
import { InfoRows } from './InfoRows'
import { PhoneScreen } from './PhoneScreen'

// The two success styles. Money moved (navy): an overline (PAID, RECEIVED, SENT …) in the
// header, a green check tile, the amount, who and what, then the detail lines and a white [Done].
// No money moved (neutral, navy-800): the same frame with a ring check and a title instead of an
// amount. The header shows only the overline and Home; [Done] returns Home.

export interface SuccessLine {
  label: string
  value: ReactNode
  mono?: boolean
}

export interface SuccessScreenProps {
  /** data-screen. */
  id: string
  variant: 'money' | 'neutral'
  overline: string
  /** A small chip above the block ("From notification · 12:15"). */
  chip?: ReactNode
  /** The big amount; `signed` shows a leading + ("+11.00"). */
  amount?: { value: Minor; signed?: boolean }
  /** "≈ €10.00" under the amount. */
  eur?: string
  /** A line under the amount in the same style ("from @ana · Ana Novak"). */
  sub?: string
  /** "to Café Lipa" under the amount (money), or the headline (neutral). */
  title?: string
  /** One line under the title. */
  body?: string
  /** A green line ("Spendable now"). */
  highlight?: string
  lines?: SuccessLine[]
  /** `plain`: rows under a hairline; `card`: rows in a bordered navy panel (the café's PAID). */
  linesStyle?: 'plain' | 'card'
  doneLabel?: string
  /** [Done]. */
  onDone: () => void
  /** A second control beside [Done] in the dock (a text link or an outline button). */
  secondary?: DockSecondary
}

/** A success screen inside a phone: its Home returns to the account's Home. */
export function SuccessScreen(p: SuccessScreenProps) {
  const nav = usePhoneNav()
  return <SuccessLayout {...p} onHome={() => nav.home()} />
}

/** The success screen itself. Without `onHome` the header shows only the overline (the payment page outside the phones). */
export function SuccessLayout(p: SuccessScreenProps & { onHome?: () => void }) {
  const neutral = p.variant === 'neutral'
  return (
    <PhoneScreen
      id={p.id}
      header={neutral ? 'navy800' : 'navy'}
      body={neutral ? 'navy-800' : 'navy'}
      overline={p.overline}
      overlineTone={neutral ? 'muted' : 'green'}
      {...(p.onHome ? { onHome: p.onHome } : {})}
      dock={
        <Dock
          tone={neutral ? 'navy800' : 'navy'}
          {...(p.secondary ? { secondary: p.secondary } : {})}
          primary={{ label: p.doneLabel ?? ui.common.done, tone: 'white', onPress: p.onDone }}
        />
      }
    >
      <div className="flex min-h-0 flex-1 flex-col px-5 pt-1">
        {p.chip && (
          <p className="inline-flex w-fit items-center gap-2 border border-navy-700 px-2.5 py-[5px] font-body text-caption text-line-300">
            {p.chip}
          </p>
        )}
        <div className="flex flex-1 flex-col items-center justify-center py-4 text-center">
          {neutral ? (
            <span
              aria-hidden="true"
              className="flex size-14 items-center justify-center border-2 border-muted-on-800 text-white"
            >
              <Check size={24} strokeWidth={1.75} />
            </span>
          ) : (
            <span aria-hidden="true" className="flex size-16 items-center justify-center bg-green-500 text-navy-900">
              <Check size={36} strokeWidth={2.5} />
            </span>
          )}
          {p.amount && (
            <p
              data-testid="success-amount"
              className="mt-6 font-display text-[48px] leading-[52px] font-semibold tracking-[-0.02em] tnum text-white"
            >
              {p.amount.signed ? '+' : ''}
              {formatMinor(p.amount.value)}
              <span className="ml-2 text-[22px] font-medium tracking-normal text-grey-400">{ui.common.bcps}</span>
            </p>
          )}
          {p.eur && <p className="font-body text-body text-line-300 tnum">{p.eur}</p>}
          {p.sub && <p className="mt-1 font-body text-body text-line-300">{p.sub}</p>}
          {p.title && (
            <p
              className={`${p.amount ? 'mt-3 text-title' : 'mt-5 text-display-m'} font-display font-semibold text-white`}
            >
              {p.title}
            </p>
          )}
          {p.body && (
            <p className={`mt-2 max-w-[290px] font-body text-body ${neutral ? 'text-muted-on-800' : 'text-line-300'}`}>
              {p.body}
            </p>
          )}
          {p.highlight && <p className="mt-3 font-body text-body font-semibold text-green-500">{p.highlight}</p>}
        </div>
        {p.lines && p.lines.length > 0 && p.linesStyle === 'card' ? (
          <InfoRows className="mb-3" rows={p.lines} />
        ) : (
          p.lines &&
          p.lines.length > 0 && (
            <dl className="border-t border-navy-700 pt-1 pb-3">
              {p.lines.map((l) => (
                <div key={l.label} className="flex min-h-10 items-center justify-between gap-4">
                  <dt className={`font-body text-body-s ${neutral ? 'text-muted-on-800' : 'text-grey-400'}`}>
                    {l.label}
                  </dt>
                  <dd
                    className={`text-right text-body-s text-white tnum ${l.mono ? 'font-mono text-mono' : 'font-body'}`}
                  >
                    {l.value}
                  </dd>
                </div>
              ))}
            </dl>
          )
        )}
      </div>
    </PhoneScreen>
  )
}
