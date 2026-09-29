import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { CANONICAL_URL } from './src/build-constants'
import { contentPlugin } from './src/content/vite-plugin-content'

/** CSP of the normal (hosted, service-worker) build. */
const CSP_HOSTED =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; worker-src 'self'"

/**
 * CSP of the single-file backup. Everything is inline there: scripts are allowed by hash
 * (computed from the final HTML), styles and base64 fonts inline. No network, no workers.
 */
function cspSingle(scriptHashes: string[]): string {
  const scripts = scriptHashes.map((h) => `'sha256-${h}'`).join(' ')
  return [
    "default-src 'none'",
    `script-src ${scripts || "'none'"}`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  let bin = ''
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b)
  return btoa(bin)
}

const cspMeta = (policy: string) => `<meta http-equiv="Content-Security-Policy" content="${policy}" />`

/**
 * Adds the Content-Security-Policy meta at build time only (the dev server injects inline
 * scripts for hot reload, which a strict policy would block).
 * - normal build: the hosted policy, placed first in <head>;
 * - single mode: runs after vite-plugin-singlefile has inlined everything, hashes each inline
 *   <script> and inserts a policy that allows exactly those scripts.
 */
function cspPlugin(single: boolean): Plugin {
  return {
    name: 'bcps-csp',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // The backup has no separate files, so it drops the icon links.
        if (single) return html.replace(/\s*<link rel="(icon|apple-touch-icon)"[^>]*>/gi, '')
        return html.replace(/<head>/i, `<head>\n    ${cspMeta(CSP_HOSTED)}`)
      },
    },
    generateBundle: {
      order: 'post',
      async handler(_options, bundle) {
        if (!single) return
        for (const file of Object.values(bundle)) {
          if (file.type !== 'asset' || !file.fileName.endsWith('.html')) continue
          const html = typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source)
          const hashes: string[] = []
          for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
            const body = m[1] ?? ''
            if (body.length > 0) hashes.push(await sha256Base64(body))
          }
          file.source = html.replace(/<head>/i, `<head>\n    ${cspMeta(cspSingle(hashes))}`)
        }
      },
    },
  }
}

// `vite build --mode single` produces the one-file offline backup (no service worker).
export default defineConfig(({ mode }) => {
  const single = mode === 'single'
  const env = loadEnv(mode, '.', '')
  const buildSha = env.GITHUB_SHA ? env.GITHUB_SHA.slice(0, 7) : 'dev'
  return {
    // Relative paths: the same build runs under /mobile/next/, at /mobile/, and from file://.
    base: './',
    // The layer aliases (@domain/*, @content/*, @sim/*, @store/*, @app/*) come from tsconfig.json.
    resolve: { tsconfigPaths: true },
    define: {
      __CANONICAL_URL__: JSON.stringify(CANONICAL_URL),
      __BUILD_SHA__: JSON.stringify(buildSha),
    },
    plugins: [
      contentPlugin({ validator: '/src/sim/validate-content.ts' }),
      react(),
      tailwindcss(),
      single
        ? viteSingleFile()
        : VitePWA({
            registerType: 'prompt',
            // 'auto': registerSW.js is injected until the app imports virtual:pwa-register (the
            // "Update ready" prompt on the Start screen); then the app registers the worker itself.
            injectRegister: 'auto',
            // The icons are already matched by globPatterns.
            includeManifestIcons: false,
            manifest: {
              name: 'BCPS',
              short_name: 'BCPS',
              description: 'BCPS payments',
              start_url: './',
              scope: './',
              display: 'standalone',
              theme_color: '#0D1B2A',
              background_color: '#F8F9FA',
              icons: [
                { src: 'brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                { src: 'brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,woff2,svg,png,ico,webmanifest}'],
              // reset.html must always come from the network, never from the precache.
              globIgnores: ['**/node_modules/**', 'reset.html', '**/reset.html'],
              navigateFallback: 'index.html',
              // Only the app root falls back offline: a navigation to a folder (".../") or to
              // ".../index.html", with or without a query such as ?view=phone. Path-agnostic, so
              // the same build works under /mobile/next/, at /mobile/ and under test servers.
              // The app itself routes by hash, so it has no other pages.
              navigateFallbackAllowlist: [/\/(index\.html)?(\?.*)?$/],
              navigateFallbackDenylist: [/\/reset\.html(\?.*)?$/],
              cleanupOutdatedCaches: true,
            },
          }),
      cspPlugin(single),
      // Bundle report of the hosted build: reports/bundle.html, kept as a CI
      // artifact next to the budgets (scripts/check-budgets.ts). Never part of the site.
      ...(single
        ? []
        : [
            visualizer({
              filename: 'reports/bundle.html',
              template: 'treemap',
              gzipSize: true,
              brotliSize: false,
              title: 'BCPS bundle',
            }) as Plugin,
          ]),
    ],
    // The backup is exactly one file: public/ (icons, reset.html) is not copied.
    publicDir: single ? false : 'public',
    build: {
      outDir: single ? 'dist-single' : 'dist',
      // Single mode inlines every asset, fonts included (base64).
      assetsInlineLimit: single ? 100_000_000 : 4096,
    },
  }
})
