// The single-file backup opens from file:// with no requests beyond the file.
// Build it first: npx vite build --mode single (CI downloads it from the build job).
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'

const PAY = '#/pay?v=1&to=@cafelipa&amount=11.00'

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
    await page.goto(`${pathToFileURL(single).href}${PAY}`)
    await expect(page.getByText('11.00 BCPS')).toBeVisible()
    expect(foreign).toEqual([])
  })
})
