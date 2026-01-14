import {
  expect,
  type FrameLocator,
  type Locator,
  type Page,
} from '@playwright/test'

const previewFrameSelector = 'iframe[title="storybook-preview-iframe"]'

export function previewFrame(page: Page): FrameLocator {
  return page.frameLocator(previewFrameSelector)
}

/**
 * Get the preview iframe element (useful for waiting on iframe to be attached)
 */
export function previewIframe(page: Page): Locator {
  return page.locator(previewFrameSelector)
}

/**
 * Wait for the Storybook preview iframe to be ready and stable.
 * This handles the race condition where Storybook may still be doing HMR rebuilds
 * after the server reports it's ready.
 */
export async function waitForPreviewReady(page: Page): Promise<FrameLocator> {
  const iframe = previewIframe(page)

  // Wait for iframe to be visible (60s timeout for slow CI environments like Windows)
  await iframe.waitFor({ state: 'visible', timeout: 60000 })

  const frame = previewFrame(page)

  // Use CSS selector with comma to match either docs or story root.
  // Combined with expect's built-in retry mechanism, this will keep polling
  // until one of them becomes visible or timeout is reached.
  // Using 60s timeout to accommodate slow CI environments (Windows) and
  // sandboxes with long build times (modernjs-react).
  await expect(
    frame
      .locator('#storybook-docs:not([hidden]), #storybook-root:not([hidden])')
      .first(),
  ).toBeVisible({ timeout: 60000 })

  return frame
}

export async function expectDocsStorybookTitle(page: Page): Promise<void> {
  // Use the robust waiting mechanism
  const frame = await waitForPreviewReady(page)
  const docsRoot = frame.locator('#storybook-docs:not([hidden])')

  // Wait for docs root with built-in retry
  await expect(docsRoot).toBeVisible()
  const title = docsRoot.locator('#configure-your-project')
  await expect(title).toBeVisible()
  await expect(title).toHaveText('Configure your project')
}
