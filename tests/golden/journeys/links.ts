// Journey links: at Friday 12:15 Ana makes a single-use payment link for 13.20 "Pizza", sends it to
// Marko in the app, and Marko pays it (the payer adds the 1 %: 13.33). She then makes and sends a second
// link for 4.00 that nobody pays.
import type { Content } from '@content/schema'
import { mustParseMinor as m } from '@domain/money'
import type { Journey } from '../../support/journey'

const id = (n: number, step: string) => `${n.toString(16).padStart(16, '0')}:${step}`

export function links(_content: Content): Journey {
  return [
    {
      at: { day: 0, time: '12:16:00.000' },
      cmd: { type: 'link.create', actor: 'ana', cmdId: id(0x201, 'link'), amount: m('13.20'), note: 'Pizza' },
    },
    {
      at: { day: 0, time: '12:16:30.000' },
      cmd: { type: 'link.share', actor: 'ana', cmdId: id(0x202, 'share'), linkId: 'L-000001', to: '@marko' },
    },
    {
      at: { day: 0, time: '12:17:00.000' },
      cmd: {
        type: 'pay',
        actor: 'marko',
        cmdId: id(0x203, 'review'),
        to: '@ana',
        amount: m('13.20'),
        channel: 'link',
        linkId: 'L-000001',
        expect: { senderDebit: m('13.33') },
      },
    },
    {
      at: { day: 0, time: '12:18:00.000' },
      cmd: { type: 'link.create', actor: 'ana', cmdId: id(0x204, 'link'), amount: m('4.00') },
    },
    {
      at: { day: 0, time: '12:18:30.000' },
      cmd: { type: 'link.share', actor: 'ana', cmdId: id(0x205, 'share'), linkId: 'L-000002', to: '@marta_k' },
    },
  ]
}
