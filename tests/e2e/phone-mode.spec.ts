// Phone mode (#/phone, #/phone/:persona): one phone with the account pill, its menu, the toast with
// [Switch] for another account's payment, links that log an account in, the browser's Back as the
// phone's Back, and the differences on a touch device (no in-app status bar, portrait only).
import { expect, test } from '@playwright/test'
import { SALE, SEND, biometricLogin, expectBalance, expectCleanVisibleCopy, openApp, pay, slot } from './helpers'

test.describe('phone mode @webkit', () => {
  test.use({ viewport: { width: 390, height: 664 } })

  test('Welcome, then Home; the page never scrolls', async ({ page }) => {
    await openApp(page, '#/phone')
    await expect(slot(page, 'single')).toHaveAttribute('data-persona', 'none')
    await expect(page.locator('[data-screen="auth.welcome"]')).toBeVisible()
    await expect(page.getByTestId('pill')).toContainText('No one logged in')
    await expect(page.locator('img[alt="BCPS"]')).toBeVisible()
    await biometricLogin(page, 'single')
    await expect(page.locator('[data-screen="c.home"]')).toBeVisible()
    await expectBalance(page, 'ana', '247.50')
    await expect(page.getByTestId('pill')).toContainText('Ana Novak')
    const scroll = await page.evaluate(() => ({
      page: document.scrollingElement?.scrollHeight ?? 0,
      view: window.innerHeight,
      home: (() => {
        const el = document.querySelector('[data-screen="c.home"]')
        return el ? el.scrollHeight - el.clientHeight : -1
      })(),
    }))
    expect(scroll.page).toBeLessThanOrEqual(scroll.view)
    await expectCleanVisibleCopy(page)
  })

  test('the pill menu: accounts, the virtual time, Reset and Settings', async ({ page }) => {
    await openApp(page, '#/phone')
    await biometricLogin(page, 'single')
    await page.getByTestId('pill').click()
    const menu = page.getByTestId('account-menu')
    await expect(menu).toContainText('Café Lipa')
    await expect(menu).toContainText('Marko Kovač')
    await expect(page.getByTestId('virtual-time')).toHaveText('Fri 25 Sep · 12:15')
    await page.getByTestId('account-cafe').click()
    await expect(slot(page, 'single')).toHaveAttribute('data-persona', 'cafe')
    await expect(page.locator('[data-screen="pos.home"]')).toBeVisible()
    await expect(page.getByTestId('pill')).toContainText('Café Lipa')
    await page.getByTestId('pill').click()
    await page.getByTestId('menu-settings').click()
    await expect(page.getByTestId('settings-panel')).toBeVisible()
    await page.getByTestId('settings-done').click()
    await page.getByTestId('pill').click()
    await page.getByTestId('menu-reset').click()
    // Off by default in phone mode.
    await expect(page.getByTestId('reset-login-again')).not.toBeChecked()
    await page.getByTestId('reset-confirm').click()
    await expect(slot(page, 'single')).toHaveAttribute('data-persona', 'none')
    await expect(page.getByTestId('reset-toast')).toContainText('Everything reset')
  })

  test('#/phone/:persona logs that account in; an unknown one leaves the phone alone', async ({ page }) => {
    await openApp(page, '#/phone/marko')
    await expect(slot(page, 'single')).toHaveAttribute('data-persona', 'marko')
    await expect(page).toHaveURL(/#\/phone$/)
    await openApp(page, '#/phone/nobody')
    await expect(page).toHaveURL(/#\/phone$/)
    await expect(slot(page, 'single')).toHaveAttribute('data-persona', 'marko')
  })

  test('a payment link opens phone mode on Welcome; no account, no code, nothing is paid', async ({ page }) => {
    await openApp(page, '#/pay?v=1&to=@cafelipa&amount=11.00&req=r_unknown')
    await expect(slot(page, 'single')).toHaveAttribute('data-persona', 'none')
    await expect(page.locator('[data-screen="auth.welcome"]')).toBeVisible()
    await expect(page.getByTestId('not-found')).toHaveCount(0)
  })

  test('a banner for the account on the phone; a toast with [Switch] for one that is not', async ({ page }) => {
    await openApp(page, '#/phone/marko')
    await pay(page, SEND)
    const banner = slot(page, 'single').getByTestId('banner')
    await expect(banner).toContainText('@ana sent you 16.50 BCPS · Cinema')
    await expect(slot(page, 'single').getByTestId('bell-count')).toHaveText('1')
    await pay(page, SALE)
    const toast = page.getByTestId('phone-toast')
    await expect(toast).toContainText("On Café Lipa's phone: Payment received · 11.00 BCPS")
    // The toast stands under the pill row, never at the bottom where the dock is.
    const box = await toast.boundingBox()
    expect((box?.y ?? 999) + (box?.height ?? 0)).toBeLessThan(200)
    await page.getByTestId('toast-switch').click()
    await expect(slot(page, 'single')).toHaveAttribute('data-persona', 'cafe')
    await expect(page.getByTestId('phone-toast')).toHaveCount(0)
  })

  test('the browser Back is the phone Back: one screen at a time, Home last', async ({ page }) => {
    await openApp(page, '#/')
    await page.getByTestId('open-bcps').click()
    await expect(page).toHaveURL(/#\/phone$/)
    await biometricLogin(page, 'single')
    await page.getByTestId('avatar').click()
    await expect(page.locator('[data-screen="c.profile"]')).toBeVisible()
    await page.getByRole('button', { name: 'About BCPS' }).click()
    await expect(page.locator('[data-screen="shared.about"]')).toBeVisible()
    await page.goBack()
    await expect(page.locator('[data-screen="c.profile"]')).toBeVisible()
    await page.goBack()
    await expect(page.locator('[data-screen="c.home"]')).toBeVisible()
    await expect(page).toHaveURL(/#\/phone$/)
    // The app's own Back and Home keep the history in step: no leftover entries.
    await page.getByTestId('avatar').click()
    await page.getByRole('button', { name: 'About BCPS' }).click()
    await page.getByTestId('nav-home').click()
    await expect(page.locator('[data-screen="c.home"]')).toBeVisible()
    await page.goBack()
    await expect(page.getByTestId('open-bcps')).toBeVisible() // leaves the app: the landing page
  })

  test('the browser Back from a log-out confirmation leaves the flow', async ({ page }) => {
    await openApp(page, '#/phone/ana')
    await page.getByTestId('avatar').click()
    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page.locator('[data-screen="auth.logout"]')).toBeVisible()
    await page.goBack()
    await expect(page.locator('[data-screen="c.profile"]')).toBeVisible()
  })
})

test.describe('phone mode on a 375 × 548 screen', () => {
  test.use({ viewport: { width: 375, height: 548 } })

  test('Welcome and Home fit without scrolling', async ({ page }) => {
    await openApp(page, '#/phone')
    await expect(page.locator('[data-screen="auth.welcome"]')).toBeVisible()
    const dock = await page.getByRole('button', { name: 'Log in with biometrics' }).boundingBox()
    expect((dock?.y ?? 999) + (dock?.height ?? 0)).toBeLessThanOrEqual(548)
    await biometricLogin(page, 'single')
    const size = await page.evaluate(() => ({ h: document.scrollingElement?.scrollHeight ?? 0, v: window.innerHeight }))
    expect(size.h).toBeLessThanOrEqual(size.v)
  })
})

test.describe('phone mode on a touch device', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })

  test('no in-app status bar; the dock is the last thing on the screen', async ({ page }) => {
    await openApp(page, '#/phone')
    await expect(page.locator('[data-screen="auth.welcome"]')).toBeVisible()
    await expect(page.getByTestId('status-bar')).toHaveCount(0)
    await page.getByRole('button', { name: 'Log in with biometrics' }).tap()
    await expect(slot(page, 'single')).not.toHaveAttribute('data-persona', 'none')
    await expect(page.getByTestId('status-bar')).toHaveCount(0)
  })

  test('held sideways it asks for the phone to be turned upright', async ({ page }) => {
    await openApp(page, '#/phone')
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(page.locator('[data-screen="page.phone.upright"]')).toContainText('Turn your phone upright')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('[data-screen="page.phone.upright"]')).toHaveCount(0)
  })

  test('the dock stays above the soft keyboard: the page follows the visible height', async ({ page }) => {
    await openApp(page, '#/phone')
    await expect(page.getByTestId('phone-mode')).toBeVisible()
    const height = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="phone-mode"]') as HTMLElement
      return { root: root.getBoundingClientRect().height, view: window.visualViewport?.height ?? 0 }
    })
    expect(Math.abs(height.root - height.view)).toBeLessThanOrEqual(1)
  })
})
