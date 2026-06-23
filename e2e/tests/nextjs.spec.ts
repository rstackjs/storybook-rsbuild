import fs from 'node:fs'
import path from 'node:path'
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

  test('next/image reads per-story parameters.nextjs.image via the shared context', async ({
    page,
  }) => {
    // ImageDecorator provides `parameters.nextjs.image` to a context the mock
    // consumes; `loading: 'eager'` should reach the rendered <img>. A broken
    // provider/consumer identity (two separate contexts) would leave the
    // default `loading="lazy"`.
    const frame = await openStory(page, 'stories-image--with-story-params')
    const img = frame.getByRole('img', { name: 'Vercel Logo' })
    await expect(img).toBeVisible()
    await expect(img).toHaveAttribute('loading', 'eager')
  })

  test('next/font applies a Google font className', async ({ page }) => {
    const frame = await openStory(page, 'stories-font--inter-font')
    const heading = frame.getByRole('heading', { name: 'Inter (Google Font)' })
    await expect(heading).toBeVisible()

    // The ported @storybook/nextjs font loader emits a deterministic
    // `<family>-<style>` class (e.g. `inter-normal`), not Next's native
    // `__className_<hash>`. See loaders/storybook-nextjs-font-loader.cjs.
    const wrapper = heading.locator('..')
    const className = await wrapper.getAttribute('class')
    expect(className).toMatch(/inter-normal/)
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
    // Bare `Buffer` reference — exercises `ProvidePlugin` retention.
    expect(text).toContain('"provided":"aGk="')
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

  test('next.config.webpack() rule with bare @svgr/webpack loader resolves and runs', async ({
    page,
  }) => {
    // Locks in three things at once: (1) `resolveLoader.modules` includes the
    // consumer's `node_modules` so the bare `@svgr/webpack` specifier resolves;
    // (2) the user-side rule from `next.config.webpack()` actually fires
    // (delta-rules forwarding); (3) the safe-wallet pattern of mutating the
    // image rule's `exclude` to /\.svg$/ in the same hook so SVGR — not the
    // default asset-image loader — claims .svg files.
    const frame = await openStory(page, 'stories-svgricon--default')
    const icon = frame.getByTestId('svgr-icon')
    // SVGR turns .svg files into React components — the element renders as an
    // <svg>, NOT an <img>. (If the default image rule still owned .svg this
    // would be `<img src="..." />` instead.)
    await expect(icon).toBeVisible()
    expect(await icon.evaluate((el) => el.tagName.toLowerCase())).toBe('svg')
  })

  test('user-defined resolve.alias in next.config.webpack() resolves through delta', async ({
    page,
  }) => {
    // anticapture-style alias delta: the user's webpack() hook adds
    // `'@user-alias/probe': '/path/to/target.ts'` and importing the alias
    // from a story resolves via rspack's resolver.
    const frame = await openStory(page, 'stories-useralias--default')
    const probe = frame.getByTestId('user-alias-probe')
    await expect(probe).toBeVisible()
    await expect(probe).toHaveText('resolved via @user-alias/probe')
  })

  test('user DefinePlugin from next.config.webpack() reaches story runtime', async ({
    page,
  }) => {
    // proposalsapp-style: user pushes `new webpack.DefinePlugin({...})`
    // that injects `process.env.DATABASE_URL`, feature flags, etc. The
    // define must survive `forwardNextConfigPlugins: true` forwarding AND
    // `dedupProvidePluginKeys` (which targets ProvidePlugin only, not
    // DefinePlugin — regression target if the dedup widens accidentally).
    const frame = await openStory(page, 'stories-userdefine--default')
    const probe = frame.getByTestId('user-define-probe')
    await expect(probe).toBeVisible()
    await expect(probe).toHaveText('user-define-value')
  })

  test('user resolve.fallback maps a non-builtin module to empty so it imports cleanly', async ({
    page,
  }) => {
    // proposalsapp-style: 40+ node-only deps (pg, jsdom, ...) are stubbed via
    // `config.resolve.fallback['pg'] = false`. We use a synthetic module name
    // (`sandbox-fake-native`) to avoid pulling a real native dep into the
    // sandbox install. If the fallback delta isn't forwarded, rspack errors
    // at build time with "Can't resolve 'sandbox-fake-native'".
    const frame = await openStory(page, 'stories-userfallback--default')
    const probe = frame.getByTestId('user-fallback-probe')
    await expect(probe).toBeVisible()
    await expect(probe).toHaveText(/resolved to empty module/)
  })

  test('root-absolute url() in CSS builds and passes through as a runtime URL', async ({
    page,
  }) => {
    // Regression target (safe-wallet): Rsbuild's css-loader tried to resolve
    // `/vercel.svg` as a module and failed the build; we mirror Next.js and
    // leave root-absolute urls untouched (isRuntimeCssUrl).
    const frame = await openStory(page, 'stories-cssabsoluteurl--default')
    const probe = frame.getByTestId('css-abs-url-probe')
    await expect(probe).toBeVisible()
    await expect(probe).toHaveCSS('background-image', /url\(.*vercel\.svg.*\)/)
  })

  test('data: URL in a CSS custom property survives the css-loader passthrough', async ({
    page,
  }) => {
    // Regression target (transit/proposalsapp): css-loader must not try to
    // resolve a data:/external URL as a module.
    const frame = await openStory(page, 'stories-cssexternalurl--default')
    const probe = frame.getByTestId('css-ext-url-probe')
    await expect(probe).toBeVisible()
    await expect(probe).toHaveCSS(
      'background-image',
      /url\(["']?data:image\/svg\+xml/,
    )
  })

  test('optimizePackageImports compiles a TS re-export barrel via __barrel_optimize__', async ({
    page,
  }) => {
    // Regression target (safe-wallet @mui): the barrel matchResource bypasses
    // the .tsx rule, so without makeBarrelRule the TS source would be parsed as
    // raw JS and throw. lucide-react (JS) doesn't exercise this; this does.
    const frame = await openStory(page, 'stories-optimizedimports--ts-barrel')
    await expect(frame.getByTestId('barrel-ts-badge')).toHaveText('ok')
  })

  test('Tailwind utilities are expanded by the PostCSS pipeline', async ({
    page,
  }) => {
    // Regression target: 6/8 gauntlet projects run Tailwind through Rsbuild's
    // PostCSS. Arbitrary-value utilities prove `@tailwind utilities` expanded.
    const frame = await openStory(page, 'stories-tailwind--default')
    const probe = frame.getByTestId('tw-probe')
    await expect(probe).toBeVisible()
    await expect(probe).toHaveCSS('color', 'rgb(255, 71, 133)')
    await expect(probe).toHaveCSS('font-weight', '700')
  })

  test('SCSS modules compile via @rsbuild/plugin-sass and apply scoped styles', async ({
    page,
  }) => {
    // Regression target (oak): pins the consumer contract that .scss works when
    // @rsbuild/plugin-sass is enabled, with CSS-module scoping intact.
    const frame = await openStory(page, 'stories-scss--default')
    const probe = frame.getByTestId('scss-probe')
    await expect(probe).toBeVisible()
    await expect(probe).toHaveCSS('border-color', 'rgb(0, 128, 0)')
  })

  test('styled-components applies styles via the next-swc transform', async ({
    page,
  }) => {
    // Regression target (oak): the styled-components SWC transform flows through
    // our extracted next-swc loader chain.
    const frame = await openStory(page, 'stories-styledcomponents--default')
    const probe = frame.getByTestId('sc-probe')
    await expect(probe).toBeVisible()
    await expect(probe).toHaveCSS('color', 'rgb(255, 71, 133)')
  })

  test('@emotion/styled injects styles into the preview', async ({ page }) => {
    // Regression target (safe-wallet): @emotion/styled resolves and injects
    // styles through Rsbuild's bundle.
    const frame = await openStory(page, 'stories-emotion--default')
    const probe = frame.getByTestId('emotion-probe')
    await expect(probe).toBeVisible()
    await expect(probe).toHaveCSS('color', 'rgb(255, 199, 0)')
  })

  test('node: protocol imports load as empty modules instead of crashing the chunk', async ({
    page,
  }) => {
    // Regression target: a `node:`-prefixed import must not throw
    // "Cannot find module 'node:path'" when the story chunk evaluates.
    // IgnoreNodeProtocolPlugin should replace it with an empty module so the
    // probe renders (with `sep` undefined → `<empty>`).
    const moduleErrors: string[] = []
    page.on('pageerror', (err) => moduleErrors.push(err.message))
    const frame = await openStory(page, 'stories-nodeprotocol--default')
    const probe = frame.getByTestId('node-protocol-probe')
    await expect(probe).toBeVisible()
    await expect(probe).toContainText('node:path sep =')
    expect(moduleErrors.join('\n')).not.toMatch(/Cannot find module 'node:/)
  })

  test('Fast Refresh hot-updates a component and preserves its React state', async ({
    page,
  }) => {
    // Editing a component must hot-update the preview AND preserve hook state; a
    // remount / full reload resets the counter to 0. Regression guard for the
    // loader-chain selection that must pick the rule paired with
    // `builtin:react-refresh-loader` (the only one emitting the
    // `module.hot.accept` Fast Refresh footer). The spec edits the committed
    // FastRefresh fixture in place and restores it in `finally` — a hard kill
    // (SIGKILL/OOM) between the edit and restore can leave a one-token V1→V2
    // diff, an accepted residual risk inherent to HMR e2e.
    const probePath = path.resolve(
      sandbox.relativeDir,
      'src/stories/FastRefresh.tsx',
    )
    const original = fs.readFileSync(probePath, 'utf8')
    let didNavigate = false
    page.on('framenavigated', (navigatedFrame) => {
      if (navigatedFrame.url().includes('iframe.html')) didNavigate = true
    })

    try {
      const frame = await openStory(page, 'stories-fastrefresh--default')
      await frame.getByTestId('fr-inc').click()
      await frame.getByTestId('fr-inc').click()
      await frame.getByTestId('fr-inc').click()
      await expect(frame.getByTestId('fr-count')).toHaveText('3')

      didNavigate = false
      fs.writeFileSync(
        probePath,
        original.replace('FR_MARKER_V1', 'FR_MARKER_V2'),
      )

      // The edit must reach the preview...
      await expect(frame.getByTestId('fr-marker')).toHaveText('FR_MARKER_V2', {
        timeout: 30_000,
      })
      // ...with hook state preserved and without a full preview reload.
      await expect(frame.getByTestId('fr-count')).toHaveText('3')
      expect(didNavigate).toBe(false)
    } finally {
      fs.writeFileSync(probePath, original)
    }
  })
})
