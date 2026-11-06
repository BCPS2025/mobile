import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against the assembled Pages artifact (_site/), served under /mobile/ as
// on GitHub Pages: the legacy page at /mobile/, the app at /mobile/next/.
// Build first (`npx vite build`); the web server assembles _site/ and serves it. With
// BCPS_PREBUILT_SITE=1 (the CI e2e and visual jobs, which download _site/ from the build job)
// it only serves what is there.
//
// Projects:
//   chromium  every spec in tests/e2e (CI: three shards)
//   webkit    the specs tagged @webkit (the iOS Safari subset; CI: one job)
//   visual    tests/visual, toHaveScreenshot baselines, generated only in the pinned
//             Playwright Docker image (CI `visual` job)
const PORT = 4317
const CI = Boolean(process.env.CI)
const PREBUILT = process.env.BCPS_PREBUILT_SITE === '1'
const serve = `node scripts/serve-site.mjs --port ${PORT}`

export default defineConfig({
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: 1,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/mobile/next/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    {
      name: 'chromium',
      testDir: 'tests/e2e',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit',
      testDir: 'tests/e2e',
      grep: /@webkit/,
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'visual',
      testDir: 'tests/visual',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: PREBUILT ? serve : `node scripts/assemble-site.mjs && ${serve}`,
    url: `http://127.0.0.1:${PORT}/mobile/next/`,
    reuseExistingServer: !CI,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
