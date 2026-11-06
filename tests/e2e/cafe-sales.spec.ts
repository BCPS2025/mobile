// The café's sales (pos.sales): Today and 7 days with SALES / GROSS / FEES / NET, the chart, the
// conversions to euros, Export CSV and the accounting integration that is planned. Every figure
// comes from the ledger: a sale made now moves Today at once.
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { SALE, expectBalance, expectCleanFileName, expectNoSeriousViolations, pay, slot, stageBoth } from './helpers'

test.use({ viewport: { width: 1280, height: 720 } })

const kpi = (cafe: import('@playwright/test').Locator, id: 'sales' | 'gross' | 'fees' | 'net') =>
  cafe.getByTestId(`kpi-${id}`)

async function openSales(cafe: import('@playwright/test').Locator) {
  await cafe.locator('[data-tile="sales"]').click()
  await expect(cafe.locator('[data-screen="pos.sales"]')).toBeVisible()
}

test.describe('Sales · Today', () => {
  test('23 payments · 111.38 · 1.11 · 110.27, then 24 · 122.38 · 1.22 · 121.16 after an 11.00 sale', async ({
    page,
  }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await expect(cafe.locator('[data-tile="sales"]')).toContainText('23 today · 111.38')
    await openSales(cafe)
    await expect(cafe.getByTestId('range-today')).toHaveAttribute('aria-checked', 'true')
    await expect(kpi(cafe, 'sales')).toContainText('23')
    await expect(kpi(cafe, 'gross')).toContainText('111.38')
    await expect(kpi(cafe, 'fees')).toContainText('1.11')
    await expect(kpi(cafe, 'net')).toContainText('110.27')
    // The only row is the seeded one; the list ends on All payments.
    await expect(cafe.getByTestId('sales-summary')).toContainText('Today so far · 23 payments')
    await expect(cafe.getByTestId('row-allPayments')).toBeVisible()

    await pay(page, SALE)
    await expect(kpi(cafe, 'sales')).toContainText('24')
    await expect(kpi(cafe, 'gross')).toContainText('122.38')
    await expect(kpi(cafe, 'fees')).toContainText('1.22')
    await expect(kpi(cafe, 'net')).toContainText('121.16')
    // The sale is the first row: who, the table, the time and the items.
    const row = cafe.locator('[data-testid^="sale-BC-"]').first()
    await expect(row).toContainText('@ana')
    await expect(row).toContainText('2 × flat white · 2 × croissant')
    await expect(row).toContainText('11.00')
    // It opens the payment as the café sees it.
    await row.click()
    await expect(cafe.locator('[data-screen="shared.tx"]')).toBeVisible()
    await expect(cafe.locator('[data-screen="shared.tx"]')).toContainText('Final · no chargebacks')
  })

  test('the tab is kept while the café looks at All payments and comes back', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await openSales(cafe)
    await cafe.getByTestId('range-7d').click()
    await expect(cafe.getByTestId('sales-chart')).toBeVisible()
    await cafe.getByTestId('row-allPayments').click()
    await expect(cafe.locator('[data-screen="biz.history"]')).toBeVisible()
    await cafe.getByTestId('nav-back').click()
    await expect(cafe.getByTestId('range-7d')).toHaveAttribute('aria-checked', 'true')
    await expect(cafe.getByTestId('sales-chart')).toBeVisible()
  })
})

test.describe('Sales · 7 days', () => {
  test('180 payments · 1,221.22 · 12.20 · 1,209.02, a chart Sat to Fri with Closed under Sunday', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await openSales(cafe)
    await cafe.getByTestId('range-7d').click()
    await expect(kpi(cafe, 'sales')).toContainText('180')
    await expect(kpi(cafe, 'gross')).toContainText('1,221.22')
    await expect(kpi(cafe, 'fees')).toContainText('12.20')
    await expect(kpi(cafe, 'net')).toContainText('1,209.02')

    const chart = cafe.getByTestId('sales-chart')
    await expect(chart).toContainText('Closed')
    // Seven bars; today's is the last, and the chart has a table for a screen reader.
    await expect(chart.locator('[data-testid^="bar-"]')).toHaveCount(7)
    await expect(chart.locator('table.sr-only tbody tr')).toHaveCount(7)
    // Tapping a bar says what the day held.
    await chart.locator('[data-testid^="bar-"]').nth(5).click()
    await expect(cafe.getByTestId('bar-detail')).toContainText('Thu 24 Sep · 42 payments · 309.80 BCPS')
    // The closed Sunday says so.
    await chart.locator('[data-testid^="bar-"]').nth(1).click()
    await expect(cafe.getByTestId('bar-detail')).toContainText('Sun 20 Sep · Closed')

    // The conversions of the week, newest first, with the euros they paid.
    const conversions = cafe.getByTestId('sales-conversions').locator('li')
    await expect(conversions).toHaveCount(6)
    await expect(conversions.first()).toContainText('Thu 24 Sep · 23:00')
    await expect(conversions.first()).toContainText('175.73 BCPS')
    await expect(conversions.first()).toContainText('≈ €157.35')
    await expect(cafe.getByTestId('accounting-planned')).toContainText('Accounting integration')
    await expect(cafe.getByTestId('accounting-planned')).toContainText('PLANNED')
  })

  test('Export CSV saves cafe-lipa-sales-2026-09-25.csv: every cell quoted, "\'@ana" for a handle', async ({
    page,
  }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await pay(page, SALE)
    await expectBalance(page, 'cafe', '296.89')
    await openSales(cafe)
    await cafe.getByTestId('range-7d').click()
    const [download] = await Promise.all([page.waitForEvent('download'), cafe.getByTestId('export-csv').click()])
    expect(download.suggestedFilename()).toBe('cafe-lipa-sales-2026-09-25.csv')
    expectCleanFileName(download.suggestedFilename())
    const path = await download.path()
    const text = readFileSync(path, 'utf8')
    const lines = text.trimEnd().split('\n')
    expect(lines[0]).toBe('date,time,reference,payer,items,gross,fee,net')
    // The sale made now is the last line (oldest first); its payer cell is neutralised.
    const last = lines[lines.length - 1] ?? ''
    expect(last).toMatch(
      /^"2026-09-25","12:1\d","BC-[0-9A-Z]{6}","'@ana","2 × Flat white, 2 × Croissant","11.00","0.11","10.89"$/,
    )
    // The seeded daily rows are there as one line each.
    expect(lines.filter((l) => l.includes('payments')).length).toBeGreaterThanOrEqual(6)
    // No download link stays on the page.
    await expect(page.locator('a[download]')).toHaveCount(0)
  })

  test('no serious accessibility violation on Today and on 7 days', async ({ page }) => {
    await stageBoth(page)
    const cafe = slot(page, 'right')
    await openSales(cafe)
    await page.waitForTimeout(600)
    await expectNoSeriousViolations(page, 'Sales · Today')
    await cafe.getByTestId('range-7d').click()
    await page.waitForTimeout(600)
    await expectNoSeriousViolations(page, 'Sales · 7 days')
  })
})
