import { Check } from 'lucide-react'
import { BUILD_SHA } from '../boot/build-info'
import { fill, ui } from '../copy'
import { rateText } from '../format'
import { content } from '@content/load'

// The About BCPS content (Profile › About BCPS, and the #/about page): what BCPS is, the three
// fee lines, the rate note, what others see, the one warning and the build line.

function Heading({ children, page }: { children: string; page: boolean }) {
  return (
    <div className="pt-6 pb-1">
      <h2
        className={`font-display font-semibold uppercase text-navy-900 ${page ? 'text-[14px] tracking-[0.16em]' : 'text-[13px] leading-4 tracking-[0.14em]'}`}
      >
        {children}
      </h2>
      <span aria-hidden="true" className="mt-1.5 block h-[3px] w-6 bg-green-600" />
    </div>
  )
}

export function AboutContent({ page = false }: { page?: boolean }) {
  const rate = content.config.rate
  return (
    <div className={`flex min-h-0 flex-1 flex-col ${page ? 'font-body' : ''}`}>
      <p className={`${page ? 'text-body-l' : 'text-body'} pt-4 text-navy-900`}>{ui.about.intro}</p>
      <Heading page={page}>{ui.about.feesTitle}</Heading>
      <ul className="mt-2 space-y-2">
        {ui.about.fees.map((line) => (
          <li key={line} className="flex gap-2.5 font-body text-body-s text-navy-900">
            <Check size={18} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3.5 bg-green-50 px-3 py-2.5 font-body text-body-s text-navy-900">
        {fill(ui.common.rateInfo, { rate: rateText(rate) })}
      </p>
      <Heading page={page}>{ui.about.privacyTitle}</Heading>
      <p className="mt-2 font-body text-body-s text-grey-600">{ui.about.privacy}</p>
      <p className="mt-2 font-body text-body-s font-semibold text-navy-900">{ui.about.safety}</p>
      <p className="mt-auto pt-8 pb-4 text-center font-body text-body-s text-grey-600">
        {fill(ui.about.build, { sha: BUILD_SHA })}
      </p>
    </div>
  )
}
