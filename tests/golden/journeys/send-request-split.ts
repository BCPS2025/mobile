// Journey send-request-split: everyday money between Ana and Marko, from the start at Friday 12:15.
// Ana sends 16.50; pays Marko's Lunch request; asks Marko for 13.20 and he pays; turns down Marko's
// request for a taxi; splits the Brunch with Marko (he declines, Ana asks again, he pays) and a 10.00
// pizza with Marko and Marta (Marko pays, Ana cancels Marta's open share). Each command carries the
// debit its review step showed.
import type { Content } from '@content/schema'
import { mustParseMinor as m } from '@domain/money'
import type { UserCommand } from '@domain/types'
import { buildSeed } from '@sim/seed'
import type { Journey } from '../../support/journey'

const pay = (
  actor: string,
  to: `@${string}`,
  amount: string,
  debit: string,
  extra: Record<string, unknown>,
): UserCommand =>
  ({
    type: 'pay',
    actor,
    to,
    amount: m(amount),
    expect: { senderDebit: m(debit) },
    ...extra,
  }) as UserCommand

/** The reference of a seeded payment (the same at every epoch: seed rows are numbered in time order). */
export function seedTxId(content: Content, key: string): string {
  const seed = buildSeed(content, '2026-09-25')
  const tx = Object.values(seed.state.txs).find((t) => t.seedMeta?.key === key)
  if (!tx) throw new Error(`no seed row ${key}`)
  return tx.id
}

export function sendRequestSplit(content: Content): Journey {
  const id = (n: number, step: string) => `${n.toString(16).padStart(16, '0')}:${step}`
  return [
    {
      at: { day: 0, time: '12:16:00.000' },
      cmd: pay('ana', '@marko', '16.50', '16.67', { cmdId: id(0x101, 'review'), channel: 'username', note: 'Cinema' }),
    },
    {
      at: { day: 0, time: '12:17:00.000' },
      cmd: pay('ana', '@marko', '13.20', '13.33', {
        cmdId: id(0x102, 'review'),
        channel: 'request',
        requestId: 'r_seed_lunch',
      }),
    },
    {
      at: { day: 0, time: '12:18:00.000' },
      cmd: {
        type: 'request.create',
        actor: 'ana',
        cmdId: id(0x103, 'request'),
        channel: 'username',
        payer: '@marko',
        amount: m('13.20'),
        note: 'Lunch',
      },
    },
    {
      at: { day: 0, time: '12:19:00.000' },
      cmd: pay('marko', '@ana', '13.20', '13.33', {
        cmdId: id(0x104, 'review'),
        channel: 'request',
        requestId: 'R-000001',
      }),
    },
    {
      at: { day: 0, time: '12:20:00.000' },
      cmd: {
        type: 'request.create',
        actor: 'marko',
        cmdId: id(0x105, 'request'),
        channel: 'username',
        payer: '@ana',
        amount: m('5.00'),
        note: 'Taxi',
      },
    },
    {
      at: { day: 0, time: '12:20:30.000' },
      cmd: {
        type: 'request.decline',
        actor: 'ana',
        cmdId: id(0x106, 'decline'),
        requestId: 'R-000002',
        reason: 'Not ordered',
      },
    },
    {
      at: { day: 0, time: '12:21:00.000' },
      cmd: {
        type: 'split.create',
        actor: 'ana',
        cmdId: id(0x107, 'split'),
        // The Brunch of Thursday, from the starting records: a payment named by its seed row.
        sourceTxId: seedTxId(content, 'cafe-thu-brunch'),
        total: m('26.40'),
        note: 'Brunch for two',
        shares: [{ party: '@marko', amount: m('13.20') }],
      },
    },
    {
      at: { day: 0, time: '12:22:00.000' },
      cmd: { type: 'request.decline', actor: 'marko', cmdId: id(0x108, 'decline'), requestId: 'R-000003' },
    },
    {
      at: { day: 0, time: '12:23:00.000' },
      cmd: { type: 'split.reask', actor: 'ana', cmdId: id(0x109, 'reask'), splitId: 'S-000001', party: '@marko' },
    },
    {
      at: { day: 0, time: '12:24:00.000' },
      cmd: pay('marko', '@ana', '13.20', '13.33', {
        cmdId: id(0x10a, 'review'),
        channel: 'request',
        requestId: 'R-000004',
      }),
    },
    {
      at: { day: 0, time: '12:25:00.000' },
      cmd: {
        type: 'split.create',
        actor: 'ana',
        cmdId: id(0x10b, 'split'),
        total: m('10.00'),
        note: 'Pizza night',
        shares: [
          { party: '@marko', amount: m('3.33') },
          { party: '@marta_k', amount: m('3.33') },
        ],
      },
    },
    {
      at: { day: 0, time: '12:26:00.000' },
      cmd: pay('marko', '@ana', '3.33', '3.36', {
        cmdId: id(0x10c, 'review'),
        channel: 'request',
        requestId: 'R-000005',
      }),
    },
    {
      at: { day: 0, time: '12:27:00.000' },
      cmd: { type: 'split.cancel', actor: 'ana', cmdId: id(0x10d, 'cancel'), splitId: 'S-000002' },
    },
  ]
}
