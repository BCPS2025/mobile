import { entryOf } from '@domain/ledger'
import type { AccountId, LedgerState, Party, PersonaId } from '@domain/types'

// Finding a person or business to pay: the parties an account has dealt with (contacts, newest
// first), and a search over the directory by @username or name. Pure selectors over the ledger;
// the picker step draws them. What a flow may pay (a business only, no guests …) is its own
// `filter`.

export interface PartyFilter {
  /** Keep only the parties this returns true for (default: everyone but the viewer). */
  filter?: (p: Party) => boolean
}

/** Lower case, no accents: "Kovač" and "kovac" are the same. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** The directory entry an account or handle names on a transaction leg (off-stage legs carry the handle). */
export function counterpartyOf(s: LedgerState, account: AccountId, party: string | undefined): Party | undefined {
  if (account === 'sys:offstage') return party === undefined ? undefined : partyByHandle(s, party)
  if (account.startsWith('sys:')) return undefined
  return entryOf(s.directory, account)
}

function partyByHandle(s: LedgerState, handle: string): Party | undefined {
  const id = entryOf(s.handles, handle.startsWith('@') ? handle : `@${handle}`)
  return id === undefined ? undefined : entryOf(s.directory, id)
}

/** The people and businesses `viewer` has paid or been paid by, most recent first, each once. */
export function contactsOf(s: LedgerState, viewer: PersonaId, o: PartyFilter = {}): Party[] {
  const out: Party[] = []
  const seen = new Set<string>()
  for (let i = s.txOrder.length - 1; i >= 0; i--) {
    const tx = s.txs[s.txOrder[i] ?? '']
    if (!tx) continue
    let other: Party | undefined
    if (tx.from === viewer) other = counterpartyOf(s, tx.to, tx.party)
    else if (tx.to === viewer) other = counterpartyOf(s, tx.from, tx.party)
    if (!other || other.id === viewer || seen.has(other.id)) continue
    if (o.filter && !o.filter(other)) continue
    seen.add(other.id)
    out.push(other)
  }
  return out
}

/** Whether a typed query is a prefix of the handle or of a word of the name. */
function matches(p: Party, q: string): boolean {
  if (q === '') return true
  const handle = fold(p.handle).replace(/^@/, '')
  if (handle.startsWith(q)) return true
  return fold(p.displayName)
    .split(/[\s.·-]+/)
    .some((word) => word.startsWith(q))
}

/** The query without a leading "@", trimmed and folded. */
export const normaliseQuery = (query: string): string => fold(query.trim()).replace(/^@+/, '')

/**
 * Suggestions for what has been typed: contacts first (newest first), then the rest of the
 * directory by handle. An empty query lists the contacts only.
 */
export function searchParties(s: LedgerState, viewer: PersonaId, query: string, o: PartyFilter = {}): Party[] {
  const q = normaliseQuery(query)
  const contacts = contactsOf(s, viewer, o)
  if (q === '') return contacts
  const isContact = new Set(contacts.map((p) => p.id))
  const rest = Object.values(s.directory)
    .filter((p) => p.id !== viewer && !isContact.has(p.id) && (!o.filter || o.filter(p)))
    .sort((a, b) => a.handle.localeCompare(b.handle))
  return [...contacts, ...rest].filter((p) => matches(p, q))
}

/** The party whose handle is exactly what was typed ("@marko" or "marko"), if it may be paid. */
export function resolveParty(s: LedgerState, viewer: PersonaId, query: string, o: PartyFilter = {}): Party | undefined {
  const q = query.trim()
  if (q === '') return undefined
  const p = partyByHandle(s, q.toLowerCase())
  if (!p || p.id === viewer) return undefined
  return o.filter && !o.filter(p) ? undefined : p
}

/** Whether a typed handle ("@ana" or "ana") names the viewer's own account. */
export function isSelf(s: LedgerState, viewer: PersonaId, query: string): boolean {
  const q = query.trim().toLowerCase()
  return q !== '' && partyByHandle(s, q)?.id === viewer
}
