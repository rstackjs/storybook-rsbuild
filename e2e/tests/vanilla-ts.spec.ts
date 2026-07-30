import { expect, test } from '@playwright/test'
import { sandboxes } from '../sandboxes'
import {
  expectDocsStorybookTitle,
  waitForPreviewReady,
} from '../utils/assertions'
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

  // Regression guard for #522: a worker importing an async chunk only resolves
  // it when the preview output stays flat.
  test('should load an async chunk from a web worker', async ({ page }) => {
    const currentServer = server
    if (!currentServer) {
      throw new Error('Storybook server failed to start')
    }

    await page.goto(
      `${currentServer.url}?path=/story/example-worker-probe--default`,
      { waitUntil: 'domcontentloaded' },
    )
    const frame = await waitForPreviewReady(page)

    await expect(frame.locator('#worker-probe')).toHaveText(
      'worker: chunk-loaded-ok',
    )
  })

  // Regression guard for #522's other half. The CSS `url()` only resolves when
  // the stylesheet is emitted at the dist root, which catches a `filename`
  // prefix sneaking a directory back in — something `distPath` assertions
  // cannot see. The SVG loads at any depth (an `<img src>` resolves against the
  // document), so the probe reports where it landed instead.
  test('should resolve a CSS url() and emit an imported SVG at the root', async ({
    page,
  }) => {
    const currentServer = server
    if (!currentServer) {
      throw new Error('Storybook server failed to start')
    }

    await page.goto(
      `${currentServer.url}?path=/story/example-asset-probe--default`,
      { waitUntil: 'domcontentloaded' },
    )
    const frame = await waitForPreviewReady(page)

    await expect(frame.locator('#asset-probe-status')).toHaveText(
      'css: ok svg: root',
    )
  })
})
