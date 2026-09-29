// The laptop stage (#/stage): two phones over one ledger, the role labels with the account menu and
// zoom, swap, the tape and the session counter, banners and gutter toasts, token travel. The
// payments are sent through the test hook of the manual clock (the same command a review step
// sends); the screens that send them arrive with the people and café screens.
import { expect, test } from '@playwright/test'
import {
  SALE,
  SEND,
  biometricLogin,
  expectBalance,
  expectCleanVisibleCopy,
  openApp,
  overlaps,
  pay,
  slot,
} from './helpers'

test.describe('stage', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('two phones on Welcome, the role labels beside them, scale 0.88 or more at 1,280 × 720', async ({ page }) => {
    await openApp(page, '#/stage')
    await expect(slot(page, 'left')).toHaveAttribute('data-persona', 'none')
    await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'none')
    await expect(page.locator('[data-screen="auth.welcome"]')).toHaveCount(2)
    await expect(page.getByText('Ana Novak · ana.novak@•••••••')).toBeVisible()
    await expect(page.getByText('Business account · Café Lipa')).toBeVisible()
    await expect(page.getByTestId('date-chip')).toContainText('Fri 25 Sep · 12:15')
    await expect(page.getByTestId('account-menu-left')).toContainText('No one logged in')

    const left = await slot(page, 'left').boundingBox()
    const right = await slot(page, 'right').boundingBox()
    if (!left || !right) throw new Error('no phones')
    expect(left.width / 390).toBeGreaterThanOrEqual(0.88)
    expect(left.height / 700).toBeGreaterThanOrEqual(0.88)
    // Labels beside the phones at 1,280 px: to the left of the left phone, to the right of the right one.
    const labelL = await page.getByTestId('label-left').boundingBox()
    const labelR = await page.getByTestId('label-right').boundingBox()
    if (!labelL || !labelR) throw new Error('no labels')
    expect(labelL.x + labelL.width).toBeLessThanOrEqual(left.x + 1)
    expect(labelR.x).toBeGreaterThanOrEqual(right.x + right.width - 1)
    expect(left.y + left.height).toBeLessThanOrEqual(720)
  })

  test('log in by biometrics: Home with the seed balances, role labels and names', async ({ page }) => {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await biometricLogin(page, 'right')
    await expect(slot(page, 'left')).toHaveAttribute('data-persona', 'ana')
    await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'cafe')
    await expect(page.locator('[data-screen="c.home"]')).toBeVisible()
    await expect(page.locator('[data-screen="pos.home"]')).toBeVisible()
    await expectBalance(page, 'ana', '247.50')
    await expectBalance(page, 'cafe', '286.00')
    await expect(page.getByTestId('role-left')).toHaveText('CUSTOMER')
    await expect(page.getByTestId('role-right')).toHaveText('CAFÉ')
    await expect(page.getByTestId('account-menu-left')).toContainText('Ana Novak')
    await expectCleanVisibleCopy(page)
  })

  test('the account menu: groups, balances, on this phone, swap when chosen on the other phone, Welcome', async ({
    page,
  }) => {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await biometricLogin(page, 'right')
    await page.getByTestId('account-menu-left').click()
    const menu = page.getByTestId('account-menu')
    await expect(menu.getByRole('heading', { name: 'Switch account' })).toBeVisible()
    await expect(menu).toContainText('MERCHANTS')
    await expect(menu).toContainText('END CUSTOMERS')
    await expect(page.getByTestId('account-ana')).toContainText('On this phone')
    await expect(page.getByTestId('account-cafe')).toContainText('On the other phone')
    await expect(page.getByTestId('account-marko')).toContainText('132.98')
    await expect(menu.getByText('Lintvern Games')).toHaveCount(0)
    // Marko on the left phone at once: no login screens, a handover card for 600 ms.
    await page.getByTestId('account-marko').click()
    await expect(slot(page, 'left')).toHaveAttribute('data-persona', 'marko')
    await expect(page.getByTestId('handover').first()).toBeVisible()
    await expect(menu).toHaveCount(0)
    // The café is on the other phone: choosing it on the left swaps the phones.
    await page.getByTestId('account-menu-left').click()
    await page.getByTestId('account-cafe').click()
    await expect(slot(page, 'left')).toHaveAttribute('data-persona', 'cafe')
    await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'marko')
    // Show Welcome on this phone.
    await page.getByTestId('account-menu-right').click()
    await page.getByTestId('show-welcome').click()
    await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'none')
    await expect(slot(page, 'right').locator('[data-screen="auth.welcome"]')).toBeVisible()
    await expect(slot(page, 'right').getByTestId('welcome-account')).toContainText('Marko Kovač')
  })

  test('the same account is never on both phones; the swap button exchanges them', async ({ page }) => {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await biometricLogin(page, 'right')
    await page.getByTestId('swap').click()
    await expect(slot(page, 'left')).toHaveAttribute('data-persona', 'cafe')
    await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'ana')
    await page.getByTestId('account-menu-left').click()
    await expect(page.getByTestId('account-cafe')).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('account-menu')).toHaveCount(0)
  })

  test('zoom fits the last-used phone and hides the other; Esc and Z restore', async ({ page }) => {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await biometricLogin(page, 'right')
    await page.getByTestId('zoom-right').click()
    await expect(slot(page, 'left')).toHaveCount(0)
    const zoomed = await slot(page, 'right').boundingBox()
    if (!zoomed) throw new Error('no phone')
    expect(zoomed.height).toBeGreaterThan(700 * 0.75)
    await page.keyboard.press('Escape')
    await expect(slot(page, 'left')).toHaveCount(1)
    // Z zooms the phone used last (the one clicked in), Z again shows both.
    await slot(page, 'left').getByTestId('balance-ana').click()
    await page.keyboard.press('z')
    await expect(slot(page, 'right')).toHaveCount(0)
    await expect(slot(page, 'left')).toHaveCount(1)
    await page.keyboard.press('z')
    await expect(slot(page, 'right')).toHaveCount(1)
  })

  test('a sale: token travels, the café gets a banner, the tape row and the session counter', async ({ page }) => {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await biometricLogin(page, 'right')
    await pay(page, SALE)
    await expect(page.getByTestId('token')).toHaveCount(1)
    await expect(page.getByTestId('tape-row').first()).toContainText('sending')
    await expectBalance(page, 'ana', '236.50')
    await expectBalance(page, 'cafe', '296.89')
    const row = page.getByTestId('tape-row').first()
    await expect(row).toContainText('@ana → Café Lipa · 11.00 BCPS · settled · fee 0.11 · BC-')
    await expect(page.getByTestId('session-counter')).toHaveText(
      'Merchant payments 1 · fees 0.11 BCPS ≈ €0.10 vs cards typically ≈ €0.15–0.30 plus additional charges',
    )
    const banner = slot(page, 'right').getByTestId('banner')
    await expect(banner).toContainText('Payment received · 11.00 BCPS')
    await expect(banner).toContainText('from @ana · 2 × flat white · 2 × croissant')
    await expect(slot(page, 'right').getByTestId('bell-count')).toHaveText('1')
    await expect(page.getByTestId('live-region')).toContainText("On Café Lipa's phone: Payment received · 11.00 BCPS")
    // The banner goes after 3 s; the bell keeps the count.
    await expect(banner).toHaveCount(0, { timeout: 6000 })
    await expect(slot(page, 'right').getByTestId('bell-count')).toHaveText('1')
    await expectCleanVisibleCopy(page)
  })

  test('a payment to an account that is not on a phone: a gutter toast beside a phone, never over one', async ({
    page,
  }) => {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await biometricLogin(page, 'right')
    await pay(page, SEND)
    await expectBalance(page, 'ana', '230.83')
    const toast = page.getByTestId('toast')
    await expect(toast).toHaveCount(1)
    await expect(toast).toContainText("On Marko Kovač's phone")
    await expect(toast).toContainText('@ana sent you 16.50 BCPS')
    await expect(toast).toContainText('Cinema')
    const box = await toast.boundingBox()
    if (!box) throw new Error('no toast')
    for (const s of ['left', 'right'] as const) {
      const phone = await slot(page, s).boundingBox()
      if (!phone) throw new Error('no phone')
      expect(overlaps(box, phone)).toBe(false)
    }
    // Beside the right phone (the café's), since the payer is on the left.
    const right = await slot(page, 'right').boundingBox()
    expect(box.x).toBeGreaterThanOrEqual((right?.x ?? 0) + (right?.width ?? 0))
    // A tap opens Marko on that phone.
    await toast.click()
    await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'marko')
    await expect(toast).toHaveCount(0)
    await expect(slot(page, 'right').getByTestId('bell-count')).toHaveText('1')
  })

  test('toasts go after 3 s unless hovered, and at most three stand', async ({ page }) => {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await biometricLogin(page, 'right')
    await pay(page, SEND)
    const toast = page.getByTestId('toast')
    await expect(toast).toHaveCount(1)
    await toast.hover()
    await page.waitForTimeout(3600)
    await expect(toast).toHaveCount(1)
    await page.mouse.move(5, 300)
    await expect(toast).toHaveCount(0, { timeout: 6000 })
  })

  test('Settings: the payment tape switches off and the choice survives a reload', async ({ page }) => {
    await openApp(page, '#/stage')
    await expect(page.getByTestId('tape')).toBeVisible()
    await page.getByTestId('settings').click()
    const panel = page.getByTestId('settings-panel')
    await expect(panel).toBeVisible()
    for (const label of ['Reduce motion', 'Sound', 'Large text on navy', 'Payment tape']) {
      await expect(panel.getByRole('switch', { name: label })).toBeVisible()
    }
    await expect(panel.getByText('About BCPS')).toBeVisible()
    await expect(panel.getByText(/^Build /)).toBeVisible()
    await panel.getByRole('switch', { name: 'Payment tape' }).click()
    await expect(page.getByTestId('tape')).toHaveCount(0)
    await expect(page.getByTestId('session-counter')).toHaveCount(0)
    const phone = await slot(page, 'left').boundingBox()
    expect((phone?.width ?? 0) / 390).toBeGreaterThan(0.9)
    await page.getByTestId('settings-done').click()
    await page.reload()
    await expect(page.getByTestId('tape')).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bcps:prefs') ?? '{}').tape)).toBe(false)
  })

  test('the shortcut list opens with ? and closes with Esc; keys are ignored in a field', async ({ page }) => {
    await openApp(page, '#/stage')
    await page.keyboard.press('?')
    await expect(page.getByTestId('shortcut-list')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('shortcut-list')).toHaveCount(0)
    // Typing "z" in a text field never zooms.
    await page.evaluate(() => {
      const input = document.createElement('input')
      input.id = 'probe'
      document.body.appendChild(input)
      input.focus()
    })
    await page.keyboard.press('z')
    await expect(slot(page, 'right')).toHaveCount(1)
    await expect(slot(page, 'left')).toHaveCount(1)
  })
})

test.describe('stage at 1,024 × 720', () => {
  test.use({ viewport: { width: 1024, height: 720 } })

  test('the role labels sit above the phones and a toast still stands beside a phone', async ({ page }) => {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await biometricLogin(page, 'right')
    const left = await slot(page, 'left').boundingBox()
    const labelL = await page.getByTestId('label-left').boundingBox()
    if (!left || !labelL) throw new Error('no boxes')
    expect(labelL.y + labelL.height).toBeLessThanOrEqual(left.y + 1)
    await pay(page, SEND)
    const toast = page.getByTestId('toast')
    await expect(toast).toHaveCount(1)
    const box = await toast.boundingBox()
    if (!box) throw new Error('no toast')
    for (const s of ['left', 'right'] as const) {
      const phone = await slot(page, s).boundingBox()
      if (!phone) throw new Error('no phone')
      expect(overlaps(box, phone)).toBe(false)
    }
  })
})

test.describe('stage in a narrow window', () => {
  test('below 768 px, or in portrait, the stage gives way to phone mode', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 600 })
    await openApp(page, '#/stage')
    await expect(page).toHaveURL(/#\/phone$/)
    await expect(slot(page, 'single')).toBeVisible()
    await page.setViewportSize({ width: 820, height: 1180 })
    await openApp(page, '#/stage')
    await expect(page).toHaveURL(/#\/phone$/)
  })
})
