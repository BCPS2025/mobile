// The people screens as a whole: no serious accessibility violation on each, every History chip shows
// its rows or its own empty state, and no screen scrolls the page sideways on a small phone.
import { type Page, expect, test } from '@playwright/test'
import {
  SALE,
  anaAndMarko,
  expectCleanVisibleCopy,
  expectNoSeriousViolations,
  openApp,
  pay,
  slot,
  typeAmount,
} from './helpers'

/** Axe on what the page shows once the screen has finished fading in (a fade in progress blends the colours). */
async function noSeriousViolations(page: Page, where: string, within?: string): Promise<void> {
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished),
    ),
  )
  await expectNoSeriousViolations(page, where, within)
}

const EMPTY_TITLE = {
  all: 'No payments yet.',
  in: 'No money in yet.',
  out: 'No money out yet.',
  shops: 'No shop payments yet.',
  people: 'No payments with people yet.',
  topupsCashouts: 'No top-ups or cash-outs yet.',
  requests: 'No requests yet.',
  sales: 'No sales yet.',
  refunds: 'No refunds yet.',
  suppliers: 'No supplier payments yet.',
  payouts: 'No payouts yet.',
  topups: 'No top-ups yet.',
} as const

test.describe('the people screens', () => {
  test.use({ viewport: { width: 390, height: 664 } })

  test('every History chip, of a person and of the café, shows rows or its own empty state', async ({ page }) => {
    await openApp(page, '#/phone/ana')
    await page.locator('[data-tile="history"]').click()
    const phone = slot(page, 'single')
    for (const chip of ['all', 'in', 'out', 'shops', 'people', 'topupsCashouts', 'requests'] as const) {
      await phone.getByTestId(`chip-${chip}`).click()
      const rows = await phone.getByTestId('history-list').count()
      if (rows === 0) await expect(phone.getByTestId('empty-state')).toContainText(EMPTY_TITLE[chip])
      else await expect(phone.getByTestId('empty-state')).toHaveCount(0)
    }
    // A new account's list: nothing yet. Marko's chips on the same page show his own rows.
    await page.evaluate(() => {
      location.hash = '#/phone/cafe'
    })
    await page.locator('[data-tile="sales"]').click()
    await page.getByTestId('row-allPayments').click()
    for (const chip of ['all', 'sales', 'refunds', 'suppliers', 'payouts', 'topups'] as const) {
      await phone.getByTestId(`chip-${chip}`).click()
      const rows = await phone.getByTestId('history-list').count()
      if (rows === 0) await expect(phone.getByTestId('empty-state')).toContainText(EMPTY_TITLE[chip])
      else await expect(phone.getByTestId('empty-state')).toHaveCount(0)
    }
  })

  test('no serious accessibility violation: History, My code, Wallet, the counter code and the codes nearby', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await openApp(page, '#/phone/ana')
    await page.locator('[data-tile="history"]').click()
    await noSeriousViolations(page, 'History · All')
    await page.getByTestId('chip-requests').click()
    await noSeriousViolations(page, 'History · Requests')
    await page.getByTestId('history-search').fill('zzz')
    await noSeriousViolations(page, 'History · Nothing found')
    await page.getByTestId('nav-home').click()
    await page.locator('[data-tile="wallet"]').click()
    await noSeriousViolations(page, 'Wallet')
    await page.getByTestId('row-myCode').click()
    await noSeriousViolations(page, 'My code')
    await page.getByTestId('nav-home').click()
    await page.locator('[data-tile="scan"]').click()
    await noSeriousViolations(page, 'Scan · Counter code locked')
    await page.getByRole('button', { name: 'Continue' }).click()
    await noSeriousViolations(page, 'Scan · Counter code · amount')
    await typeAmount(page.locator('[data-screen="c.scan.counterAmount"]'), '3.30')
    await page.getByRole('button', { name: 'Continue' }).click()
    await noSeriousViolations(page, 'Scan · Counter code · review')
    await page.getByTestId('nav-home').click()
    // A second code nearby: the list.
    await page.evaluate(() => {
      location.hash = '#/phone/cafe'
    })
    const cafe = slot(page, 'single')
    await cafe.locator('[data-tile="charge"]').click()
    for (const sku of ['flat-white', 'croissant']) await cafe.getByTestId(`item-${sku}`).click()
    await cafe.getByRole('button', { name: /^Charge / }).click()
    await expect(cafe.locator('[data-screen="pos.code"]')).toBeVisible()
    await page.evaluate(() => {
      location.hash = '#/phone/ana'
    })
    await page.locator('[data-tile="scan"]').click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await noSeriousViolations(page, 'Scan · 2 codes nearby')
  })

  test('no serious violation: Pay & request, a request, a link, a split and the payment page', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.setViewportSize({ width: 1280, height: 720 })
    await anaAndMarko(page)
    await pay(page, SALE)
    const ana = slot(page, 'left')
    await ana.locator('[data-tile="payRequest"]').click()
    await noSeriousViolations(page, 'Pay & request · list')
    await ana.getByTestId('pay-item-r_seed_lunch').click()
    await noSeriousViolations(page, 'Pay a request')
    await ana.getByRole('button', { name: 'Decline' }).click()
    await noSeriousViolations(page, 'Decline a request')
    await ana.getByTestId('nav-back').click()
    await ana.getByTestId('nav-back').click()
    await ana.getByTestId('row-request').click()
    await noSeriousViolations(page, 'Request · Who')
    await ana.getByTestId('party-search').fill('@marko')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await typeAmount(ana, '13.20')
    await noSeriousViolations(page, 'Request · Amount')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByRole('button', { name: 'Lunch', exact: true }).click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await noSeriousViolations(page, 'Request · Review')
    await ana.getByRole('button', { name: 'Send request' }).click()
    await noSeriousViolations(page, 'Request · Sent')
    await ana.getByRole('button', { name: 'Done' }).click()

    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('row-paymentLink').click()
    await typeAmount(ana, '13.20')
    await noSeriousViolations(page, 'Payment link · Amount')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await noSeriousViolations(page, 'Payment link · Note')
    await ana.getByRole('button', { name: 'Pizza', exact: true }).click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await noSeriousViolations(page, 'Payment link · Review')
    await ana.getByRole('button', { name: 'Create link' }).click()
    await noSeriousViolations(page, 'Payment link · Link ready')
    await ana.getByTestId('copy-link').click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    await ana.getByTestId('show-qr').click()
    await noSeriousViolations(page, 'Payment link · QR')
    await ana.getByTestId('nav-home').click()

    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('row-splitBill').click()
    await noSeriousViolations(page, 'Split · Choose a payment')
    await ana
      .getByTestId(/^split-tx-/)
      .first()
      .click()
    await noSeriousViolations(page, 'Split · People')

    // The payment page, in a tab of its own.
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).length > 0)).toBe(true)
    await page.waitForTimeout(600)
    const tab = await context.newPage()
    await tab.goto(
      `${new URL('./', page.url()).href}?clock=manual&epoch=2026-09-25${copied.slice(copied.indexOf('#'))}`,
    )
    await tab.locator('[data-testid="pay-page"]').waitFor()
    await noSeriousViolations(tab, 'Payment page · Who’s paying?')
    await tab.getByTestId('payer-marko').click()
    await noSeriousViolations(tab, 'Payment page · check')
    await expectCleanVisibleCopy(tab)
    await tab.close()
  })

  test('nothing scrolls the page sideways on a 320 px phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await openApp(page, '#/phone/ana')
    const wide = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    await page.locator('[data-tile="history"]').click()
    expect(await wide()).toBe(false)
    await page.getByTestId('chip-topupsCashouts').click()
    expect(await wide()).toBe(false)
    await page.getByTestId('nav-home').click()
    await page.locator('[data-tile="wallet"]').click()
    await page.getByTestId('row-myCode').click()
    expect(await wide()).toBe(false)
    await page.getByTestId('nav-home').click()
    await page.locator('[data-tile="scan"]').click()
    await page.getByRole('button', { name: 'Continue' }).click()
    expect(await wide()).toBe(false)
  })
})
