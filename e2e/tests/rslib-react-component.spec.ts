import { expect, test } from '@playwright/test'
import { sandboxes } from '../sandboxes'
import { waitForPreviewReady } from '../utils/assertions'
import { launchSandbox } from '../utils/sandboxProcess'

const sandbox = sandboxes.find(
  (entry) => entry.name === 'rslib-react-component',
)

if (!sandbox) {
  throw new Error('Sandbox definition not found: rslib-react-component')
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

    // Use the robust waiting mechanism that handles HMR rebuilds
    const frame = await waitForPreviewReady(page)
    const docsRoot = frame.locator('#storybook-docs:not([hidden])')

    await expect(docsRoot).toBeVisible()
    const title = docsRoot.locator('h1')
    await expect(title).toBeVisible()
    await expect(title).toHaveText('CounterButton')
  })
})
