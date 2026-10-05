// Scan beyond the café's payment code: the counter code (the payer enters the amount), several codes
// nearby in phone mode, a personal code, a payment link on the other phone, and My code itself.
import { expect, test } from '@playwright/test'
import {
  anaAndMarko,
  expectBalance,
  expectCleanVisibleCopy,
  expectNoSeriousViolations,
  openApp,
  slot,
  typeAmount,
} from './helpers'

/** The café's own setting, as the café would change it (its screen comes with the café's tools). */
async function setFeePayer(page: import('@playwright/test').Page, feePayer: 'recipient' | 'sender') {
  const ok = await page.evaluate(
    (payer) =>
      (window as unknown as { __bcps: { dispatch(c: unknown): { ok: boolean } } }).__bcps.dispatch({
        type: 'merchant.settings',
        actor: 'cafe',
        cmdId: 'f1f1f1f1f1f1f1f1:t',
        patch: { feePayer: payer },
      }).ok,
    feePayer,
  )
  expect(ok).toBe(true)
}

test.describe('the counter code in phone mode', () => {
  test.use({ viewport: { width: 390, height: 664 } })

  test('Scan locks onto the counter code; 3.30 is paid with the café’s fee: café +3.27', async ({ page }) => {
    await openApp(page, '#/phone/ana')
    await page.locator('[data-tile="scan"]').click()
    await expect(page.getByTestId('scan-status')).toHaveText('Locked · Café Lipa ✓')
    await expect(page.locator('[data-screen="c.scan"]')).toContainText('Counter code · You enter the amount')
    await page.getByRole('button', { name: 'Continue' }).click()

    const amount = page.locator('[data-screen="c.scan.counterAmount"]')
    await expect(amount).toBeVisible()
    await expect(page.getByTestId('nav-back')).toBeVisible()
    await expect(amount.getByRole('heading', { name: 'How much?' })).toBeVisible()
    await expect(page.getByTestId('counter-tag')).toHaveText('Counter code · Café Lipa ✓')
    await expect(amount).toContainText('Available 247.50 BCPS')
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()
    // The keypad fits the phone, and a figure that is too big is told so.
    await typeAmount(amount, '999')
    await expect(page.getByTestId('error-line')).toContainText('You have 247.50 BCPS. Top up')
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()
    for (let i = 0; i < 3; i++) await amount.locator('[data-key="del"]').click()
    await typeAmount(amount, '3.30')
    await expect(page.getByTestId('amount-value')).toContainText('3.30')
    await page.getByRole('button', { name: 'Continue' }).click()

    const review = page.locator('[data-screen="c.payCode.review"]')
    await expect(review).toBeVisible()
    await expect(review).toContainText('Café Lipa')
    await expect(review).toContainText('3.30 BCPS')
    await expect(page.getByTestId('fee-line')).toContainText(
      'Transaction fee 1% · 0.03 BCPS (≈ €0.03) · paid by Café Lipa',
    )
    await expect(page.getByTestId('review-total')).toContainText('3.30')
    await expect(page.getByTestId('balance-after')).toContainText('244.20 BCPS')
    // Edit opens the amount; its button reads "Back to review".
    await page.getByTestId('edit-Amount').click()
    await expect(amount).toBeVisible()
    await page.getByRole('button', { name: 'Back to review' }).click()
    await expect(review).toBeVisible()
    await page.getByRole('button', { name: 'Pay 3.30 BCPS' }).dblclick()
    const done = page.locator('[data-screen="c.payCode.success"]')
    await expect(done).toBeVisible({ timeout: 5000 })
    await expect(done).toContainText('to Café Lipa')
    await expect(done).toContainText('0.03 BCPS · paid by Café Lipa')
    await done.getByRole('button', { name: 'Done' }).click()
    await expectBalance(page, 'ana', '244.20')
    // The café received 3.27: 286.00 + 3.30 − 0.03.
    await page.getByTestId('pill').click()
    await page.getByTestId('account-cafe').click()
    await expectBalance(page, 'cafe', '289.27')
  })

  test('the café changed who pays the fee while the check was open: "The amount changed." with the new total', async ({
    page,
  }) => {
    await openApp(page, '#/phone/ana')
    await page.locator('[data-tile="scan"]').click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await typeAmount(page.locator('[data-screen="c.scan.counterAmount"]'), '3.30')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('button', { name: 'Pay 3.30 BCPS' })).toBeVisible()
    await setFeePayer(page, 'sender')
    await page.getByRole('button', { name: 'Pay 3.30 BCPS' }).click()
    await expect(page.getByTestId('error-line')).toHaveText('The amount changed. Check it and try again.')
    await expect(page.getByRole('button', { name: 'Pay 3.33 BCPS' })).toBeVisible()
    await expect(page.getByTestId('fee-line')).toContainText('paid by you')
    await expect(page.getByTestId('review-total')).toContainText('3.33')
    await page.getByRole('button', { name: 'Pay 3.33 BCPS' }).click()
    await expect(page.locator('[data-screen="c.payCode.success"]')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: 'Done' }).click()
    await expectBalance(page, 'ana', '244.17')
  })

  test('2 codes nearby: the counter first, then the open code; a tap chooses, Back returns to the list', async ({
    page,
  }) => {
    await openApp(page, '#/phone/cafe')
    const cafe = slot(page, 'single')
    await cafe.locator('[data-tile="charge"]').click()
    for (const sku of ['flat-white', 'flat-white', 'croissant', 'croissant'])
      await cafe.getByTestId(`item-${sku}`).click()
    await cafe.getByRole('button', { name: 'Charge 11.00 BCPS' }).click()
    await expect(cafe.locator('[data-screen="pos.code"]')).toBeVisible()
    await page.evaluate(() => {
      location.hash = '#/phone/ana'
    })
    await expect(page.locator('[data-screen="c.home"]')).toBeVisible()
    await page.locator('[data-tile="scan"]').click()
    await expect(page.getByTestId('scan-status')).toHaveText('2 codes nearby')
    await page.getByRole('button', { name: 'Continue' }).click()
    const list = page.locator('[data-screen="c.scan.nearby"]')
    await expect(list).toBeVisible()
    await expect(page.getByRole('heading', { name: '2 codes nearby' })).toBeVisible()
    await expect(page.getByTestId('nav-back')).toBeVisible()
    await expect(page.getByTestId('codes-nearby').locator('li')).toHaveCount(2)
    await expect(page.getByTestId('codes-nearby').locator('li').first()).toContainText('Café Lipa · Counter')
    await expect(page.getByTestId('codes-nearby').locator('li').first()).toContainText('You enter the amount')
    const table = page.getByTestId('code-pos')
    await expect(table).toContainText('Café Lipa · Table 4')
    await expect(table).toContainText('2 × flat white · 2 × croissant')
    await expect(table).toContainText('11.00')
    // No sentence about how near the codes are.
    await expect(list).not.toContainText('metres')
    await expectNoSeriousViolations(page, 'codes nearby', '[data-screen="c.scan.nearby"]')
    // The counter: its amount screen, and Back returns to the list.
    await page.getByTestId('code-counter').click()
    await expect(page.locator('[data-screen="c.scan.counterAmount"]')).toBeVisible()
    await page.getByTestId('nav-back').click()
    await expect(list).toBeVisible()
    // The open code: the check of the sale, 11.00, the café pays the fee.
    await table.click()
    const review = page.locator('[data-screen="c.payCode.review"]')
    await expect(review).toBeVisible()
    await expect(page.getByTestId('review-total')).toContainText('11.00')
    await expect(review).toContainText('2 × flat white · 2 × croissant')
    await page.getByRole('button', { name: 'Pay 11.00 BCPS' }).click()
    await expect(page.locator('[data-screen="c.payCode.success"]')).toBeVisible({ timeout: 5000 })
  })

  test('My code in phone mode: the code, @ana, Copy @ana, Share payment link; Wallet opens it', async ({ page }) => {
    await openApp(page, '#/phone/ana')
    await context(page).grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.locator('[data-tile="wallet"]').click()
    await expect(page.locator('[data-screen="c.wallet.hub"]')).toBeVisible()
    await expect(page.getByTestId('row-myCode')).toContainText('My code')
    await page.getByTestId('row-myCode').click()
    const code = page.locator('[data-screen="c.mycode"]')
    await expect(code).toBeVisible()
    await expect(page.getByTestId('my-handle')).toHaveText('@ana')
    await expect(code).toContainText('Ana Novak')
    await expect(code.getByRole('img', { name: 'Payment code of @ana' })).toBeVisible()
    expect(await code.innerText()).not.toMatch(/https?:|#\/pay|github/)
    await page.getByRole('button', { name: 'Copy @ana' }).click()
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('@ana')
    await page.getByRole('button', { name: 'Share payment link' }).click()
    await expect(page.locator('[data-screen="c.link.amount"]')).toBeVisible()
    await page.getByTestId('nav-back').click()
    await expect(code).toBeVisible()
    await expectCleanVisibleCopy(page)
  })
})

function context(page: import('@playwright/test').Page) {
  return page.context()
}

test.describe('what the other phone shows, on the stage', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('Ana shows My code: Marko’s Scan locks onto it and Continue opens Send for @ana, on the amount', async ({
    page,
  }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    const marko = slot(page, 'right')
    // Nothing to point at yet.
    await marko.locator('[data-tile="scan"]').click()
    await expect(marko.getByTestId('scan-status')).toHaveText('No payment code in view')
    await marko.getByTestId('nav-back').click()
    await ana.locator('[data-tile="wallet"]').click()
    await ana.getByTestId('row-myCode').click()
    await expect(ana.locator('[data-screen="c.mycode"]')).toBeVisible()
    await marko.locator('[data-tile="scan"]').click()
    await expect(marko.getByTestId('scan-status')).toHaveText('Locked · Ana Novak ✓')
    await expect(marko.locator('[data-screen="c.scan"]')).toContainText('Personal code · @ana')
    await marko.getByRole('button', { name: 'Continue' }).click()
    const amount = marko.locator('[data-screen="c.send.amount"]')
    await expect(amount).toBeVisible()
    await expect(marko.getByTestId('amount-value')).toHaveText(/^0\s*BCPS$/)
    await typeAmount(marko, '5')
    await marko.getByRole('button', { name: 'Continue' }).click()
    await marko.getByRole('button', { name: 'Skip' }).click()
    const review = marko.locator('[data-screen="c.send.review"]')
    await expect(review).toContainText('@ana')
    await expect(review).toContainText('Ana Novak')
    // Back from the first step the flow was opened on leaves it.
    await marko.getByTestId('nav-back').click()
    await marko.getByTestId('nav-back').click()
    await marko.getByTestId('nav-back').click()
    await expect(marko.locator('[data-screen="c.home"]')).toBeVisible()
  })

  test('Ana shows her payment link’s code: Marko’s Scan locks onto it and opens the check; he pays 13.33', async ({
    page,
  }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    const marko = slot(page, 'right')
    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('row-paymentLink').click()
    await typeAmount(ana, '13.20')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByRole('button', { name: 'Pizza', exact: true }).click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByRole('button', { name: 'Create link' }).click()
    await ana.getByTestId('show-qr').click()
    await marko.locator('[data-tile="scan"]').click()
    await expect(marko.getByTestId('scan-status')).toHaveText('Locked · Ana Novak ✓')
    await expect(marko.locator('[data-screen="c.scan"]')).toContainText('Payment link · 13.20 BCPS')
    await marko.getByRole('button', { name: 'Continue' }).click()
    const review = marko.locator('[data-screen="c.payItem.review"]')
    await expect(review).toBeVisible()
    await expect(marko.getByTestId('review-total')).toContainText('13.33 BCPS')
    await marko.getByRole('button', { name: 'Pay 13.33' }).click()
    await expect(marko.locator('[data-screen="c.payItem.success"]')).toBeVisible({ timeout: 5000 })
    await marko.getByRole('button', { name: 'Done' }).click()
    await ana.getByTestId('nav-back').click()
    await ana.getByTestId('nav-home').click()
    await expectBalance(page, 'ana', '260.70')
    await expectBalance(page, 'marko', '119.65')
  })

  test('on the stage the counter code is not listed: only what the phone beside shows', async ({ page }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    await ana.locator('[data-tile="scan"]').click()
    await expect(ana.getByTestId('scan-status')).toHaveText('No payment code in view')
    await expect(ana.getByRole('button', { name: 'Continue' })).toHaveCount(0)
  })
})
