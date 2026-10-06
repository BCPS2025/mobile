// What the café is asked to pay: the Pay list (TO PAY, Pay supplier, Invoices), the invoice with its
// fee and total, paying it (fee 0.53, café 232.67) and declining it with a reason.
import { expect, test } from '@playwright/test'
import { expectBalance, expectCleanVisibleCopy, expectNoSeriousViolations, slot, stageBoth } from './helpers'

test.use({ viewport: { width: 1280, height: 720 } })

type Locator = import('@playwright/test').Locator
type Page = import('@playwright/test').Page

async function openPay(cafe: Locator) {
  await cafe.locator('[data-tile="pay"]').click()
  await expect(cafe.locator('[data-screen="pos.pay"]')).toBeVisible()
}

async function axe(page: Page, where: string) {
  await page.waitForTimeout(600)
  await expectNoSeriousViolations(page, where)
}

test.describe('Pay', () => {
  test('the tile says 1 to pay with a badge; the list has TO PAY, Pay supplier and Invoices', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    const tile = cafe.locator('[data-tile="pay"]')
    await expect(tile).toContainText('1 to pay')
    await expect(tile).toContainText('1')
    await openPay(cafe)
    const toPay = cafe.getByTestId('to-pay')
    await expect(toPay).toContainText('TO PAY')
    await expect(toPay.getByTestId('invoice-PZ-0412')).toContainText('PZ-0412 · Pekarna Zrno')
    await expect(toPay.getByTestId('invoice-PZ-0412')).toContainText('Weekly bread order')
    await expect(toPay.getByTestId('invoice-PZ-0412')).toContainText('DUE')
    await expect(toPay.getByTestId('invoice-PZ-0412')).toContainText('52.80')
    await expect(cafe.getByTestId('row-paySupplier')).toContainText('By @name, code or invoice')
    await expect(cafe.getByTestId('row-invoices')).toContainText('PZ-0412 · 52.80')
    await axe(page, 'Pay')
  })

  test('Invoices lists it with its due day; the notification of the invoice opens the same detail', async ({
    page,
  }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await openPay(cafe)
    await cafe.getByTestId('row-invoices').click()
    const list = cafe.locator('[data-screen="biz.invoices"]')
    await expect(list).toBeVisible()
    await expect(list.getByTestId('invoice-PZ-0412')).toContainText('Due 2 Oct')
    await axe(page, 'Invoices')
    await cafe.getByTestId('nav-home').click()
    await cafe.getByTestId('bell').click()
    await cafe.getByText('New invoice PZ-0412 from Pekarna Zrno').click()
    await expect(cafe.locator('[data-screen="biz.invoice.detail"]')).toBeVisible()
  })
})

test.describe('Pay an invoice', () => {
  test('the invoice shows who, number, what, issued, due, the 0.53 fee and the total 53.33', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await openPay(cafe)
    await cafe.getByTestId('invoice-PZ-0412').click()
    const detail = cafe.locator('[data-screen="biz.invoice.detail"]')
    await expect(detail).toBeVisible()
    await expect(detail).toContainText('52.80')
    await expect(detail).toContainText('≈ €48.00')
    await expect(cafe.getByTestId('fact-from')).toContainText('Pekarna Zrno')
    await expect(cafe.getByTestId('fact-from')).toContainText('✓ Verified')
    await expect(cafe.getByTestId('fact-number')).toContainText('PZ-0412')
    await expect(cafe.getByTestId('fact-description')).toContainText('Weekly bread order')
    await expect(cafe.getByTestId('fact-issued')).toContainText('Fri 25 Sep')
    await expect(cafe.getByTestId('fact-due')).toContainText('Fri 2 Oct')
    await expect(cafe.getByTestId('fact-fee')).toContainText('0.53 BCPS')
    await expect(cafe.getByTestId('fact-fee')).toContainText('≈ €0.48')
    await expect(cafe.getByTestId('review-total')).toContainText('53.33 BCPS')
    // No card comparison line on an invoice.
    await expect(detail).not.toContainText('Cards')
    await axe(page, 'Invoice detail')
  })

  test('Pay 53.33 BCPS: PAID, café 232.67, the invoice and the badge are gone', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await openPay(cafe)
    await cafe.getByTestId('invoice-PZ-0412').click()
    await cafe.getByRole('button', { name: 'Pay 53.33 BCPS' }).click()
    await expect(page.getByTestId('edge-marker').first()).toBeVisible()
    const paid = cafe.locator('[data-screen="biz.invoice.paid"]')
    await expect(paid).toBeVisible({ timeout: 5000 })
    await expect(paid).toContainText('PAID')
    await expect(paid).toContainText('52.80')
    await expect(paid).toContainText('to Pekarna Zrno')
    await expect(paid).toContainText('0.53 BCPS · paid by you')
    await expectCleanVisibleCopy(page)
    await cafe.getByRole('button', { name: 'Done' }).click()
    await expectBalance(page, 'cafe', '232.67')
    await expect(cafe.locator('[data-tile="pay"]')).not.toContainText('to pay')
    await openPay(cafe)
    await expect(cafe.getByTestId('to-pay')).toHaveCount(0)
    await cafe.getByTestId('row-invoices').click()
    await expect(cafe.locator('[data-screen="biz.invoices"]')).toContainText('No invoices to pay.')
    await expect(cafe.locator('[data-screen="biz.invoices"]')).toContainText(
      'Invoices from your suppliers appear here.',
    )
    await axe(page, 'Invoices · Empty')
  })

  test('Decline asks why, tells the supplier, and no money moves', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await openPay(cafe)
    await cafe.getByTestId('invoice-PZ-0412').click()
    await cafe.getByRole('button', { name: 'Decline' }).click()
    const why = cafe.locator('[data-screen="biz.invoice.decline"]')
    await expect(why).toBeVisible()
    await expect(why).toContainText('Why are you declining?')
    await expect(cafe.getByTestId('decline-reasons').locator('label')).toHaveText([
      'Wrong amount',
      'Not ordered',
      'Already paid',
      'Other',
    ])
    await expect(why).toContainText('Pekarna Zrno sees your reason. No money moves.')
    await expect(cafe.getByLabel('Wrong amount')).toBeChecked()
    await axe(page, 'Invoice · Decline reason')
    // Keep goes back to the invoice; Decline with a reason ends on a neutral screen.
    await cafe.getByRole('button', { name: 'Keep' }).click()
    await expect(cafe.locator('[data-screen="biz.invoice.detail"]')).toBeVisible()
    await cafe.getByRole('button', { name: 'Decline' }).click()
    await cafe.getByTestId('reason-Not ordered').click()
    await expect(cafe.getByLabel('Not ordered')).toBeChecked()
    await cafe.getByRole('button', { name: 'Decline' }).last().click()
    const declined = cafe.locator('[data-screen="biz.invoice.declined"]')
    await expect(declined).toBeVisible()
    await expect(declined).toContainText('Invoice declined')
    await expect(declined).toContainText('Pekarna Zrno sees your reason. No money moved.')
    await cafe.getByRole('button', { name: 'Done' }).click()
    await expectBalance(page, 'cafe', '286.00')
    await expect(cafe.locator('[data-tile="pay"]')).not.toContainText('to pay')
  })

  test('with less than 53.33 the line says so, offers Top up and Pay stays off', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    const ok = await page.evaluate(() => {
      const hook = (window as unknown as { __bcps: { dispatch(c: unknown): { ok: boolean } } }).__bcps
      return hook.dispatch({ type: 'ramp.off', actor: 'cafe', cmdId: '00000000000e2e30:cash', amount: 26000 }).ok
    })
    expect(ok).toBe(true)
    await expectBalance(page, 'cafe', '26.00')
    await openPay(cafe)
    await cafe.getByTestId('invoice-PZ-0412').click()
    await expect(cafe.getByTestId('error-line')).toContainText('You have 26.00 BCPS. Top up 27.33 BCPS to pay.')
    await expect(cafe.getByRole('button', { name: 'Pay 53.33 BCPS' })).toBeDisabled()
    await cafe.getByTestId('error-top-up').click()
    await expect(cafe.locator('[data-screen="shared.topup.amount"]')).toBeVisible()
  })
})
