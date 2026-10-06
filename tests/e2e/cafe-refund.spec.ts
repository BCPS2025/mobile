// Refund a sale (biz.refund.*): choose a named sale, check, refund. The refund has no fee and
// keeps the sale's own fee; the sale reads Refunded ✓ from then on, for the café and the customer.
import { expect, test } from '@playwright/test'
import { SALE, expectBalance, expectCleanVisibleCopy, expectNoSeriousViolations, pay, slot, stageBoth } from './helpers'

test.use({ viewport: { width: 1280, height: 720 } })

type Page = import('@playwright/test').Page

/** A command another phone (or this one) sends, as the manual clock's hook takes it. */
async function send(page: Page, cmd: Record<string, unknown>): Promise<void> {
  const ok = await page.evaluate((c) => {
    const hook = (window as unknown as { __bcps: { dispatch(c: unknown): { ok: boolean } } }).__bcps
    return hook.dispatch(c).ok
  }, cmd)
  expect(ok).toBe(true)
}

async function openRefundList(cafe: import('@playwright/test').Locator) {
  await cafe.locator('[data-tile="sales"]').click()
  await cafe.getByTestId('row-refundSale').click()
}

test.describe('Refund a sale', () => {
  test('Which sale? lists Brunch and the Espresso; Brunch 26.40: café 259.60, Ana 273.90, no fee', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    const ana = slot(page, 'left')
    await openRefundList(cafe)
    const pick = cafe.locator('[data-screen="biz.refund.pick"]')
    await expect(pick).toBeVisible()
    await expect(cafe.getByText('Step 1 of 2')).toBeVisible()
    await expect(pick).toContainText('Which sale?')
    const sales = cafe.getByTestId('refund-sales').locator('li')
    await expect(sales).toHaveCount(2)
    await expect(sales.nth(0)).toContainText('@ana · Brunch for two')
    await expect(sales.nth(0)).toContainText('26.40')
    await expect(sales.nth(1)).toContainText('@ana · 1 × espresso')
    await expect(sales.nth(1)).toContainText('2.20')
    // The newest is chosen already; Continue goes to the check.
    await expect(sales.nth(0).locator('button')).toHaveAttribute('aria-pressed', 'true')

    // The search looks through who, what, the amount and the reference.
    await cafe.getByTestId('refund-search').fill('espresso')
    await expect(sales).toHaveCount(1)
    await cafe.getByTestId('refund-search').fill('nothing like it')
    await expect(cafe.getByTestId('refund-none-found')).toBeVisible()
    await cafe.getByTestId('refund-search').fill('')
    await expect(sales).toHaveCount(2)

    await cafe.getByRole('button', { name: 'Continue' }).click()
    const review = cafe.locator('[data-screen="biz.refund.review"]')
    await expect(review).toBeVisible()
    await expect(cafe.getByText('Step 2 of 2')).toBeVisible()
    await expect(review).toContainText('Refund 26.40 BCPS to @ana?')
    await expect(cafe.getByTestId('fact-sale')).toContainText('Brunch for two')
    await expect(cafe.getByTestId('fact-reference')).toContainText(/BC-[0-9A-Z]{6}/)
    await expect(cafe.getByTestId('review-total')).toContainText('26.40 BCPS')
    await expect(cafe.getByTestId('refund-note')).toContainText("No fee. The original 0.26 fee isn't returned.")
    await page.waitForTimeout(600)
    await expectNoSeriousViolations(page, 'Refund · Review')

    await cafe.getByRole('button', { name: 'Refund 26.40 BCPS' }).click()
    const done = cafe.locator('[data-screen="biz.refund.done"]')
    await expect(done).toBeVisible({ timeout: 5000 })
    await expect(done).toContainText('REFUNDED')
    await expect(done).toContainText('26.40')
    await expect(done).toContainText('to @ana · Ana Novak')
    await expect(done).toContainText('Refunded ✓ is now shown on the sale.')
    await expect(done).toContainText('No fee')
    await expect(done).toContainText(/BC-[0-9A-Z]{6}/)
    await expectCleanVisibleCopy(page)

    // Ana hears about it.
    await expect(ana.getByTestId('banner')).toContainText('Refund from Café Lipa · 26.40 BCPS')
    await cafe.getByRole('button', { name: 'Done' }).click()
    await expect(cafe.locator('[data-screen="pos.home"]')).toBeVisible()
    await expectBalance(page, 'cafe', '259.60')
    await expectBalance(page, 'ana', '273.90')
  })

  test('the sale reads Refunded ✓ on both detail screens, and the café has no Refund button for it any more', async ({
    page,
  }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    const ana = slot(page, 'left')
    await openRefundList(cafe)
    await cafe.getByRole('button', { name: 'Continue' }).click()
    await cafe.getByRole('button', { name: 'Refund 26.40 BCPS' }).click()
    await expect(cafe.locator('[data-screen="biz.refund.done"]')).toBeVisible({ timeout: 5000 })
    await cafe.getByRole('button', { name: 'Done' }).click()

    // Ana: the original payment in her History says Refunded ✓.
    await ana.locator('[data-tile="history"]').click()
    const refundRow = ana.locator('[data-testid^="tx-BC-"]').filter({ hasText: '+26.40' }).first()
    await expect(refundRow).toBeVisible()
    const original = ana.locator('[data-testid^="tx-BC-"]').filter({ hasText: '−26.40' }).first()
    await original.click()
    await expect(ana.locator('[data-screen="shared.tx"]')).toContainText(/Refunded ✓ · (Thu|Fri) \d\d:\d\d/)

    // The café: the refunded sale is greyed in the list and not offered again.
    await openRefundList(cafe)
    await expect(cafe.getByTestId('refund-sales').locator('li')).toHaveCount(2)
    const brunch = cafe.getByTestId('refund-sales').locator('li').first()
    await expect(brunch).toContainText('REFUNDED ✓')
    await expect(brunch.locator('button')).toHaveAttribute('aria-disabled', 'true')
    // The newest sale that can still be refunded is the one chosen.
    await expect(cafe.getByTestId('refund-sales').locator('li').nth(1).locator('button')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('from the sale itself: Refund on its detail starts on the check; Today then shows the refund', async ({
    page,
  }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await pay(page, SALE)
    await expectBalance(page, 'cafe', '296.89')
    await cafe.locator('[data-tile="sales"]').click()
    await cafe.locator('[data-testid^="sale-BC-"]').first().click()
    await expect(cafe.locator('[data-screen="shared.tx"]')).toBeVisible()
    await cafe.getByRole('button', { name: 'Refund', exact: true }).click()
    const review = cafe.locator('[data-screen="biz.refund.review"]')
    await expect(review).toBeVisible()
    await expect(review).toContainText('Refund 11.00 BCPS to @ana?')
    await expect(cafe.getByText('Step 2 of 2')).toHaveCount(0)
    await expect(cafe.getByTestId('refund-note')).toContainText('The original 0.11 fee')
    await cafe.getByRole('button', { name: 'Refund 11.00 BCPS' }).click()
    await expect(cafe.locator('[data-screen="biz.refund.done"]')).toBeVisible({ timeout: 5000 })
    await cafe.getByRole('button', { name: 'Done' }).click()
    await expectBalance(page, 'cafe', '285.89')

    // Sales: the refund shows as a line, and the sale as REFUNDED ✓; its detail has no Refund button.
    await cafe.locator('[data-tile="sales"]').click()
    await expect(cafe.getByTestId('sales-refunds')).toHaveText('Refunds −11.00')
    await expect(cafe.getByTestId('kpi-sales')).toContainText('24')
    await expect(cafe.getByTestId('kpi-net')).toContainText('110.16')
    const sale = cafe.locator('[data-testid^="sale-BC-"]').first()
    await expect(sale).toContainText('REFUNDED ✓')
    await sale.click()
    await expect(cafe.locator('[data-screen="shared.tx"]')).toContainText(/Refunded ✓ · /)
    await expect(cafe.getByRole('button', { name: 'Refund', exact: true })).toHaveCount(0)
  })

  test('a sale refunded while the check is open: the line says Refunded ✓ and the time, no second refund', async ({
    page,
  }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await openRefundList(cafe)
    const id = (await cafe.locator('[data-testid^="refund-tx-"]').first().getAttribute('data-testid'))?.replace(
      'refund-tx-',
      '',
    )
    await cafe.getByRole('button', { name: 'Continue' }).click()
    await expect(cafe.locator('[data-screen="biz.refund.review"]')).toBeVisible()
    await send(page, { type: 'refund', actor: 'cafe', cmdId: '00000000000e2e01:review', txId: id })
    await expectBalance(page, 'ana', '273.90')
    await cafe.getByRole('button', { name: 'Refund 26.40 BCPS' }).click()
    await expect(cafe.getByTestId('error-line')).toContainText(/^Refunded ✓ · (Thu|Fri) \d\d:\d\d/)
    await expectBalance(page, 'ana', '273.90')
    await cafe.getByTestId('nav-home').click()
    await expectBalance(page, 'cafe', '259.60')
  })

  test('with nothing left to refund the list says so', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await openRefundList(cafe)
    const ids = await cafe
      .locator('[data-testid^="refund-tx-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')?.replace('refund-tx-', '') ?? ''))
    await cafe.getByTestId('nav-back').click()
    let n = 0
    for (const txId of ids)
      await send(page, { type: 'refund', actor: 'cafe', cmdId: `00000000000e2e1${n++}:review`, txId })
    await expectBalance(page, 'ana', '276.10')
    await cafe.getByTestId('row-refundSale').click()
    await expect(cafe.locator('[data-screen="biz.refund.pick"]')).toContainText('No sales to refund.')
    await expect(cafe.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await page.waitForTimeout(600)
    await expectNoSeriousViolations(page, 'Refund · empty')
  })
})
