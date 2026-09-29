// Sizes: the stage at 1,280 × 720 (full screen), 1,280 × 800 and 1,440 × 900, and phone mode at
// 390 × 664 and 375 × 548. The phones never overflow the window, no toast covers a phone, and
// every Home fits without scrolling.
import { expect, test } from '@playwright/test'
import { SEND, biometricLogin, openApp, overlaps, pay, slot } from './helpers'

const STAGES: [w: number, h: number, minScale: number][] = [
  [1280, 720, 0.88],
  [1280, 800, 0.95],
  [1440, 900, 1],
  [1024, 720, 0.78],
]

for (const [w, h, minScale] of STAGES) {
  test.describe(`stage ${w} × ${h}`, () => {
    test.use({ viewport: { width: w, height: h } })

    test(`the phones fit the window (scale ${minScale} or more) and nothing scrolls`, async ({ page }) => {
      await openApp(page, '#/stage')
      await biometricLogin(page, 'left')
      await biometricLogin(page, 'right')
      const left = await slot(page, 'left').boundingBox()
      const right = await slot(page, 'right').boundingBox()
      const tape = await page.getByTestId('tape').boundingBox()
      if (!left || !right || !tape) throw new Error('missing boxes')
      expect(left.width / 390).toBeGreaterThanOrEqual(minScale)
      expect(overlaps(left, right)).toBe(false)
      expect(left.x).toBeGreaterThanOrEqual(0)
      expect(right.x + right.width).toBeLessThanOrEqual(w)
      expect(left.y + left.height).toBeLessThanOrEqual(tape.y + 1)
      const size = await page.evaluate(() => ({
        h: document.scrollingElement?.scrollHeight ?? 0,
        w: document.scrollingElement?.scrollWidth ?? 0,
      }))
      expect(size.h).toBeLessThanOrEqual(h)
      expect(size.w).toBeLessThanOrEqual(w)
      // A toast never covers a phone.
      await pay(page, SEND)
      const toast = await page.getByTestId('toast').boundingBox()
      if (toast) {
        expect(overlaps(toast, left)).toBe(false)
        expect(overlaps(toast, right)).toBe(false)
      }
    })
  })
}

for (const [w, h] of [
  [390, 664],
  [375, 548],
] as const) {
  test.describe(`phone mode ${w} × ${h}`, () => {
    test.use({ viewport: { width: w, height: h } })

    test('Welcome and the Homes fit without scrolling; the dock stays inside the window', async ({ page }) => {
      await openApp(page, '#/phone')
      const bio = await page.getByRole('button', { name: 'Log in with biometrics' }).boundingBox()
      expect((bio?.y ?? 0) + (bio?.height ?? 0)).toBeLessThanOrEqual(h)
      for (const who of ['ana', 'cafe']) {
        await openApp(page, `#/phone/${who}`)
        await expect(slot(page, 'single')).toHaveAttribute('data-persona', who)
        const size = await page.evaluate(() => ({
          h: document.scrollingElement?.scrollHeight ?? 0,
          w: document.scrollingElement?.scrollWidth ?? 0,
        }))
        expect(size.h).toBeLessThanOrEqual(h)
        expect(size.w).toBeLessThanOrEqual(w)
        const home = page.locator('[data-screen$=".home"]')
        const overflow = await home.evaluate((el) => {
          const body = el.querySelector(':scope > div.overflow-y-auto') as HTMLElement | null
          return body ? body.scrollHeight - body.clientHeight : 0
        })
        expect(overflow).toBeLessThanOrEqual(0)
      }
    })
  })
}
