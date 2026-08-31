import type { RstestConfig } from '@rstest/core'

export const rstestCommonConfig = {
  passWithNoTests: true,
  clearMocks: true,
  globals: true,
  testTimeout: 10000,
  testEnvironment: 'node',
  include: ['**/*.test.{ts,tsx}'],
} satisfies RstestConfig
