// Payment link: make one, see its code, copy it, show it full screen, send it to one person, share
// it again; the person pays it and the owner sees it paid.
import { expect, test } from '@playwright/test'
import { anaAndMarko, expectBalance, expectCleanVisibleCopy, slot, typeAmount } from './helpers'

test.describe('payment link on the stage', () => {
  test.use({ viewport: { width: 1280, height: 720 }, permissions: ['clipboard-read', 'clipboard-write'] })

  test('Ana makes 13.20 "Pizza", copies it, shows the code, sends it to Marko, who pays 13.33', async ({ page }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    const marko = slot(page, 'right')
    await ana.locator('[data-tile="payRequest"]').click()
    await expect(ana.getByTestId('row-paymentLink')).toContainText('Payment link')
    await ana.getByTestId('row-paymentLink').click()

    // How much, what for, check.
    await expect(ana.locator('[data-screen="c.link.amount"]')).toBeVisible()
    await expect(ana.getByText('Step 1 of 3')).toBeVisible()
    await expect(ana.getByTestId('amount-hint')).toHaveText('The payer sees this amount')
    await typeAmount(ana, '13.20')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await expect(ana.locator('[data-screen="c.link.note"]')).toBeVisible()
    await expect(ana.getByText('Everyone who opens the link sees this note.')).toBeVisible()
    await ana.getByRole('button', { name: 'Pizza', exact: true }).click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    const review = ana.locator('[data-screen="c.link.review"]')
    await expect(review).toBeVisible()
    await expect(ana.getByText('Step 3 of 3')).toBeVisible()
    await expect(review).toContainText('13.20 BCPS')
    await expect(review).toContainText('Pizza')
    await expect(review).toContainText('One person · single use')
    await expect(review).toContainText('Paid by the payer')
    await expect(review).not.toContainText('Expires')
    await ana.getByRole('button', { name: 'Create link' }).click()

    // Link ready: the code, the amount, the note, the reference; never the address.
    const ready = ana.locator('[data-screen="c.link.ready"]')
    await expect(ready).toBeVisible()
    await expect(ready).toContainText('LINK READY')
    await expect(ready).toContainText('13.20')
    await expect(ready).toContainText('Pizza')
    await expect(ready).toContainText('Reference L-000001')
    await expect(ready.getByRole('img', { name: 'bcps link · 13.20 BCPS · Pizza' })).toBeVisible()
    expect(await ready.innerText()).not.toMatch(/https?:|#\/pay|github/)
    await ana.getByTestId('copy-link').click()
    await expect(ana.getByTestId('copy-link')).toContainText('Link copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
      /#\/pay\?v=1&to=@ana&amount=13\.20&link=L-000001$/,
    )

    // Show QR, and back.
    await ana.getByTestId('show-qr').click()
    await expect(ana.locator('[data-screen="c.link.qr"]')).toBeVisible()
    await expect(ana.getByTestId('qr-large')).toBeVisible()
    await ana.getByTestId('nav-back').click()
    await expect(ready).toBeVisible()

    // Send in BCPS: one person.
    await ana.getByRole('button', { name: 'Send in BCPS' }).click()
    await expect(ana.locator('[data-screen="c.link.to"]')).toBeVisible()
    await ana.getByTestId('party-search').fill('@cafelipa')
    await expect(ana.getByTestId('error-line')).toHaveText('Payment links go to people.')
    await ana.getByTestId('party-search').fill('@marko')
    await ana.getByRole('button', { name: 'Send link' }).click()
    const sent = ana.locator('[data-screen="c.link.shared"]')
    await expect(sent).toContainText('Link sent')
    await expect(sent).toContainText('To @marko')
    await expect(marko.getByTestId('banner')).toContainText('@ana sent you a payment link · 13.20 BCPS · Pizza')
    await ana.getByRole('button', { name: 'Done' }).click()

    // Marko: the banner opens the check; Pay 13.33.
    await marko.getByTestId('banner').click()
    const check = marko.locator('[data-screen="c.payItem.review"]')
    await expect(check).toBeVisible()
    await expect(check.getByRole('heading', { name: 'Pay @ana?' })).toBeVisible()
    await expect(marko.getByRole('button', { name: 'Decline' })).toHaveCount(0)
    await expect(marko.getByText('Ana sent you this link today at 12:15.')).toBeVisible()
    await marko.getByRole('button', { name: 'Pay 13.33' }).click()
    await expect(marko.locator('[data-screen="c.payItem.success"]')).toBeVisible({ timeout: 5000 })
    await marko.getByRole('button', { name: 'Done' }).click()
    await expectBalance(page, 'marko', '119.65')

    // Ana: the link is paid.
    await expect(ana.getByTestId('banner')).toContainText('@marko paid your link · 13.20 BCPS · Pizza')
    await ana.getByTestId('banner').click()
    await ana.getByTestId('nav-home').click()
    await expectBalance(page, 'ana', '260.70')
    await ana.locator('[data-tile="payRequest"]').click()
    await expect(ana.getByTestId('waiting')).toContainText('PAID')
    await ana.getByTestId('waiting-L-000001').click()
    const detail = ana.locator('[data-screen="c.link.detail"]')
    await expect(detail.getByTestId('status-chip')).toHaveText('Paid by @marko ✓')
    await expect(detail).toContainText('Single use: the link closed after Marko paid.')
    await expect(detail.getByRole('button', { name: /Share again|Send in BCPS/ })).toHaveCount(0)
    await expectCleanVisibleCopy(page)
  })

  test('a link that waits can be sent again; Done leaves it waiting', async ({ page }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    const marko = slot(page, 'right')
    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('row-paymentLink').click()
    await typeAmount(ana, '5.50')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByRole('button', { name: 'Skip' }).click()
    await ana.getByRole('button', { name: 'Create link' }).click()
    await ana.getByRole('button', { name: 'Done' }).click()
    await expect(ana.locator('[data-screen="c.home"]')).toBeVisible()

    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('waiting-L-000001').click()
    const detail = ana.locator('[data-screen="c.link.detail"]')
    await expect(detail.getByTestId('status-chip')).toHaveText('Waiting')
    await expect(detail).not.toContainText('expires')
    await expect(detail).toContainText('Single use: one person can pay this link.')
    // Not sent yet: the button says so; once sent it reads Share again.
    await detail.getByRole('button', { name: 'Send in BCPS' }).click()
    await expect(ana.locator('[data-screen="c.link.to"]')).toBeVisible()
    await ana.getByTestId('party-search').fill('@marko')
    await ana.getByRole('button', { name: 'Send link' }).click()
    await expect(ana.locator('[data-screen="c.link.shared"]')).toBeVisible()
    await expect(marko.locator('[data-tile="payRequest"]')).toContainText('1 to pay')
    await ana.getByRole('button', { name: 'Done' }).click()

    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('waiting-L-000001').click()
    await expect(detail).toContainText('Marko Kovač · @marko')
    await expect(detail).toContainText('Sent to')
    await detail.getByRole('button', { name: 'Share again' }).click()
    await ana.getByTestId('party-search').fill('@marko')
    await ana.getByRole('button', { name: 'Send link' }).click()
    await expect(ana.getByTestId('error-line')).toHaveText('This was already shared.')
    await ana.getByTestId('nav-back').click()
    await expect(detail).toBeVisible()
  })
})
