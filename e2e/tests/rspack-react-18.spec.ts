import { expect, test } from '@playwright/test'
import { sandboxes } from '../sandboxes'
import {
  expectDocsStorybookTitle,
  waitForPreviewReady,
} from '../utils/assertions'
import { launchSandbox } from '../utils/sandboxProcess'

const sandbox = sandboxes.find((entry) => entry.name === 'rspack-react-18')

if (!sandbox) {
  throw new Error('Sandbox definition not found: rspack-react-18')
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

  // This sandbox sets `features.docgenServer: false`, so props come from builder
  // docgen (react-docgen-typescript), which injects `__docgenInfo` into the bundle.
  test('should document props with builder docgen', async ({ page }) => {
    const currentServer = server
    if (!currentServer) {
      throw new Error('Storybook server failed to start')
    }

    await page.goto(`${currentServer.url}?path=/docs/example-button--docs`, {
      waitUntil: 'domcontentloaded',
    })

    const frame = await waitForPreviewReady(page)
    const docsRoot = frame.locator('#storybook-docs:not([hidden])')
    await expect(
      docsRoot.getByText('How large should the button be?'),
    ).toBeVisible()

    const docgenInfo = await page
      .frameLocator('#storybook-preview-iframe')
      .locator('body')
      .evaluate(async () => {
        const preview = (window as any).__STORYBOOK_PREVIEW__
        const csfFile = await preview.storyStore.loadCSFFileByStoryId(
          'example-button--primary',
        )
        return csfFile.meta.component?.__docgenInfo
      })
    expect(docgenInfo?.props?.size?.description).toBe(
      'How large should the button be?',
    )
  })
})
