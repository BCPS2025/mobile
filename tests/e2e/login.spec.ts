// Log in (D19): Welcome › Log in (the accounts, then the masked email typed into a read-only
// display) › Enter the code (the Mail chip fills six display boxes) › Verify and log in › Home.
// Codes rotate with every login and every "Send again"; the same account is never on both phones;
// there is no field for the email or the code anywhere.
import { expect, test } from '@playwright/test'
import { expectCleanVisibleCopy, openApp, slot } from './helpers'

test.describe('login on the stage @webkit', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('Ana on the left and the café on the right, by choosing an account and entering the code', async ({ page }) => {
    await openApp(page, '#/stage')
    const left = slot(page, 'left')
    const right = slot(page, 'right')

    // Welcome › Log in: the account rows, the remembered one first.
    await left.getByRole('button', { name: 'Log in', exact: true }).click()
    await expect(left.locator('[data-screen="auth.login"]')).toBeVisible()
    await expect(left.getByRole('heading', { name: 'Choose your account' })).toBeVisible()
    const rows = left.locator('[data-testid^="login-"][aria-pressed]')
    await expect(rows).toHaveCount(3)
    await expect(rows.first()).toContainText('Ana Novak')
    await expect(rows.first()).toContainText('ana.novak@•••••••')
    await expect(rows.first()).toContainText('PERSONAL')
    await expect(rows.nth(2)).toContainText('BUSINESS')
    await expect(left.getByTestId('login-email')).toContainText('Tap an account above')
    await expect(left.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await expect(left.getByRole('button', { name: 'Log in with biometrics' })).toHaveCount(0)

    // Tapping a row types its masked email into the display, then Continue opens the code.
    await left.getByTestId('login-ana').click()
    await expect(left.getByTestId('login-email')).toContainText('ana.novak@•••••••', { timeout: 3000 })
    await expect(left.getByRole('button', { name: 'Continue' })).toBeEnabled()
    await expect(left.getByRole('button', { name: 'Log in with biometrics' })).toBeVisible()
    await left.getByRole('button', { name: 'Continue' }).click()

    // Enter the code: the chip after 700 ms, then the six boxes fill, then Verify.
    await expect(left.locator('[data-screen="auth.code"]')).toBeVisible()
    await expect(left.getByText('Sent to ana.novak@•••••••')).toBeVisible()
    await expect(left.getByRole('button', { name: 'Verify and log in' })).toBeDisabled()
    await expect(left.getByTestId('mail-chip')).toContainText('From Mail · 482 916', { timeout: 3000 })
    await expect(left.getByRole('button', { name: 'Verify and log in' })).toBeEnabled({ timeout: 4000 })
    await expect(left.getByTestId('code-boxes')).toHaveText('482916')
    await expect(left.getByTestId('mail-chip')).toHaveCount(0)
    await left.getByRole('button', { name: 'Verify and log in' }).click()
    await expect(left.locator('[data-screen="c.home"]')).toBeVisible({ timeout: 4000 })
    await expect(left).toHaveAttribute('data-persona', 'ana')

    // The café on the right: its own first code; Ana's row is greyed there.
    await right.getByRole('button', { name: 'Log in', exact: true }).click()
    await expect(right.getByTestId('login-cafe')).toBeEnabled()
    await expect(right.getByTestId('login-ana')).toBeDisabled()
    await expect(right.getByTestId('login-ana')).toContainText('On the other phone')
    await right.getByTestId('login-cafe').click()
    await expect(right.getByTestId('login-email')).toContainText('hello@•••••••', { timeout: 3000 })
    await right.getByRole('button', { name: 'Continue' }).click()
    await expect(right.getByTestId('mail-chip')).toContainText('264 903', { timeout: 3000 })
    await expect(right.getByRole('button', { name: 'Verify and log in' })).toBeEnabled({ timeout: 4000 })
    await right.getByRole('button', { name: 'Verify and log in' }).click()
    await expect(right.locator('[data-screen="pos.home"]')).toBeVisible({ timeout: 4000 })
    await expect(right).toHaveAttribute('data-persona', 'cafe')
    await expectCleanVisibleCopy(page)
  })

  test('no field, no form, no autofill hint on Welcome, Log in or Enter the code', async ({ page }) => {
    await openApp(page, '#/stage')
    const left = slot(page, 'left')
    const forbidden = () =>
      page.evaluate(() => ({
        forms: document.querySelectorAll('form').length,
        inputs: document.querySelectorAll('input[type=email], input[type=password], input[type=tel]').length,
        anyInput: document.querySelectorAll('[data-slot="left"] input').length,
        autofill: document.querySelectorAll('[autocomplete="email"], [autocomplete="one-time-code"]').length,
        editable: document.querySelectorAll('[contenteditable="true"]').length,
      }))
    const none = { forms: 0, inputs: 0, anyInput: 0, autofill: 0, editable: 0 }
    expect(await forbidden()).toEqual(none)
    await left.getByRole('button', { name: 'Log in', exact: true }).click()
    await left.getByTestId('login-ana').click()
    expect(await forbidden()).toEqual(none)
    await expect(left.getByRole('button', { name: 'Continue' })).toBeEnabled({ timeout: 3000 })
    await left.getByRole('button', { name: 'Continue' }).click()
    await expect(left.getByRole('button', { name: 'Verify and log in' })).toBeEnabled({ timeout: 4000 })
    expect(await forbidden()).toEqual(none)
    // The email and the code are read-only text.
    await expect(left.getByTestId('code-boxes').getByRole('textbox').first()).toHaveAttribute('aria-readonly', 'true')
  })

  test('a different code on Send again and on the next login; Back goes one screen', async ({ page }) => {
    await openApp(page, '#/stage')
    const left = slot(page, 'left')
    await left.getByRole('button', { name: 'Log in', exact: true }).click()
    await left.getByTestId('login-ana').click()
    await expect(left.getByRole('button', { name: 'Continue' })).toBeEnabled({ timeout: 3000 })
    await left.getByRole('button', { name: 'Continue' }).click()
    await expect(left.getByTestId('mail-chip')).toContainText('482 916', { timeout: 3000 })
    await expect(left.getByRole('button', { name: 'Verify and log in' })).toBeEnabled({ timeout: 4000 })
    // Send again: the boxes empty and refill with the next code.
    await left.getByRole('button', { name: 'Send again' }).click()
    await expect(left.getByRole('button', { name: 'Verify and log in' })).toBeDisabled()
    await expect(left.getByTestId('mail-chip')).toContainText('490 835', { timeout: 3000 })
    await expect(left.getByTestId('code-boxes')).toHaveText('490835', { timeout: 4000 })
    // Back: the account list, the account still chosen; Back again: Welcome remembering Ana.
    await left.getByTestId('nav-back').click()
    await expect(left.locator('[data-screen="auth.login"]')).toBeVisible()
    await expect(left.getByTestId('login-ana')).toHaveAttribute('aria-pressed', 'true')
    await left.getByTestId('nav-back').click()
    await expect(left.locator('[data-screen="auth.welcome"]')).toBeVisible()
    await expect(left.getByTestId('welcome-account')).toContainText('Ana Novak')
    // Nothing was logged in yet, so the counter has not moved: the first code again.
    await left.getByRole('button', { name: 'Log in', exact: true }).click()
    await left.getByTestId('login-ana').click()
    await expect(left.getByRole('button', { name: 'Continue' })).toBeEnabled({ timeout: 3000 })
    await left.getByRole('button', { name: 'Continue' }).click()
    await expect(left.getByTestId('mail-chip')).toContainText('482 916', { timeout: 3000 })
    await expect(left.getByRole('button', { name: 'Verify and log in' })).toBeEnabled({ timeout: 4000 })
    await left.getByRole('button', { name: 'Verify and log in' }).click()
    await expect(left.locator('[data-screen="c.home"]')).toBeVisible({ timeout: 4000 })
    // Log out and in again: a login was completed, so the code is another one.
    await left.getByTestId('avatar').click()
    await left.getByRole('button', { name: 'Log out' }).click()
    await left.getByTestId('dock-primary').click()
    await left.getByRole('button', { name: 'Log in', exact: true }).click()
    await left.getByTestId('login-ana').click()
    await expect(left.getByRole('button', { name: 'Continue' })).toBeEnabled({ timeout: 3000 })
    await left.getByRole('button', { name: 'Continue' }).click()
    await expect(left.getByTestId('mail-chip')).toContainText('490 835', { timeout: 3000 })
  })
})

test.describe('login in phone mode', () => {
  test.use({ viewport: { width: 390, height: 664 } })

  test('biometrics from the account list reaches Home with the chosen account', async ({ page }) => {
    await openApp(page, '#/phone')
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await page.getByTestId('login-marko').click()
    await expect(page.getByRole('button', { name: 'Log in with biometrics' })).toBeVisible()
    await page.getByRole('button', { name: 'Log in with biometrics' }).click()
    // The glyph shows in the button while it works; Home follows.
    await expect(page.getByRole('button', { name: 'Log in with biometrics' })).toHaveAttribute('aria-busy', 'true')
    await expect(page.locator('[data-screen="c.home"]')).toBeVisible({ timeout: 3000 })
    await expect(slot(page, 'single')).toHaveAttribute('data-persona', 'marko')
  })

  test('the browser Back steps from the code to the account list to Welcome', async ({ page }) => {
    await openApp(page, '#/phone')
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await page.getByTestId('login-ana').click()
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled({ timeout: 3000 })
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.locator('[data-screen="auth.code"]')).toBeVisible()
    await page.goBack()
    await expect(page.locator('[data-screen="auth.login"]')).toBeVisible()
    await page.goBack()
    await expect(page.locator('[data-screen="auth.welcome"]')).toBeVisible()
  })
})

test.describe('login with reduced motion', () => {
  test.use({ viewport: { width: 390, height: 664 } })

  test('the email and the code appear at once, announced once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page, '#/phone')
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await page.getByTestId('login-ana').click()
    // No typing: the email is there and Continue is enabled straight away.
    await expect(page.getByTestId('login-email')).toContainText('ana.novak@•••••••', { timeout: 300 })
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled({ timeout: 300 })
    await expect(page.getByRole('status').filter({ hasText: 'Email filled: ana.novak@•••••••' })).toHaveCount(1)
    // The animated text is hidden from assistive technology.
    await expect(page.getByTestId('login-email').locator('[aria-hidden="true"]').first()).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    // No chip, the six digits at once.
    await expect(page.getByTestId('code-boxes')).toHaveText('482916', { timeout: 300 })
    await expect(page.getByTestId('mail-chip')).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'Code filled' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Verify and log in' })).toBeEnabled()
    await page.getByRole('button', { name: 'Verify and log in' }).click()
    await expect(page.locator('[data-screen="c.home"]')).toBeVisible({ timeout: 3000 })
  })
})
