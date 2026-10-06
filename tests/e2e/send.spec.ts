// Send: who, how much, a note, Check and send; the fee paid by the sender, Max, errors, one payment
// for a double tap; then History, the payment detail with Send again, and Marko's notification.
import { expect, test } from '@playwright/test'
import { biometricLogin, expectBalance, expectCleanVisibleCopy, openApp, slot } from './helpers'

test.describe('send on the stage @webkit', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  /** Ana on the left, Marko on the right (through the account menu). */
  async function anaAndMarko(page: import('@playwright/test').Page) {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await page.getByTestId('account-menu-right').click()
    await page.getByTestId('account-marko').click()
    await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'marko')
    await expect(slot(page, 'right').locator('[data-screen="c.home"]')).toBeVisible()
  }

  async function toAmount(page: import('@playwright/test').Page, handle = '@marko') {
    const ana = slot(page, 'left')
    await ana.locator('[data-tile="payRequest"]').click()
    await expect(ana.locator('[data-screen="c.payRequest.hub"]')).toBeVisible()
    await expect(ana.getByTestId('row-send')).toContainText('To a person or business')
    await ana.getByTestId('row-send').click()
    await expect(ana.locator('[data-screen="c.send.to"]')).toBeVisible()
    await ana.getByTestId('party-search').fill(handle)
    await ana.getByRole('button', { name: 'Continue' }).click()
    await expect(ana.locator('[data-screen="c.send.amount"]')).toBeVisible()
  }

  async function type(page: import('@playwright/test').Page, amount: string) {
    const ana = slot(page, 'left')
    for (const ch of amount) await ana.locator(`[data-key="${ch}"]`).click()
  }

  test('Ana sends Marko 16.50 "Cinema": total 16.67, Ana 230.83, Marko 149.48, one payment for a double tap', async ({
    page,
  }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    const marko = slot(page, 'right')
    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('row-send').click()

    // Who: suggestions while typing, contacts and the directory.
    await expect(ana.getByText('RECENT')).toBeVisible()
    await ana.getByTestId('party-search').fill('@mar')
    await expect(ana.getByTestId('party-marko')).toContainText('@marko')
    await expect(ana.getByTestId('party-marko')).toContainText('Marko Kovač')
    await expect(ana.getByTestId('party-marta_k')).toContainText('Marta K.')
    await expect(ana.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await expect(ana.getByText('Step 1 of 4')).toBeVisible()
    await ana.getByTestId('party-marko').click()
    await ana.getByRole('button', { name: 'Continue' }).click()

    // How much: Available, Max, the keypad, ≈ €.
    await expect(ana.locator('[data-screen="c.send.amount"]')).toBeVisible()
    await expect(ana.getByText('Available 247.50 BCPS')).toBeVisible()
    await expect(ana.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await type(page, '16.50')
    await expect(ana.getByTestId('amount-value')).toContainText('16.50')
    await expect(ana.getByText('≈ €15.00')).toBeVisible()
    await ana.getByRole('button', { name: 'Continue' }).click()

    // A note: the chips of the catalogue, the visibility line, Skip.
    await expect(ana.locator('[data-screen="c.send.note"]')).toBeVisible()
    for (const chip of ['Cinema', 'Lunch', 'Pizza', 'Taxi share', 'Groceries'])
      await expect(ana.getByRole('button', { name: chip, exact: true })).toBeVisible()
    await expect(ana.getByText('Only you and @marko see the note.')).toBeVisible()
    await expect(ana.getByTestId('dock-secondary')).toHaveText('Skip')
    await ana.getByRole('button', { name: 'Cinema', exact: true }).click()
    await expect(ana.getByTestId('note-input')).toHaveValue('Cinema')
    await ana.getByRole('button', { name: 'Continue' }).click()

    // Check and send: the fee paid by Ana, explained in place; the total; the balance after.
    await expect(ana.locator('[data-screen="c.send.review"]')).toBeVisible()
    await expect(ana.getByText('Step 4 of 4')).toBeVisible()
    await expect(ana.getByTestId('fee-line')).toContainText('Transaction fee 1% · 0.17 BCPS (≈ €0.15) · paid by you')
    await expect(ana.getByTestId('review-total')).toContainText('16.67')
    await expect(ana.getByTestId('balance-after')).toHaveText('Balance after 230.83 BCPS')
    await expect(ana.getByText('A 1% fee on every payment, always shown before you pay.')).toHaveCount(0)
    await ana.getByTestId('fee-line').click()
    await expect(
      ana.getByText('A 1% fee on every payment, always shown before you pay. Conversion to EUR: 1.5%.'),
    ).toBeVisible()
    const send = ana.getByRole('button', { name: 'Send 16.67 BCPS' })
    await expect(send).toBeVisible()
    await send.dblclick()
    await expect(ana.getByRole('button', { name: 'Sending…' })).toBeVisible()
    // Back and Home wait while it sends.
    await expect(ana.getByTestId('nav-back')).toBeDisabled()
    await expect(ana.getByTestId('nav-home')).toBeDisabled()

    // Sent: the receipt, once.
    await expect(ana.locator('[data-screen="c.send.success"]')).toBeVisible({ timeout: 5000 })
    await expect(ana.getByTestId('success-amount')).toContainText('16.50')
    await expect(ana.getByText('SENT')).toBeVisible()
    await expect(ana.getByText('to @marko')).toBeVisible()
    await expect(ana.getByText('0.17 BCPS · paid by you')).toBeVisible()
    await expect(ana.getByText(/^BC-[0-9A-Z]{6}$/)).toBeVisible()
    await expectBalance(page, 'marko', '149.48')
    await expect(page.getByTestId('tape-row')).toHaveCount(1)
    await expect(page.getByTestId('tape-row').first()).toContainText('@ana → @marko · 16.50 BCPS · settled · fee 0.17')

    // Marko's phone: the banner and the bell.
    await expect(marko.getByTestId('banner')).toContainText('@ana sent you 16.50 BCPS · Cinema')
    await expect(marko.getByTestId('bell-count')).toHaveText('1')
    await ana.getByRole('button', { name: 'Done' }).click()
    await expect(ana.locator('[data-screen="c.home"]')).toBeVisible()
    await expectBalance(page, 'ana', '230.83')
    await expectCleanVisibleCopy(page)
  })

  test('a double tap or a second Enter before the review stops on the review; nothing is sent', async ({ page }) => {
    await anaAndMarko(page)
    await toAmount(page)
    const ana = slot(page, 'left')
    await type(page, '16.50')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByRole('button', { name: 'Cinema', exact: true }).click()
    // The second tap lands where [Send 16.67 BCPS] now sits.
    await ana.getByRole('button', { name: 'Continue' }).dblclick()
    const review = ana.locator('[data-screen="c.send.review"]')
    await expect(review).toBeVisible()
    await page.waitForTimeout(1600)
    await expect(review).toBeVisible()
    await expect(ana.getByRole('button', { name: 'Send 16.67 BCPS' })).toBeEnabled()
    await expect(page.getByTestId('tape-row')).toHaveCount(0)

    // By keyboard: Enter on Continue opens the review and takes the focus to it; Enter again sends nothing.
    await ana.getByTestId('nav-back').click()
    await expect(ana.locator('[data-screen="c.send.note"]')).toBeVisible()
    const next = ana.getByRole('button', { name: 'Continue' })
    await expect(next).toBeEnabled()
    await next.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(review).toBeVisible()
    await expect(review).toBeFocused()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1600)
    await expect(review).toBeVisible()
    await expect(page.getByTestId('tape-row')).toHaveCount(0)
    await expectBalance(page, 'marko', '132.98')
  })

  test('Max fills 245.05 from a fresh start; the total is the whole balance', async ({ page }) => {
    await anaAndMarko(page)
    await toAmount(page)
    const ana = slot(page, 'left')
    await ana.getByTestId('amount-max').click()
    await expect(ana.getByTestId('amount-value')).toContainText('245.05')
    await expect(ana.getByRole('button', { name: 'Continue' })).toBeEnabled()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByRole('button', { name: 'Skip' }).click()
    await expect(ana.getByTestId('review-total')).toContainText('247.50')
    await expect(ana.getByTestId('balance-after')).toHaveText('Balance after 0.00 BCPS')
    await expect(ana.getByText('No note')).toBeVisible()
  })

  test('over the balance, an unknown handle and yourself: the words of the errors, Continue off', async ({ page }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('row-send').click()
    await ana.getByTestId('party-search').fill('@anaa')
    await expect(ana.getByTestId('error-line')).toHaveText("No BCPS user '@anaa'. Check the spelling.")
    await expect(ana.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await ana.getByTestId('party-search').fill('@ana')
    await expect(ana.getByTestId('error-line')).toHaveText("You can't pay yourself.")
    await ana.getByTestId('party-search').fill('@marko')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await type(page, '300')
    await expect(ana.getByTestId('error-line')).toContainText('You have 247.50 BCPS. Top up')
    await expect(ana.getByTestId('error-line')).toContainText('BCPS to pay.')
    await expect(ana.getByRole('button', { name: 'Continue' })).toBeDisabled()
    // The dock offers Top up with the shortfall in whole euros: 300.00 + 3.00 fee − 247.50 = 55.50 BCPS ≈ €50.45, so €51.
    await expect(ana.getByRole('button', { name: 'Top up' })).toHaveCount(1)
    await ana.getByRole('button', { name: 'Top up' }).click()
    await expect(ana.locator('[data-screen="shared.topup.amount"]')).toBeVisible()
    await expect(ana.getByTestId('amount-value')).toHaveText('€51')
    await expect(ana.getByTestId('top-up-get')).toHaveText('You get 56.10 BCPS')
    // It replaced the Send flow and kept the screens below it: Back lands on Pay & request.
    await ana.getByTestId('nav-back').click()
    await expect(ana.locator('[data-screen="c.payRequest.hub"]')).toBeVisible()
    await ana.getByTestId('row-send').click()
    await ana.getByTestId('party-search').fill('@marko')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await type(page, '300')
    // The keypad stops at the account's limit: 999.99.
    for (let i = 0; i < 3; i++) await ana.locator('[data-key="del"]').click()
    await type(page, '9999')
    await expect(ana.getByTestId('amount-value')).toContainText('999')
    await expect(ana.getByTestId('amount-value')).not.toContainText('9999')
  })

  test('Back goes one step, Edit opens a step whose button reads "Back to review"', async ({ page }) => {
    await anaAndMarko(page)
    await toAmount(page)
    const ana = slot(page, 'left')
    await type(page, '5')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await expect(ana.locator('[data-screen="c.send.review"]')).toBeVisible()
    await ana.getByTestId('edit-Amount').click()
    await expect(ana.locator('[data-screen="c.send.amount"]')).toBeVisible()
    await expect(ana.getByRole('button', { name: 'Back to review' })).toBeVisible()
    await type(page, '.5')
    await ana.getByRole('button', { name: 'Back to review' }).click()
    await expect(ana.getByTestId('review-total')).toContainText('5.56')
    await ana.getByTestId('nav-back').click()
    await expect(ana.locator('[data-screen="c.send.note"]')).toBeVisible()
    await ana.getByTestId('nav-back').click()
    await expect(ana.locator('[data-screen="c.send.amount"]')).toBeVisible()
    await ana.getByTestId('nav-back').click()
    await expect(ana.locator('[data-screen="c.send.to"]')).toBeVisible()
    await ana.getByTestId('nav-back').click()
    await expect(ana.locator('[data-screen="c.payRequest.hub"]')).toBeVisible()
  })

  test('History, the payment detail with Send again, and Marko’s notification', async ({ page }) => {
    await anaAndMarko(page)
    await toAmount(page)
    const ana = slot(page, 'left')
    const marko = slot(page, 'right')
    await type(page, '16.50')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByRole('button', { name: 'Cinema', exact: true }).click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByRole('button', { name: 'Send 16.67 BCPS' }).click()
    await expect(ana.locator('[data-screen="c.send.success"]')).toBeVisible({ timeout: 5000 })
    await ana.getByRole('button', { name: 'Done' }).click()

    // History: Today first, then Yesterday and the dated days.
    await ana.locator('[data-tile="history"]').click()
    await expect(ana.locator('[data-screen="c.history"]')).toBeVisible()
    const headings = await ana.locator('[data-screen="c.history"] h2').allInnerTexts()
    expect(headings.slice(0, 3)).toEqual(['TODAY', 'YESTERDAY', 'WED 23 SEP'])
    const first = ana.locator('[data-screen="c.history"] button[data-testid^="tx-BC-"]').first()
    await expect(first).toContainText('@marko · Cinema')
    await expect(first).toContainText('−16.50')
    await first.click()

    // The detail.
    const detail = ana.locator('[data-screen="shared.tx"]')
    await expect(detail).toBeVisible()
    await expect(detail).toContainText('−16.50')
    await expect(detail).toContainText('to @marko · ≈ €15.00')
    await expect(detail).toContainText('Sent')
    await expect(detail).toContainText('Settled')
    await expect(detail).toContainText('Ana Novak · @ana')
    await expect(detail).toContainText('Marko Kovač · @marko')
    await expect(detail).toContainText('Cinema')
    await expect(detail).toContainText('0.17 BCPS (≈ €0.15)')
    await expect(detail).toContainText('paid by you')
    await expect(detail).toContainText('€1 ≈ 1.10 BCPS')
    await expect(detail).toContainText('Only you and Marko see these details.')
    await expect(detail.getByRole('button', { name: 'Split this bill' })).toBeVisible()
    await detail.getByRole('button', { name: '✓ Verified' }).click()
    await expect(detail.getByText('Verified identity')).toBeVisible()

    // Send again: filled in, straight on Review; Back leaves the flow.
    await ana.getByRole('button', { name: 'Send again' }).click()
    await expect(ana.locator('[data-screen="c.send.review"]')).toBeVisible()
    await expect(ana.getByTestId('review-total')).toContainText('16.67')
    await expect(ana.getByText('Cinema', { exact: true })).toBeVisible()
    await expect(ana.getByText(/Step \d of 4/)).toHaveCount(0)
    await ana.getByTestId('nav-back').click()
    await expect(ana.locator('[data-screen="shared.tx"]')).toBeVisible()

    // Marko: the bell has one, the list opens the payment and marks it read.
    await marko.getByTestId('bell').click()
    await expect(marko.locator('[data-screen="shared.notifications"]')).toBeVisible()
    const row = marko.locator('[data-testid^="notification-tx:BC-"]')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('@ana sent you 16.50 BCPS')
    await expect(row).toContainText('Cinema')
    await expect(row).toHaveAttribute('data-unread', 'true')
    await row.click()
    const mdetail = marko.locator('[data-screen="shared.tx"]')
    await expect(mdetail).toContainText('+16.50')
    await expect(mdetail).toContainText('from @ana · ≈ €15.00')
    await expect(mdetail).toContainText('Only you and Ana see these details.')
    await expect(mdetail.getByRole('button', { name: 'Send again' })).toHaveCount(0)
    await marko.getByTestId('nav-back').click()
    await expect(row).not.toHaveAttribute('data-unread', 'true')
    await marko.getByTestId('nav-home').click()
    await expect(marko.getByTestId('bell-count')).toHaveCount(0)
  })
})

test.describe('the empty lists', () => {
  test.use({ viewport: { width: 390, height: 664 } })

  test('Notifications with nothing new: "You\'re all caught up."', async ({ page }) => {
    await openApp(page, '#/phone/marko')
    await page.getByTestId('bell').click()
    await expect(page.locator('[data-screen="shared.notifications"]')).toBeVisible()
    await expect(page.getByText("You're all caught up.")).toBeVisible()
    await expect(page.getByText('New payments and requests appear here.')).toBeVisible()
    await expect(page.getByTestId('mark-all-read')).toHaveCount(0)
  })

  test('History from a fresh start: the waiting Lunch request under Today, then Yesterday; a row opens its payment', async ({
    page,
  }) => {
    await openApp(page, '#/phone/ana')
    await page.locator('[data-tile="history"]').click()
    const days = page.locator('[data-screen="c.history"] h2')
    await expect(days.nth(0)).toHaveText('TODAY')
    await expect(days.nth(1)).toHaveText('YESTERDAY')
    await expect(page.getByTestId('status-r_seed_lunch')).toContainText('WAITING')
    await page
      .getByTestId(/^tx-BC-/)
      .first()
      .click()
    await expect(page.locator('[data-screen="shared.tx"]')).toContainText('−26.40')
    await expect(page.locator('[data-screen="shared.tx"]')).toContainText('Refunds are merchant-initiated.')
  })
})
