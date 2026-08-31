import { defineConfig } from '@rstest/core'
import { fileURLToPath } from 'node:url'
import { rstestCommonConfig } from '../../rstest.shared.ts'

export default defineConfig({
  ...rstestCommonConfig,
  setupFiles: [
    fileURLToPath(new URL('../../rstest-setup.ts', import.meta.url)),
  ],
  testEnvironment: 'node',
})
