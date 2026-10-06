// The café's History and the summary of a day: the daily rows open the day with its totals, its
// first sale, its busiest hour and the evening's conversion; Export CSV saves the day.
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { expectCleanFileName, expectNoSeriousViolations, slot, stageBoth } from './helpers'

test.use({ viewport: { width: 1280, height: 720 } })

async function openHistory(cafe: import('@playwright/test').Locator) {
  await cafe.locator('[data-tile="sales"]').click()
  await cafe.getByTestId('row-allPayments').click()
  await expect(cafe.locator('[data-screen="biz.history"]')).toBeVisible()
}

test.describe('History of the café', () => {
  test('search, the chips of the business and no SCHEDULED row', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await openHistory(cafe)
    await expect(cafe.getByTestId('history-search')).toHaveAttribute(
      'placeholder',
      'Search sales, customers, references',
    )
    await expect(cafe.getByTestId('history-chips').locator('button')).toHaveText([
      'All',
      'Sales',
      'Refunds',
      'Supplier payments',
      'Payouts',
      'Top-ups',
    ])
    await expect(cafe.locator('[data-screen="biz.history"]')).not.toContainText('SCHEDULED')
  })

  test('a daily sales row opens that day: net sales, SALES / GROSS / FEES / NET and THE DAY', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await openHistory(cafe)
    // Thursday, the day before: its summary row and the conversion that evening.
    await cafe
      .getByRole('button', { name: /Daily sales/ })
      .first()
      .click()
    const day = cafe.locator('[data-screen="shared.daySummary"]')
    await expect(day).toBeVisible()
    await expect(day).toContainText('Thu 24 Sep')
    await expect(cafe.getByTestId('day-net')).toContainText('280.57')
    await expect(cafe.getByTestId('kpi-sales')).toContainText('41')
    await expect(cafe.getByTestId('kpi-gross')).toContainText('283.40')
    await expect(cafe.getByTestId('kpi-fees')).toContainText('2.83')
    await expect(cafe.getByTestId('kpi-net')).toContainText('280.57')
    const rows = cafe.getByTestId('day-rows').locator('li')
    await expect(rows.nth(0)).toContainText('First sale')
    await expect(rows.nth(0)).toContainText(/\d\d:\d\d · @\w+/)
    await expect(rows.nth(1)).toContainText('Busiest hour')
    await expect(rows.nth(1)).toContainText(/\d\d:00–\d\d:00 · \d+ payments/)
    await expect(rows.nth(2)).toContainText('Cash out · Auto 50%')
    await expect(rows.nth(2)).toContainText('23:00 · to SI56 •••• 1934')
    await expect(rows.nth(2)).toContainText('−175.73')
    await page.waitForTimeout(600)
    await expectNoSeriousViolations(page, 'Day summary')
    // Back is History.
    await cafe.getByTestId('nav-back').click()
    await expect(cafe.locator('[data-screen="biz.history"]')).toBeVisible()
  })

  test('Export CSV saves the day as one line, with every cell quoted', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await openHistory(cafe)
    await cafe
      .getByRole('button', { name: /Daily sales/ })
      .first()
      .click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      cafe.getByRole('button', { name: 'Export CSV' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('cafe-lipa-sales-2026-09-25.csv')
    expectCleanFileName(download.suggestedFilename())
    const lines = readFileSync(await download.path(), 'utf8')
      .trimEnd()
      .split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('date,time,reference,payer,items,gross,fee,net')
    expect(lines[1]).toMatch(
      /^"2026-09-24","\d\d:\d\d","BC-[0-9A-Z]{6}","","Daily sales · 41 payments","283.40","2.83","280.57"$/,
    )
  })
})
