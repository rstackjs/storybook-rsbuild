import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rstest/core'

export default defineConfig({
  setupFiles: [fileURLToPath(new URL('./rstest-setup.ts', import.meta.url))],
  include: ['./*.test.ts'],
  testTimeout: 120000,
})
