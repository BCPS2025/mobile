// The café's business screens as a whole: no serious accessibility violation on the ones the other
// specs do not look at, and nothing in a phone scrolls sideways on a 320 px screen.
import { type Page, expect, test } from '@playwright/test'
import { expectNoSeriousViolations, openApp, slot } from './helpers'

/** Axe once the screen has finished fading in (a fade in progress blends the colours). */
async function noSeriousViolations(page: Page, where: string): Promise<void> {
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished),
    ),
  )
  await expectNoSeriousViolations(page, where)
}

/** Whether the page, or the scrolling body of the screen in the phone, is wider than its box. */
const sideways = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth ||
      [...document.querySelectorAll('[data-screen] .overflow-y-auto')].some((el) => el.scrollWidth > el.clientWidth),
  )

test.describe('the café screens', () => {
  test.use({ viewport: { width: 390, height: 664 } })

  test('no serious accessibility violation: the refund list and its end, the invoice paid, Saved', async ({ page }) => {
    test.setTimeout(90_000)
    await openApp(page, '#/phone/cafe')
    const phone = slot(page, 'single')
    await phone.locator('[data-tile="sales"]').click()
    await phone.getByTestId('row-refundSale').click()
    await noSeriousViolations(page, 'Refund · Choose a sale')
    await phone.getByRole('button', { name: 'Continue' }).click()
    await phone.getByRole('button', { name: 'Refund 26.40 BCPS' }).click()
    await expect(phone.locator('[data-screen="biz.refund.done"]')).toBeVisible({ timeout: 5000 })
    await noSeriousViolations(page, 'Refund · Done')
    await phone.getByTestId('nav-home').click()
    await phone.locator('[data-tile="pay"]').click()
    await phone.getByTestId('invoice-PZ-0412').click()
    await phone.getByRole('button', { name: 'Pay 53.33 BCPS' }).click()
    await expect(phone.locator('[data-screen="biz.invoice.paid"]')).toBeVisible({ timeout: 5000 })
    await noSeriousViolations(page, 'Invoice · Paid')
    await phone.getByTestId('nav-home').click()
    await phone.getByTestId('avatar').click()
    await phone.getByTestId('row-feePayer').click()
    await phone.getByRole('button', { name: 'Save' }).click()
    await noSeriousViolations(page, 'Settings · Saved')
  })

  test('nothing scrolls sideways on a 320 px phone', async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 320, height: 568 })
    await openApp(page, '#/phone/cafe')
    const phone = slot(page, 'single')
    const here = async (where: string) => expect(await sideways(page), where).toBe(false)
    await here('Home')
    await phone.locator('[data-tile="sales"]').click()
    await here('Sales · Today')
    await phone.getByTestId('range-7d').click()
    await here('Sales · 7 days')
    await phone.getByTestId('row-refundSale').click()
    await here('Refund · Choose a sale')
    await phone.getByRole('button', { name: 'Continue' }).click()
    await here('Refund · Review')
    await phone.getByTestId('nav-home').click()
    await phone.locator('[data-tile="pay"]').click()
    await here('Pay')
    await phone.getByTestId('row-invoices').click()
    await here('Invoices')
    await phone.getByTestId('invoice-PZ-0412').click()
    await here('Invoice detail')
    await phone.getByRole('button', { name: 'Decline' }).click()
    await here('Invoice · Why are you declining?')
    await phone.getByTestId('nav-home').click()
    await phone.locator('[data-tile="sales"]').click()
    await phone.getByTestId('row-allPayments').click()
    await here('History')
    await phone
      .getByRole('button', { name: /Daily sales/ })
      .first()
      .click()
    await here('Day summary')
    await phone.getByTestId('nav-home').click()
    await phone.getByTestId('avatar').click()
    await here('Settings')
    await phone.getByTestId('row-feePayer').click()
    await here('Settings · Who pays the fee')
  })
})
