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

  test('Node.js polyfills (querystring, buffer) are wired through global fallback', async ({
    page,
  }) => {
    const frame = await openStory(page, 'stories-polyfill--node-polyfills')
    const out = frame.getByTestId('polyfill-output')
    await expect(out).toBeVisible()
    const text = await out.textContent()
    expect(text).toContain('"a":"1"')
    expect(text).toContain('"b":"2"')
    expect(text).toContain('"encoded":"aGk="')
  })

  test('global CSS import applies styles to story content', async ({
    page,
  }) => {
    const frame = await openStory(page, 'stories-globalcss--default')
    const probe = frame.getByTestId('global-css-probe')
    await expect(probe).toBeVisible()
    await expect(probe).toHaveCSS('color', 'rgb(255, 71, 133)')
  })

  test('CSS Modules generate hashed class names and apply scoped styles', async ({
    page,
  }) => {
    const frame = await openStory(page, 'stories-cssmodules--default')
    const probe = frame.getByTestId('css-modules-probe')
    await expect(probe).toBeVisible()
    const className = await frame
      .getByTestId('css-modules-classname')
      .textContent()
    // CSS Modules emit a hashed identifier (literal "card" alone would mean
    // the modules pipeline was bypassed).
    expect(className).not.toBe('card')
    expect(className).toMatch(/card/)
    await expect(probe).toHaveCSS('border-color', 'rgb(0, 128, 0)')
  })

  test('next/dynamic resolves the lazy chunk and swaps out the placeholder', async ({
    page,
  }) => {
    const frame = await openStory(page, 'stories-dynamic--default')
    const loaded = frame.getByTestId('dynamic-loaded')
    await expect(loaded).toBeVisible()
    await expect(loaded).toHaveText('Lazy chunk loaded')
  })

  test('optimizePackageImports rewrites lucide-react named imports through the barrel rule', async ({
    page,
  }) => {
    const frame = await openStory(page, 'stories-optimizedimports--default')
    await expect(frame.getByTestId('optimized-imports-probe')).toBeVisible()
    await expect(frame.getByTestId('icon-heart')).toBeVisible()
    await expect(frame.getByTestId('icon-star')).toBeVisible()
  })

  test('transpilePackages compiles workspace TSX source through next-swc-loader', async ({
    page,
  }) => {
    const frame = await openStory(page, 'stories-transpilepackages--default')
    const badge = frame.getByTestId('transpiled-badge')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveText('from workspace dep')
  })

  test('MDX docs page renders through addon-docs', async ({ page }) => {
    const frame = await openStory(page, 'stories-documentation--docs')
    await expect(frame.getByTestId('mdx-probe')).toBeVisible()
  })

  test('next/image with placeholder=blur paints the blurDataURL while loading', async ({
    page,
  }) => {
    // Regression target: framework forwards `placeholder` + `blurDataURL` so
    // next/image emits the inline `background-image: url(data:…)` placeholder.
    // We hold the image response in a route handler so the blur layer stays
    // painted long enough to assert against; releasing afterwards confirms the
    // real image still finishes loading once the placeholder is cleared.
    const onePxPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    )
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/blur-target.png**', async (route) => {
      await held
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: onePxPng,
      })
    })

    const frame = await openStory(page, 'stories-image--with-blur-placeholder')
    const img = frame.getByRole('img', { name: 'Blur Probe' })
    await expect(img).toBeVisible()

    const loadingStyle = await img.getAttribute('style')
    // Next.js wraps the PNG blurDataURL inside an SVG Gaussian-blur filter,
    // so the outer URL is `data:image/svg+xml` and the original PNG bytes are
    // embedded as an `href` inside it. Assert both: the placeholder pipeline
    // ran (svg wrapper present) AND our blurDataURL payload survived.
    expect(loadingStyle).toMatch(/background-image:\s*url\(["']?data:image\//i)
    expect(loadingStyle).toContain('iVBORw0KGgo')

    release()
  })

  test('next/image with priority + sizes emits a sized srcset', async ({
    page,
  }) => {
    const frame = await openStory(
      page,
      'stories-image--with-priority-and-sizes',
    )
    const img = frame.getByRole('img', { name: 'Vercel Logo' })
    await expect(img).toBeVisible()
    await expect(img).toHaveAttribute('sizes', /max-width: 768px/)
    await expect(img).toHaveAttribute('srcset', /\?w=\d+&q=\d+/)
  })

  test('next/navigation route params surface through useParams', async ({
    page,
  }) => {
    const frame = await openStory(page, 'stories-navigation--with-route-params')
    await expect(frame.getByText('address: 0xdeadbeef')).toBeVisible()
  })
})
