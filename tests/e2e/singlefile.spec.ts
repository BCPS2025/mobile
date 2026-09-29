// The single-file backup opens from file:// with no requests beyond the file.
// Build it first: npx vite build --mode single (CI downloads it from the build job).
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'

test.describe('single-file backup', () => {
  const single = resolve('dist-single/index.html')

  test('opens from file:// with no requests beyond the file', async ({ page }) => {
    test.skip(!existsSync(single), 'dist-single/index.html not built (npx vite build --mode single)')
    const foreign: string[] = []
    page.on('request', (r) => {
      const u = r.url()
      if (!u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) foreign.push(u)
    })
    await page.goto(`${pathToFileURL(single).href}#/`)
    await page.locator('#root > *').first().waitFor()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pay and get paid in seconds.')
    // Phone mode from file://: Welcome with its emblem, then Home after biometrics.
    await page.goto(`${pathToFileURL(single).href}?clock=manual&epoch=2026-09-25#/phone`)
    await expect(page.locator('[data-screen="auth.welcome"]')).toBeVisible()
    const emblem = page.locator('[data-screen="auth.welcome"] img[alt="BCPS"]')
    await expect(emblem).toBeVisible()
    expect(await emblem.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Log in with biometrics' }).click()
    await expect(page.locator('[data-screen="c.home"]')).toBeVisible()
    await expect(page.locator('[data-testid="balance-ana"]')).toContainText('247.50')
    // The stage from file://: two phones.
    await page.goto(`${pathToFileURL(single).href}?clock=manual&epoch=2026-09-25#/stage`)
    await expect(page.locator('[data-slot="left"]')).toBeVisible()
    await expect(page.locator('[data-slot="right"]')).toBeVisible()
    expect(foreign).toEqual([])
  })
})
