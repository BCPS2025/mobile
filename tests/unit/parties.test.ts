import { describe, expect, it } from 'vitest'
import type { UserCommand } from '@domain/types'
import { contactsOf, normaliseQuery, resolveParty, searchParties } from '@store/parties'
import { headless } from '../support/journey'
import { m } from './helpers'

// Who Ana can pay: contacts first, then the directory; "@mar" finds both @marko and @marta_k.

const seed = headless('2026-09-25').seed.state
const handles = (list: { handle: string }[]) => list.map((p) => p.handle)

describe('contacts', () => {
  it('are the people and businesses the account has paid or been paid by, newest first, once each', () => {
    const list = handles(contactsOf(seed, 'ana'))
    expect(list).toContain('@marko')
    expect(list).toContain('@marta_k')
    expect(new Set(list).size).toBe(list.length)
    expect(list).not.toContain('@ana')
    // The seed's sys accounts (top-ups) never show up as a person.
    expect(list.every((h) => h.startsWith('@'))).toBe(true)
  })

  it('a payment made now moves that person to the front', () => {
    const h = headless('2026-09-25')
    const cmd: UserCommand = {
      type: 'pay',
      actor: 'ana',
      cmdId: 'aaaaaaaaaaaaaaaa:review',
      to: '@cafelipa',
      amount: m('3.30'),
      channel: 'qr',
      expect: { senderDebit: m('3.30') },
    }
    expect(h.node.dispatch(cmd).ok).toBe(true)
    h.node.settleDue()
    expect(handles(contactsOf(h.node.getState(), 'ana'))[0]).toBe('@cafelipa')
  })

  it('respect the filter (a flow that pays businesses only)', () => {
    const list = contactsOf(seed, 'cafe', { filter: (p) => p.kind === 'business' })
    expect(list.every((p) => p.kind === 'business')).toBe(true)
  })
})

describe('search', () => {
  it('"@mar" suggests @marko and @marta_k, the contact first', () => {
    const list = searchParties(seed, 'ana', '@mar')
    expect(handles(list)).toEqual(expect.arrayContaining(['@marko', '@marta_k']))
    expect(list.find((p) => p.handle === '@marta_k')?.offstage).toBe(true)
    expect(list.find((p) => p.handle === '@marko')?.onStage).toBe(true)
  })

  it('finds a business by its name and a person by the surname, without accents', () => {
    expect(handles(searchParties(seed, 'ana', 'caf'))).toContain('@cafelipa')
    expect(handles(searchParties(seed, 'ana', 'kovac'))).toContain('@marko')
    expect(handles(searchParties(seed, 'ana', 'Kovač'))).toContain('@marko')
    expect(handles(searchParties(seed, 'ana', 'pekarna'))).toContain('@pekarnazrno')
  })

  it('never offers the account itself, and offers nobody for an unknown handle', () => {
    expect(handles(searchParties(seed, 'ana', 'ana'))).not.toContain('@ana')
    expect(searchParties(seed, 'ana', '@anaa')).toEqual([])
    expect(searchParties(seed, 'ana', 'zzz')).toEqual([])
  })

  it('an empty query lists the contacts only', () => {
    expect(searchParties(seed, 'ana', '')).toEqual(contactsOf(seed, 'ana'))
    expect(searchParties(seed, 'ana', '  ')).toEqual(contactsOf(seed, 'ana'))
  })

  it('the query is trimmed, folded and loses a leading @', () => {
    expect(normaliseQuery('  @@Marko ')).toBe('marko')
    expect(normaliseQuery('Kovač')).toBe('kovac')
  })
})

describe('resolving a typed handle', () => {
  it('needs the whole handle, with or without @', () => {
    expect(resolveParty(seed, 'ana', '@marko')?.id).toBe('marko')
    expect(resolveParty(seed, 'ana', 'marko')?.id).toBe('marko')
    expect(resolveParty(seed, 'ana', ' @Marko ')?.id).toBe('marko')
    expect(resolveParty(seed, 'ana', '@mar')).toBeUndefined()
    expect(resolveParty(seed, 'ana', '@anaa')).toBeUndefined()
    expect(resolveParty(seed, 'ana', '')).toBeUndefined()
    expect(resolveParty(seed, 'ana', '@marta_k')?.offstage).toBe(true)
  })

  it('never resolves the account itself, or a party the filter refuses', () => {
    expect(resolveParty(seed, 'ana', '@ana')).toBeUndefined()
    expect(resolveParty(seed, 'ana', '@marko', { filter: (p) => p.kind === 'business' })).toBeUndefined()
    expect(resolveParty(seed, 'ana', '@cafelipa', { filter: (p) => p.kind === 'business' })?.id).toBe('cafe')
  })
})
