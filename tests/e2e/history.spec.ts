// History: the search and the chips over the account's payments, what is waiting, the empty states
// and the café's own chips.
import { expect, test } from '@playwright/test'
import { SALE, anaAndMarko, biometricLogin, expectCleanVisibleCopy, openApp, pay, slot, typeAmount } from './helpers'

test.describe('History of a person', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('Ana from fresh: every chip holds what it names, and the Lunch request waits', async ({ page }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    await ana.locator('[data-tile="history"]').click()
    const history = ana.locator('[data-screen="c.history"]')
    await expect(history).toBeVisible()
    await expect(ana.getByTestId('history-search')).toHaveAttribute('placeholder', 'Search people, shops, notes')
    await expect(ana.getByTestId('history-chips').getByRole('button')).toHaveText([
      'All',
      'Money in',
      'Money out',
      'Shops',
      'People',
      'Top-ups & cash-outs',
      'Requests',
    ])
    const rows = ana.getByTestId('history-list').locator('li')
    await expect(ana.getByTestId('chip-all')).toHaveAttribute('aria-pressed', 'true')
    await expect(rows).toHaveCount(8)
    const lunch = ana.getByTestId('status-r_seed_lunch')
    await expect(lunch).toContainText('@marko · Lunch')
    await expect(lunch).toContainText('Asked you · 11:52')
    await expect(lunch).toContainText('WAITING')
    await expect(lunch).toContainText('13.20')
    await expect(ana.getByTestId('history-list').locator('h2').first()).toHaveText('TODAY')
    for (const [chip, n] of [
      ['in', 4],
      ['out', 3],
      ['shops', 2],
      ['people', 3],
      ['topupsCashouts', 2],
      ['requests', 1],
    ] as const) {
      await ana.getByTestId(`chip-${chip}`).click()
      await expect(ana.getByTestId(`chip-${chip}`)).toHaveAttribute('aria-pressed', 'true')
      await expect(rows, chip).toHaveCount(n)
    }
    await expectCleanVisibleCopy(page)
  })

  test('search finds Pizza, ignores case and accents, and says so when nothing matches', async ({ page }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    await ana.locator('[data-tile="history"]').click()
    const rows = ana.getByTestId('history-list').locator('li')
    await ana.getByTestId('history-search').fill('PIZZA')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('@marta_k · Pizza')
    await ana.getByTestId('history-search').fill('cafe')
    await expect(rows).toHaveCount(2)
    await ana.getByTestId('history-search').fill('zzz')
    await expect(ana.getByTestId('empty-state')).toContainText('Nothing found.')
    await expect(ana.getByTestId('empty-state')).toContainText('Try another name, shop or note.')
    // The search stays inside the chip.
    await ana.getByTestId('history-search').fill('pizza')
    await ana.getByTestId('chip-in').click()
    await expect(ana.getByTestId('empty-state')).toBeVisible()
    await ana.getByTestId('chip-out').click()
    await expect(rows).toHaveCount(1)
  })

  test('a chip with nothing in it has its own empty state (Marko has no top-up)', async ({ page }) => {
    await anaAndMarko(page)
    const marko = slot(page, 'right')
    await marko.locator('[data-tile="history"]').click()
    await marko.getByTestId('chip-requests').click()
    // Marko asked Ana for Lunch: it waits in his list too.
    await expect(marko.getByTestId('status-r_seed_lunch')).toContainText('You asked · 11:52')
    await expect(marko.getByTestId('status-r_seed_lunch')).toContainText('WAITING')
    // Ana pays it: the request leaves "waiting" and Marko's Requests chip holds its outcome.
    const ana = slot(page, 'left')
    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('pay-item-r_seed_lunch').click()
    await ana.getByRole('button', { name: 'Decline' }).click()
    await ana.getByRole('button', { name: 'Decline', exact: true }).last().click()
    await expect(ana.locator('[data-screen="c.payItem.declined"]')).toBeVisible()
    await expect(marko.getByTestId('status-r_seed_lunch')).toContainText('DECLINED')
    await ana.getByRole('button', { name: 'Done' }).click()
    await ana.locator('[data-tile="history"]').click()
    await ana.getByTestId('chip-requests').click()
    await expect(ana.getByTestId('status-r_seed_lunch')).toContainText('DECLINED')
    // A declined request addressed to Ana has nothing more to open.
    await expect(ana.getByTestId('status-r_seed_lunch')).not.toHaveAttribute('data-status', 'open')
    await ana.getByTestId('chip-all').click()
    await expect(ana.getByTestId('history-list').locator('li')).toHaveCount(8)
  })

  test('the chip and the search are kept when Ana comes back; a row opens its payment or request', async ({ page }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    await ana.locator('[data-tile="history"]').click()
    await ana.getByTestId('chip-shops').click()
    await ana.getByTestId('history-search').fill('brunch')
    await ana
      .getByTestId(/^tx-BC-/)
      .first()
      .click()
    await expect(ana.locator('[data-screen="shared.tx"]')).toBeVisible()
    await ana.getByTestId('nav-back').click()
    await expect(ana.getByTestId('chip-shops')).toHaveAttribute('aria-pressed', 'true')
    await expect(ana.getByTestId('history-search')).toHaveValue('brunch')
    await ana.getByTestId('history-search').fill('')
    await ana.getByTestId('chip-all').click()
    // The Lunch request asked of her opens the check to pay.
    await ana.getByTestId('status-r_seed_lunch').click()
    await expect(ana.locator('[data-screen="c.payItem.review"]')).toBeVisible()
    await ana.getByTestId('nav-back').click()
    await expect(ana.locator('[data-screen="c.history"]')).toBeVisible()
  })

  test('a request Ana makes waits in her list, opens its detail, and a paid one reads PAID under Requests', async ({
    page,
  }) => {
    await anaAndMarko(page)
    const ana = slot(page, 'left')
    const marko = slot(page, 'right')
    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('row-request').click()
    await ana.getByTestId('party-marko').click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await typeAmount(ana, '8.80')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByRole('button', { name: 'Skip' }).click()
    await ana.getByRole('button', { name: 'Send request' }).click()
    await expect(ana.locator('[data-screen="c.request.sent"]')).toBeVisible()
    await ana.getByRole('button', { name: 'Done' }).click()
    await ana.locator('[data-tile="history"]').click()
    await ana.getByTestId('chip-requests').click()
    const rows = ana.getByTestId('history-list').locator('li')
    await expect(rows).toHaveCount(2)
    const mine = ana.locator('[data-testid^="status-"]', { hasText: 'You asked' })
    await expect(mine).toContainText('8.80')
    await expect(mine).toContainText('WAITING')
    await mine.click()
    await expect(ana.locator('[data-screen="c.request.detail"]')).toBeVisible()
    await ana.getByTestId('nav-back').click()
    // Marko pays it: Ana's row reads PAID under Requests, and the payment is in All.
    await marko.locator('[data-tile="payRequest"]').click()
    await marko
      .getByTestId(/^pay-item-/)
      .first()
      .click()
    await marko.getByRole('button', { name: /^Pay / }).click()
    await expect(marko.locator('[data-screen="c.payItem.success"]')).toBeVisible({ timeout: 5000 })
    await expect(ana.locator('[data-testid^="status-"]', { hasText: 'You asked' })).toContainText('PAID')
    await ana.getByTestId('chip-all').click()
    await expect(ana.getByTestId('history-list').locator('li').first()).toContainText('@marko')
  })
})

test.describe('History of the café', () => {
  test.use({ viewport: { width: 390, height: 664 } })

  test('its own search prompt and chips; a sale is found by its items', async ({ page }) => {
    await openApp(page, '#/phone/cafe')
    await pay(page, SALE)
    await page.locator('[data-tile="sales"]').click()
    await page.getByTestId('row-allPayments').click()
    const phone = slot(page, 'single')
    await expect(phone.locator('[data-screen="biz.history"]')).toBeVisible()
    await expect(phone.getByTestId('history-search')).toHaveAttribute(
      'placeholder',
      'Search sales, customers, references',
    )
    await expect(phone.getByTestId('history-chips').getByRole('button')).toHaveText([
      'All',
      'Sales',
      'Refunds',
      'Supplier payments',
      'Payouts',
      'Top-ups',
    ])
    await phone.getByTestId('chip-refunds').click()
    await expect(phone.getByTestId('empty-state')).toContainText('No refunds yet.')
    await phone.getByTestId('chip-all').click()
    await phone.getByTestId('history-search').fill('croissant')
    await expect(phone.getByTestId('history-list').locator('li')).toHaveCount(1)
  })
})

test.describe('History of a person in phone mode', () => {
  test.use({ viewport: { width: 390, height: 664 } })

  test('the chips scroll sideways and the chosen one stays in view', async ({ page }) => {
    await openApp(page, '#/phone')
    await biometricLogin(page, 'single')
    await page.locator('[data-tile="history"]').click()
    await page.getByTestId('chip-requests').click()
    await expect(page.getByTestId('chip-requests')).toBeInViewport()
    await expect(page.getByTestId('status-r_seed_lunch')).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true)
  })
})
