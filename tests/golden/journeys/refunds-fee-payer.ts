// Journey refunds-fee-payer: the café's refunds and its choice of who pays the fee, from the start at
// Friday 12:15. Ana pays 11.00 over the counter and the café refunds it; the café refunds the Thursday
// brunch; the café then lets the customer pay the fee (a Brunch code for 13.20 costs Ana 13.33, an 11.00
// code 11.11), and a 3.30 code made while the customer pays keeps that payer after the café switches back.
// It saves a new auto-convert schedule, which converts nothing, and Ana pays Marko late in the evening
// (after 23:00) to show that. Each command carries the debit its review step showed.
import type { Content } from '@content/schema'
import { nextTxId } from '@domain/ledger'
import { mustParseMinor as m } from '@domain/money'
import type { UserCommand } from '@domain/types'
import { buildSeed, resolveItems } from '@sim/seed'
import type { Journey } from '../../support/journey'
import { seedTxId } from './send-request-split'

const id = (n: number, step: string) => `${n.toString(16).padStart(16, '0')}:${step}`

const payCode = (cmdId: string, amount: string, debit: string, requestId: string, items?: unknown): UserCommand =>
  ({
    type: 'pay',
    actor: 'ana',
    cmdId,
    to: '@cafelipa',
    amount: m(amount),
    channel: 'qr',
    requestId,
    ...(items === undefined ? {} : { items }),
    expect: { senderDebit: m(debit) },
  }) as UserCommand

export function refundsFeePayer(content: Content): Journey {
  const seed = buildSeed(content, '2026-09-25').state
  const first = nextTxId(seed) // the 11.00 sale is the first payment of the session
  const flatWhite2Croissant2 = resolveItems(content, 'cafe', [
    { sku: 'flat-white', qty: 2 },
    { sku: 'croissant', qty: 2 },
  ])
  const brunch = resolveItems(content, 'cafe', [{ sku: 'brunch', qty: 1 }])
  return [
    {
      at: { day: 0, time: '12:16:00.000' },
      cmd: {
        type: 'pay',
        actor: 'ana',
        cmdId: id(0x401, 'review'),
        to: '@cafelipa',
        amount: m('11.00'),
        channel: 'qr',
        items: flatWhite2Croissant2,
        expect: { senderDebit: m('11.00') },
      },
    },
    {
      at: { day: 0, time: '12:17:00.000' },
      cmd: { type: 'refund', actor: 'cafe', cmdId: id(0x402, 'refund'), txId: first },
    },
    {
      at: { day: 0, time: '12:18:00.000' },
      cmd: { type: 'refund', actor: 'cafe', cmdId: id(0x403, 'refund'), txId: seedTxId(content, 'cafe-thu-brunch') },
    },
    {
      at: { day: 0, time: '12:19:00.000' },
      cmd: { type: 'merchant.settings', actor: 'cafe', cmdId: id(0x404, 'settings'), patch: { feePayer: 'sender' } },
    },
    // The customer pays the fee: 13.20 on top 0.13, the café receives the full 13.20.
    {
      at: { day: 0, time: '12:20:00.000' },
      cmd: {
        type: 'request.create',
        actor: 'cafe',
        cmdId: id(0x405, 'code'),
        channel: 'pos',
        amount: m('13.20'),
        items: brunch,
      },
    },
    { at: { day: 0, time: '12:21:00.000' }, cmd: payCode(id(0x406, 'review'), '13.20', '13.33', 'R-000001', brunch) },
    {
      at: { day: 0, time: '12:22:00.000' },
      cmd: {
        type: 'request.create',
        actor: 'cafe',
        cmdId: id(0x407, 'code'),
        channel: 'pos',
        amount: m('11.00'),
        items: flatWhite2Croissant2,
      },
    },
    {
      at: { day: 0, time: '12:23:00.000' },
      cmd: payCode(id(0x408, 'review'), '11.00', '11.11', 'R-000002', flatWhite2Croissant2),
    },
    // A code made while the customer pays keeps that payer after the café switches back.
    {
      at: { day: 0, time: '12:24:00.000' },
      cmd: { type: 'request.create', actor: 'cafe', cmdId: id(0x409, 'code'), channel: 'pos', amount: m('3.30') },
    },
    {
      at: { day: 0, time: '12:25:00.000' },
      cmd: { type: 'merchant.settings', actor: 'cafe', cmdId: id(0x40a, 'settings'), patch: { feePayer: 'recipient' } },
    },
    { at: { day: 0, time: '12:26:00.000' }, cmd: payCode(id(0x40b, 'review'), '3.30', '3.33', 'R-000003') },
    // Auto-convert at 30 % at 22:00: saved and shown; nothing converts (not at 22:00, not at 23:00).
    {
      at: { day: 0, time: '12:30:00.000' },
      cmd: {
        type: 'merchant.settings',
        actor: 'cafe',
        cmdId: id(0x40c, 'settings'),
        patch: { autoConvert: { sharePct: 30, atLocal: '22:00' } },
      },
    },
    {
      at: { day: 0, time: '23:30:00.000' },
      cmd: {
        type: 'pay',
        actor: 'ana',
        cmdId: id(0x40d, 'review'),
        to: '@marko',
        amount: m('5.00'),
        channel: 'username',
        note: 'Coffee',
        expect: { senderDebit: m('5.05') },
      },
    },
  ]
}
