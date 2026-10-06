// The café loop on the stage: Charge (items or a custom amount), the payment code with its
// countdown, Ana's Scan locking onto it, the payment travelling between the two phones, PAID on
// both, and the cases around it (Home then pay, reload then pay, Back on the code, a code that
// ran out, a code cancelled or paid elsewhere); then Pay supplier and the café's History.
import { type Page, expect, test } from '@playwright/test'
import { biometricLogin, expectBalance, expectCleanVisibleCopy, openApp, slot } from './helpers'

/**
 * A persona's balance, read on its Home: a phone that shows a success screen or a step goes Home
 * first (the balance is drawn on Home only).
 */
async function balanceAfter(page: Page, persona: string, amount: string): Promise<void> {
  const home = page.locator(`[data-phone="${persona}"]`).getByTestId('nav-home')
  if ((await home.count()) > 0 && (await home.isEnabled())) await home.click()
  await expectBalance(page, persona, amount)
}

test.describe('the café sale on the stage @webkit', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  const ana = (page: Page) => slot(page, 'left')
  const cafe = (page: Page) => slot(page, 'right')

  /** Ana on the left, the café on the right, both logged in by biometrics. */
  async function both(page: Page) {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await biometricLogin(page, 'right')
    await expect(cafe(page).locator('[data-screen="pos.home"]')).toBeVisible()
  }

  /** The café charges Flat white ×2 and Croissant ×2 and shows the code. */
  async function chargeEleven(page: Page) {
    const phone = cafe(page)
    await phone.locator('[data-tile="charge"]').click()
    await expect(phone.locator('[data-screen="pos.charge"]')).toBeVisible()
    for (const sku of ['flat-white', 'flat-white', 'croissant', 'croissant'])
      await phone.getByTestId(`item-${sku}`).click()
    await phone.getByRole('button', { name: 'Charge 11.00 BCPS' }).click()
    await expect(phone.locator('[data-screen="pos.code"]')).toBeVisible()
  }

  /** Ana scans the café's code and stops on the review. */
  async function scanToReview(page: Page) {
    const phone = ana(page)
    await phone.locator('[data-tile="scan"]').click()
    await expect(phone.getByTestId('scan-status')).toContainText('Locked · Café Lipa')
    await phone.getByRole('button', { name: 'Continue' }).click()
    await expect(phone.locator('[data-screen="c.payCode.review"]')).toBeVisible()
  }

  test('Flat white ×2 + Croissant ×2: the code, Ana pays, PAID on both phones; Ana 236.50, café 296.89, fee 0.11', async ({
    page,
  }) => {
    await both(page)
    const phone = cafe(page)

    // Charge: the amount from the items, ≈ €, the chips (menu prices are never shown), the hint.
    await phone.locator('[data-tile="charge"]').click()
    await expect(phone.getByTestId('nav-back')).toBeVisible()
    await expect(phone.getByRole('heading', { name: 'Charge' })).toBeVisible()
    await expect(phone.getByRole('button', { name: 'Charge', exact: true })).toBeDisabled()
    for (const name of ['Flat white', 'Espresso', 'Croissant', 'Brunch', 'Custom amount'])
      await expect(phone.getByRole('button', { name })).toBeVisible()
    await expect(phone.getByText('Table 4 · tap an item again to add one more')).toBeVisible()
    await phone.getByTestId('item-flat-white').click()
    await phone.getByTestId('item-flat-white').click()
    await phone.getByTestId('item-croissant').click()
    await phone.getByTestId('item-croissant').click()
    await expect(phone.getByTestId('amount-value')).toContainText('11.00')
    await expect(phone.getByText('≈ €10.00')).toBeVisible()
    await expect(phone.getByTestId('qty-flat-white')).toHaveText('× 2')
    await expect(phone.getByTestId('qty-croissant')).toHaveText('× 2')
    await phone.getByRole('button', { name: 'Charge 11.00 BCPS' }).click()

    // The payment code: a real QR (never a file: address), the amount, the items, the countdown.
    const code = phone.locator('[data-screen="pos.code"]')
    await expect(code).toBeVisible()
    await expect(phone.getByRole('heading', { name: 'Payment code' })).toBeVisible()
    await expect(code.getByTestId('code-amount')).toContainText('11.00')
    await expect(code).toContainText('Table 4 · 2 × flat white · 2 × croissant')
    await expect(code.getByTestId('code-countdown')).toHaveText('Valid for 4:59')
    await expect(code).toContainText('Tap to pay · PLANNED')
    const payload = await code.locator('[data-payload]').getAttribute('data-payload')
    expect(payload).toMatch(/#\/pay\?v=1&to=@cafelipa&amount=11\.00&req=R-000001$/)
    expect(payload?.startsWith('file:')).toBe(false)

    // Ana's Scan locks within a moment; the review as designed.
    const a = ana(page)
    await a.locator('[data-tile="scan"]').click()
    await expect(a.getByTestId('scan-status')).toHaveText('Locked · Café Lipa ✓')
    await expect(a.locator('[data-screen="c.scan"]')).toContainText('Table 4 · 11.00 BCPS')
    await a.getByRole('button', { name: 'Continue' }).click()
    const review = a.locator('[data-screen="c.payCode.review"]')
    await expect(review).toContainText('Pay Café Lipa?')
    await expect(review).toContainText('2 × flat white · 2 × croissant')
    await expect(a.getByTestId('fee-line')).toContainText(
      'Transaction fee 1% · 0.11 BCPS (≈ €0.10) · paid by Café Lipa',
    )
    await expect(review).toContainText('Fee 1% · 0.11 (≈ €0.10) · café')
    await expect(review).toContainText('Cards 1.5–3% +')
    await expect(a.getByTestId('balance-after')).toHaveText('Balance after 236.50 BCPS')
    await a.getByRole('button', { name: 'Pay 11.00 BCPS' }).click()
    await expect(a.getByRole('button', { name: 'Sending…' })).toBeVisible()
    await expect(page.getByTestId('token')).toHaveCount(1)

    // PAID on Ana's phone: the receipt with a reference; on the café's phone as designed.
    const paid = a.locator('[data-screen="c.payCode.success"]')
    await expect(paid).toBeVisible({ timeout: 5000 })
    await expect(paid).toContainText('PAID')
    await expect(paid).toContainText('to Café Lipa')
    await expect(paid).toContainText('0.11 BCPS · paid by Café Lipa')
    await expect(paid.getByText(/^BC-[0-9A-Z]{6}$/)).toBeVisible()
    const sale = phone.locator('[data-screen="pos.paid"]')
    await expect(sale).toBeVisible({ timeout: 5000 })
    await expect(sale.getByTestId('success-amount')).toContainText('+11.00')
    await expect(sale).toContainText('from @ana · Ana Novak')
    await expect(sale).toContainText('Spendable now')
    await expect(sale).toContainText('Transaction fee')
    await expect(sale).toContainText('1% · 0.11 BCPS (≈ €0.10)')
    await expect(sale).toContainText('Reference')
    await expect(sale.getByText(/^BC-[0-9A-Z]{6}$/)).toBeVisible()
    await expect(sale.getByRole('button', { name: 'New sale' })).toBeVisible()
    await expect(sale.getByTestId('nav-back')).toHaveCount(0)
    // No banner over PAID, and the sale is not left unread (the two from the start remain).
    await expect(phone.getByTestId('banner')).toHaveCount(0)
    await expect(page.getByTestId('tape-row').first()).toContainText(
      '@ana → Café Lipa · 11.00 BCPS · settled · fee 0.11 · BC-',
    )
    await expect(page.getByTestId('session-counter')).toHaveText(
      'Merchant payments 1 · fees 0.11 BCPS ≈ €0.10 vs cards typically ≈ €0.15–0.30 plus additional charges',
    )
    await expectCleanVisibleCopy(page)

    // [New sale] is an empty Charge; Home shows the sale on the Sales tile.
    await sale.getByRole('button', { name: 'New sale' }).click()
    await expect(phone.locator('[data-screen="pos.charge"]')).toBeVisible()
    await expect(phone.getByTestId('amount-value')).toContainText('0.00')
    await phone.getByTestId('nav-home').click()
    await expect(phone.locator('[data-tile="sales"]')).toContainText('24 today · 122.38')
    await expect(phone.getByTestId('bell-count')).toHaveText('2')
    await a.getByRole('button', { name: 'Done' }).click()
    await expect(a.locator('[data-screen="c.home"]')).toBeVisible()
    await balanceAfter(page, 'ana', '236.50')
    await balanceAfter(page, 'cafe', '296.89')
  })

  test('the café’s payment detail: the card line and "Final · no chargebacks"; History names the payer and the table', async ({
    page,
  }) => {
    await both(page)
    await chargeEleven(page)
    await scanToReview(page)
    await ana(page).getByRole('button', { name: 'Pay 11.00 BCPS' }).click()
    await expect(cafe(page).locator('[data-screen="pos.paid"]')).toBeVisible({ timeout: 5000 })
    const phone = cafe(page)
    await phone.getByTestId('nav-home').click()
    await phone.locator('[data-tile="sales"]').click()
    await expect(phone.locator('[data-screen="pos.sales"]')).toBeVisible()
    await expect(phone.getByTestId('row-allPayments')).toContainText('All payments')
    await phone.getByTestId('row-allPayments').click()
    const history = phone.locator('[data-screen="biz.history"]')
    await expect(history).toBeVisible()
    const first = history.locator('button[data-testid^="tx-BC-"]').first()
    await expect(first).toContainText('@ana · Table 4')
    await expect(first).toContainText('Sale')
    await expect(first).toContainText('+11.00')
    await first.click()
    const detail = phone.locator('[data-screen="shared.tx"]')
    await expect(detail).toContainText('+11.00')
    await expect(detail).toContainText('from @ana · ≈ €10.00')
    await expect(detail).toContainText('2 × flat white · 2 × croissant')
    await expect(detail).toContainText('0.11 BCPS (≈ €0.10)')
    await expect(detail).toContainText('paid by Café Lipa')
    await expect(detail).toContainText('Final · no chargebacks')
    await expect(detail).toContainText('Cards typically ≈ €0.15–0.30 · 1.5–3% plus additional charges')
    await expect(detail.getByRole('button', { name: 'Refund' })).toHaveCount(0)
  })

  test('Espresso 2.20 alone: fee 0.02 and no card comparison', async ({ page }) => {
    await both(page)
    const phone = cafe(page)
    await phone.locator('[data-tile="charge"]').click()
    await phone.getByTestId('item-espresso').click()
    await phone.getByRole('button', { name: 'Charge 2.20 BCPS' }).click()
    await expect(phone.locator('[data-screen="pos.code"]')).toBeVisible()
    await scanToReview(page)
    await expect(ana(page).getByTestId('fee-line')).toContainText(
      'Transaction fee 1% · 0.02 BCPS (≈ €0.02) · paid by Café Lipa',
    )
    await expect(ana(page).locator('[data-screen="c.payCode.review"]')).not.toContainText('Cards 1.5–3%')
    await ana(page).getByRole('button', { name: 'Pay 2.20 BCPS' }).click()
    await expect(phone.locator('[data-screen="pos.paid"]')).toBeVisible({ timeout: 5000 })
    await expect(phone.locator('[data-screen="pos.paid"]')).toContainText('1% · 0.02 BCPS')
    await balanceAfter(page, 'ana', '245.30')
    await balanceAfter(page, 'cafe', '288.18')
    await expect(page.getByTestId('session-counter')).toHaveText('')
  })

  test('a custom amount: the keypad, locked while items are chosen ("Amount set from items", Clear)', async ({
    page,
  }) => {
    await both(page)
    const phone = cafe(page)
    await phone.locator('[data-tile="charge"]').click()
    await phone.getByTestId('item-custom').click()
    await expect(phone.getByText('Amount set from items')).toHaveCount(0)
    for (const k of ['1', '2', '.', '5']) await phone.locator(`[data-key="${k}"]`).click()
    await expect(phone.getByTestId('amount-value')).toContainText('12.5')
    await expect(phone.getByRole('button', { name: 'Charge 12.50 BCPS' })).toBeEnabled()
    // An item replaces the typed amount and locks the keypad.
    await phone.getByTestId('item-brunch').click()
    await expect(phone.getByTestId('amount-value')).toContainText('13.20')
    await expect(phone.getByText('Amount set from items')).toBeVisible()
    await expect(phone.locator('[data-key="5"]')).toBeDisabled()
    await phone.getByTestId('charge-clear').click()
    await expect(phone.getByTestId('amount-value')).toContainText('0.00')
    await expect(phone.locator('[data-key="5"]')).toBeEnabled()
    // From the physical keyboard too.
    await phone.locator('[data-screen="pos.charge"] [data-keypad]').focus()
    await page.keyboard.type('7.25')
    await expect(phone.getByRole('button', { name: 'Charge 7.25 BCPS' })).toBeEnabled()
    await phone.getByRole('button', { name: 'Charge 7.25 BCPS' }).click()
    await expect(phone.locator('[data-screen="pos.code"]')).toContainText('Table 4')
    await expect(phone.locator('[data-screen="pos.code"]')).not.toContainText('×')
    await scanToReview(page)
    await ana(page).getByRole('button', { name: 'Pay 7.25 BCPS' }).click()
    await expect(phone.locator('[data-screen="pos.paid"]')).toBeVisible({ timeout: 5000 })
    await balanceAfter(page, 'ana', '240.25')
  })

  test('Back on the code asks to cancel; Keep goes back; Cancel charge ends the code and Ana’s review says so', async ({
    page,
  }) => {
    await both(page)
    await chargeEleven(page)
    const phone = cafe(page)
    // Ana already has the code on her review.
    await scanToReview(page)
    await phone.getByTestId('nav-back').click()
    const cancel = phone.locator('[data-screen="pos.code.cancel"]')
    await expect(cancel).toBeVisible()
    await expect(phone.getByRole('heading', { name: 'Payment code' })).toBeVisible()
    await expect(cancel).toContainText('Cancel this charge?')
    await expect(cancel).toContainText('11.00 BCPS')
    await expect(cancel).toContainText('2 × flat white · 2 × croissant')
    await expect(cancel).toContainText('The code stops working. No money moves.')
    await phone.getByRole('button', { name: 'Keep' }).click()
    await expect(phone.locator('[data-screen="pos.code"]')).toBeVisible()
    await phone.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(cancel).toBeVisible()
    await phone.getByRole('button', { name: 'Cancel charge' }).click()
    // An empty Charge again; the money never moved.
    await expect(phone.locator('[data-screen="pos.charge"]')).toBeVisible()
    await expect(phone.getByTestId('amount-value')).toContainText('0.00')
    // Ana's review: the code was cancelled; Pay is off.
    await expect(ana(page).getByTestId('error-line')).toHaveText('This code was cancelled')
    await expect(ana(page).getByRole('button', { name: 'Pay 11.00 BCPS' })).toBeDisabled()
    // A new charge in the same flow works.
    await phone.getByTestId('item-espresso').click()
    await phone.getByRole('button', { name: 'Charge 2.20 BCPS' }).click()
    await expect(phone.locator('[data-screen="pos.code"]')).toBeVisible()
    await balanceAfter(page, 'cafe', '286.00')
  })

  test('a code paid by someone else: "This code was already paid."', async ({ page }) => {
    await both(page)
    await chargeEleven(page)
    await scanToReview(page)
    // Marko (not on a phone) pays the same code first.
    const payload = await cafe(page).locator('[data-payload]').getAttribute('data-payload')
    const req = payload?.match(/req=([^&]+)/)?.[1]
    const ok = await page.evaluate(
      (id) =>
        (window as unknown as { __bcps: { dispatch(c: unknown): { ok: boolean } } }).__bcps.dispatch({
          type: 'pay',
          actor: 'marko',
          cmdId: 'e2e00000000000ab:review',
          to: '@cafelipa',
          amount: 1100,
          channel: 'qr',
          requestId: id,
          expect: { senderDebit: 1100 },
        }).ok,
      req,
    )
    expect(ok).toBe(true)
    await expect(ana(page).getByTestId('error-line')).toHaveText('This code was already paid.')
    await expect(ana(page).getByRole('button', { name: 'Pay 11.00 BCPS' })).toBeDisabled()
    await balanceAfter(page, 'ana', '247.50')
  })

  test('a code that ran out: the countdown ends, Ana’s viewfinder lets go, [New code] makes a fresh one', async ({
    page,
  }) => {
    await both(page)
    await chargeEleven(page)
    const phone = cafe(page)
    const first = await phone.locator('[data-payload]').getAttribute('data-payload')
    await page.evaluate(() =>
      (window as unknown as { __bcps: { advance(ms: number): void } }).__bcps.advance(4 * 60_000 + 30_000),
    )
    await expect(phone.getByTestId('code-countdown')).toHaveText('Valid for 0:29')
    await page.evaluate(() => (window as unknown as { __bcps: { advance(ms: number): void } }).__bcps.advance(30_000))
    await expect(phone.getByTestId('code-expired')).toHaveText('This code expired. No money moved.')
    await expect(phone.getByRole('button', { name: 'New code' })).toBeVisible()
    await expect(phone.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    // Ana's Scan has nothing to lock onto.
    await ana(page).locator('[data-tile="scan"]').click()
    await expect(ana(page).getByTestId('scan-status')).toHaveText('No payment code in view')
    await ana(page).getByTestId('nav-home').click()
    await phone.getByRole('button', { name: 'New code' }).click()
    await expect(phone.getByTestId('code-countdown')).toHaveText('Valid for 4:59')
    await expect(phone.locator('[data-screen="pos.code"]')).toContainText('2 × flat white · 2 × croissant')
    const second = await phone.locator('[data-payload]').getAttribute('data-payload')
    expect(second).not.toBe(first)
    expect(second).toMatch(/req=R-000002$/)
    await scanToReview(page)
    await ana(page).getByRole('button', { name: 'Pay 11.00 BCPS' }).click()
    await expect(phone.locator('[data-screen="pos.paid"]')).toBeVisible({ timeout: 5000 })
    await balanceAfter(page, 'cafe', '296.89')
  })

  test('double taps never skip a step: [Charge] stays on the code, Scan’s Continue stays on the review', async ({
    page,
  }) => {
    await both(page)
    const phone = cafe(page)
    await phone.locator('[data-tile="charge"]').click()
    for (const sku of ['flat-white', 'flat-white', 'croissant', 'croissant'])
      await phone.getByTestId(`item-${sku}`).click()
    // The second tap lands where the code's Cancel now sits: it does nothing.
    await phone.getByRole('button', { name: 'Charge 11.00 BCPS' }).dblclick()
    await expect(phone.locator('[data-screen="pos.code"]')).toBeVisible()
    await page.waitForTimeout(600)
    await expect(phone.locator('[data-screen="pos.code"]')).toBeVisible()
    // The second tap on Continue lands where [Pay 11.00 BCPS] now sits: no payment.
    await ana(page).locator('[data-tile="scan"]').click()
    await expect(ana(page).getByTestId('scan-status')).toContainText('Locked · Café Lipa')
    await ana(page).getByRole('button', { name: 'Continue' }).dblclick()
    const review = ana(page).locator('[data-screen="c.payCode.review"]')
    await expect(review).toBeVisible()
    await page.waitForTimeout(1600)
    await expect(review).toBeVisible()
    await expect(ana(page).getByRole('button', { name: 'Pay 11.00 BCPS' })).toBeEnabled()
    await expect(page.getByTestId('tape-row')).toHaveCount(0)
    await expect(phone.locator('[data-screen="pos.code"]')).toBeVisible()
    // A deliberate tap once the review has settled pays, once.
    await ana(page).getByRole('button', { name: 'Pay 11.00 BCPS' }).click()
    await expect(phone.locator('[data-screen="pos.paid"]')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('tape-row')).toHaveCount(1)
  })

  test('Home then pay: the café is told with a banner; a tap opens the sale; Done goes back', async ({ page }) => {
    await both(page)
    await chargeEleven(page)
    const phone = cafe(page)
    await phone.getByTestId('nav-home').click()
    await expect(phone.locator('[data-screen="pos.home"]')).toBeVisible()
    await scanToReview(page)
    await ana(page).getByRole('button', { name: 'Pay 11.00 BCPS' }).click()
    const banner = phone.getByTestId('banner')
    await expect(banner).toContainText('Payment received · 11.00 BCPS', { timeout: 5000 })
    await expect(banner).toContainText('from @ana · 2 × flat white · 2 × croissant')
    await expect(phone.getByTestId('bell-count')).toHaveText('3') // the two from the start and the sale
    await banner.click()
    const received = phone.locator('[data-screen="biz.received"]')
    await expect(received).toBeVisible()
    await expect(received).toContainText('RECEIVED')
    await expect(received).toContainText('From notification · 12:15')
    await expect(received.getByTestId('success-amount')).toContainText('+11.00')
    await expect(received).toContainText('from @ana · Ana Novak')
    await expect(received).toContainText('Spendable now')
    await expect(received).toContainText('Sale')
    await expect(received).toContainText('2 × flat white · 2 × croissant')
    await expect(received).toContainText('0.11 BCPS')
    await expect(received.getByText(/^BC-[0-9A-Z]{6}$/)).toBeVisible()
    await received.getByRole('button', { name: 'Done' }).click()
    await expect(phone.locator('[data-screen="pos.home"]')).toBeVisible()
    await expect(phone.getByTestId('bell-count')).toHaveText('2')
    await expect(phone.locator('[data-tile="sales"]')).toContainText('24 today · 122.38')
  })

  test('reload then pay: the Charge tile opens straight on the code', async ({ page }) => {
    await both(page)
    await chargeEleven(page)
    const before = await cafe(page).locator('[data-payload]').getAttribute('data-payload')
    await page.reload()
    await page.locator('[data-testid="stage"]').waitFor()
    await expect(cafe(page).locator('[data-screen="pos.home"]')).toBeVisible()
    await cafe(page).locator('[data-tile="charge"]').click()
    await expect(cafe(page).locator('[data-screen="pos.code"]')).toBeVisible()
    await expect(cafe(page).locator('[data-payload]').getAttribute('data-payload')).resolves.toBe(before)
    await scanToReview(page)
    await ana(page).getByRole('button', { name: 'Pay 11.00 BCPS' }).click()
    await expect(cafe(page).locator('[data-screen="pos.paid"]')).toBeVisible({ timeout: 5000 })
    await balanceAfter(page, 'ana', '236.50')
    await balanceAfter(page, 'cafe', '296.89')
  })

  test('the phones swap mid-sale: the code is still on the other phone and still scans', async ({ page }) => {
    await both(page)
    await chargeEleven(page)
    await page.getByTestId('swap').click()
    await expect(slot(page, 'left')).toHaveAttribute('data-persona', 'cafe')
    await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'ana')
    await expect(slot(page, 'left').locator('[data-screen="pos.code"]')).toBeVisible()
    await slot(page, 'right').locator('[data-tile="scan"]').click()
    await expect(slot(page, 'right').getByTestId('scan-status')).toContainText('Locked · Café Lipa')
    await slot(page, 'right').getByRole('button', { name: 'Continue' }).click()
    await slot(page, 'right').getByRole('button', { name: 'Pay 11.00 BCPS' }).click()
    await expect(slot(page, 'left').locator('[data-screen="pos.paid"]')).toBeVisible({ timeout: 5000 })
    await balanceAfter(page, 'cafe', '296.89')
  })

  test('the café is not on a phone: a gutter toast "Payment received", a tap opens the sale on that phone', async ({
    page,
  }) => {
    await both(page)
    await chargeEleven(page)
    const payload = await cafe(page).locator('[data-payload]').getAttribute('data-payload')
    const req = payload?.match(/req=([^&]+)/)?.[1]
    await cafe(page).getByTestId('nav-home').click()
    // Marko takes the right phone: the café is off the stage with its code still open.
    await page.getByTestId('account-menu-right').click()
    await page.getByTestId('account-marko').click()
    await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'marko')
    await page.evaluate(
      (id) =>
        (window as unknown as { __bcps: { dispatch(c: unknown): { ok: boolean } } }).__bcps.dispatch({
          type: 'pay',
          actor: 'ana',
          cmdId: 'e2e00000000000ac:review',
          to: '@cafelipa',
          amount: 1100,
          channel: 'qr',
          requestId: id,
          note: 'Table 4',
          expect: { senderDebit: 1100 },
        }),
      req,
    )
    const toast = page.getByTestId('toast')
    await expect(toast).toHaveCount(1, { timeout: 5000 })
    // As drawn: "Payment received" over "11.00 BCPS from @ana".
    await expect(toast).toHaveText(/^Payment received\s*11\.00 BCPS from @ana$/)
    await toast.click()
    await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'cafe')
    const received = slot(page, 'right').locator('[data-screen="biz.received"]')
    await expect(received).toBeVisible()
    await expect(received.getByTestId('success-amount')).toContainText('+11.00')
    await received.getByRole('button', { name: 'Done' }).click()
    await expect(slot(page, 'right').locator('[data-screen="pos.home"]')).toBeVisible()
    await expect(slot(page, 'right').getByTestId('bell-count')).toHaveText('2')
    await balanceAfter(page, 'cafe', '296.89')
  })
})

test.describe('Pay supplier on the stage @webkit', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  const cafe = (page: Page) => slot(page, 'right')

  async function both(page: Page) {
    await openApp(page, '#/stage')
    await biometricLogin(page, 'left')
    await biometricLogin(page, 'right')
  }

  async function toReview(page: Page) {
    const phone = cafe(page)
    await phone.locator('[data-tile="pay"]').click()
    await expect(phone.locator('[data-screen="pos.pay"]')).toBeVisible()
    await expect(phone.getByTestId('row-paySupplier')).toContainText('By @name, code or invoice')
    await phone.getByTestId('row-paySupplier').click()
    await expect(phone.locator('[data-screen="biz.send.review"]')).toBeVisible()
  }

  test('the order opens on Review: Pekarna Zrno, 8.80, "Croissant delivery", total 8.89, paid; café 277.11, bakery 8.80', async ({
    page,
  }) => {
    await both(page)
    const phone = cafe(page)
    await toReview(page)
    const review = phone.locator('[data-screen="biz.send.review"]')
    await expect(phone.getByRole('heading', { name: 'Pay supplier' })).toBeVisible()
    await expect(review).toContainText('Check and pay')
    await expect(review).toContainText('Pekarna Zrno')
    await expect(review).toContainText('Business · Producer')
    await expect(review.getByRole('button', { name: 'Verified business or person' })).toBeVisible()
    await expect(review).toContainText('8.80 BCPS')
    await expect(review).toContainText('≈ €8.00')
    await expect(review).toContainText('Croissant delivery')
    await expect(phone.getByTestId('fee-line')).toContainText('Transaction fee 1% · 0.09 BCPS (≈ €0.08) · paid by you')
    await expect(phone.getByTestId('review-total')).toContainText('8.89')
    await expect(phone.getByTestId('balance-after')).toHaveText('Balance after 277.11 BCPS')
    await expect(phone.getByText(/Step \d of/)).toHaveCount(0)
    await phone.getByRole('button', { name: 'Pay 8.89 BCPS' }).dblclick()
    await expect(phone.getByRole('button', { name: 'Sending…' })).toBeVisible()
    await expect(page.getByTestId('edge-marker')).toContainText('Pekarna Zrno')
    const done = phone.locator('[data-screen="biz.send.done"]')
    await expect(done).toBeVisible({ timeout: 5000 })
    await expect(done).toContainText('PAID')
    await expect(done).toContainText('to Pekarna Zrno')
    await expect(done).toContainText('0.09 BCPS · paid by you')
    await expect(page.getByTestId('tape-row')).toHaveCount(1)
    await expect(page.getByTestId('tape-row').first()).toContainText(
      'Café Lipa → Pekarna Zrno · 8.80 BCPS · settled · fee 0.09',
    )
    await done.getByRole('button', { name: 'Done' }).click()
    await expect(phone.locator('[data-screen="pos.home"]')).toBeVisible()
    await balanceAfter(page, 'cafe', '277.11')
    await expectCleanVisibleCopy(page)
  })

  test('after the sale the café ends on 288.00; Edit opens a step, its button reads "Back to review"', async ({
    page,
  }) => {
    await both(page)
    const phone = cafe(page)
    await slot(page, 'right').locator('[data-tile="charge"]').click()
    for (const sku of ['flat-white', 'flat-white', 'croissant', 'croissant'])
      await phone.getByTestId(`item-${sku}`).click()
    await phone.getByRole('button', { name: 'Charge 11.00 BCPS' }).click()
    await slot(page, 'left').locator('[data-tile="scan"]').click()
    await slot(page, 'left').getByRole('button', { name: 'Continue' }).click()
    await slot(page, 'left').getByRole('button', { name: 'Pay 11.00 BCPS' }).click()
    await expect(phone.locator('[data-screen="pos.paid"]')).toBeVisible({ timeout: 5000 })
    await phone.getByTestId('nav-home').click()
    await toReview(page)
    await expect(phone.getByTestId('balance-after')).toHaveText('Balance after 288.00 BCPS')
    // Edit the note: the chips are the supplier ones.
    await phone.getByTestId('edit-Note').click()
    await expect(phone.locator('[data-screen="biz.send.note"]')).toBeVisible()
    for (const chip of ['Croissant delivery', 'Freight', 'Stainless shelving'])
      await expect(phone.getByRole('button', { name: chip, exact: true })).toBeVisible()
    await phone.getByRole('button', { name: 'Freight', exact: true }).click()
    await phone.getByRole('button', { name: 'Back to review' }).click()
    await expect(phone.locator('[data-screen="biz.send.review"]')).toContainText('Freight')
    await phone.getByTestId('edit-Amount').click()
    await expect(phone.getByRole('button', { name: 'Back to review' })).toBeVisible()
    await phone.getByTestId('nav-back').click()
    await expect(phone.locator('[data-screen="biz.send.review"]')).toBeVisible()
    // Back on the review leaves the flow (nothing was sent), and the order is there again next time.
    await phone.getByTestId('nav-back').click()
    await expect(phone.locator('[data-screen="pos.pay"]')).toBeVisible()
    await phone.getByTestId('row-paySupplier').click()
    await expect(phone.locator('[data-screen="biz.send.review"]')).toContainText('Croissant delivery')
    await phone.getByRole('button', { name: 'Pay 8.89 BCPS' }).click()
    await expect(phone.locator('[data-screen="biz.send.done"]')).toBeVisible({ timeout: 5000 })
    await balanceAfter(page, 'cafe', '288.00')
  })
})

test.describe('the café on a phone', () => {
  test.use({ viewport: { width: 390, height: 664 } })

  test('Charge and the code work in phone mode; the browser Back is the in-phone Back', async ({ page }) => {
    await openApp(page, '#/phone/cafe')
    await page.locator('[data-tile="charge"]').click()
    await page.getByTestId('item-brunch').click()
    await page.getByRole('button', { name: 'Charge 13.20 BCPS' }).click()
    await expect(page.locator('[data-screen="pos.code"]')).toBeVisible()
    await expect(page.getByTestId('code-countdown')).toHaveText('Valid for 4:59')
    // Back from the code is the Cancel question, in the browser as in the phone.
    await page.goBack()
    await expect(page.locator('[data-screen="pos.code.cancel"]')).toBeVisible()
    await page.getByRole('button', { name: 'Keep' }).click()
    await expect(page.locator('[data-screen="pos.code"]')).toBeVisible()
  })

  test('every café screen fits without the page scrolling', async ({ page }) => {
    await openApp(page, '#/phone/cafe')
    const fits = async () =>
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
    await fits()
    await page.locator('[data-tile="charge"]').click()
    await fits()
    await page.getByTestId('item-custom').click()
    await fits()
  })
})
