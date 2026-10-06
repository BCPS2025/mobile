// The honesty scan (decision D16) over the whole app: every live screen, state and piece of stage
// chrome is read the way a visitor reads it (text, placeholder, aria-label, title, alt and the
// document title) and must pass the banned-terms rules; no control offers a dropped feature
// (decision D34) and the word PLANNED stands only where a feature is planned ("Tap to pay", the
// café's accounting integration and e-commerce plugins). A meta-test proves the scan
// itself: attributes and titles are read, masked emails pass and readable ones fail.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import {
  SALE,
  SEND,
  anaScansToReview,
  cafeShowsCode,
  expectCleanFileName,
  expectCleanVisibleCopy,
  expectNoForbiddenControls,
  openApp,
  pay,
  plannedScreens,
  slot,
  stageBoth,
  visibleFindings,
  visibleTextOf,
} from './helpers'

test.describe('honesty scan meta-test', () => {
  test('attributes and the document title are scanned; masked emails pass, readable ones fail', async ({ page }) => {
    await page.setContent(
      '<title>BCPS</title><button aria-label="Reset">Reset</button><p>Sent to ana.novak@•••••••</p>',
    )
    expect(await visibleFindings(page)).toEqual([])
    await page.setContent('<title>BCPS</title><button aria-label="Demo reset">Reset</button>')
    expect((await visibleFindings(page)).join('\n')).toContain('"Demo"')
    await page.setContent('<title>BCPS Preview</title><p>Hello</p>')
    expect((await visibleFindings(page)).join('\n')).toContain('"Preview"')
    await page.setContent(
      '<img alt="Sample card"><input placeholder="Fake amount"><p>Sent to ana.novak@example.com</p>',
    )
    const findings = (await visibleFindings(page)).join('\n')
    for (const match of ['"Sample"', '"Fake"', 'email']) expect(findings).toContain(match)
    expectCleanFileName('bcps-state-2026-09-25-1215.json')
    expect(() => expectCleanFileName('bcps-demo-state.json')).toThrow()
  })
})

test.describe('the dropped-feature scan meta-test', () => {
  test('a dropped control, a form, an email field or a stray PLANNED is found; a clean page passes', async ({
    page,
  }) => {
    await page.setContent('<title>BCPS</title><button>Log in</button><p>Tap to pay · PLANNED</p>')
    await expectNoForbiddenControls(page)
    expect(await plannedScreens(page)).toEqual(['page'])
    for (const html of [
      '<button>Create account</button>',
      '<a href="#/x" aria-label="Start from a saved state">x</a>',
      '<button>Clock</button>',
      '<div role="switch" aria-label="Presenter tools"></div>',
      '<form></form>',
      '<input type="email">',
      '<input autocomplete="one-time-code">',
      '<a download href="#/x">Save state</a>',
    ]) {
      await page.setContent(`<title>BCPS</title>${html}`)
      await expect(expectNoForbiddenControls(page), html).rejects.toThrow()
    }
    await page.setContent('<div data-screen="c.home"><span>Wallet · PLANNED</span></div>')
    expect(await plannedScreens(page)).toEqual(['c.home'])
  })
})

/** The screens that may say PLANNED: the code's "Tap to pay", the café's Sales and Settings. */
const PLANNED_ON = ['pos.code', 'pos.sales', 'biz.settings']

/** Everything read on the pages of one test, fed to check-banned at its end. */
function collector(page: Page) {
  const seen: string[] = []
  return {
    seen,
    /** The visible copy passes, no dropped feature is offered, and PLANNED is only on a planned feature. */
    async check(where: string): Promise<void> {
      await expectCleanVisibleCopy(page)
      await expectNoForbiddenControls(page)
      const text = await visibleTextOf(page)
      expect(text, `${where}: coming soon`).not.toMatch(/coming soon/i)
      for (const screen of await plannedScreens(page))
        expect(PLANNED_ON, `${where}: PLANNED on ${screen}`).toContain(screen)
      seen.push(`--- ${where}\n${text}`)
    },
  }
}

/** The collected text passes the same rules run as the check-banned script does in CI. */
function expectCollectedTextClean(seen: string[], file: string): void {
  writeFileSync(file, seen.join('\n\n'))
  let output = ''
  let status = 0
  try {
    output = execFileSync(process.execPath, ['scripts/check-banned.ts', '--visible', file], { encoding: 'utf8' })
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    status = err.status ?? 1
    output = `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
  expect(output).toContain('clean')
  expect(status).toBe(0)
}

test.describe('honesty over the whole app', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('the stage: log in, the café sale, Send, Pay supplier, notifications, History and every piece of chrome', async ({
    page,
    context,
  }, testInfo) => {
    const { seen, check } = collector(page)
    const ana = slot(page, 'left')
    const cafe = slot(page, 'right')

    // Pages outside the phones.
    for (const hash of ['#/', '#/about', '#/no-such-page']) {
      await openApp(page, hash)
      await check(`page ${hash}`)
    }

    // Welcome on both phones; the P key does nothing (no presenter tools).
    await openApp(page, '#/stage')
    await check('stage · Welcome')
    const before = await page.locator('body').innerText()
    await page.keyboard.press('p')
    await page.keyboard.press('P')
    expect(await page.locator('body').innerText()).toBe(before)

    // Log in by choosing an account: the list, typing, complete, the code with its chip, filled.
    await ana.getByRole('button', { name: 'Log in', exact: true }).click()
    await check('Log in · Choose your account')
    await ana.getByTestId('login-ana').click()
    await check('Log in · typing')
    await expect(ana.getByRole('button', { name: 'Continue' })).toBeEnabled({ timeout: 3000 })
    await check('Log in · complete')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await expect(ana.getByTestId('mail-chip')).toBeVisible({ timeout: 3000 })
    await check('Enter the code · Mail chip')
    await expect(ana.getByRole('button', { name: 'Verify and log in' })).toBeEnabled({ timeout: 4000 })
    await check('Enter the code · filled')
    await ana.getByRole('button', { name: 'Verify and log in' }).click()
    await expect(ana.locator('[data-screen="c.home"]')).toBeVisible({ timeout: 4000 })
    await cafe.getByRole('button', { name: 'Log in with biometrics' }).click()
    await expect(cafe.locator('[data-screen="pos.home"]')).toBeVisible()
    await check('both Homes')

    // The chrome around the phones: account menu, Settings, Reset, the shortcut list.
    await page.getByTestId('account-menu-left').click()
    await check('account menu')
    await page.keyboard.press('Escape')
    await page.getByTestId('settings').click()
    await check('Settings')
    await page.getByTestId('settings-done').click()
    await page.getByTestId('reset').click()
    await check('Reset?')
    await page.getByTestId('reset-cancel').click()
    await page.keyboard.press('?')
    await check('shortcut list')
    await page.keyboard.press('Escape')

    // The café sale: Charge, the custom amount, the code (the only PLANNED), Cancel, expiry, PAID.
    await cafe.locator('[data-tile="charge"]').click()
    await check('Charge')
    await cafe.getByTestId('item-custom').click()
    await check('Charge · custom amount')
    await cafe.getByTestId('item-brunch').click()
    await check('Charge · amount set from items')
    await cafe.getByTestId('charge-clear').click()
    for (const sku of ['flat-white', 'flat-white', 'croissant', 'croissant'])
      await cafe.getByTestId(`item-${sku}`).click()
    await cafe.getByRole('button', { name: 'Charge 11.00 BCPS' }).click()
    await expect(cafe.locator('[data-screen="pos.code"]')).toBeVisible()
    await check('Payment code')
    expect(await plannedScreens(page)).toEqual(['pos.code'])
    await expect(cafe.locator('[data-screen="pos.code"]')).toContainText('Tap to pay · PLANNED')
    await cafe.getByTestId('nav-back').click()
    await check('Cancel charge')
    await cafe.getByRole('button', { name: 'Keep' }).click()
    await anaScansToReview(page)
    await check('Scan · Locked, then Pay review')
    await ana.getByTestId('fee-line').click()
    await check('Pay review · fee explained')
    await ana.getByRole('button', { name: 'Pay 11.00 BCPS' }).click()
    await expect(ana.getByRole('button', { name: 'Sending…' })).toBeVisible()
    await check('Pay · Sending')
    await expect(ana.locator('[data-screen="c.payCode.success"]')).toBeVisible({ timeout: 5000 })
    await expect(cafe.locator('[data-screen="pos.paid"]')).toBeVisible({ timeout: 5000 })
    await check('PAID on both phones')
    await ana.getByRole('button', { name: 'Done' }).click()
    await cafe.getByRole('button', { name: 'New sale' }).click()
    await cafe.getByTestId('item-espresso').click()
    await cafe.getByRole('button', { name: 'Charge 2.20 BCPS' }).click()
    await page.evaluate(() =>
      (window as unknown as { __bcps: { advance(ms: number): void } }).__bcps.advance(5 * 60_000),
    )
    await expect(cafe.getByTestId('code-expired')).toBeVisible()
    await check('Code expired')
    await cafe.getByRole('button', { name: 'Cancel', exact: true }).click()
    await cafe.getByRole('button', { name: 'Cancel charge' }).click()
    await expect(cafe.locator('[data-screen="pos.charge"]')).toBeVisible()
    await check('Charge after Cancel')
    await cafe.getByTestId('nav-home').click()
    await check('café Home after a sale')

    // Ana's Home views: History and the payment detail, Notifications, Profile, About, Log out.
    await ana.locator('[data-tile="history"]').click()
    await check('History')
    await ana.locator('button[data-testid^="tx-BC-"]').first().click()
    await check('Payment detail')
    await ana.getByRole('button', { name: '✓ Verified' }).click()
    await check('Payment detail · Verified')
    await ana.getByTestId('nav-home').click()
    await ana.getByTestId('bell').click()
    await check('Notifications · Empty')
    await ana.getByTestId('nav-home').click()
    await ana.getByTestId('avatar').click()
    await check('Profile')
    await ana.getByRole('button', { name: 'About BCPS' }).click()
    await check('About BCPS in the phone')
    await ana.getByTestId('nav-back').click()
    await ana.getByRole('button', { name: 'Log out' }).click()
    await check('Log out?')
    await ana.getByRole('button', { name: 'Cancel' }).click()
    await ana.getByTestId('nav-home').click()

    // The café's own History and payment detail, Settings and the notification list.
    await cafe.locator('[data-tile="sales"]').click()
    await check('Sales')
    await cafe.getByTestId('row-allPayments').click()
    await check('café History')
    await cafe.locator('button[data-testid^="tx-BC-"]').first().click()
    await check('café Payment detail')
    await cafe.getByTestId('nav-home').click()
    await cafe.getByTestId('bell').click()
    await check('café Notifications')
    await cafe.getByTestId('nav-home').click()
    await cafe.getByTestId('avatar').click()
    await check('café Settings')
    await cafe.getByTestId('nav-home').click()

    // Send: to (suggestions, an unknown handle), the amount (too much), a note, Review, Sending, Sent.
    await ana.locator('[data-tile="payRequest"]').click()
    await check('Pay & request')
    await ana.getByTestId('row-send').click()
    await check('Send · Choose a person')
    await ana.getByTestId('party-search').fill('@mar')
    await check('Send · suggestions')
    await ana.getByTestId('party-search').fill('@anaa')
    await check('Send · unknown handle')
    await ana.getByTestId('party-search').fill('@marko')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await check('Send · Enter an amount')
    for (const ch of '300') await ana.locator(`[data-key="${ch}"]`).click()
    await check('Send · Not enough balance')
    for (let i = 0; i < 3; i++) await ana.locator('[data-key="del"]').click()
    for (const ch of '16.50') await ana.locator(`[data-key="${ch}"]`).click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await check('Send · Add a note')
    await ana.getByRole('button', { name: 'Cinema', exact: true }).click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await check('Send · Review')
    await ana.getByTestId('fee-line').click()
    await check('Send · Review · fee explained')
    await ana.getByRole('button', { name: 'Send 16.67 BCPS' }).click()
    await expect(ana.getByRole('button', { name: 'Sending…' })).toBeVisible()
    await check('Send · Sending')
    await expect(ana.locator('[data-screen="c.send.success"]')).toBeVisible({ timeout: 5000 })
    await check('Sent')
    await expect(page.getByTestId('toast')).toHaveCount(1) // Marko is not on a phone: a gutter toast
    await check('gutter toast')
    await ana.getByRole('button', { name: 'Done' }).click()

    // Pay supplier on the café's phone, with the token going to the edge marker.
    await cafe.locator('[data-tile="pay"]').click()
    await check('Pay')
    await cafe.getByTestId('row-paySupplier').click()
    await check('Pay supplier · Review')
    await cafe.getByTestId('edit-Note').click()
    await check('Pay supplier · Add a note')
    await cafe.getByRole('button', { name: 'Back to review' }).click()
    await cafe.getByRole('button', { name: 'Pay 8.89 BCPS' }).click()
    await expect(page.getByTestId('edge-marker')).toBeVisible()
    await check('Pay supplier · Sending, edge marker')
    await expect(cafe.locator('[data-screen="biz.send.done"]')).toBeVisible({ timeout: 5000 })
    await check('Pay supplier · PAID')
    await cafe.getByRole('button', { name: 'Done' }).click()

    // Reset: the toast with Undo and the fresh-start tape row; Undo; a second tab waits.
    await page.getByTestId('reset').click()
    await page.getByTestId('reset-confirm').click()
    await expect(page.getByTestId('reset-toast')).toBeVisible()
    await check('Everything reset')
    await page.getByTestId('undo-reset').click()
    const second = await context.newPage()
    await openApp(second, '#/stage')
    await expect(second.getByTestId('other-tab')).toBeVisible()
    await expectCleanVisibleCopy(second)
    await expectNoForbiddenControls(second)
    seen.push(`--- other tab\n${await visibleTextOf(second)}`)
    await second.close()

    expectCollectedTextClean(seen, testInfo.outputPath('visible-text-stage.txt'))
  })

  test('banners and RECEIVED: the café on Home is told of a sale', async ({ page }, testInfo) => {
    const { seen, check } = collector(page)
    const cafe = slot(page, 'right')
    await stageBoth(page)
    await cafeShowsCode(page)
    await cafe.getByTestId('nav-home').click()
    await anaScansToReview(page)
    await slot(page, 'left').getByRole('button', { name: 'Pay 11.00 BCPS' }).click()
    await expect(cafe.getByTestId('banner')).toBeVisible({ timeout: 5000 })
    await check('café banner')
    await cafe.getByTestId('banner').click()
    await expect(cafe.locator('[data-screen="biz.received"]')).toBeVisible()
    await check('RECEIVED from a notification')
    await cafe.getByRole('button', { name: 'Done' }).click()
    await expect(cafe.locator('[data-screen="pos.home"]')).toBeVisible()
    expectCollectedTextClean(seen, testInfo.outputPath('visible-text-received.txt'))
  })
})

test.describe('honesty in phone mode', () => {
  test.use({ viewport: { width: 390, height: 664 } })

  test('the pill menu, Settings, Reset, a banner and a toast with [Switch]', async ({ page }, testInfo) => {
    const { seen, check } = collector(page)
    await openApp(page, '#/phone')
    await check('phone mode · Welcome')
    await page.getByTestId('pill').click()
    await check('pill menu · no one logged in')
    await page.keyboard.press('Escape')
    await openApp(page, '#/phone/marko')
    await check('phone mode · Home')
    await page.getByTestId('pill').click()
    await check('pill menu')
    await page.getByTestId('menu-settings').click()
    await check('phone mode · Settings')
    await page.getByTestId('settings-done').click()
    await pay(page, SEND)
    await expect(slot(page, 'single').getByTestId('banner')).toBeVisible()
    await check('phone mode · banner')
    await pay(page, SALE)
    await expect(page.getByTestId('phone-toast')).toBeVisible()
    await check('phone mode · toast with Switch')
    await page.getByTestId('pill').click()
    await page.getByTestId('menu-reset').click()
    await check('phone mode · Reset?')
    await page.getByTestId('reset-confirm').click()
    await expect(page.getByTestId('reset-toast')).toBeVisible()
    await check('phone mode · Everything reset')
    expectCollectedTextClean(seen, testInfo.outputPath('visible-text-phone.txt'))
  })
})

test.describe('honesty on a touch device held sideways', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })

  test('"Turn your phone upright" passes the scan', async ({ page }) => {
    await openApp(page, '#/phone')
    await expect(page.locator('[data-screen="page.phone.upright"]')).toBeVisible()
    await expectCleanVisibleCopy(page)
    await expectNoForbiddenControls(page)
  })
})
