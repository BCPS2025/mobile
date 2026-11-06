import { entryOf } from '@domain/ledger'
import { ui } from '../copy'
import { createPayFlow } from './payFlow'

// Pay supplier (biz.send.*): the café pays a business by @username. The flow opens on Review with
// the usual supplier order filled in (catalogue.yaml `templates.supplierPayment`: Pekarna Zrno,
// 8.80, "Croissant delivery"); each field has an Edit link that opens its step.

export const paySupplierFlow = createPayFlow({
  id: 'paySupplier',
  title: ui.paySupplier.title,
  tone: 'business',
  screens: {
    to: 'biz.send.to',
    amount: 'biz.send.amount',
    note: 'biz.send.note',
    review: 'biz.send.review',
    success: 'biz.send.done',
  },
  words: {
    toTitle: ui.paySupplier.toTitle,
    amountTitle: ui.paySupplier.amountTitle,
    noteTitle: ui.paySupplier.noteTitle,
    reviewTitle: ui.paySupplier.reviewTitle,
    pay: ui.paySupplier.pay,
  },
  overline: ui.receipt.paid,
  chips: (ctx) => ctx.content.catalogue.noteChips.business,
  verifiedOnReview: true,
  init: (ctx) => {
    const order = ctx.content.catalogue.templates.supplierPayment
    const supplier = entryOf(ctx.state.directory, order.to)
    return {
      query: ctx.params.to ?? supplier?.handle ?? '',
      amount: ctx.params.amount ?? order.amount,
      note: ctx.params.note ?? order.note,
      templated: true,
    }
  },
})
