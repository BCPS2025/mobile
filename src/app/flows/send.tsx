import { ui } from '../copy'
import { createPayFlow } from './payFlow'

// Send (c.send.*): people paying a person or a business by @username. "Send again" from a payment
// opens it filled in, straight on Review; a scanned personal code opens it on the amount.

export const sendFlow = createPayFlow({
  id: 'send',
  title: ui.send.title,
  tone: 'light',
  screens: {
    to: 'c.send.to',
    amount: 'c.send.amount',
    note: 'c.send.note',
    review: 'c.send.review',
    success: 'c.send.success',
  },
  words: {
    toTitle: ui.send.toTitle,
    amountTitle: ui.send.amountTitle,
    noteTitle: ui.send.noteTitle,
    reviewTitle: ui.send.reviewTitle,
    pay: ui.send.send,
  },
  overline: ui.receipt.sent,
  chips: (ctx) => ctx.content.catalogue.noteChips.person,
  verifiedOnReview: false,
  init: (ctx) => {
    const to = ctx.params.to
    const amount = ctx.params.amount
    return {
      query: to ?? '',
      amount: amount ?? '',
      note: ctx.params.note ?? '',
      templated: to !== undefined && amount !== undefined,
      ...(to !== undefined && amount === undefined ? { fixedTo: true } : {}),
    }
  },
})
