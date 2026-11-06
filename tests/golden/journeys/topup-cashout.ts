// Journey topup-cashout: money in and out, from the start at Friday 12:15.
// Ana tops up €50 by card, asks for a bank transfer of €100 (it arrives two hours later, inside banking
// hours) and cashes out 110.00 and then the minimum, 1.10. Marko tops up €20 by a local method. The café
// asks for a bank transfer of €10 late on Friday (it arrives on Monday at 10:00 local time, also in the
// weeks the clocks change), tops up €20 by a local method and cashes out 50.00 on Monday.
import type { Content } from '@content/schema'
import { mustParseMinor as m } from '@domain/money'
import type { Journey } from '../../support/journey'

const id = (n: number, step: string) => `${n.toString(16).padStart(16, '0')}:${step}`

export function topupCashout(_content: Content): Journey {
  return [
    {
      at: { day: 0, time: '12:16:00.000' },
      cmd: { type: 'ramp.on', actor: 'ana', cmdId: id(0x301, 'topup'), method: 'card', eur: 50 },
    },
    {
      at: { day: 0, time: '12:17:00.000' },
      cmd: { type: 'ramp.on', actor: 'ana', cmdId: id(0x302, 'topup'), method: 'bank-transfer', eur: 100 },
    },
    {
      at: { day: 0, time: '12:18:00.000' },
      cmd: { type: 'ramp.on', actor: 'marko', cmdId: id(0x303, 'topup'), method: 'local-method', eur: 20 },
    },
    // The bank transfer (asked for at 12:17) arrived at 14:17; the cash-outs take what is there.
    {
      at: { day: 0, time: '14:30:00.000' },
      cmd: { type: 'ramp.off', actor: 'ana', cmdId: id(0x304, 'cashout'), amount: m('110.00') },
    },
    {
      at: { day: 0, time: '14:31:00.000' },
      cmd: { type: 'ramp.off', actor: 'ana', cmdId: id(0x305, 'cashout'), amount: m('1.10') },
    },
    // After closing time: this one waits for the next banking day.
    {
      at: { day: 0, time: '16:30:00.000' },
      cmd: { type: 'ramp.on', actor: 'cafe', cmdId: id(0x306, 'topup'), method: 'bank-transfer', eur: 10 },
    },
    {
      at: { day: 0, time: '16:31:00.000' },
      cmd: { type: 'ramp.on', actor: 'cafe', cmdId: id(0x307, 'topup'), method: 'local-method', eur: 20 },
    },
    // Monday: the transfer arrived at 10:00.
    {
      at: { day: 3, time: '10:30:00.000' },
      cmd: { type: 'ramp.off', actor: 'cafe', cmdId: id(0x308, 'cashout'), amount: m('50.00') },
    },
  ]
}
