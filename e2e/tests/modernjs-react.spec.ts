import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { sandboxes } from '../sandboxes'
import { previewFrame, previewIframe } from '../utils/assertions'
import { launchSandbox } from '../utils/sandboxProcess'

const execFileAsync = promisify(execFile)

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

test.describe(`${sandbox.name} build output isolation`, () => {
  // Storybook build is heavier than the dev probe; bump the per-test timeout.
  test.setTimeout(300_000)

  test('storybook build isolates output from Modern.js host config', async () => {
    const sandboxDir = path.resolve(sandbox.relativeDir)
    const hostDist = path.join(sandboxDir, 'dist')
    const storybookStatic = path.join(sandboxDir, 'storybook-static')
    const sentinelPath = path.join(hostDist, 'sentinel.txt')
    const sentinelMarker = `modernjs-host-build-${Date.now()}`

    // Plant a sentinel inside dist/ to simulate a prior `modern build`. The
    // bug being guarded against has two failure modes — Storybook writing
    // into dist/ AND Storybook wiping dist/ — so checking for the sentinel
    // post-build catches both.
    await rm(storybookStatic, { recursive: true, force: true })
    await mkdir(hostDist, { recursive: true })
    await writeFile(sentinelPath, sentinelMarker)

    // SB_RSBUILD_TEST_LEAK_PROBE activates a guarded plugin in the sandbox's
    // modern.config.ts that injects assetPrefix and filename overrides. If
    // the addon stops stripping these, they'll leak through mergeRsbuildConfig
    // and show up in the built iframe.html.
    await execFileAsync('pnpm', ['exec', 'storybook', 'build'], {
      cwd: sandboxDir,
      env: { ...process.env, CI: 'true', SB_RSBUILD_TEST_LEAK_PROBE: '1' },
      maxBuffer: 50 * 1024 * 1024,
    })

    // distPath isolation
    expect(existsSync(path.join(storybookStatic, 'iframe.html'))).toBe(true)
    expect(existsSync(sentinelPath)).toBe(true)
    expect(readFileSync(sentinelPath, 'utf8')).toBe(sentinelMarker)

    // assetPrefix / filename isolation
    const iframeHtml = readFileSync(
      path.join(storybookStatic, 'iframe.html'),
      'utf8',
    )
    expect(iframeHtml).not.toContain('leak-probe-prefix')
    expect(iframeHtml).not.toContain('leak-probe-')
    // Storybook's hardcoded chunk naming pattern survives.
    expect(iframeHtml).toMatch(/iframe\.bundle\.js/)
  })
})
