import { Check, ChevronRight, Search } from 'lucide-react'
import { type KeyboardEvent, useMemo } from 'react'
import type { Content } from '@content/schema'
import type { LedgerState, Party, PersonaId } from '@domain/types'
import { type PartyFilter, normaliseQuery, resolveParty, searchParties } from '@store/parties'
import { errorText } from '../../errors'
import { fill, ui } from '../../copy'
import { initials } from '../../format'
import { ErrorLine } from '../../phone/chrome/ErrorLine'
import { ListSection } from '../../phone/chrome/ListRow'

// The step that picks who to pay: a search field for @username or name, and under it the contacts
// (RECENT) or, while typing, the matches: contacts first, then the directory. A person shows
// "@marko ✓" over the name; a business shows its name over "Business · Ljubljana"; an off-stage
// person shows their handle over their name ("@marta_k", "Marta K."). A handle that is not in the
// directory says so and nothing can be continued. The query is the flow's draft; the flow asks
// `resolveParty` (same filter) whether it names someone.

export interface PickPartyStepProps {
  title: string
  /** What has been typed (or filled in by a tap on a row). */
  query: string
  onQuery: (query: string) => void
  state: LedgerState
  content: Content
  viewer: PersonaId
  /** Which parties may be picked. */
  filter?: PartyFilter['filter']
  /** Enter, when the query names someone. */
  onSubmit?: () => void
}

function PartyAvatar({ party }: { party: Party }) {
  return party.kind === 'business' ? (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center bg-navy-900 font-display text-[13px] font-semibold text-white"
    >
      {initials(party.displayName)}
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-line-100 font-display text-[13px] font-semibold text-navy-900"
    >
      {initials(party.displayName)}
    </span>
  )
}

/** What a row says: the first and the second line. */
function lines(p: Party, content: Content): { first: string; second: string; verified: boolean } {
  if (p.kind === 'business') {
    const place = content.personas.personas.find((x) => x.handle === p.handle)?.subtitle
    return {
      first: p.displayName,
      second: place ? fill(ui.party.businessIn, { place }) : ui.party.business,
      verified: p.onStage,
    }
  }
  return { first: p.handle, second: p.displayName, verified: p.onStage }
}

export function PickPartyStep(p: PickPartyStepProps) {
  const filter = p.filter ? { filter: p.filter } : {}
  const list = useMemo(() => searchParties(p.state, p.viewer, p.query, filter), [p.state, p.viewer, p.query, filter])
  const picked = resolveParty(p.state, p.viewer, p.query, filter)
  const typed = p.query.trim()
  const unknown = typed !== '' && list.length === 0
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && picked) {
      e.preventDefault()
      p.onSubmit?.()
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 font-display text-display-m text-navy-900">{p.title}</h2>
      <div className="field mt-3.5 flex h-12 shrink-0 items-center gap-2.5 bg-surface px-3">
        <Search size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-grey-600" />
        <input
          type="text"
          name="party-search"
          id="party-search"
          data-testid="party-search"
          aria-label={ui.party.searchLabel}
          placeholder={ui.party.placeholder}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          inputMode="text"
          enterKeyHint="next"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent font-body text-body-l text-navy-900 outline-none placeholder:text-grey-500"
        />
      </div>
      {unknown && (
        <ErrorLine className="mt-3">
          {errorText({
            code: 'unknown-recipient',
            handle: typed.startsWith('@') ? typed : `@${normaliseQuery(typed)}`,
          })}
        </ErrorLine>
      )}
      {!unknown && list.length > 0 && typed === '' && <ListSection>{ui.party.recent}</ListSection>}
      <ul className="min-h-0 flex-1 overflow-y-auto pt-1" data-testid="party-list">
        {list.map((party) => {
          const t = lines(party, p.content)
          const on = picked?.id === party.id
          return (
            <li key={party.id}>
              <button
                type="button"
                data-testid={`party-${party.handle.replace('@', '')}`}
                aria-current={on || undefined}
                onClick={() => p.onQuery(party.handle)}
                className={`flex min-h-[61px] w-full items-center gap-3 border-b border-line-100 py-2 text-left active:bg-line-100 ${on ? 'bg-green-50' : ''}`}
              >
                <PartyAvatar party={party} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 font-body text-body font-semibold text-navy-900">
                    <span className="truncate">{t.first}</span>
                    {t.verified && (
                      <Check
                        size={15}
                        strokeWidth={2.25}
                        aria-label={ui.common.verified}
                        className="shrink-0 text-green-700"
                      />
                    )}
                  </span>
                  <span className="block truncate font-body text-body-s text-grey-600">{t.second}</span>
                </span>
                <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
