// The presenter's conveniences outside the phones: Reset with its option and Undo, a reload that
// restores balances, sessions and phones, a payment saved even when the tab closes at once, a
// corrupted record that starts fresh with a notice, and a second tab that waits.
import { expect, test } from '@playwright/test'
import { SALE, biometricLogin, expectBalance, expectCleanVisibleCopy, openApp, pay, slot } from './helpers'

test.use({ viewport: { width: 1280, height: 720 } })

const recordKey = (page: import('@playwright/test').Page) =>
  page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith('bcps:state:v')) ?? '')

test.describe('Reset and Undo', () => {
  test('with the option on both phones come back on Home; Undo restores the balances and sessions', async ({
    page,
  }) => {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await biometricLogin(page, 'right')
    await pay(page, SALE)
    await expectBalance(page, 'ana', '236.50')
    await page.getByTestId('account-menu-left').click()
    await page.getByTestId('account-marko').click()
    await expect(slot(page, 'left')).toHaveAttribute('data-persona', 'marko')
    await expectBalance(page, 'marko', '132.98')

    await page.getByTestId('reset').click()
    const dialog = page.getByTestId('reset-dialog')
    await expect(dialog).toContainText('Reset everything?')
    await expect(dialog).toContainText('All accounts return to their starting balances and history.')
    await expect(page.getByTestId('reset-login-again')).toBeChecked() // on by default on the stage
    await page.getByTestId('reset-cancel').click()
    await expect(dialog).toHaveCount(0)
    await expect(slot(page, 'left')).toHaveAttribute('data-persona', 'marko')

    await page.getByTestId('reset').click()
    await page.getByTestId('reset-confirm').click()
    await expect(slot(page, 'left')).toHaveAttribute('data-persona', 'ana')
    await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'cafe')
    await expectBalance(page, 'ana', '247.50')
    await expectBalance(page, 'cafe', '286.00')
    const toast = page.getByTestId('reset-toast')
    await expect(toast).toContainText('Everything reset')
    await expect(page.getByTestId('tape')).toContainText('Fresh start · all accounts at starting balances')
    await expect(page.getByTestId('session-counter')).toHaveText('')
    await page.getByTestId('undo-reset').click()
    await expect(slot(page, 'left')).toHaveAttribute('data-persona', 'marko')
    await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'cafe')
    await expectBalance(page, 'cafe', '296.89')
    await expect(toast).toHaveCount(0)
  })

  test('with the option off both phones show Welcome; the tape preferences survive Reset', async ({ page }) => {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await page.getByTestId('settings').click()
    await page.getByRole('switch', { name: 'Large text on navy' }).click()
    await page.getByTestId('settings-done').click()
    await page.getByTestId('reset').click()
    await page.getByTestId('reset-login-again').uncheck()
    await page.getByTestId('reset-confirm').click()
    await expect(slot(page, 'left')).toHaveAttribute('data-persona', 'none')
    await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'none')
    await expect(page.getByTestId('stage')).toHaveClass(/projector/)
    // Settings offers Undo reset for the rest of the session.
    await page.getByTestId('settings').click()
    await expect(page.getByTestId('settings-undo')).toBeVisible()
    await page.getByTestId('settings-undo').click()
    await expect(slot(page, 'left')).toHaveAttribute('data-persona', 'ana')
  })

  test('Reset in the dialog is reachable by keyboard and Esc cancels', async ({ page }) => {
    await openApp(page, '#/stage')
    await page.getByTestId('reset').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('reset-cancel')).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    // Focus stays inside the dialog.
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="reset-dialog"]')))).toBe(
      true,
    )
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('reset-dialog')).toHaveCount(0)
    await expect(page.getByTestId('reset')).toBeFocused()
  })
})

test.describe('reload and closing the tab', () => {
  test('a reload restores balances, sessions and phones', async ({ page }) => {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await biometricLogin(page, 'right')
    await page.getByTestId('swap').click()
    await pay(page, SALE)
    await expectBalance(page, 'cafe', '296.89')
    await page.reload()
    await expect(slot(page, 'left')).toHaveAttribute('data-persona', 'cafe')
    await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'ana')
    await expectBalance(page, 'ana', '236.50')
    await expectBalance(page, 'cafe', '296.89')
    await expect(page.getByTestId('tape-row').first()).toContainText('settled')
    await expect(page.getByTestId('session-counter')).toContainText('Merchant payments 1')
    // The unread badge is derived from the ledger again: the café still has its sale unread.
    await expect(slot(page, 'left').getByTestId('bell-count')).toHaveText('1')
  })

  test('closing the tab 50 ms after a payment still restores it', async ({ page, context }) => {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await biometricLogin(page, 'right')
    await pay(page, SALE)
    await page.waitForTimeout(50)
    await page.close({ runBeforeUnload: true })
    const next = await context.newPage()
    await openApp(next, '#/stage')
    await expectBalance(next, 'ana', '236.50')
    await expectBalance(next, 'cafe', '296.89')
  })

  test('a corrupted record starts fresh with a notice and is kept aside', async ({ page, context }) => {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    const key = await recordKey(page)
    expect(key).not.toBe('')
    await page.close()
    const next = await context.newPage()
    await next.addInitScript((k) => localStorage.setItem(k, '{"format":"bcps-state","log":['), key)
    await openApp(next, '#/stage')
    await expect(next.getByTestId('notice-restore-failed')).toContainText(
      "Couldn't restore your last session. Started fresh.",
    )
    await expect(slot(next, 'left')).toHaveAttribute('data-persona', 'none')
    await biometricLogin(next, 'left')
    await expectBalance(next, 'ana', '247.50')
    await expect
      .poll(() => next.evaluate(() => Object.keys(localStorage).some((k) => k.includes('quarantine'))))
      .toBe(true)
    await next.getByTestId('notice-restore-failed').getByRole('button', { name: 'Dismiss' }).click()
    await expect(next.getByTestId('notice-restore-failed')).toHaveCount(0)
    await expectCleanVisibleCopy(next)
  })
})

test.describe('a second tab', () => {
  test('waits with "BCPS is open in another tab." and takes over when the first one closes', async ({
    page,
    context,
  }) => {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await expect(page.getByTestId('other-tab')).toHaveCount(0)
    const second = await context.newPage()
    await openApp(second, '#/stage')
    await expect(second.getByTestId('other-tab')).toContainText('BCPS is open in another tab.')
    await expect(second.getByRole('button', { name: 'Use here' })).toBeVisible()
    await expect(page.getByTestId('other-tab')).toHaveCount(0)
    await page.close()
    await expect(second.getByTestId('other-tab')).toHaveCount(0, { timeout: 10_000 })
    await expect(slot(second, 'left')).toHaveAttribute('data-persona', 'ana') // the first tab's session
  })

  test('[Use here] takes the lock; the other tab becomes the waiting one', async ({ page, context }) => {
    await openApp(page, '#/stage')
    const second = await context.newPage()
    await openApp(second, '#/stage')
    await second.getByRole('button', { name: 'Use here' }).click()
    await expect(second.getByTestId('other-tab')).toHaveCount(0)
    await expect(page.getByTestId('other-tab')).toContainText('BCPS is open in another tab.')
  })
})
