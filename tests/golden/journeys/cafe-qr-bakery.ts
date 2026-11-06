// Journey cafe-qr-bakery: at T0 (Friday 12:15) Ana pays Café Lipa 11.00 by QR for two flat whites
// and two croissants; the café then pays its bakery, Pekarna Zrno, 8.80 for a croissant delivery.
// Each command carries the debit its review step showed.
import type { Content } from '@content/schema'
import { mustParseMinor } from '@domain/money'
import type { Minor } from '@domain/types'
import { resolveItems } from '@sim/seed'
import type { Journey } from '../../support/journey'

export function cafeQrBakery(content: Content): Journey {
  const items = resolveItems(content, 'cafe', [
    { sku: 'flat-white', qty: 2 },
    { sku: 'croissant', qty: 2 },
  ])
  const amount = items.reduce((acc, it) => acc + it.qty * it.price, 0) as Minor
  return [
    {
      at: { day: 0, time: '12:16:00.000' },
      cmd: {
        type: 'pay',
        actor: 'ana',
        cmdId: '3be07a9c11f45d62:review',
        to: '@cafelipa',
        amount,
        channel: 'qr',
        items,
        expect: { senderDebit: mustParseMinor('11.00') },
      },
    },
    {
      at: { day: 0, time: '12:16:36.000' },
      cmd: {
        type: 'pay',
        actor: 'cafe',
        cmdId: 'c81e5f0a92d4b736:review',
        to: '@pekarnazrno',
        amount: mustParseMinor('8.80'),
        channel: 'username',
        note: 'Croissant delivery',
        expect: { senderDebit: mustParseMinor('8.89') },
      },
    },
  ]
}
