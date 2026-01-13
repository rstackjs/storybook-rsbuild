import { expect, test } from '@playwright/test'
import { sandboxes } from '../sandboxes'
import { waitForPreviewReady } from '../utils/assertions'
import { launchSandbox } from '../utils/sandboxProcess'

// Skip on Windows due to path handling differences that affect Nativewind/Reanimated
// TODO: Re-enable when Windows path issues are fully resolved
const isWindows = process.platform === 'win32'

const sandbox = sandboxes.find((entry) => entry.name === 'react-native-web')

if (!sandbox) {
  throw new Error('Sandbox definition not found: react-native-web')
}

test.describe(sandbox.name, () => {
  test.skip(isWindows, 'Skipped on Windows due to path compatibility issues')

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

  test('should load the home page with Button docs', async ({ page }) => {
    const currentServer = server
    if (!currentServer) {
      throw new Error('Storybook server failed to start')
    }

    // Use 'domcontentloaded' instead of 'networkidle' to avoid flakiness
    // with HMR/WebSocket connections that keep the network active
    await page.goto(currentServer.url, { waitUntil: 'domcontentloaded' })

    const frame = await waitForPreviewReady(page)
    const docsRoot = frame.locator('#storybook-docs:not([hidden])')
    await expect(docsRoot).toBeVisible()

    // Check that Button component docs are rendered
    const title = docsRoot.locator('h1')
    await expect(title).toBeVisible()
    await expect(title).toHaveText('Button')
  })

  test('should render Button component with React Native Web primitives', async ({
    page,
  }) => {
    const currentServer = server
    if (!currentServer) {
      throw new Error('Storybook server failed to start')
    }

    // Navigate to Primary story
    // Use 'domcontentloaded' instead of 'networkidle' to avoid flakiness
    await page.goto(
      `${currentServer.url}?path=/story/components-button--primary`,
      {
        waitUntil: 'domcontentloaded',
      },
    )

    const frame = await waitForPreviewReady(page)

    // The button text should be visible
    // TouchableOpacity renders as a div, and Text renders as a span
    const buttonText = frame.getByText('Primary Button')
    await expect(buttonText).toBeVisible()
  })

  test('should render Card component', async ({ page }) => {
    const currentServer = server
    if (!currentServer) {
      throw new Error('Storybook server failed to start')
    }

    // Navigate to Card Default story
    // Use 'domcontentloaded' instead of 'networkidle' to avoid flakiness
    await page.goto(
      `${currentServer.url}?path=/story/components-card--default`,
      {
        waitUntil: 'domcontentloaded',
      },
    )

    const frame = await waitForPreviewReady(page)

    // Check card title is rendered
    const cardTitle = frame.getByText('Card Title')
    await expect(cardTitle).toBeVisible()

    // Check card content is rendered
    const cardContent = frame.getByText(
      'This is the card content. You can put any React Native components here.',
    )
    await expect(cardContent).toBeVisible()
  })

  test('should show props table with docgen', async ({ page }) => {
    const currentServer = server
    if (!currentServer) {
      throw new Error('Storybook server failed to start')
    }

    // Navigate to Button docs
    // Use 'domcontentloaded' instead of 'networkidle' to avoid flakiness
    await page.goto(`${currentServer.url}?path=/docs/components-button--docs`, {
      waitUntil: 'domcontentloaded',
    })

    const frame = await waitForPreviewReady(page)
    const docsRoot = frame.locator('#storybook-docs:not([hidden])')
    await expect(docsRoot).toBeVisible()

    // Check that props table shows expected props from docgen
    const labelProp = docsRoot.getByText('The button label')
    await expect(labelProp).toBeVisible()

    const variantProp = docsRoot.getByText('Visual variant of the button')
    await expect(variantProp).toBeVisible()
  })

  test('should render Nativewind styled components', async ({ page }) => {
    const currentServer = server
    if (!currentServer) {
      throw new Error('Storybook server failed to start')
    }

    // Navigate to Nativewind Showcase story
    // Use 'domcontentloaded' instead of 'networkidle' to avoid flakiness
    await page.goto(
      `${currentServer.url}?path=/story/nativewind-showcase--showcase`,
      {
        waitUntil: 'domcontentloaded',
      },
    )

    const frame = await waitForPreviewReady(page)

    // Check that the Nativewind container is rendered
    const container = frame.locator('[data-testid="nativewind-container"]')
    await expect(container).toBeVisible()

    // Check that the title is rendered
    const title = frame.locator('[data-testid="nativewind-title"]')
    await expect(title).toBeVisible()
    await expect(title).toHaveText('Nativewind v4')

    // Verify Tailwind CSS styles are applied (background color from purple-500)
    // The gradient starts with purple-500 (#a855f7) which gets applied as background
    const containerStyles = await container.evaluate((el) => {
      const styles = window.getComputedStyle(el)
      return {
        padding: styles.padding,
        borderRadius: styles.borderRadius,
      }
    })

    // Check that Tailwind utilities are applied (p-8 = 32px padding, rounded-3xl = 24px border-radius)
    expect(containerStyles.padding).toBe('32px')
    expect(containerStyles.borderRadius).toBe('24px')
  })

  test('should render Reanimated animated components', async ({ page }) => {
    const currentServer = server
    if (!currentServer) {
      throw new Error('Storybook server failed to start')
    }

    // Navigate to Reanimated Showcase story
    // Use 'domcontentloaded' instead of 'networkidle' to avoid flakiness
    await page.goto(
      `${currentServer.url}?path=/story/reanimated-animations--showcase`,
      {
        waitUntil: 'domcontentloaded',
      },
    )

    const frame = await waitForPreviewReady(page)

    // Check that the showcase container is rendered
    const showcase = frame.locator('[data-testid="reanimated-showcase"]')
    await expect(showcase).toBeVisible()

    // Check that the FadeInBox component is rendered
    const fadeInBox = frame.locator('[data-testid="reanimated-fade-in"]')
    await expect(fadeInBox).toBeVisible()

    // Verify the FadeInBox has expected text
    const fadeInText = fadeInBox.getByText('Fade In')
    await expect(fadeInText).toBeVisible()

    // Wait for animation to complete and verify opacity is applied
    await page.waitForTimeout(1500) // Wait for 1000ms animation + buffer

    const opacity = await fadeInBox.evaluate((el) => {
      return window.getComputedStyle(el).opacity
    })

    // After animation completes, opacity should be 1
    expect(Number.parseFloat(opacity)).toBeCloseTo(1, 1)
  })

  test('should render Reanimated FadeIn story individually', async ({
    page,
  }) => {
    const currentServer = server
    if (!currentServer) {
      throw new Error('Storybook server failed to start')
    }

    // Navigate to FadeIn story
    // Use 'domcontentloaded' instead of 'networkidle' to avoid flakiness
    await page.goto(
      `${currentServer.url}?path=/story/reanimated-animations--fade-in`,
      {
        waitUntil: 'domcontentloaded',
      },
    )

    const frame = await waitForPreviewReady(page)

    // Check that the FadeInBox component is rendered
    const fadeInBox = frame.locator('[data-testid="reanimated-fade-in"]')
    await expect(fadeInBox).toBeVisible()

    // Verify the component has the correct background color (#6366f1 = indigo-500)
    const bgColor = await fadeInBox.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor
    })

    // #6366f1 in RGB is rgb(99, 102, 241)
    expect(bgColor).toBe('rgb(99, 102, 241)')
  })
})
