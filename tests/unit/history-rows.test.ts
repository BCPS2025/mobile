import { describe, expect, it } from 'vitest'
import { rowText } from '@app/phone/views/ActivityRow'
import { resolveItems } from '@sim/seed'
import { activity } from '@store/selectors'
import { headless } from '../support/journey'
import { content, m } from './helpers'

// What a History row says: name and what it was for, the time and items, and which rows open.

const TZ = content.config.t0.tz
const items = resolveItems(content, 'cafe', [
  { sku: 'flat-white', qty: 2 },
  { sku: 'croissant', qty: 2 },
])

function rows(persona: string, node: ReturnType<typeof headless>['node']) {
  const s = node.getState()
  const bank = content.personas.personas.find((p) => p.id === persona)?.methods?.bank
  return activity(s, persona, node.now(), TZ)
    .flatMap((g) => g.rows)
    .map((row) => ({ row, text: rowText(row, s, persona, TZ, bank) }))
}

describe('History rows', () => {
  it('Ana: a purchase names the café and lists the items; a transfer names the person and the note', () => {
    const { node } = headless('2026-09-25')
    node.dispatch({
      type: 'pay',
      actor: 'ana',
      cmdId: 'a1a1a1a1a1a1a1a1:review',
      to: '@cafelipa',
      amount: m('11.00'),
      channel: 'qr',
      note: 'Table 4',
      items,
      expect: { senderDebit: m('11.00') },
    })
    node.dispatch({
      type: 'pay',
      actor: 'ana',
      cmdId: 'b2b2b2b2b2b2b2b2:review',
      to: '@marko',
      amount: m('16.50'),
      channel: 'username',
      note: 'Cinema',
      expect: { senderDebit: m('16.67') },
    })
    const list = rows('ana', node)
    const [cinema, sale] = list
    expect(cinema?.text).toMatchObject({ title: '@marko · Cinema', sub: '12:15', openable: true, summary: false })
    expect(cinema?.row.pending).toBe(true)
    expect(sale?.text).toMatchObject({
      title: 'Café Lipa',
      sub: '12:15 · 2 × flat white · 2 × croissant',
      openable: true,
    })
    // Older rows: the seeded brunch and a card top-up.
    const brunch = list.find((r) => r.text.title === 'Café Lipa' && r.row.tx.seed)
    expect(brunch?.text.sub).toBe('12:40 · 2 × brunch')
    const topUp = list.find((r) => r.row.tx.kind === 'on-ramp' && r.row.tx.seedMeta?.method === 'card')
    expect(topUp?.text.title).toBe('Top up · card €100.00')
  })

  it('the café: a sale names the payer, with the note and "Sale"; a daily summary is not a payment and opens that day', () => {
    const { node } = headless('2026-09-25')
    node.dispatch({
      type: 'pay',
      actor: 'ana',
      cmdId: 'c3c3c3c3c3c3c3c3:review',
      to: '@cafelipa',
      amount: m('11.00'),
      channel: 'qr',
      note: 'Table 4',
      items,
      expect: { senderDebit: m('11.00') },
    })
    node.settleDue()
    const list = rows('cafe', node)
    expect(list[0]?.text).toMatchObject({ title: '@ana · Table 4', sub: '12:15 · Sale', openable: true })
    const today = list.find((r) => r.row.tx.summary && r.row.tx.seedMeta?.labelKey === 'todaySoFar')
    expect(today?.text).toMatchObject({
      title: 'Today so far',
      sub: '23 payments · net 110.27',
      summary: true,
      openable: true,
    })
    // Saturday: 48 payments for 334.58, net of the 1% fee 331.23.
    const daily = list.find((r) => r.row.tx.seedMeta?.key === 'cafe-sat')
    expect(daily?.text).toMatchObject({
      title: 'Daily sales',
      sub: '48 payments · net 331.23',
      summary: true,
      openable: true,
    })
    // Money to the bank, automatic or not, is a cash-out to the café's bank account.
    const outs = list.filter((r) => r.row.tx.kind === 'off-ramp')
    expect(outs.length).toBeGreaterThan(0)
    for (const out of outs) {
      expect(out.text.title).toBe('Cash out')
      expect(out.text.sub).toMatch(/^\d\d:\d\d · to SI56 •••• 1934$/)
    }
    const carried = list.find((r) => r.row.tx.seedMeta?.labelKey === 'carriedOver')
    expect(carried?.text.openable).toBe(false)
    expect(carried?.text.summary).toBe(false)
  })

  it('the café: a payment to its supplier names the business, with the note under the name', () => {
    const { node } = headless('2026-09-25')
    node.dispatch({
      type: 'pay',
      actor: 'cafe',
      cmdId: 'd4d4d4d4d4d4d4d4:review',
      to: '@pekarnazrno',
      amount: m('8.80'),
      channel: 'username',
      note: 'Croissant delivery',
      expect: { senderDebit: m('8.89') },
    })
    node.settleDue()
    const first = rows('cafe', node)[0]
    expect(first?.text).toMatchObject({ title: 'Pekarna Zrno', sub: '12:15 · Croissant delivery', openable: true })
    expect(first?.row.signed).toBe(-880)
  })

  it('an off-stage person is named by @handle', () => {
    const { node } = headless('2026-09-25')
    const pizza = rows('ana', node).find((r) => r.text.title.startsWith('@marta_k'))
    expect(pizza?.text.title).toBe('@marta_k · Pizza')
  })
})
