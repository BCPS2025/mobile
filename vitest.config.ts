import { defineConfig } from 'vitest/config'
import { CANONICAL_URL } from './src/build-constants'
import { contentPlugin } from './src/content/vite-plugin-content'

// Unit tests run in Node with the same content plugin and build constants as the app.
export default defineConfig({
  plugins: [contentPlugin({ validator: '/src/sim/validate-content.ts' })],
  // The layer aliases (@domain/*, @content/*, @sim/*, @store/*, @app/*) come from tsconfig.json.
  resolve: { tsconfigPaths: true },
  define: { __CANONICAL_URL__: JSON.stringify(CANONICAL_URL) },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/golden/**/*.test.ts', 'tests/property/**/*.test.ts'],
    environment: 'node',
  },
})
