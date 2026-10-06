// Top up: euros, a method on file, the check and where each method ends. A card settles at once
// (+55.00 for €50 with no fee, the token from the "Top up" edge); a bank transfer shows its timeline
// until it arrives and has a PENDING row in History that opens the same screen.
import { expect, test } from '@playwright/test'
import { anaAndMarko, expectBalance, expectCleanVisibleCopy, expectNoSeriousViolations, slot } from './helpers'

test.use({ viewport: { width: 1280, height: 720 } })

async function toTopUp(page: import('@playwright/test').Page) {
  await anaAndMarko(page)
  const ana = slot(page, 'left')
  await ana.locator('[data-tile="wallet"]').click()
  await expect(ana.locator('[data-screen="c.wallet.hub"]')).toBeVisible()
  await ana.getByTestId('row-topup').click()
  await expect(ana.locator('[data-screen="shared.topup.amount"]')).toBeVisible()
  return ana
}

const keys = async (phone: import('@playwright/test').Locator, digits: string[]) => {
  for (const k of digits) await phone.locator(`[data-key="${k}"]`).click()
}

test.describe('Top up by card', () => {
  test('€50 by card: +55.00 with no fee, Ana 302.50, the token comes from the Top up edge', async ({ page }) => {
    const ana = await toTopUp(page)
    await expect(ana.getByText('Step 1 of 3')).toBeVisible()
    await expect(ana.getByTestId('amount-value')).toHaveText('€0')
    await expect(ana.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await keys(ana, ['5', '00'])
    await expect(ana.getByTestId('amount-value')).toHaveText('€500')
    await keys(ana, ['del'])
    await expect(ana.getByTestId('amount-value')).toHaveText('€50')
    await expect(ana.getByTestId('top-up-get')).toHaveText('You get 55.00 BCPS')
    await expect(ana.getByTestId('amount-hint')).toHaveText('No top-up fee')
    await ana.getByRole('button', { name: 'Continue' }).click()

    // The methods on file: her card, her bank, a local method.
    await expect(ana.locator('[data-screen="shared.topup.method"]')).toBeVisible()
    await expect(ana.getByRole('radio')).toHaveCount(3)
    await expect(ana.getByTestId('method-card')).toContainText('Card •• 7719')
    await expect(ana.getByTestId('method-card')).toContainText('Instant')
    await expect(ana.getByTestId('method-bank-transfer')).toContainText('Bank transfer from SI56 •••• •••• 4821')
    await expect(ana.getByTestId('method-bank-transfer')).toContainText('When your bank sends it')
    await expect(ana.getByTestId('method-local-method')).toContainText('Local payment method')
    await expect(ana.getByTestId('method-card')).toHaveAttribute('aria-checked', 'true')
    await ana.getByRole('button', { name: 'Continue' }).click()

    await expect(ana.locator('[data-screen="shared.topup.review"]')).toBeVisible()
    await expect(ana.getByTestId('fact-amount')).toContainText('€50.00')
    await expect(ana.getByTestId('fact-method')).toContainText('Card •• 7719')
    await expect(ana.getByTestId('fact-fee')).toContainText('No top-up fee')
    await expect(ana.getByTestId('review-total')).toContainText('55.00 BCPS')
    await expect(ana.locator('[data-screen="shared.topup.review"]')).toContainText('BCPS is not pegged to the euro.')
    await ana.getByRole('button', { name: 'Top up €50.00' }).click()
    // The money comes in from the edge of the phone, marked "Top up", while the button sends.
    await expect(page.getByTestId('edge-marker').first()).toHaveText('Top up')
    await expect(ana.locator('[data-screen="shared.topup.done"]')).toBeVisible()
    await expect(ana.getByTestId('success-amount')).toContainText('+55.00')
    await expect(page.getByTestId('tape-row').first()).toContainText('Top up → @ana · 55.00 BCPS · settled · fee 0.00')
    await expect(ana.locator('[data-screen="shared.topup.done"]')).toContainText('from €50.00 · Card •• 7719')
    await expect(ana.locator('[data-screen="shared.topup.done"]')).toContainText('Ready to spend')
    await expect(ana.locator('[data-screen="shared.topup.done"]')).toContainText('No top-up fee')
    await expect(ana.locator('[data-screen="shared.topup.done"]')).toContainText('BC-')
    await expectCleanVisibleCopy(page)
    await ana.getByRole('button', { name: 'Done' }).click()
    await expect(ana.locator('[data-screen="c.home"]')).toBeVisible()
    await expectBalance(page, 'ana', '302.50')

    // It shows in History as a top-up.
    await ana.locator('[data-tile="history"]').click()
    await ana.getByTestId('chip-topupsCashouts').click()
    await expect(ana.getByTestId('history-list').locator('li')).toHaveCount(3)
    await ana.getByTestId('history-list').locator('li button').first().click()
    const detail = ana.locator('[data-screen="shared.tx"]')
    await expect(detail).toContainText('Card •• 7719')
    await expect(detail).toContainText('from €50.00')
    await expect(detail).toContainText('No top-up fee')
  })

  test('above €10,000 the words are the limit and Continue stays off', async ({ page }) => {
    const ana = await toTopUp(page)
    await keys(ana, ['1', '0', '0', '0', '1'])
    await expect(ana.getByTestId('error-line')).toHaveText('The maximum top-up is €10,000.')
    await expect(ana.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await keys(ana, ['del'])
    await expect(ana.getByTestId('error-line')).toHaveCount(0)
    await expect(ana.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  test('Edit goes back to the amount and Back to review returns; Back from the first step leaves', async ({ page }) => {
    const ana = await toTopUp(page)
    await keys(ana, ['2', '0'])
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByTestId('edit-Amount').click()
    await expect(ana.locator('[data-screen="shared.topup.amount"]')).toBeVisible()
    await keys(ana, ['5'])
    await ana.getByRole('button', { name: 'Back to review' }).click()
    await expect(ana.getByTestId('fact-amount')).toContainText('€205.00')
    await ana.getByTestId('nav-back').click()
    await ana.getByTestId('nav-back').click()
    await ana.getByTestId('nav-back').click()
    await expect(ana.locator('[data-screen="c.wallet.hub"]')).toBeVisible()
  })
})

test.describe('Top up by bank transfer', () => {
  test('on its way at Fri 12:15: expected Fri 14:15, a PENDING History row that opens the same screen', async ({
    page,
  }) => {
    const ana = await toTopUp(page)
    await keys(ana, ['5', '0'])
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByTestId('method-bank-transfer').click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await expect(ana.getByTestId('fact-method')).toContainText('Bank transfer from SI56 •••• •••• 4821')
    await ana.getByRole('button', { name: 'Top up €50.00' }).click()

    const wait = ana.locator('[data-screen="shared.topup.onItsWay"]')
    await expect(wait).toBeVisible()
    await expect(wait).toContainText('ON ITS WAY')
    await expect(wait).toContainText('+55.00')
    await expect(wait).toContainText('from €50.00 · bank transfer')
    const timeline = ana.getByTestId('top-up-timeline').locator('li')
    await expect(timeline).toHaveCount(3)
    await expect(timeline.nth(0)).toContainText('Requested')
    await expect(timeline.nth(0)).toContainText('Fri 25 Sep · 12:15')
    await expect(timeline.nth(1)).toContainText('Expected Fri 14:15')
    await expect(timeline.nth(2)).toContainText('In your BCPS balance')
    await expect(wait).toContainText('SI56 •••• •••• 4821')
    await expectNoSeriousViolations(page, 'Top up · on its way')
    await ana.getByRole('button', { name: 'Done' }).click()
    await expect(ana.locator('[data-screen="c.home"]')).toBeVisible()
    await expectBalance(page, 'ana', '247.50')

    await ana.locator('[data-tile="history"]').click()
    const row = ana.getByTestId(/^ramp-/)
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Bank transfer · on its way')
    await expect(row).toContainText('PENDING')
    await row.click()
    await expect(ana.locator('[data-screen="shared.topup.onItsWay"]')).toBeVisible()
    await expect(ana.getByTestId('top-up-timeline')).toContainText('Expected Fri 14:15')
    // [Done] on the opened row goes back to History.
    await ana.getByRole('button', { name: 'Done' }).click()
    await expect(ana.locator('[data-screen="c.history"]')).toBeVisible()
  })
})
