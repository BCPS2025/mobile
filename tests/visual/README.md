# Visual regression baselines

`toHaveScreenshot` specs (`*.spec.ts`) for key screens: every Home, every designed screen and one
screen per flow family, in Chromium at device scale 2 with the manual clock and fonts loaded.
They arrive with the screens, from milestone A2.

Baselines live in `__screenshots__/` and are generated only in the pinned Playwright Docker image
that the CI `visual` job uses (`mcr.microsoft.com/playwright:v1.63.0-noble`), never on a Mac:
font rendering differs. A new or changed baseline is committed on its own, after review.
