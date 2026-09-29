# ADR-0001: Stack

Status: accepted (2026-09)

## Context

The app shows BCPS payments on two phones in one browser window, on a laptop, on a projector,
on a phone and without a network connection. Edits come from several people, often through the
GitHub web interface, and the code is written with AI assistance. Money arithmetic must be
checked by a compiler and by tests before anything is published.

## Decision

- Vite, TypeScript (strict) and React 19. State lives in a small external store read with
  `useSyncExternalStore`.
- Tailwind CSS v4, compiled at build time. Design tokens in `src/app/tokens.css`.
- `vite-plugin-pwa` (generateSW) for the offline copy; `vite-plugin-singlefile` for a one-file
  copy that opens from disk.
- Self-hosted fonts (`@fontsource`), `uqr` for QR codes, `lucide-react` icons. `zod` and `yaml`
  validate the content at build time; the page receives plain JSON. All dependencies are pinned
  and bundled; the page makes no requests to other origins.
- Vite `base: './'` with hash routing, so the same build runs under a sub-folder, at the site
  root and from `file://`.
- GitHub Actions builds, tests and deploys (ADR-0003).

## Consequences

- A build step stands between an edit and the live site, so a broken edit cannot be published.
- React is familiar to most contributors and assistants; its size (about 50 kB gzip) fits the
  budget of 150 kB gzip of initial JavaScript.
- Browser floor: Safari 16.4, Chrome 111, Firefox 128 (cascade layers, `@property`,
  `color-mix`).
- Rejected: a single hand-written HTML file as the main app (untestable, depends on CDNs), a
  native app (store friction), and any backend or test network (the app must work offline).
