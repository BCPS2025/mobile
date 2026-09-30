// After one load the app needs no network: the café sale, Send and Pay supplier run with the
// connection off, a reload while offline restores them, phone mode works too, and the page makes
// no request to any other origin.
import { expect, test } from '@playwright/test'
import {
  APP_QUERY,
  SEND,
  anaPaysCode,
  anaScansToReview,
  biometricLogin,
  cafeShowsCode,
  expectBalance,
  expectCleanVisibleCopy,
  openApp,
  pay,
  slot,
  trackForeignRequests,
  waitForServiceWorker,
} from './helpers'

test.describe('offline after one load', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('the café sale and Send run offline; a reload offline restores them', async ({ page, context, baseURL }) => {
    const foreign = trackForeignRequests(page, baseURL as string)
    // One online load of the stage, the phones and their fonts, then the connection goes.
    await openApp(page, '#/stage')
    await waitForServiceWorker(page)
    await context.setOffline(true)
    await page.reload()
    await page.locator('[data-testid="stage"]').waitFor()
    await biometricLogin(page, 'left')
    await biometricLogin(page, 'right')

    // The sale, with the code drawn from the ledger and the payment travelling between the phones.
    await cafeShowsCode(page)
    await anaScansToReview(page)
    await anaPaysCode(page)
    await expect(slot(page, 'right').locator('[data-screen="pos.paid"]')).toContainText('+11.00')
    await slot(page, 'left').getByRole('button', { name: 'Done' }).click()
    await expectBalance(page, 'ana', '236.50')
    await slot(page, 'right').getByRole('button', { name: 'New sale' }).click()
    await slot(page, 'right').getByTestId('nav-home').click()
    await expectBalance(page, 'cafe', '296.89')

    // Send, by the same command the review step sends.
    await pay(page, SEND)
    await expectBalance(page, 'ana', '219.83')

    // A reload while offline: the record, the phones and the balances are all there.
    await page.reload()
    await page.locator('[data-testid="stage"]').waitFor()
    await expect(slot(page, 'left')).toHaveAttribute('data-persona', 'ana')
    await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'cafe')
    await expectBalance(page, 'ana', '219.83')
    await expectBalance(page, 'cafe', '296.89')
    await expect(page.getByTestId('tape-row').first()).toContainText('settled')
    await expectCleanVisibleCopy(page)

    // Phone mode and the pages load from the cache as well.
    await openApp(page, '#/phone/cafe')
    await expect(page.locator('[data-screen="pos.home"]')).toBeVisible()
    await expectBalance(page, 'cafe', '296.89')
    await page.goto(`./${APP_QUERY}#/about`)
    await page.locator('#root > *').first().waitFor()
    await expect(page.getByText('BCPS will never ask you to send money or crypto.')).toBeVisible()
    await context.setOffline(false)
    expect(foreign).toEqual([])
  })
})
