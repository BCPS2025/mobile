// Smoke test of the pages (landing, About, the stage, phone mode, a payment link, not-found):
// online and offline after one load, no foreign requests, noindex, clean visible copy (decision
// D16) and no enabled control that leads to the not-found route.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import {
  expectCleanVisibleCopy,
  expectNoindex,
  open,
  openApp,
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
  ['#/stage', false],
  ['#/phone', false],
  [PAY, false],
  ['#/pay', false],
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
      await openApp(page, hash)
      await expectNoindex(page)
      await expect(page.locator('[data-testid="not-found"]')).toHaveCount(notFound ? 1 : 0)
      await collect(page)
    }
    await expect(page).toHaveTitle('BCPS')
    expect(foreign).toEqual([])
  })

  test('a payment link opens phone mode on Welcome, and the landing offers the stage or the phone', async ({
    page,
  }) => {
    await openApp(page, PAY)
    await expect(page.locator('[data-slot="single"][data-persona="none"]')).toBeVisible()
    await expect(page.locator('[data-screen="auth.welcome"]')).toBeVisible()
    await openApp(page, '#/')
    await expect(page.getByTestId('open-bcps')).toHaveAttribute('href', '#/stage')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByTestId('open-bcps')).toHaveAttribute('href', '#/phone')
    await page.setViewportSize({ width: 1024, height: 1366 })
    await expect(page.getByTestId('open-bcps')).toHaveAttribute('href', '#/phone')
    await page.setViewportSize({ width: 768, height: 700 })
    await expect(page.getByTestId('open-bcps')).toHaveAttribute('href', '#/stage')
  })

  test('the landing page and About make no ledger and take no writer lock', async ({ page }) => {
    await openApp(page, '#/')
    await openApp(page, '#/about')
    const keys = await page.evaluate(() => Object.keys(localStorage))
    expect(keys.filter((k) => k.startsWith('bcps:state'))).toEqual([])
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
    // The stage and phone mode load on demand: their code is in the offline cache too.
    await open(page, '#/stage')
    await expect(page.locator('[data-screen="auth.welcome"]')).toHaveCount(2)
    await collect(page)
    await open(page, '#/phone')
    await expect(page.locator('[data-screen="auth.welcome"]')).toBeVisible()
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
    for (const hash of ['#/', '#/about', PAY, '#/stage']) {
      const prepare = async () => {
        await openApp(page, hash)
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
