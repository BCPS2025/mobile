// The page a payment link, a request or a code opens (#/pay?…): the accounts that can pay, the check,
// the receipt and [Back to BCPS], which hands the writer lock back to the tab that had it. An address
// with an id this browser does not know opens phone mode on Welcome.
import { type BrowserContext, type Page, expect, test } from '@playwright/test'
import { APP_QUERY, anaAndMarko, expectCleanVisibleCopy, openApp, slot, typeAmount } from './helpers'

test.use({ viewport: { width: 1280, height: 720 } })

/** The page address the way the clipboard holds it, pointed at the app this test runs against. */
async function localAddress(page: Page, copied: string): Promise<string> {
  const hash = copied.slice(copied.indexOf('#'))
  const base = new URL('./', page.url()).href
  return `${base}${APP_QUERY}${hash}`
}

/** Ana makes a 13.20 "Pizza" link on the stage and copies it; the tab stays on Link ready. */
async function anaCopiesLink(page: Page): Promise<string> {
  await anaAndMarko(page)
  const ana = slot(page, 'left')
  await ana.locator('[data-tile="payRequest"]').click()
  await ana.getByTestId('row-paymentLink').click()
  await typeAmount(ana, '13.20')
  await ana.getByRole('button', { name: 'Continue' }).click()
  await ana.getByRole('button', { name: 'Pizza', exact: true }).click()
  await ana.getByRole('button', { name: 'Continue' }).click()
  const saved = () => page.evaluate(() => JSON.stringify(localStorage))
  const before = await saved()
  await ana.getByRole('button', { name: 'Create link' }).click()
  await expect(ana.locator('[data-screen="c.link.ready"]')).toBeVisible()
  await ana.getByTestId('copy-link').click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toMatch(/#\/pay\?v=1&to=@ana&amount=13\.20&link=L-000001$/)
  // The session is saved a moment after it changes; a new tab reads what was saved.
  await expect.poll(saved).not.toBe(before)
  return localAddress(page, copied)
}

async function newTab(context: BrowserContext, address: string): Promise<Page> {
  const tab = await context.newPage()
  await tab.goto(address)
  await tab.locator('[data-testid="pay-page"], [data-testid="phone-mode"]').first().waitFor()
  return tab
}

test.describe('the payment page', () => {
  test('a link in a new tab of the same browser: who is paying, the check, the receipt; the stage tab goes on by itself', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const address = await anaCopiesLink(page)
    const pay = await newTab(context, address)

    // The page: what is asked (from the ledger), the accounts that can log in, no way to sign up.
    const choose = pay.locator('[data-screen="page.pay"]')
    await expect(choose).toBeVisible()
    await expect(choose).toContainText('PAYMENT LINK')
    await expect(choose.getByRole('heading', { name: 'Pay @ana' })).toBeVisible()
    await expect(pay.getByTestId('pay-amount')).toContainText('13.20')
    await expect(choose).toContainText('Pizza · ≈ €12.00')
    await expect(choose.getByRole('heading', { name: "Who's paying?" })).toBeVisible()
    await expect(pay.getByTestId('payers').locator('li')).toHaveCount(3)
    await expect(pay.getByTestId('payer-marko')).toContainText('Marko Kovač')
    await expect(pay.getByTestId('payer-marko')).toContainText('marko.kovac@•••••••')
    await expect(choose).toContainText('Single use: one person can pay this link.')
    await expect(pay.getByText(/create an account/i)).toHaveCount(0)
    await expectCleanVisibleCopy(pay)
    // Looking does not take the lock from the stage tab.
    await expect(page.getByTestId('other-tab')).toHaveCount(0)

    // Marko: the check, with the fee he pays on top.
    await pay.getByTestId('payer-marko').click()
    const review = pay.locator('[data-screen="page.pay.review"]')
    await expect(review).toBeVisible()
    await expect(pay.getByTestId('fact-payer')).toContainText('Marko Kovač · @marko')
    await expect(pay.getByTestId('fact-fee')).toContainText('0.13 BCPS')
    await expect(pay.getByTestId('review-total')).toContainText('13.33 BCPS')
    await pay.getByRole('button', { name: 'Choose someone else' }).click()
    await expect(choose).toBeVisible()
    await pay.getByTestId('payer-marko').click()
    await pay.getByRole('button', { name: 'Pay 13.33 BCPS' }).click()

    // Paying took the lock: the stage tab says so. The receipt, then [Back to BCPS] gives it back.
    const done = pay.locator('[data-screen="page.pay.done"]')
    await expect(done).toBeVisible({ timeout: 8000 })
    await expect(done).toContainText('PAID')
    await expect(done).toContainText('13.20')
    await expect(done).toContainText('to @ana')
    await expect(done).toContainText('0.13 BCPS · paid by you')
    await expect(page.getByTestId('other-tab')).toBeVisible()
    await done.getByRole('button', { name: 'Back to BCPS' }).click()
    await expect(page.getByTestId('other-tab')).toHaveCount(0, { timeout: 8000 })

    // The stage tab has the payment without a reload: Ana 260.70, Marko 119.65, the link paid.
    const ana = slot(page, 'left')
    await expect(page.getByTestId('balance-marko').first()).toContainText('119.65')
    await ana.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByTestId('balance-ana').first()).toContainText('260.70')
    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('waiting').getByRole('button').first().click()
    await expect(ana.locator('[data-screen="c.link.detail"]')).toContainText('Paid by @marko ✓')
    await pay.close()
  })

  test('a link that was paid says so; Ana choosing her own link is told; nothing moves', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const address = await anaCopiesLink(page)
    const pay = await newTab(context, address)
    // Her own link: the check says so and there is nothing to press.
    await pay.getByTestId('payer-ana').click()
    await expect(pay.getByTestId('error-line')).toHaveText('This is your own link.')
    await expect(pay.getByTestId('dock-primary')).toBeDisabled()
    await pay.getByRole('button', { name: 'Choose someone else' }).click()
    await pay.getByTestId('payer-marko').click()
    await pay.getByRole('button', { name: 'Pay 13.33 BCPS' }).click()
    await expect(pay.locator('[data-screen="page.pay.done"]')).toBeVisible({ timeout: 8000 })
    await pay.getByRole('button', { name: 'Back to BCPS' }).click()
    await expect(page.getByTestId('other-tab')).toHaveCount(0, { timeout: 8000 })
    // The same address again: the link is paid.
    const again = await newTab(context, address)
    await expect(again.locator('[data-screen="page.pay"]')).toBeVisible()
    await expect(again.getByTestId('error-line')).toHaveText('This link has already been paid.')
    await expect(again.getByTestId('payers')).toHaveCount(0)
    await expect(again.getByRole('button', { name: /^Pay / })).toHaveCount(0)
  })

  test('an address this browser does not know opens phone mode on Welcome', async ({ browser, baseURL }) => {
    const fresh = await browser.newContext({ ...(baseURL ? { baseURL } : {}) })
    const page = await fresh.newPage()
    await openApp(page, '#/pay?v=1&to=@ana&amount=13.20&link=L-000001')
    await expect(slot(page, 'single')).toHaveAttribute('data-persona', 'none')
    await expect(page.locator('[data-screen="auth.welcome"]')).toBeVisible()
    await expect(page.getByTestId('pay-page')).toHaveCount(0)
    // An id that exists but is another person’s, or an amount that differs, is not known either.
    await openApp(page, '#/pay?v=1&to=@marko&amount=13.20&req=r_seed_lunch')
    await expect(page.getByTestId('pay-page')).toBeVisible()
    await openApp(page, '#/pay?v=1&to=@marko&amount=99.00&req=r_seed_lunch')
    await expect(page.locator('[data-screen="auth.welcome"]')).toBeVisible()
    await fresh.close()
  })

  test('the seeded Lunch request in a browser of its own: Ana pays 13.33 from the page', async ({ page }) => {
    await openApp(page, '#/pay?v=1&to=@marko&amount=13.20&req=r_seed_lunch')
    const choose = page.locator('[data-screen="page.pay"]')
    await expect(choose).toContainText('PAYMENT REQUEST')
    await expect(choose.getByRole('heading', { name: 'Pay @marko' })).toBeVisible()
    await expect(choose).toContainText('Lunch · ≈ €12.00')
    // A request is not a single-use link: no line about it.
    await expect(choose).not.toContainText('Single use')
    // Only Ana was asked: Marko is told so.
    await page.getByTestId('payer-marko').click()
    await expect(page.getByTestId('error-line')).toHaveText("You can't pay yourself.")
    await page.getByRole('button', { name: 'Choose someone else' }).click()
    await page.getByTestId('payer-cafe').click()
    await expect(page.getByTestId('error-line')).toHaveText('Only @ana can do this.')
    await page.getByRole('button', { name: 'Choose someone else' }).click()
    await page.getByTestId('payer-ana').click()
    await expect(page.getByTestId('review-total')).toContainText('13.33 BCPS')
    await page.getByRole('button', { name: 'Pay 13.33 BCPS' }).click()
    await expect(page.locator('[data-screen="page.pay.done"]')).toBeVisible({ timeout: 8000 })
    await page.getByRole('button', { name: 'Back to BCPS' }).click()
    // Back to the start; the saved session has the payment (Ana 234.17).
    await expect(page.getByTestId('open-bcps')).toBeVisible()
    await openApp(page, '#/phone/ana')
    await expect(page.getByTestId('balance-ana').first()).toContainText('234.17')
  })

  test('a request that was cancelled meanwhile: "This request was cancelled."', async ({ page }) => {
    await openApp(page, '#/phone/marko')
    const cancelled = await page.evaluate(() => {
      const hook = (window as unknown as { __bcps: { dispatch(c: unknown): { ok: boolean } } }).__bcps
      return hook.dispatch({
        type: 'request.cancel',
        actor: 'marko',
        cmdId: 'c0c0c0c0c0c0c0c0:t',
        requestId: 'r_seed_lunch',
      }).ok
    })
    expect(cancelled).toBe(true)
    await page.evaluate(() => {
      location.hash = '#/pay?v=1&to=@marko&amount=13.20&req=r_seed_lunch'
    })
    await expect(page.locator('[data-screen="page.pay"]')).toBeVisible()
    await expect(page.getByTestId('error-line')).toHaveText('This request was cancelled.')
  })
})
