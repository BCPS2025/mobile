// The café's Settings: who pays the fee on sales (and what it does to the next code), auto-convert,
// the payout account, Biometrics, and the integrations (one of them PLANNED).
import { expect, test } from '@playwright/test'
import { anaScansToReview, expectBalance, expectNoSeriousViolations, openApp, slot, stageBoth } from './helpers'

type Locator = import('@playwright/test').Locator

test.use({ viewport: { width: 1280, height: 720 } })

async function openSettings(cafe: Locator) {
  await cafe.getByTestId('avatar').click()
  await expect(cafe.locator('[data-screen="biz.settings"]')).toBeVisible()
}

/** Settings › Who pays the fee on sales › the choice › Save › Done. */
async function chooseFeePayer(cafe: Locator, who: 'recipient' | 'sender') {
  await openSettings(cafe)
  await cafe.getByTestId('row-feePayer').click()
  await expect(cafe.locator('[data-screen="biz.feePayer"]')).toBeVisible()
  await cafe.getByTestId(`fee-payer-${who}`).click()
  await cafe.getByRole('button', { name: 'Save' }).click()
  await expect(cafe.locator('[data-screen="biz.feePayer.saved"]')).toBeVisible()
  await cafe.getByRole('button', { name: 'Done' }).click()
  await expect(cafe.locator('[data-screen="pos.home"]')).toBeVisible()
}

async function showCode(cafe: Locator, skus: string[], label: string) {
  await cafe.locator('[data-tile="charge"]').click()
  for (const sku of skus) await cafe.getByTestId(`item-${sku}`).click()
  await cafe.getByRole('button', { name: label }).click()
  await expect(cafe.locator('[data-screen="pos.code"]')).toBeVisible()
}

test.describe('Settings', () => {
  test('SALES & PAYOUTS, INTEGRATIONS, About and Log out; one PLANNED', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await openSettings(cafe)
    const settings = cafe.locator('[data-screen="biz.settings"]')
    await expect(settings).toContainText('SALES & PAYOUTS')
    await expect(cafe.getByTestId('row-feePayer')).toContainText('Who pays the fee on sales')
    await expect(cafe.getByTestId('row-feePayer')).toContainText('You pay')
    await expect(cafe.getByTestId('row-autoConvert')).toContainText('On · 50% · 23:00')
    await expect(cafe.getByTestId('info-payoutAccount')).toContainText('SI56 •••• •••• 1934')
    await expect(cafe.getByTestId('biometrics-switch')).toHaveAttribute('aria-checked', 'true')
    await expect(settings).toContainText('INTEGRATIONS')
    await expect(cafe.getByTestId('integration-webApi')).toContainText('Web API ✓')
    await expect(cafe.getByTestId('integration-paymentLinks')).toContainText('Payment links ✓')
    await expect(cafe.getByTestId('integration-ecommercePlugins')).toContainText('E-commerce plugins')
    await expect(cafe.getByTestId('integration-ecommercePlugins')).toContainText('PLANNED')
    await expect(settings.getByText('PLANNED')).toHaveCount(1)
    await expect(cafe.getByRole('button', { name: 'About BCPS' })).toBeVisible()
    await expect(cafe.getByRole('button', { name: 'Log out' })).toBeVisible()
    // The Roadmap arrives later: no row for it yet.
    await expect(settings).not.toContainText('Roadmap')
    await page.waitForTimeout(600)
    await expectNoSeriousViolations(page, 'Settings')
    // Auto-convert opens its first step from here too.
    await cafe.getByTestId('row-autoConvert').click()
    await expect(cafe.locator('[data-screen="biz.autoconvert.onoff"]')).toBeVisible()
  })

  test('Biometrics off: after Log out the Welcome screen offers the code only', async ({ page }) => {
    await openApp(page, '#/phone/cafe')
    const phone = slot(page, 'single')
    await phone.getByTestId('avatar').click()
    await phone.getByTestId('biometrics-switch').click()
    await expect(phone.getByTestId('biometrics-switch')).toHaveAttribute('aria-checked', 'false')
    await phone.getByRole('button', { name: 'Log out' }).click()
    await phone.getByTestId('dock-primary').click()
    await expect(phone.locator('[data-screen="auth.welcome"]')).toBeVisible()
    await expect(phone.getByRole('button', { name: 'Log in' })).toBeVisible()
    await expect(phone.getByRole('button', { name: 'Log in with biometrics' })).toHaveCount(0)
    // Choosing the café on the Log in screen offers only Continue as well.
    await phone.getByRole('button', { name: 'Log in', exact: true }).click()
    await phone.getByTestId('login-cafe').click()
    await expect(phone.getByRole('button', { name: 'Continue' })).toBeVisible()
    await expect(phone.getByRole('button', { name: 'Log in with biometrics' })).toHaveCount(0)
  })
})

test.describe('Who pays the fee on sales', () => {
  test('two choices with what an 11.00 sale comes to; Save shows Saved and the list reads Customer pays', async ({
    page,
  }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await openSettings(cafe)
    await cafe.getByTestId('row-feePayer').click()
    const screen = cafe.locator('[data-screen="biz.feePayer"]')
    await expect(screen).toContainText('Who pays the fee on sales?')
    await expect(cafe.getByTestId('fee-payer-recipient')).toContainText('You pay')
    await expect(cafe.getByTestId('fee-payer-recipient')).toContainText(
      'On an 11.00 sale: customer pays 11.00 · you receive 10.89',
    )
    await expect(cafe.getByTestId('fee-payer-sender')).toContainText('Customer pays')
    await expect(cafe.getByTestId('fee-payer-sender')).toContainText(
      'On an 11.00 sale: customer pays 11.11 · you receive 11.00',
    )
    await expect(screen).toContainText('The fee is 1% of each sale.')
    await expect(cafe.getByLabel('You pay')).toBeChecked()
    await page.waitForTimeout(600)
    await expectNoSeriousViolations(page, 'Settings · Who pays the fee')
    await cafe.getByTestId('fee-payer-sender').click()
    await cafe.getByRole('button', { name: 'Save' }).click()
    const saved = cafe.locator('[data-screen="biz.feePayer.saved"]')
    await expect(saved).toContainText('Saved')
    await cafe.getByRole('button', { name: 'Done' }).click()
    await openSettings(cafe)
    await expect(cafe.getByTestId('row-feePayer')).toContainText('Customer pays')
  })

  test('Customer pays: a Brunch 13.20 code reviews with 0.13 paid by Ana, total 13.33; the café receives 13.20', async ({
    page,
  }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    const ana = slot(page, 'left')
    await chooseFeePayer(cafe, 'sender')
    await showCode(cafe, ['brunch'], 'Charge 13.20 BCPS')
    await anaScansToReview(page)
    await expect(ana.getByTestId('fee-line')).toContainText('Transaction fee 1% · 0.13 BCPS (≈ €0.12) · paid by you')
    await expect(ana.getByTestId('review-total')).toContainText('13.33')
    await ana.getByRole('button', { name: 'Pay 13.33 BCPS' }).click()
    await expect(ana.locator('[data-screen="c.payCode.success"]')).toBeVisible({ timeout: 5000 })
    await expect(cafe.locator('[data-screen="pos.paid"]')).toBeVisible({ timeout: 5000 })
    await cafe.getByTestId('nav-home').click()
    await expectBalance(page, 'cafe', '299.20')
  })

  test('Customer pays: an 11.00 code puts 11.11 on the button, with the fee paid by Ana', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    const ana = slot(page, 'left')
    await chooseFeePayer(cafe, 'sender')
    await showCode(cafe, ['flat-white', 'flat-white', 'croissant', 'croissant'], 'Charge 11.00 BCPS')
    await anaScansToReview(page)
    await expect(ana.getByRole('button', { name: 'Pay 11.11 BCPS' })).toBeVisible()
    await expect(ana.getByTestId('fee-line')).toContainText('paid by you')
  })

  test('a code that was already open keeps its payer when the setting changes', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    const ana = slot(page, 'left')
    await showCode(cafe, ['flat-white', 'flat-white', 'croissant', 'croissant'], 'Charge 11.00 BCPS')
    await page.evaluate(() => {
      const hook = (window as unknown as { __bcps: { dispatch(c: unknown): { ok: boolean } } }).__bcps
      hook.dispatch({
        type: 'merchant.settings',
        actor: 'cafe',
        cmdId: '00000000000e2e40:save',
        patch: { feePayer: 'sender' },
      })
    })
    await anaScansToReview(page)
    await expect(ana.getByTestId('fee-line')).toContainText('paid by Café Lipa')
    await expect(ana.getByRole('button', { name: 'Pay 11.00 BCPS' })).toBeVisible()
  })
})
