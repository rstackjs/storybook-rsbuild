import { defineConfig } from '@rstest/core'
import { rstestCommonConfig } from '../../rstest.shared.ts'

export default defineConfig({
  ...rstestCommonConfig,
  testEnvironment: 'node',
})
