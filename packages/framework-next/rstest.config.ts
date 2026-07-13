import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rstest/core'
import { rstestCommonConfig } from '../../rstest.config'

// No injected-artifact guard here: these unit tests exercise pure utilities and
// never import the pnpm-injected `storybook-builder-rsbuild`. The freshness
// guard lives on the e2e path (nextjs.spec.ts) that actually boots Storybook.
export default defineConfig({
  ...rstestCommonConfig,
  setupFiles: [
    fileURLToPath(new URL('../../rstest-setup.ts', import.meta.url)),
  ],
  testEnvironment: 'node',
})
