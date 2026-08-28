import { defineConfig } from '@rstest/core'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  setupFiles: [fileURLToPath(new URL('./rstest-setup.ts', import.meta.url))],
  include: ['./*.test.ts'],
  testTimeout: 120000,
})
