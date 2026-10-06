// Split a bill: pick a payment, choose who shares it, equal or custom shares, the check, the
// request; the share is paid or declined and the owner follows the progress.
import { expect, test } from '@playwright/test'
import { anaAndMarko, expectBalance, expectCleanVisibleCopy, slot, typeAmount } from './helpers'

test.describe('split a bill on the stage', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('Brunch for two with Marko: 13.20 each; Marko pays 13.33; Ana 260.70, Marko 119.65; 1 of 1 paid', async ({
    page,
  }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    const marko = slot(page, 'right')
    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('row-splitBill').click()

    // Which payment: the last outgoing ones.
    const pick = ana.locator('[data-screen="c.split.pick"]')
    await expect(pick).toBeVisible()
    await expect(ana.getByText('Step 1 of 4')).toBeVisible()
    await expect(pick.getByTestId('split-payments').locator('li')).toHaveCount(3)
    await expect(pick).toContainText('Café Lipa · Brunch for two')
    await expect(pick).toContainText('−26.40')
    await expect(pick).toContainText('Café Lipa · 1 × espresso')
    await expect(pick).toContainText('@marta_k · Pizza')
    await ana.getByRole('button', { name: 'Continue' }).click()

    // Who shares it.
    await expect(ana.locator('[data-screen="c.split.people"]')).toBeVisible()
    await expect(ana.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await ana.getByTestId('party-marko').click()
    await expect(ana.getByTestId('people-count')).toHaveText('1 person selected · you are included.')
    await ana.getByRole('button', { name: 'Continue' }).click()

    // Equal or custom.
    await expect(ana.locator('[data-screen="c.split.shares"]')).toBeVisible()
    await expect(ana.getByTestId('share-you')).toContainText('13.20 BCPS')
    await expect(ana.getByTestId('share-marko')).toContainText('13.20 BCPS')
    await expect(ana.getByTestId('share-total')).toContainText('26.40 BCPS')
    // Custom over the total says so and stops.
    await ana.getByTestId('mode-custom').click()
    await ana.getByTestId('share-marko').click()
    await typeAmount(ana, '30')
    await expect(ana.getByTestId('error-line')).toHaveText('The shares add up to more than 26.40.')
    await expect(ana.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await ana.getByTestId('mode-equal').click()
    await expect(ana.getByTestId('error-line')).toHaveCount(0)
    await ana.getByRole('button', { name: 'Continue' }).click()

    // Check and send.
    const review = ana.locator('[data-screen="c.split.review"]')
    await expect(review).toBeVisible()
    await expect(ana.getByText('Step 4 of 4')).toBeVisible()
    await expect(review).toContainText('Café Lipa · Brunch for two')
    await expect(review).toContainText('Equal · 2 people')
    await expect(review).toContainText('@marko pays')
    await expect(review).toContainText('You paid')
    await expect(ana.getByTestId('info-note')).toHaveText(
      'Marko pays the 1% fee (0.13 BCPS). You receive the full amount.',
    )
    await ana.getByRole('button', { name: 'Send 1 request' }).click()
    const sent = ana.locator('[data-screen="c.split.sent"]')
    await expect(sent).toContainText('Split sent')
    await expect(sent).toContainText('13.20 BCPS from @marko · Brunch for two')
    await ana.getByRole('button', { name: 'Done' }).click()

    // Marko: the banner, the share to pay, 13.33.
    await expect(marko.getByTestId('banner')).toContainText('@ana split Brunch for two · Your share 13.20 BCPS')
    await marko.getByTestId('banner').click()
    const check = marko.locator('[data-screen="c.payItem.review"]')
    await expect(check.getByRole('heading', { name: 'Pay @ana?' })).toBeVisible()
    await expect(marko.getByText('Ana asked for your share today at 12:15.')).toBeVisible()
    await expect(marko.getByTestId('review-total')).toContainText('13.33 BCPS')
    await marko.getByRole('button', { name: 'Pay 13.33' }).click()
    await expect(marko.locator('[data-screen="c.payItem.success"]')).toBeVisible({ timeout: 5000 })
    await marko.getByRole('button', { name: 'Done' }).click()
    await expectBalance(page, 'marko', '119.65')

    // Ana: everyone paid.
    await expect(ana.getByTestId('banner')).toContainText('Brunch for two · everyone paid ✓')
    await ana.getByTestId('banner').click()
    const detail = ana.locator('[data-screen="c.split.detail"]')
    await expect(detail).toBeVisible()
    await expect(detail.getByTestId('status-chip')).toHaveText('1 of 1 paid ✓')
    await expect(detail).toContainText('COLLECTED')
    await expect(detail).toContainText('13.20')
    await expect(detail.getByRole('button', { name: 'Ask again' })).toHaveCount(0)
    await ana.getByTestId('nav-home').click()
    await expectBalance(page, 'ana', '260.70')

    // The Brunch's detail now shows the split instead of offering one.
    await ana.locator('[data-tile="history"]').click()
    await ana
      .getByTestId(/^tx-BC-/)
      .filter({ hasText: 'Café Lipa' })
      .first()
      .click()
    await expect(ana.getByRole('button', { name: 'Split · 1 of 1 paid' })).toBeVisible()
    await expectCleanVisibleCopy(page)
  })

  test('a share that was declined is asked again; the open ones can be cancelled', async ({ page }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    const marko = slot(page, 'right')
    // From the payment's detail: People first, three steps.
    await ana.locator('[data-tile="history"]').click()
    await ana
      .getByTestId(/^tx-BC-/)
      .filter({ hasText: 'Café Lipa' })
      .first()
      .click()
    await expect(ana.getByRole('button', { name: 'Split this bill' })).toBeVisible()
    await ana.getByRole('button', { name: 'Split this bill' }).click()
    await expect(ana.locator('[data-screen="c.split.people"]')).toBeVisible()
    await expect(ana.getByText('Step 1 of 3')).toBeVisible()
    await ana.getByTestId('party-marko').click()
    await ana.getByTestId('party-marta_k').click()
    await expect(ana.getByTestId('people-count')).toHaveText('2 people selected · you are included.')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await expect(ana.getByTestId('share-you')).toContainText('8.80 BCPS')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByRole('button', { name: 'Send 2 requests' }).click()
    await expect(ana.locator('[data-screen="c.split.sent"]')).toContainText('2 people asked · Brunch for two')
    await ana.getByRole('button', { name: 'Done' }).click()

    // Marko declines his share.
    await marko.getByTestId('banner').click()
    await marko.getByRole('button', { name: 'Decline' }).click()
    await marko.getByRole('button', { name: 'Decline', exact: true }).last().click()
    await expect(marko.locator('[data-screen="c.payItem.declined"]')).toBeVisible()
    await expect(ana.getByTestId('banner')).toContainText('@marko declined your split')
    await expect(ana.getByTestId('banner')).toContainText('Brunch for two')
    await marko.getByRole('button', { name: 'Done' }).click()

    // Ana's progress: Marko DECLINED, @marta_k waiting.
    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('waiting').getByText('Split · 0 of 2 paid').click()
    const detail = ana.locator('[data-screen="c.split.detail"]')
    await expect(detail.getByTestId('status-chip')).toHaveText('0 of 2 paid')
    await expect(detail.getByTestId('share-marko')).toContainText('DECLINED')
    await expect(detail.getByTestId('share-marta_k')).toContainText('Waiting')
    await expect(detail).toContainText('You can ask again.')
    await expect(detail).not.toContainText('Change split')

    // Ask again (a double tap): Marko has a new request to pay, and the second tap does not press
    // [Cancel open requests], which takes the button's place.
    await detail.getByRole('button', { name: 'Ask again' }).dblclick()
    await expect(detail.getByTestId('share-marko')).not.toContainText('DECLINED')
    await page.waitForTimeout(600)
    await expect(detail).toBeVisible()
    await expect(ana.locator('[data-screen="c.split.cancel"]')).toHaveCount(0)
    await expect(marko.locator('[data-tile="payRequest"]')).toContainText('1 to pay')

    // Cancel what is open (both shares), after a question.
    await detail.getByRole('button', { name: 'Cancel open requests' }).click()
    const confirm = ana.locator('[data-screen="c.split.cancel"]')
    await expect(confirm).toContainText('Cancel the open requests?')
    await expect(confirm).toContainText('Open requests')
    await ana.getByRole('button', { name: 'Keep' }).click()
    await expect(detail).toBeVisible()
    await detail.getByRole('button', { name: 'Cancel open requests' }).click()
    await ana.getByRole('button', { name: 'Cancel requests' }).click()
    await expect(ana.locator('[data-screen="c.split.cancelled"]')).toContainText('Open requests cancelled')
    await ana.getByRole('button', { name: 'Done' }).click()
    await expect(marko.locator('[data-tile="payRequest"]')).not.toContainText('to pay')
  })

  test('an amount that is entered: 10.00 "Taxi share" with two people is 3.33, 3.33 and 3.34', async ({ page }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('row-splitBill').click()
    await ana.getByRole('button', { name: 'Enter an amount' }).click()
    await expect(ana.locator('[data-screen="c.split.amount"]')).toBeVisible()
    await typeAmount(ana, '10')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await expect(ana.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await ana.getByRole('button', { name: 'Taxi share', exact: true }).click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByTestId('party-marko').click()
    await ana.getByTestId('party-marta_k').click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await expect(ana.getByTestId('share-you')).toContainText('3.34 BCPS')
    await expect(ana.getByTestId('share-marko')).toContainText('3.33 BCPS')
    await expect(ana.getByTestId('share-marta_k')).toContainText('3.33 BCPS')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await expect(ana.locator('[data-screen="c.split.review"]')).toContainText('Your share')
    await expect(ana.getByTestId('info-note')).toContainText('Each person pays the 1% fee on their share.')
  })
})
