import { resolve } from 'node:path'
import { describe, expect, it, rs } from '@rstest/core'
import type { Options } from 'storybook/internal/types'
import { getVirtualModules } from '../../src/preview/virtual-module-mapping'

const fixtureDir = resolve(__dirname, '../fixtures')

// A normal stories glob (no `node_modules` in it) — Storybook core's generated
// `webpackInclude` carries a `(?!.*node_modules)` guard for these.
const storiesConfig = [
  { directory: './stories', files: '*.stories.tsx', titlePrefix: '' },
]

const createOptions = (
  stories: unknown = storiesConfig,
  configType: 'PRODUCTION' | 'DEVELOPMENT' = 'PRODUCTION',
) => {
  const presetValues = new Map<string, unknown>([
    ['core', { builder: { name: 'storybook-builder-rsbuild', options: {} } }],
    ['stories', stories],
    ['previewAnnotations', []],
  ])

  const apply = rs.fn(async (name: string, defaultValue?: unknown) =>
    presetValues.has(name) ? presetValues.get(name) : defaultValue,
  )

  return {
    configType,
    presets: { apply },
    configDir: fixtureDir,
  } as unknown as Options
}

const getStoriesModule = async (options: Options) => {
  const { virtualModules } = await getVirtualModules(options)
  const storiesPath = resolve(process.cwd(), 'storybook-stories.js')
  return virtualModules[storiesPath]
}

// The injected exclude is anchored to path separators rather than the bare
// `node_modules` substring, so it can't prune first-party stories when the
// project lives under a directory whose name merely contains the substring.
const pathSegmentExclude = '/* webpackExclude: /[\\\\/]node_modules[\\\\/]/ */'

describe('virtual-module-mapping: stories context excludes node_modules', () => {
  // Rspack's require.context (unlike webpack's) enumerates node_modules, so a
  // dependency that ships `.stories.*` files would be swept into the preview
  // build. Re-assert Storybook core's intent with an explicit webpackExclude.
  it('adds a node_modules webpackExclude to the generated stories importFn', async () => {
    const mod = await getStoriesModule(createOptions())

    expect(mod).toMatch(/webpackInclude:/)
    expect(mod).toContain(pathSegmentExclude)
  })

  // `storybook dev` uses the pipelined/lazy import form — the exclude must
  // apply there too (it's the more common path that hits the sweep).
  it('also excludes node_modules in development (lazy) mode', async () => {
    const mod = await getStoriesModule(
      createOptions(storiesConfig, 'DEVELOPMENT'),
    )

    expect(mod).toContain(pathSegmentExclude)
  })

  // The exclude must be a path-segment regex, not a bare `/node_modules/`
  // substring match — otherwise a checkout path like `/builds/node_modules-x/`
  // would over-prune first-party stories into an empty context.
  it('anchors the exclude to path separators, not the bare substring', async () => {
    const mod = await getStoriesModule(createOptions())

    expect(mod).not.toMatch(/webpackExclude:\s*\/node_modules\//)
  })

  // If a glob *intentionally* points into node_modules, Storybook core emits no
  // `(?!.*node_modules)` guard — we must not override that intent.
  it('leaves a glob that intentionally targets node_modules untouched', async () => {
    const mod = await getStoriesModule(
      createOptions([
        { directory: './node_modules/some-pkg', files: '*.stories.tsx' },
      ]),
    )

    expect(mod).toMatch(/webpackInclude:/)
    expect(mod).not.toContain(pathSegmentExclude)
  })
})
