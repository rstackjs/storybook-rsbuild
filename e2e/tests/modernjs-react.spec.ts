import { expect, test } from '@playwright/test'
import { sandboxes } from '../sandboxes'
import { previewFrame, previewIframe } from '../utils/assertions'
import { launchSandbox } from '../utils/sandboxProcess'

const sandbox = sandboxes.find((entry) => entry.name === 'modernjs-react')

if (!sandbox) {
  throw new Error('Sandbox definition not found: modernjs-react')
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

    // Navigate directly to the docs entry to avoid relying on Storybook's
    // async default selection on cold starts.
    await page.goto(
      `${currentServer.url}?path=/docs/example-antdbutton--docs`,
      {
        waitUntil: 'domcontentloaded',
      },
    )

    await previewIframe(page).waitFor({ state: 'visible', timeout: 60_000 })

    const frame = previewFrame(page)
    const docsBody = frame.locator('body')
    await expect(docsBody).toContainText('AntdButton', { timeout: 30_000 })
    await expect(docsBody).toContainText('myButtonExtra', { timeout: 30_000 })
  })
})
