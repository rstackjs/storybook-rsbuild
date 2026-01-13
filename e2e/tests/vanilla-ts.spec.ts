import { test } from '@playwright/test'
import { sandboxes } from '../sandboxes'
import { expectDocsStorybookTitle } from '../utils/assertions'
import { launchSandbox } from '../utils/sandboxProcess'

const sandbox = sandboxes.find((entry) => entry.name === 'vanilla-ts')

if (!sandbox) {
  throw new Error('Sandbox definition not found: vanilla-ts')
}

test.describe(sandbox.name, () => {
  let server: Awaited<ReturnType<typeof launchSandbox>> | null = null

  test.beforeAll(async () => {
    server = await launchSandbox(sandbox)
  })

  test.afterAll(async () => {
    if (server) {
      await server.stop()
      server = null
    }
  })

  test('should load the home page', async ({ page }) => {
    const currentServer = server
    if (!currentServer) {
      throw new Error('Storybook server failed to start')
    }

    // Use 'domcontentloaded' instead of 'networkidle' to avoid flakiness
    // with HMR/WebSocket connections that keep the network active
    await page.goto(currentServer.url, { waitUntil: 'domcontentloaded' })
    await expectDocsStorybookTitle(page)
  })
})
