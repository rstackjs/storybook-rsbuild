import { defineConfig, type RstestConfig } from '@rstest/core'

export const rstestCommonConfig = {
  passWithNoTests: true,
  clearMocks: true,
  globals: true,
  testTimeout: 10000,
  testEnvironment: 'node',
  include: ['**/*.test.{ts,tsx}'],
} satisfies RstestConfig

// Root rstest config which aggregates all other rstest configs
export default defineConfig({
  projects: [
    './packages/*/rstest.config.ts',
    './sandboxes/*/rstest.config.ts',
    './tests/rstest.config.ts',
  ],
})
