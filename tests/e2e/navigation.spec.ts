// Navigation of the phone runtime, over the screens that are live: Back and Home on every screen
// below Home, one hub level, a flow that ends on its own screen, the saved hub after a reload,
// and no dead end. The crawl grows with the screens each milestone makes live.
import { expect, test } from '@playwright/test'
import { openApp, slot } from './helpers'

test.use({ viewport: { width: 390, height: 664 } })

const cases = [
  { who: 'ana', shell: 'c.home', hub: 'c.profile', avatar: 'Profile' },
  { who: 'cafe', shell: 'pos.home', hub: 'biz.settings', avatar: 'Settings' },
]

for (const c of cases) {
  test.describe(`${c.who}: the avatar opens ${c.avatar} ${c.who === 'ana' ? '@webkit' : ''}`, () => {
    test('hub, About and Log out have Back and Home; Back pops one screen; Home returns Home', async ({ page }) => {
      await openApp(page, `#/phone/${c.who}`)
      await expect(page.locator(`[data-screen="${c.shell}"]`)).toBeVisible()
      await expect(page.getByTestId('avatar')).toHaveAccessibleName(c.avatar)
      // Home itself has neither Back nor Home in its header.
      await expect(page.getByTestId('nav-back')).toHaveCount(0)
      await page.getByTestId('avatar').click()
      const hub = page.locator(`[data-screen="${c.hub}"]`)
      await expect(hub).toBeVisible()
      // A screen that opens takes the focus, so a keyboard or screen-reader user starts at its top.
      await expect(hub).toBeFocused()
      await expect(page.getByTestId('nav-back')).toBeVisible()
      await expect(page.getByTestId('nav-home')).toBeVisible()
      await page.getByRole('button', { name: 'About BCPS' }).click()
      await expect(page.locator('[data-screen="shared.about"]')).toBeVisible()
      await expect(page.getByText('€1 ≈ 1.10 BCPS')).toBeVisible()
      await expect(page.getByText('BCPS will never ask you to send money or crypto.')).toBeVisible()
      await expect(page.getByText('Other people only see your name and @username.')).toBeVisible()
      await page.getByTestId('nav-back').click()
      await expect(hub).toBeVisible()
      await page.getByTestId('nav-home').click()
      await expect(page.locator(`[data-screen="${c.shell}"]`)).toBeVisible()
      await expect(page.locator(`[data-screen="${c.shell}"]`)).toBeFocused()
    })

    test('Log out: a confirm step with Cancel and Log out; Welcome remembers the account', async ({ page }) => {
      await openApp(page, `#/phone/${c.who}`)
      await page.getByTestId('avatar').click()
      await page.getByRole('button', { name: 'Log out' }).click()
      const step = page.locator('[data-screen="auth.logout"]')
      await expect(step).toContainText('Log out?')
      await expect(step).toContainText(
        'To come back, choose your account and enter the code from Mail, or use biometrics.',
      )
      await expect(page.getByTestId('nav-back')).toBeVisible()
      await expect(page.getByTestId('nav-home')).toBeVisible()
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect(page.locator(`[data-screen="${c.hub}"]`)).toBeVisible()
      await page.getByRole('button', { name: 'Log out' }).click()
      await page.getByTestId('dock-primary').click()
      await expect(page.locator('[data-screen="auth.welcome"]')).toBeVisible()
      await expect(slot(page, 'single')).toHaveAttribute('data-persona', 'none')
      await expect(page.getByTestId('welcome-account')).toContainText(
        c.who === 'ana' ? 'Ana Novak' : 'Business account · Café Lipa',
      )
    })

    test('the hub is saved: a reload returns to it, and Back from there is Home', async ({ page }) => {
      await openApp(page, `#/phone/${c.who}`)
      await page.getByTestId('avatar').click()
      await expect(page.locator(`[data-screen="${c.hub}"]`)).toBeVisible()
      await page.reload()
      await expect(page.locator(`[data-screen="${c.hub}"]`)).toBeVisible()
      await page.getByTestId('nav-back').click()
      await expect(page.locator(`[data-screen="${c.shell}"]`)).toBeVisible()
    })
  })
}

test('each persona keeps its own stack while accounts switch', async ({ page }) => {
  await openApp(page, '#/phone/ana')
  await page.getByTestId('avatar').click()
  await page.getByRole('button', { name: 'About BCPS' }).click()
  await page.getByTestId('pill').click()
  await page.getByTestId('account-cafe').click()
  await expect(page.locator('[data-screen="pos.home"]')).toBeVisible()
  await page.getByTestId('pill').click()
  await page.getByTestId('account-ana').click()
  await expect(page.locator('[data-screen="shared.about"]')).toBeVisible()
})
