import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rstest/core'
import { rstestCommonConfig } from '../../rstest.config'

export default defineConfig({
  ...rstestCommonConfig,
  setupFiles: [
    fileURLToPath(new URL('../../rstest-setup.ts', import.meta.url)),
  ],
  // Fail fast if this package's pnpm-injected builder artifact is stale.
  globalSetup: [
    fileURLToPath(
      new URL('../../scripts/check-injected-artifact.ts', import.meta.url),
    ),
  ],
  testEnvironment: 'node',
})
