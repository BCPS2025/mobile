// Whole journeys of the everyday money features and the café's business tools, each from a fresh
// session: what the person who asked sees once the other one answered, a share asked again and paid,
// a refund from both sides, the notification list, and one evening that runs several features one
// after the other and ends on the balances they must add up to.
import { expect, test } from '@playwright/test'
import { anaAndMarko, expectBalance, expectCleanVisibleCopy, slot, stageBoth, typeAmount } from './helpers'

test.use({ viewport: { width: 1280, height: 720 } })

type Locator = import('@playwright/test').Locator
type Page = import('@playwright/test').Page

/** Switches the right phone to another account through the account menu. */
async function rightPhoneTo(page: Page, id: 'marko' | 'cafe', home: string): Promise<Locator> {
  await page.getByTestId('account-menu-right').click()
  await page.getByTestId(`account-${id}`).click()
  const right = slot(page, 'right')
  await expect(right).toHaveAttribute('data-persona', id)
  await expect(right.locator(`[data-screen="${home}"]`)).toBeVisible()
  return right
}

/** Ana opens the Lunch request Marko made and pays it from the check. */
async function anaPaysSeededLunch(ana: Locator): Promise<void> {
  await ana.locator('[data-tile="payRequest"]').click()
  await ana.getByTestId('pay-item-r_seed_lunch').click()
  await expect(ana.locator('[data-screen="c.payItem.review"]')).toBeVisible()
  await ana.getByRole('button', { name: 'Pay 13.33' }).click()
  await expect(ana.locator('[data-screen="c.payItem.success"]')).toBeVisible({ timeout: 5000 })
  await ana.getByRole('button', { name: 'Done' }).click()
  await expect(ana.locator('[data-screen="c.home"]')).toBeVisible()
}

/** Ana asks Marko for 13.20 "Lunch" and ends back on Home; `whileSent` runs while "Request sent" shows. */
async function anaAsksMarkoForLunch(ana: Locator, whileSent?: () => Promise<void>): Promise<void> {
  await ana.locator('[data-tile="payRequest"]').click()
  await ana.getByTestId('row-request').click()
  await ana.getByTestId('party-search').fill('@marko')
  await ana.getByRole('button', { name: 'Continue' }).click()
  await typeAmount(ana, '13.20')
  await ana.getByRole('button', { name: 'Continue' }).click()
  await ana.getByRole('button', { name: 'Lunch', exact: true }).click()
  await ana.getByRole('button', { name: 'Continue' }).click()
  await ana.getByRole('button', { name: 'Send request' }).click()
  await expect(ana.locator('[data-screen="c.request.sent"]')).toBeVisible()
  await whileSent?.()
  await ana.getByRole('button', { name: 'Done' }).click()
  await expect(ana.locator('[data-screen="c.home"]')).toBeVisible()
}

/** Ana tops up €50 by card and ends back on Home. */
async function anaTopsUp50(ana: Locator): Promise<void> {
  await ana.locator('[data-tile="wallet"]').click()
  await ana.getByTestId('row-topup').click()
  for (const key of ['5', '0']) await ana.locator(`[data-key="${key}"]`).click()
  await ana.getByRole('button', { name: 'Continue' }).click()
  await ana.getByRole('button', { name: 'Continue' }).click()
  await ana.getByRole('button', { name: 'Top up €50.00' }).click()
  await expect(ana.locator('[data-screen="shared.topup.done"]')).toBeVisible({ timeout: 5000 })
  await ana.getByRole('button', { name: 'Done' }).click()
  await expect(ana.locator('[data-screen="c.home"]')).toBeVisible()
}

/** Ana cashes out 110.00 and ends back on Home. */
async function anaCashesOut110(ana: Locator): Promise<void> {
  await ana.locator('[data-tile="wallet"]').click()
  await ana.getByTestId('row-cashOut').click()
  await typeAmount(ana, '110')
  await ana.getByRole('button', { name: 'Continue' }).click()
  await ana.getByRole('button', { name: 'Cash out 110.00' }).click()
  await expect(ana.locator('[data-screen="shared.cashout.done"]')).toBeVisible({ timeout: 5000 })
  await ana.getByRole('button', { name: 'Done' }).click()
  await expect(ana.locator('[data-screen="c.home"]')).toBeVisible()
}

/** The café refunds the newest named sale (Brunch for two, 26.40) and ends back on Home; `whileDone` runs while REFUNDED shows. */
async function cafeRefundsBrunch(cafe: Locator, whileDone?: () => Promise<void>): Promise<void> {
  await cafe.locator('[data-tile="sales"]').click()
  await cafe.getByTestId('row-refundSale').click()
  await expect(cafe.getByTestId('refund-sales').locator('li').first()).toContainText('Brunch for two')
  await cafe.getByRole('button', { name: 'Continue' }).click()
  await cafe.getByRole('button', { name: 'Refund 26.40 BCPS' }).click()
  await expect(cafe.locator('[data-screen="biz.refund.done"]')).toBeVisible({ timeout: 5000 })
  await whileDone?.()
  await cafe.getByRole('button', { name: 'Done' }).click()
  await expect(cafe.locator('[data-screen="pos.home"]')).toBeVisible()
}

test.describe('what the person who asked sees', () => {
  test('Ana pays the Lunch request: 234.17 and 146.18, and Marko’s own request reads "Paid by @ana ✓"', async ({
    page,
  }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    const marko = slot(page, 'right')
    await anaPaysSeededLunch(ana)
    await expectBalance(page, 'ana', '234.17')
    await expectBalance(page, 'marko', '146.18')

    await marko.locator('[data-tile="payRequest"]').click()
    await marko.getByTestId('waiting-r_seed_lunch').click()
    const detail = marko.locator('[data-screen="c.request.detail"]')
    await expect(detail).toBeVisible()
    await expect(detail.getByTestId('status-chip')).toHaveText('Paid by @ana ✓')
    await expect(detail).toContainText('13.20')
    await expect(detail.getByRole('button', { name: 'Cancel request' })).toHaveCount(0)
    // The payment behind it: the full 13.20 came in, the fee was Ana's.
    await detail.getByTestId('view-payment').click()
    await expect(marko.locator('[data-screen="shared.tx"]')).toContainText('+13.20')
    await expectCleanVisibleCopy(page)
  })

  test('Ana declines the Lunch request: Marko’s request reads "Declined by @ana · no money moved", balances stay', async ({
    page,
  }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    const marko = slot(page, 'right')
    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('pay-item-r_seed_lunch').click()
    await ana.getByRole('button', { name: 'Decline' }).click()
    await ana.getByRole('button', { name: 'Decline', exact: true }).last().click()
    await expect(ana.locator('[data-screen="c.payItem.declined"]')).toBeVisible()
    await ana.getByRole('button', { name: 'Done' }).click()
    await expectBalance(page, 'ana', '247.50')
    await expectBalance(page, 'marko', '132.98')

    await marko.locator('[data-tile="payRequest"]').click()
    await marko.getByTestId('waiting-r_seed_lunch').click()
    const detail = marko.locator('[data-screen="c.request.detail"]')
    await expect(detail.getByTestId('status-chip')).toHaveText('Declined by @ana · no money moved')
    await expect(detail.getByRole('button', { name: 'Cancel request' })).toHaveCount(0)
    await expect(detail.getByTestId('view-payment')).toHaveCount(0)
    await marko.getByTestId('nav-home').click()
    await expectBalance(page, 'ana', '247.50')
    await expectBalance(page, 'marko', '132.98')
  })

  test('Ana asks for 13.20 "Lunch": Marko’s count, bell and banner, the row to pay; Ana’s WAITING row', async ({
    page,
  }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    const marko = slot(page, 'right')
    await expect(marko.locator('[data-tile="payRequest"]')).not.toContainText('to pay')
    await expect(marko.getByTestId('bell-count')).toHaveCount(0)
    await anaAsksMarkoForLunch(ana, async () => {
      await expect(marko.getByTestId('banner')).toContainText('@ana requests 13.20 BCPS')
    })
    await expect(marko.locator('[data-tile="payRequest"]')).toContainText('1 to pay')
    await expect(marko.getByTestId('bell-count')).toHaveText('1')
    await marko.locator('[data-tile="payRequest"]').click()
    await expect(marko.getByTestId('to-pay')).toContainText('@ana · Lunch')
    await expect(marko.getByTestId('to-pay')).toContainText('13.20')
    await ana.locator('[data-tile="payRequest"]').click()
    await expect(ana.getByTestId('waiting')).toContainText('@marko · Lunch')
    await expect(ana.getByTestId('waiting')).toContainText('13.20')
    // Asking moves no money.
    await ana.getByTestId('nav-home').click()
    await marko.getByTestId('nav-home').click()
    await expectBalance(page, 'ana', '247.50')
    await expectBalance(page, 'marko', '132.98')
  })
})

test.describe('a split asked again', () => {
  test('Marko declines his share of the Brunch, Ana asks again, he pays: 1 of 1 paid ✓, Ana 260.70, Marko 119.65', async ({
    page,
  }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    const marko = slot(page, 'right')
    // The Brunch from her History, split with Marko.
    await ana.locator('[data-tile="history"]').click()
    await ana
      .getByTestId(/^tx-BC-/)
      .filter({ hasText: 'Café Lipa' })
      .first()
      .click()
    await ana.getByRole('button', { name: 'Split this bill' }).click()
    await ana.getByTestId('party-marko').click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await expect(ana.getByTestId('share-you')).toContainText('13.20 BCPS')
    await expect(ana.getByTestId('share-marko')).toContainText('13.20 BCPS')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByRole('button', { name: 'Send 1 request' }).click()
    await expect(ana.locator('[data-screen="c.split.sent"]')).toBeVisible()
    await ana.getByRole('button', { name: 'Done' }).click()

    // Marko declines: his share shows DECLINED on Ana's progress.
    await marko.locator('[data-tile="payRequest"]').click()
    await marko
      .getByTestId(/^pay-item-/)
      .first()
      .click()
    await marko.getByRole('button', { name: 'Decline' }).click()
    await marko.getByRole('button', { name: 'Decline', exact: true }).last().click()
    await expect(marko.locator('[data-screen="c.payItem.declined"]')).toBeVisible()
    await marko.getByRole('button', { name: 'Done' }).click()
    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('waiting').getByText('Split · 0 of 1 paid').click()
    const progress = ana.locator('[data-screen="c.split.detail"]')
    await expect(progress.getByTestId('status-chip')).toHaveText('0 of 1 paid')
    await expect(progress.getByTestId('share-marko')).toContainText('DECLINED')

    // Asking again links the share to a new request; Marko has it to pay.
    await progress.getByRole('button', { name: 'Ask again' }).click()
    await expect(progress.getByTestId('share-marko')).not.toContainText('DECLINED')
    await expect(marko.locator('[data-tile="payRequest"]')).toContainText('1 to pay')
    await marko.locator('[data-tile="payRequest"]').click()
    await marko
      .getByTestId(/^pay-item-/)
      .first()
      .click()
    await expect(marko.getByTestId('review-total')).toContainText('13.33 BCPS')
    await marko.getByRole('button', { name: 'Pay 13.33' }).click()
    await expect(marko.locator('[data-screen="c.payItem.success"]')).toBeVisible({ timeout: 5000 })
    await marko.getByRole('button', { name: 'Done' }).click()

    // The progress follows: everyone paid, nothing to ask again, and the money moved once.
    await expect(progress.getByTestId('status-chip')).toHaveText('1 of 1 paid ✓')
    await expect(progress.getByRole('button', { name: 'Ask again' })).toHaveCount(0)
    await expect(progress.getByRole('button', { name: 'Cancel open requests' })).toHaveCount(0)
    await ana.getByTestId('nav-home').click()
    await expectBalance(page, 'ana', '260.70')
    await expectBalance(page, 'marko', '119.65')
  })
})

test.describe('a refund seen from both sides', () => {
  test('Ana hears "+26.40", has the row and the original reads Refunded ✓; the café’s day rows offer no refund', async ({
    page,
  }) => {
    await stageBoth(page)
    const ana = slot(page, 'left')
    const cafe = slot(page, 'right')
    await cafeRefundsBrunch(cafe, async () => {
      await expect(ana.getByTestId('banner')).toContainText('Refund from Café Lipa · +26.40 BCPS')
    })
    await expectBalance(page, 'cafe', '259.60')
    await expectBalance(page, 'ana', '273.90')

    // Ana: the History row and the original purchase.
    await ana.locator('[data-tile="history"]').click()
    const history = ana.locator('[data-screen="c.history"]')
    const refundRow = history.locator('[data-testid^="tx-BC-"]').filter({ hasText: '+26.40' }).first()
    await expect(refundRow).toContainText('Café Lipa')
    await expect(refundRow).toContainText('Refund')
    await history.locator('[data-testid^="tx-BC-"]').filter({ hasText: '−26.40' }).first().click()
    await expect(ana.locator('[data-screen="shared.tx"]')).toContainText(/Refunded ✓ · /)
    await expect(ana.getByRole('button', { name: 'Split this bill' })).toHaveCount(0)

    // The café: the sale reads Refunded ✓ and is not offered again; the summary rows (a day's
    // totals, not a sale) have no refund at all.
    await cafe.locator('[data-tile="sales"]').click()
    await cafe.getByTestId('row-refundSale').click()
    await expect(cafe.getByTestId('refund-sales').locator('li')).toHaveCount(2)
    await expect(cafe.getByTestId('refund-sales').locator('li').first()).toContainText('REFUNDED ✓')
    await cafe.getByTestId('nav-back').click()
    await cafe.getByTestId('row-allPayments').click()
    await cafe
      .getByRole('button', { name: /Daily sales/ })
      .first()
      .click()
    const day = cafe.locator('[data-screen="shared.daySummary"]')
    await expect(day).toBeVisible()
    await expect(day.getByRole('button', { name: /Refund/ })).toHaveCount(0)
    await cafe.getByTestId('nav-back').click()
    await cafe.getByTestId('chip-refunds').click()
    await expect(cafe.getByTestId('history-list').locator('li')).toHaveCount(1)
    await expect(cafe.getByTestId('history-list')).toContainText('−26.40')
  })
})

test.describe('notifications', () => {
  test('fresh: Ana 1, the café 2, Marko 0; a row opens its target and clears its dot; Mark all as read', async ({
    page,
  }) => {
    await stageBoth(page)
    const ana = slot(page, 'left')
    const cafe = slot(page, 'right')
    await expect(ana.getByTestId('bell-count')).toHaveText('1')
    await expect(cafe.getByTestId('bell-count')).toHaveText('2')

    // Ana: the Lunch request is the one unread; it opens the check to pay and clears the dot.
    await ana.getByTestId('bell').click()
    const list = ana.locator('[data-screen="shared.notifications"]')
    await expect(list).toBeVisible()
    const rows = list.locator('[data-testid^="notification-"]')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveAttribute('data-unread', 'true')
    await expect(rows.first()).toContainText('@marko requests 13.20 BCPS')
    await rows.first().click()
    await expect(ana.locator('[data-screen="c.payItem.review"]')).toBeVisible()
    await ana.getByTestId('nav-back').click()
    await expect(list).toBeVisible()
    await expect(rows.first()).not.toHaveAttribute('data-unread', 'true')
    await expect(list.getByTestId('mark-all-read')).toHaveCount(0)
    await ana.getByTestId('nav-home').click()
    await expect(ana.getByTestId('bell-count')).toHaveCount(0)

    // The café: Thursday's conversion and the invoice; one opens, the other goes with Mark all.
    await cafe.getByTestId('bell').click()
    const cafeList = cafe.locator('[data-screen="shared.notifications"]')
    const cafeRows = cafeList.locator('[data-testid^="notification-"]')
    await expect(cafeRows).toHaveCount(2)
    await expect(cafeRows.filter({ hasText: 'Auto-converted 175.73 BCPS' })).toHaveAttribute('data-unread', 'true')
    await cafeRows.filter({ hasText: 'New invoice PZ-0412 from Pekarna Zrno' }).click()
    await expect(cafe.locator('[data-screen="biz.invoice.detail"]')).toBeVisible()
    await cafe.getByTestId('nav-back').click()
    await expect(cafeList).toBeVisible()
    await expect(cafeRows.filter({ hasText: 'New invoice PZ-0412' })).not.toHaveAttribute('data-unread', 'true')
    await expect(cafeRows.filter({ hasText: 'Auto-converted' })).toHaveAttribute('data-unread', 'true')
    await cafeList.getByTestId('mark-all-read').click()
    await expect(cafeList.locator('[data-unread="true"]')).toHaveCount(0)
    await expect(cafeList.getByTestId('mark-all-read')).toHaveCount(0)
    await expect(cafeRows).toHaveCount(2)
    await cafe.getByTestId('nav-home').click()
    await expect(cafe.getByTestId('bell-count')).toHaveCount(0)

    // Marko has nothing new.
    const marko = await rightPhoneTo(page, 'marko', 'c.home')
    await expect(marko.getByTestId('bell-count')).toHaveCount(0)
    await marko.getByTestId('bell').click()
    await expect(marko.getByText("You're all caught up.")).toBeVisible()
  })
})

test.describe('one evening, several features', () => {
  test('lunch paid, lunch asked, top-up, refund, cash-out, supplier invoice: the balances add up', async ({ page }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    const marko = slot(page, 'right')

    // Ana pays the Lunch Marko asked for (13.33), then asks him for the same (he pays 13.33).
    await anaPaysSeededLunch(ana)
    await expectBalance(page, 'ana', '234.17')
    await expectBalance(page, 'marko', '146.18')
    await anaAsksMarkoForLunch(ana)
    await marko.locator('[data-tile="payRequest"]').click()
    await marko
      .getByTestId(/^pay-item-/)
      .first()
      .click()
    await expect(marko.locator('[data-screen="c.payItem.review"]')).toBeVisible()
    await marko.getByRole('button', { name: 'Pay 13.33' }).click()
    await expect(marko.locator('[data-screen="c.payItem.success"]')).toBeVisible({ timeout: 5000 })
    await marko.getByRole('button', { name: 'Done' }).click()
    await expectBalance(page, 'ana', '247.37')
    await expectBalance(page, 'marko', '132.85')

    // €50 by card is 55.00 with no fee.
    await anaTopsUp50(ana)
    await expectBalance(page, 'ana', '302.37')

    // The café takes the right phone: it refunds the Brunch (no fee), later pays the bakery's invoice.
    const cafe = await rightPhoneTo(page, 'cafe', 'pos.home')
    await cafeRefundsBrunch(cafe)
    await expectBalance(page, 'cafe', '259.60')
    await expectBalance(page, 'ana', '328.77')

    // 110.00 out costs 1.65 (paid from it): Ana keeps 218.77.
    await anaCashesOut110(ana)
    await expectBalance(page, 'ana', '218.77')

    await cafe.locator('[data-tile="pay"]').click()
    await cafe.getByTestId('invoice-PZ-0412').click()
    await cafe.getByRole('button', { name: 'Pay 53.33 BCPS' }).click()
    await expect(cafe.locator('[data-screen="biz.invoice.paid"]')).toBeVisible({ timeout: 5000 })
    await cafe.getByRole('button', { name: 'Done' }).click()
    await expectBalance(page, 'cafe', '206.27')

    // Nothing else moved; Ana's History holds what she did.
    await expectBalance(page, 'ana', '218.77')
    await ana.locator('[data-tile="history"]').click()
    await ana.getByTestId('chip-topupsCashouts').click()
    await expect(ana.getByTestId('history-list').locator('li')).toHaveCount(4)
    await ana.getByTestId('chip-requests').click()
    await expect(ana.getByTestId('history-list').locator('li')).toHaveCount(2)
    await expect(ana.getByTestId('history-list')).not.toContainText('WAITING')
    await expectCleanVisibleCopy(page)
  })
})
