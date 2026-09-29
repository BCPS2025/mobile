# ADR-0003: Deployment, offline copy and hardening

Status: accepted (2026-09)

## Context

The site is hosted on GitHub Pages, which cannot send custom HTTP headers. The app has to keep
working with no network, and a copy has to run from a USB stick. Edits made in the web interface
must never reach the live site unchecked.

## Decision

- One workflow, `.github/workflows/pages.yml`, in separate jobs (amended 2026-09: one job no
  longer held the whole suite):
  - `static`: typecheck, Biome, layer check, wording check and its meta-test, commit identity
    check, content check, state-version check;
  - `unit`: unit, golden, property and performance tests;
  - `build`: production build and one-file build, assembly of `_site/` (the current page at the
    root, the app under `next/`), bundle and asset budgets, uploads of `_site/`, the one-file
    copy and the bundle report as workflow artifacts;
  - `e2e` (Chromium in three shards, WebKit in one) and `visual` (in the pinned Playwright
    image) test the downloaded `_site/`;
  - `gate` succeeds only when every job above succeeded;
  - `deploy`: `needs: gate`, runs only on `main`, for pushes and manual runs
    (`workflow_dispatch`, which republishes the last green build); publishes with
    `actions/deploy-pages` in the `github-pages` environment, one deployment at a time; on a
    `v*` tag, `release` attaches the one-file copy to the release.
  - Only the built-in `GITHUB_TOKEN` is used, with the least permissions per job.
  - Every job runs locally with the same commands: `scripts/ci-local.sh <job>`.
- Offline: `vite-plugin-pwa` with generateSW precaches scripts, styles, fonts, icons and the
  manifest. Only the app root falls back to `index.html` offline. `reset.html` is never
  precached and never served from the fallback; it works without JavaScript modules, unregisters
  the service worker, clears the caches and goes back to the app. Updates wait for a prompt.
- One-file copy: `vite build --mode single` inlines scripts, styles and fonts, has no service
  worker, and carries a Content-Security-Policy that allows exactly its inline scripts by hash.
  Payment codes in any non-https build point at the canonical https address, never at a local
  path.
- Hardening without headers: a Content-Security-Policy meta element on every page, `noindex`
  on every page, `referrer: no-referrer`, and a boot check that refuses to render inside a frame
  (Pages cannot send `frame-ancestors`).

## Consequences

- A red build never deploys, even if branch protection is bypassed, because `deploy` depends
  on `gate`.
- The one-file copy is larger (fonts inlined) and has no update path; it is downloaded from the
  workflow run when needed.
- Branch protection with the required check `gate` is set in the repository settings; the
  workflow dependency is the gate that holds regardless.
