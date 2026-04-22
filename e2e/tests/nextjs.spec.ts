import { expect, type Page, test } from '@playwright/test'
import { sandboxes } from '../sandboxes'
import { previewFrame, waitForPreviewReady } from '../utils/assertions'
import { launchSandbox } from '../utils/sandboxProcess'

const sandbox = sandboxes.find((entry) => entry.name === 'nextjs')

if (!sandbox) {
  throw new Error('Sandbox definition not found: nextjs')
}

test.describe(sandbox.name, () => {
  let server: Awaited<ReturnType<typeof launchSandbox>>

  async function openStory(page: Page, storyId: string) {
    await page.goto(`${server.url}?path=/story/${storyId}`, {
      waitUntil: 'domcontentloaded',
    })
    await waitForPreviewReady(page)
    return previewFrame(page)
  }

  test.beforeAll(async () => {
    server = await launchSandbox(sandbox)
  })

  test.afterAll(async () => {
    await server?.stop()
  })

  test('renders next/image with a local asset', async ({ page }) => {
    const frame = await openStory(page, 'stories-image--default')
    const img = frame.getByRole('img', { name: 'Vercel Logo' })
    await expect(img).toBeVisible()
    // next-image-mock's defaultLoader strips the origin for relative srcs and
    // appends width/quality search params.
    await expect(img).toHaveAttribute('src', /\/vercel\.svg\?w=\d+&q=\d+/)
  })

  test('renders next/image with a remote URL via the mocked image loader', async ({
    page,
  }) => {
    // Intercept the external URL so the test stays hermetic (and still
    // exercises the absolute-URL code path in `loaders/next-image-mock.js`).
    const onePxPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    )
    await page.route(
      'https://storybook.js.org/images/placeholders/50x50.png**',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: onePxPng,
        }),
    )

    const frame = await openStory(page, 'stories-image--with-remote-image')
    const img = frame.getByRole('img', { name: 'Placeholder' })
    await expect(img).toBeVisible()
    // For http(s) srcs the mock loader preserves the origin and adds ?w=&q=.
    await expect(img).toHaveAttribute(
      'src',
      /^https:\/\/storybook\.js\.org\/images\/placeholders\/50x50\.png\?w=\d+&q=\d+$/,
    )
  })

  test('renders next/image with fill layout inside a sized parent', async ({
    page,
  }) => {
    const frame = await openStory(page, 'stories-image--filled-parent')
    const img = frame.getByRole('img', { name: 'Vercel Logo' })
    await expect(img).toBeVisible()
    await expect(img).toHaveCSS('position', 'absolute')
  })

  test('next/font applies a Google font className', async ({ page }) => {
    const frame = await openStory(page, 'stories-font--inter-font')
    const heading = frame.getByRole('heading', { name: 'Inter (Google Font)' })
    await expect(heading).toBeVisible()

    // next/font emits a hashed class prefixed with `__className_` / `__Inter`;
    // exact hash is non-deterministic so match loosely.
    const wrapper = heading.locator('..')
    const className = await wrapper.getAttribute('class')
    expect(className).toMatch(/(__Inter|__className_)/)
  })

  test('next/font exposes a CSS variable that resolves to the font family', async ({
    page,
  }) => {
    const frame = await openStory(page, 'stories-font--css-variable')
    const heading = frame.getByRole('heading', {
      name: 'Roboto Mono via CSS variable',
    })
    await expect(heading).toBeVisible()

    const container = heading.locator('..')
    await expect(container).toHaveCSS(
      'font-family',
      /(Roboto[_\s]?Mono|__Roboto_Mono)/,
    )
  })

  test('next/link renders with href for simple and URL-object variants', async ({
    page,
  }) => {
    const frame = await openStory(page, 'stories-link--default')
    await expect(
      frame.getByRole('link', { name: 'Normal Link' }),
    ).toHaveAttribute('href', '/')
    await expect(
      frame.getByRole('link', { name: 'With URL Object' }),
    ).toHaveAttribute('href', /\/with-url-object\?name=test/)
    await expect(
      frame.getByRole('link', { name: 'Replace the URL instead of push' }),
    ).toHaveAttribute('href', '/replace-url')
  })

  test('next/navigation hooks reflect the configured parameters', async ({
    page,
  }) => {
    const frame = await openStory(page, 'stories-navigation--default')
    await expect(frame.getByText('pathname: /hello')).toBeVisible()
    await expect(frame.getByText('foo: bar')).toBeVisible()

    // Router mock is asserted by the story's play fn (router.forward). Also
    // smoke-test that the button renders and is clickable.
    const forwardBtn = frame.getByRole('button', { name: 'Go forward' })
    await expect(forwardBtn).toBeVisible()
    await forwardBtn.click()
  })

  test('next/navigation respects selected layout segments parameter', async ({
    page,
  }) => {
    const frame = await openStory(
      page,
      'stories-navigation--with-segment-defined',
    )
    await expect(frame.getByText('segments: dashboard,settings')).toBeVisible()
  })

  test('next/head updates the iframe document.title', async ({ page }) => {
    const frame = await openStory(page, 'stories-head--default')
    // Poll: document.title is set inside the story's play fn; Playwright has no
    // direct hook to wait for it to finish.
    await expect
      .poll(async () => frame.locator('html').evaluate(() => document.title))
      .toBe('Next.js Head Title')
  })

  test('styled-jsx applies scoped styles', async ({ page }) => {
    const frame = await openStory(page, 'stories-styledjsx--default')
    const paragraph = frame
      .locator('main.main p')
      .getByText('This is styled using Styled JSX')
    await expect(paragraph).toBeVisible()
    await expect(paragraph).toHaveCSS('color', 'rgb(255, 71, 133)')
  })

  test("'use client' component remains interactive", async ({ page }) => {
    const frame = await openStory(page, 'stories-counter--default')
    await expect(
      frame.getByRole('heading', { name: 'Counter: 0' }),
    ).toBeVisible()

    await frame.getByRole('button', { name: '+1' }).click()
    await expect(
      frame.getByRole('heading', { name: 'Counter: 1' }),
    ).toBeVisible()

    await frame.getByRole('button', { name: '-1' }).click()
    await frame.getByRole('button', { name: '-1' }).click()
    await expect(
      frame.getByRole('heading', { name: 'Counter: -1' }),
    ).toBeVisible()
  })
})
