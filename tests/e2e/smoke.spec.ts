// Smoke test of the pages the app has between milestones A1 and A2 (start, about, the payment
// code landing, not-found): online and offline after one load, no foreign requests, noindex,
// clean visible copy (decision D16) and no enabled control that leads to the not-found route.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import {
  expectCleanVisibleCopy,
  expectNoindex,
  open,
  trackForeignRequests,
  visibleTextOf,
  waitForServiceWorker,
} from './helpers'

// The collected-text check relies on the earlier tests of this file: run (and retry) them together.
test.describe.configure({ mode: 'serial' })

const PAY = '#/pay?v=1&to=@cafelipa&amount=11.00'

/** Routes and whether each one is the not-found page. */
const ROUTES: [hash: string, notFound: boolean][] = [
  ['#/', false],
  ['#/about', false],
  [PAY, false],
  ['#/pay', false],
  ['#/stage', true],
  ['#/no-such-page', true],
]

/** Collected visible text of every page visited, fed to check-banned at the end. */
const visible: string[] = []

async function collect(page: Page): Promise<void> {
  await expectCleanVisibleCopy(page)
  visible.push(`--- ${page.url()}\n${await visibleTextOf(page)}`)
}

test.describe('pages', () => {
  test('every route: clean copy, noindex, no foreign requests', async ({ page, baseURL }) => {
    const foreign = trackForeignRequests(page, baseURL as string)
    for (const [hash, notFound] of ROUTES) {
      await open(page, hash)
      await expectNoindex(page)
      await expect(page.locator('[data-testid="not-found"]')).toHaveCount(notFound ? 1 : 0)
      await collect(page)
    }
    await expect(page).toHaveTitle('BCPS')
    expect(foreign).toEqual([])
  })

  test('the payment code landing reads the code', async ({ page }) => {
    await open(page, PAY)
    await expect(page.getByText('Café Lipa')).toBeVisible()
    await expect(page.getByText('11.00 BCPS')).toBeVisible()
    await open(page, '#/pay?v=1&to=nobody')
    await expect(page.getByText("This payment code can't be read.")).toBeVisible()
  })

  test('works offline after one load', async ({ page, context, baseURL }) => {
    const foreign = trackForeignRequests(page, baseURL as string)
    await open(page, '#/')
    await waitForServiceWorker(page)
    await context.setOffline(true)
    await page.reload()
    await page.locator('#root > *').first().waitFor()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pay and get paid in seconds.')
    const fonts = await page.evaluate(async () => {
      const loaded = await document.fonts.load('600 16px "Space Grotesk"')
      return { loaded: loaded.length, check: document.fonts.check('600 16px "Space Grotesk"') }
    })
    expect(fonts.check).toBe(true)
    expect(fonts.loaded).toBeGreaterThan(0)
    await open(page, '#/about')
    await collect(page)
    await context.setOffline(false)
    expect(foreign).toEqual([])
  })

  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixtures argument
  test('collected visible text passes check-banned', async ({}, testInfo) => {
    expect(visible.length).toBeGreaterThanOrEqual(ROUTES.length)
    const file = testInfo.outputPath('visible-text.txt')
    writeFileSync(file, visible.join('\n\n'))
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
  })

  test('no enabled control leads to the not-found route', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    let clicked = 0
    for (const hash of ['#/', '#/about', PAY]) {
      const prepare = async () => {
        await open(page, hash)
        await page.reload()
        await page.locator('#root > *').first().waitFor()
      }
      await prepare()
      const controls = page.locator('button:enabled:visible, a[href]:visible')
      const count = await controls.count()
      for (let i = 0; i < count; i++) {
        if ((await controls.count()) !== count || new URL(page.url()).hash !== new URL(hash, page.url()).hash) {
          await prepare()
        }
        const el = controls.nth(i)
        if (!(await el.isVisible()) || !(await el.isEnabled())) continue
        const href = await el.getAttribute('href')
        if (href && !href.startsWith('#')) throw new Error(`Link leaves the app: ${href}`)
        await el.click({ timeout: 3000 }).catch(() => {}) // covered or moved: skip, not a route
        clicked++
        await page.waitForTimeout(150)
        await expect(
          page.locator('[data-testid="not-found"]'),
          `${hash} control ${i} (${href ?? 'button'})`,
        ).toHaveCount(0)
      }
    }
    expect(clicked).toBeGreaterThanOrEqual(4)
    expect(errors).toEqual([])
  })
})
