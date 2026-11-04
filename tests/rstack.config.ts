import { fileURLToPath } from 'node:url'
import { define } from 'rstack'

define.test({
  setupFiles: [fileURLToPath(new URL('./rstest-setup.ts', import.meta.url))],
  include: ['./*.test.ts'],
  testTimeout: 120000,
})
