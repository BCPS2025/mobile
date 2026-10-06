// Cash out and what goes with it: the Wallet list, a person's and the café's cash-out (1.5% paid by
// the converter, the minimum, Max), the café's Cash out list, its payout history and the
// auto-convert settings (saved and shown, nothing converts).
import { expect, test } from '@playwright/test'
import {
  anaAndMarko,
  expectBalance,
  expectCleanVisibleCopy,
  expectNoSeriousViolations,
  slot,
  stageBoth,
  typeAmount,
} from './helpers'

test.use({ viewport: { width: 1280, height: 720 } })

/** Axe once the screen has stopped moving in (a screen fading in reads as low contrast). */
async function axe(page: import('@playwright/test').Page, where: string) {
  await page.waitForTimeout(600)
  await expectNoSeriousViolations(page, where)
}

test.describe('Cash out of a person', () => {
  test('the Wallet list: balance, Top up, Cash out to her bank, My code', async ({ page }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    await ana.locator('[data-tile="wallet"]').click()
    const hub = ana.locator('[data-screen="c.wallet.hub"]')
    await expect(hub).toBeVisible()
    await expect(hub.getByTestId('hub-balance')).toContainText('247.50')
    await expect(ana.getByTestId('row-topup')).toContainText('No top-up fee')
    await expect(ana.getByTestId('row-cashOut')).toContainText('To SI56 •••• •••• 4821')
    await expect(ana.getByTestId('row-myCode')).toBeVisible()
    await axe(page, 'Wallet list')
  })

  test('110.00: conversion 1.65, you receive ≈ €98.50, a BC-OUT reference, Ana 137.50', async ({ page }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    await ana.locator('[data-tile="wallet"]').click()
    await ana.getByTestId('row-cashOut').click()
    const amount = ana.locator('[data-screen="shared.cashout.amount"]')
    await expect(amount).toBeVisible()
    await expect(ana.getByText('Step 1 of 2')).toBeVisible()
    await expect(amount).toContainText('Available 247.50 BCPS')
    await expect(ana.getByRole('button', { name: 'Continue' })).toBeDisabled()

    // Below the minimum: the words, and Continue stays off.
    await typeAmount(ana, '1.09')
    await expect(ana.getByTestId('error-line')).toHaveText('The minimum is 1.10 BCPS.')
    await expect(ana.getByRole('button', { name: 'Continue' })).toBeDisabled()
    for (let i = 0; i < 4; i++) await ana.locator('[data-key="del"]').click()
    // Max fills what is available.
    await ana.getByTestId('amount-max').click()
    await expect(ana.getByTestId('amount-value')).toContainText('247.50')
    for (let i = 0; i < 6; i++) await ana.locator('[data-key="del"]').click()
    await typeAmount(ana, '110')
    await expect(amount).toContainText('≈ €100.00')
    await ana.getByRole('button', { name: 'Continue' }).click()

    const review = ana.locator('[data-screen="shared.cashout.review"]')
    await expect(review).toBeVisible()
    await expect(ana.getByText('Step 2 of 2')).toBeVisible()
    await expect(ana.getByTestId('fact-amount')).toContainText('110.00 BCPS')
    await expect(ana.getByTestId('fact-conversion')).toContainText('Conversion to EUR: 1.5%')
    await expect(ana.getByTestId('fact-conversion')).toContainText('1.65 BCPS')
    await expect(ana.getByTestId('fact-to')).toContainText('SI56 •••• •••• 4821')
    await expect(ana.getByTestId('review-total')).toContainText('≈ €98.50')
    await expect(review).toContainText('Arrives when your bank processes it.')
    await ana.getByRole('button', { name: 'Cash out 110.00' }).click()
    await expect(page.getByTestId('edge-marker').first()).toHaveText('Bank')

    const done = ana.locator('[data-screen="shared.cashout.done"]')
    await expect(done).toBeVisible({ timeout: 5000 })
    await expect(done).toContainText('CASHED OUT')
    await expect(done).toContainText('110.00')
    await expect(done).toContainText('You receive ≈ €98.50')
    await expect(done).toContainText('To SI56 •••• •••• 4821')
    await expect(done).toContainText('Conversion to EUR: 1.5%')
    await expect(done).toContainText('1.65 BCPS')
    await expect(done).toContainText(/BC-OUT-[0-9A-Z]{6}/)
    await expectCleanVisibleCopy(page)
    await ana.getByRole('button', { name: 'Done' }).click()
    await expectBalance(page, 'ana', '137.50')

    // It is in History, as a cash-out.
    await ana.locator('[data-tile="history"]').click()
    await ana.getByTestId('chip-topupsCashouts').click()
    await expect(ana.getByTestId('history-list').locator('li')).toHaveCount(3)
  })

  test('1.10 costs 0.02: ≈ €0.98', async ({ page }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    await ana.locator('[data-tile="wallet"]').click()
    await ana.getByTestId('row-cashOut').click()
    await typeAmount(ana, '1.10')
    await expect(ana.getByRole('button', { name: 'Continue' })).toBeEnabled()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await expect(ana.getByTestId('fact-conversion')).toContainText('0.02 BCPS')
    await expect(ana.getByTestId('review-total')).toContainText('≈ €0.98')
  })
})

test.describe('the café’s Cash out list, payouts and auto-convert', () => {
  test('the list: balance, the schedule it has, Cash out to its bank, Top up, Auto-convert, This week', async ({
    page,
  }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await expect(cafe.locator('[data-tile="cashOut"]')).toContainText('Auto 50% · 23:00')
    await cafe.locator('[data-tile="cashOut"]').click()
    const hub = cafe.locator('[data-screen="pos.cashOut"]')
    await expect(hub).toBeVisible()
    await expect(hub.getByTestId('hub-balance')).toContainText('286.00')
    await expect(hub.getByTestId('auto-convert-strip')).toHaveText('Auto-convert 50% · every day 23:00')
    await expect(cafe.getByTestId('row-cashOut')).toContainText('To SI56 •••• •••• 1934')
    await expect(cafe.getByTestId('row-topup')).toContainText('No top-up fee')
    await expect(cafe.getByTestId('row-autoConvert')).toContainText('On · 50% · 23:00')
    await expect(cafe.getByTestId('row-payoutHistory')).toContainText('This week ≈ €913.89')
    await axe(page, 'Cash out list')
  })

  test('payout history: six payouts, ≈ €913.89 this week, 1,020.61 BCPS converted; a new cash-out joins it', async ({
    page,
  }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await cafe.locator('[data-tile="cashOut"]').click()
    await cafe.getByTestId('row-payoutHistory').click()
    const view = cafe.locator('[data-screen="biz.payouts"]')
    await expect(view).toBeVisible()
    await expect(cafe.getByTestId('payouts-week')).toHaveText('≈ €913.89')
    await expect(cafe.getByTestId('payouts-summary')).toHaveText('6 payouts · to SI56 •••• •••• 1934')
    await expect(cafe.getByTestId('payouts-total')).toHaveText('1,020.61 BCPS converted · conversion 15.32 BCPS')
    const rows = cafe.getByTestId('payout-list').locator('li')
    await expect(rows).toHaveCount(6)
    await expect(rows.nth(0)).toContainText('Thu 24 Sep · 23:00')
    await expect(rows.nth(0)).toContainText('175.73 BCPS · Auto 50%')
    await expect(rows.nth(0)).toContainText('≈ €157.35')
    await expect(rows.nth(2)).toContainText('220.00 BCPS · Cash out')
    await expect(rows.nth(2)).toContainText('≈ €197.00')
    await expect(rows.nth(5)).toContainText('Sat 19 Sep · 23:00')
    await expect(view).toContainText('Conversion to EUR: 1.5% is included.')
    await axe(page, 'Payout history')

    // A cash-out of 143.00 joins the list, newest first.
    await cafe.getByTestId('nav-back').click()
    await cafe.getByTestId('row-cashOut').click()
    await typeAmount(cafe, '143')
    await cafe.getByRole('button', { name: 'Continue' }).click()
    await expect(cafe.getByTestId('fact-conversion')).toContainText('2.15 BCPS')
    await cafe.getByRole('button', { name: 'Cash out 143.00' }).click()
    await expect(cafe.locator('[data-screen="shared.cashout.done"]')).toBeVisible({ timeout: 5000 })
    await cafe.getByRole('button', { name: 'Done' }).click()
    await expectBalance(page, 'cafe', '143.00')
    await cafe.locator('[data-tile="cashOut"]').click()
    await cafe.getByTestId('row-payoutHistory').click()
    await expect(cafe.getByTestId('payout-list').locator('li')).toHaveCount(7)
    await expect(cafe.getByTestId('payout-list').locator('li').first()).toContainText('143.00 BCPS · Cash out')
  })

  test('the café’s conversion notification opens its payouts and clears the dot', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await expect(cafe.getByTestId('bell-count')).toHaveText('2')
    await cafe.getByTestId('bell').click()
    await cafe
      .getByTestId(/^notification-/)
      .filter({ hasText: 'Auto-converted' })
      .click()
    await expect(cafe.locator('[data-screen="biz.payouts"]')).toBeVisible()
    await cafe.getByTestId('nav-home').click()
    await expect(cafe.getByTestId('bell-count')).toHaveText('1')
  })

  test('auto-convert: 30% at 22:00 previews, saves, the tile follows, and nothing converts', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await cafe.locator('[data-tile="cashOut"]').click()
    await cafe.getByTestId('row-autoConvert').click()
    await expect(cafe.locator('[data-screen="biz.autoconvert.onoff"]')).toBeVisible()
    await expect(cafe.getByText('Step 1 of 4')).toBeVisible()
    await expect(cafe.getByTestId('auto-convert-switch')).toHaveAttribute('aria-checked', 'true')
    await expect(cafe.locator('[data-screen="biz.autoconvert.onoff"]')).toContainText(
      'Conversion to EUR: 1.5%. Your bank receives the euros.',
    )
    await cafe.getByRole('button', { name: 'Continue' }).click()

    // The same preview as it stands: every day, 23:00, 50%.
    const schedule = cafe.locator('[data-screen="biz.autoconvert.schedule"]')
    await expect(schedule).toBeVisible()
    await expect(cafe.getByTestId('schedule-daily')).toHaveAttribute('aria-checked', 'true')
    await expect(cafe.getByTestId('time-23:00')).toHaveAttribute('aria-checked', 'true')
    await expect(cafe.getByRole('radio')).toHaveCount(7)
    await cafe.getByTestId('time-22:00').click()
    await cafe.getByRole('button', { name: 'Continue' }).click()
    const share = cafe.locator('[data-screen="biz.autoconvert.share"]')
    await expect(share).toBeVisible()
    await expect(cafe.getByTestId('share-value')).toHaveText('50%')
    await cafe.getByTestId('share-range').fill('30')
    await expect(cafe.getByTestId('share-value')).toHaveText('30%')
    await expect(share).toContainText('Only on days with sales')
    await axe(page, 'Auto-convert · Share')
    await cafe.getByRole('button', { name: 'Continue' }).click()

    const review = cafe.locator('[data-screen="biz.autoconvert.review"]')
    await expect(review).toBeVisible()
    await expect(cafe.getByTestId('fact-schedule')).toContainText('Every day · 22:00')
    await expect(cafe.getByTestId('fact-share')).toContainText('30% of the balance')
    await expect(cafe.getByTestId('fact-sales-only')).toContainText('On')
    await expect(cafe.getByTestId('fact-conversion')).toContainText('Included')
    await expect(cafe.getByTestId('fact-to')).toContainText('SI56 •••• •••• 1934')
    await expect(cafe.getByTestId('auto-convert-next')).toHaveText('Next: tonight 22:00 · ≈ 85.80 BCPS → ≈ €76.83')
    await cafe.getByRole('button', { name: 'Save' }).click()
    const saved = cafe.locator('[data-screen="biz.autoconvert.saved"]')
    await expect(saved).toBeVisible()
    await expect(saved).toContainText('Saved')
    await expectCleanVisibleCopy(page)
    await cafe.getByRole('button', { name: 'Done' }).click()
    await expect(cafe.locator('[data-tile="cashOut"]')).toContainText('Auto 30% · 22:00')
    // Saved and shown; nothing was converted.
    await expectBalance(page, 'cafe', '286.00')
    await cafe.locator('[data-tile="cashOut"]').click()
    await expect(cafe.getByTestId('auto-convert-strip')).toHaveText('Auto-convert 30% · every day 22:00')
    await expect(cafe.getByTestId('row-payoutHistory')).toContainText('This week ≈ €913.89')
  })

  test('auto-convert as it stands: the next run is tonight 23:00, 143.00 BCPS → ≈ €128.05; off skips two steps', async ({
    page,
  }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await cafe.locator('[data-tile="cashOut"]').click()
    await cafe.getByTestId('row-autoConvert').click()
    await cafe.getByRole('button', { name: 'Continue' }).click()
    await cafe.getByRole('button', { name: 'Continue' }).click()
    await cafe.getByRole('button', { name: 'Continue' }).click()
    await expect(cafe.getByTestId('auto-convert-next')).toHaveText('Next: tonight 23:00 · ≈ 143.00 BCPS → ≈ €128.05')
    // Turn it off from the first step: the schedule and the share are passed over.
    await cafe.getByTestId('nav-back').click()
    await cafe.getByTestId('nav-back').click()
    await cafe.getByTestId('nav-back').click()
    await cafe.getByTestId('auto-convert-switch').click()
    await expect(cafe.getByTestId('auto-convert-switch')).toHaveAttribute('aria-checked', 'false')
    await cafe.getByRole('button', { name: 'Continue' }).click()
    await expect(cafe.locator('[data-screen="biz.autoconvert.review"]')).toBeVisible()
    await expect(cafe.getByText('Step 2 of 2')).toBeVisible()
    await expect(cafe.getByTestId('fact-state')).toContainText('Off')
    await cafe.getByRole('button', { name: 'Save' }).click()
    await expect(cafe.locator('[data-screen="biz.autoconvert.saved"]')).toBeVisible()
    await cafe.getByRole('button', { name: 'Done' }).click()
    await expect(cafe.locator('[data-tile="cashOut"]')).not.toContainText('Auto')
    await cafe.locator('[data-tile="cashOut"]').click()
    await expect(cafe.getByTestId('auto-convert-strip')).toHaveText('Auto-convert is off')
    await expect(cafe.getByTestId('row-autoConvert')).toContainText('Off')
  })

  test('the café tops up by bank transfer or a local method (no card): €100 by a local method is +110.00', async ({
    page,
  }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await cafe.locator('[data-tile="cashOut"]').click()
    await cafe.getByTestId('row-topup').click()
    await typeAmount(cafe, '1')
    await cafe.locator('[data-key="00"]').click()
    await cafe.getByRole('button', { name: 'Continue' }).click()
    await expect(cafe.getByRole('radio')).toHaveCount(2)
    await expect(cafe.getByTestId('method-card')).toHaveCount(0)
    await expect(cafe.getByTestId('method-bank-transfer')).toContainText('Bank transfer from SI56 •••• •••• 1934')
    await cafe.getByTestId('method-local-method').click()
    await cafe.getByRole('button', { name: 'Continue' }).click()
    await cafe.getByRole('button', { name: 'Top up €100.00' }).click()
    const done = cafe.locator('[data-screen="shared.topup.done"]')
    await expect(done).toBeVisible({ timeout: 5000 })
    await expect(done).toContainText('+110.00')
    await expect(done).toContainText('from €100.00 · local payment method')
    await cafe.getByRole('button', { name: 'Done' }).click()
    await expectBalance(page, 'cafe', '396.00')
  })
})
