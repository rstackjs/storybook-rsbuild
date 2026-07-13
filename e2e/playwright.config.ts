import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI
const isWindows = process.platform === 'win32'

// Windows CI has slower I/O and process startup, use serial execution
const workers = isCI ? (isWindows ? 1 : '25%') : '50%'

// Windows needs longer timeout due to slower file system operations
const expectTimeout = isCI ? (isWindows ? 120_000 : 60_000) : 20_000

export default defineConfig({
  testDir: './tests',
  forbidOnly: isCI,
  workers,
  retries: isCI ? 3 : 0,
  reporter: [['list']],
  timeout: isCI ? 360_000 : 180_000,
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    trace: 'retain-on-failure',
    navigationTimeout: 60_000,
  },
  expect: {
    timeout: expectTimeout,
  },
})
