# BCPS

A web app that walks through BCPS payments on two phones side by side: a customer pays a café by
QR code, the café pays its bakery, and every balance and fee updates as it settles.

This web app runs entirely in the browser. It has no server, holds no funds and connects to no bank,
card network or blockchain.

## Run it locally

Requirements: Node.js 22.18 or newer (the scripts use Node's built-in TypeScript support).

```sh
npm ci
npm run dev          # development server with hot reload
```

Open the address it prints. Routes are hash-based: `#/` (landing), `#/stage` (two phones side by side),
`#/phone` (one phone with an account switcher), `#/phone/<person>` (logs that person in), `#/about`
and `#/pay?…` (a payment link, request or code this browser knows opens its payment page; any other
address opens phone mode). Add `?clock=manual` for a virtual clock that moves
only when told to (the end-to-end tests use it).

## Checks

The CI workflow (`.github/workflows/pages.yml`) runs the jobs `static`, `unit`, `build`, `e2e` and
`visual`; `gate` passes only when all of them pass, and only then does `deploy` publish `main`.
Each job runs locally with the same commands:

| Command | What it does |
|---|---|
| `npm run ci` | Every job below in CI order, then the gate, with a summary |
| `npm run ci:static` | Typecheck, Biome, layer check, wording check and its meta-test, commit identity, content check, state-version check |
| `npm run ci:unit` | `npx vitest run`: unit tests, golden journeys (`tests/golden/`), property tests (`tests/property/`; `FC_SEED`, `FC_RUNS`) and performance tests |
| `npm run ci:build` | Both builds, `_site/`, the budgets (`scripts/budgets.json`, report in `reports/`) and the manifest wording check |
| `npm run ci:e2e` | Playwright against the built `_site/`: Chromium in three shards, WebKit when installed |
| `npm run ci:visual` | Screenshot comparison (`tests/visual/`; CI runs it in the pinned Playwright image) |

Single commands:

| Command | What it does |
|---|---|
| `npx tsc -b` | Typecheck |
| `npx biome ci .` | Formatting and lint rules, including the device-access rule for `src/` |
| `npx vitest run` | Every Vitest suite |
| `node scripts/check-banned.ts` | Wording rules on content, Markdown, state files, pages and source files (see CONTRIBUTING.md) |
| `ALLOWED_COMMIT_EMAILS=… bash scripts/check-commit-identity.sh` | Commit author and committer emails against an allowlist |
| `npx vite build` | Production build in `dist/` (installable, works offline after one visit) and `reports/bundle.html` |
| `npx vite build --mode single` | One-file offline copy in `dist-single/index.html`, opens from disk |
| `node scripts/assemble-site.mjs` | Builds `_site/` as published: the current page at the root, the app under `next/` |
| `node scripts/check-budgets.ts` | Initial JS, precache and asset sizes of `dist/` against `scripts/budgets.json` |
| `node scripts/serve-site.mjs --port 4173` | Serves `_site/` under `/mobile/` on 127.0.0.1 (Ctrl+C stops it) |
| `npx playwright test --project=chromium` | End-to-end tests against the assembled site (build first) |
| `node scripts/render-icons.mjs` | Re-renders the app icons in `public/brand/` from the wordmark |

The first Playwright run may need `npx playwright install chromium` (and `webkit` for the WebKit
job).

## Resetting an installed copy

Open `reset.html` next to the app (or add `?sw=reset` to the start route, `#/?sw=reset`). It removes
the offline copy and its caches on that device and reloads the app.

## Layout

- `content/` – all visible text, people, starting balances and settings (YAML, validated)
- `src/domain/` – money, fees and the ledger (pure, integer arithmetic)
- `src/sim/`, `src/store/` – clock, seed and state
- `src/app/` – screens and components: `shell/` (pages, stage, presenter chrome), `phone/` (screen stacks, the
  navigation registry, phone chrome), `flows/` (the flow engine and shared steps), `state/` (page state,
  preferences), `kit/` (small components); `boot/` holds the checks that run before the app renders

Imports run one way only: `domain` ← `content` ← `sim` ← `store` ← `app`. Across layers they use the
aliases `@domain/*`, `@content/*`, `@sim/*`, `@store/*` and `@app/*` (tsconfig.json);
`node scripts/check-layers.ts` fails on an import in the wrong direction, and the domain layer imports
no packages and never reads `Date`, `Math.random` or the DOM.
- `legacy/` – the current public page, published unchanged at the site root
- `scripts/`, `.github/workflows/pages.yml` – checks, site assembly and deployment
- `docs/adr/` – architecture decisions

Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md).
