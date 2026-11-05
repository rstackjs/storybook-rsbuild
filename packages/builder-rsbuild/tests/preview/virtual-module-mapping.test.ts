import { resolve } from 'node:path'
import { describe, expect, it } from 'rstack/test'
import type { Options } from 'storybook/internal/types'
import { getVirtualModules } from '../../src/preview/virtual-module-mapping'
import { createTestOptions } from '../fixtures/options'

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
  const { options } = createTestOptions({
    presetValues: new Map([
      ['core', { builder: { name: 'storybook-builder-rsbuild', options: {} } }],
      ['stories', stories],
      ['previewAnnotations', []],
    ]),
    overrides: { configType, configDir: fixtureDir },
  })

  return options
}

const getStoriesModule = async (options: Options) => {
  const { virtualModules } = await getVirtualModules(
    options,
    options.configType === 'DEVELOPMENT',
  )
  const storiesPath = resolve(process.cwd(), 'storybook-stories.js')
  return virtualModules[storiesPath]
}

// Rspack's context module drops candidates under `node_modules` natively since
// @rspack/core 2.1.0 (web-infra-dev/rspack#14576), matching webpack's
// `RequireContextPlugin`, so the stories virtual module is upstream's
// `toImportFn` output unchanged — no injected `webpackExclude`.
describe('virtual-module-mapping: stories context leaves node_modules to Rspack', () => {
  it('generates the upstream importFn without a webpackExclude', async () => {
    const mod = await getStoriesModule(createOptions())

    expect(mod).toMatch(/webpackInclude:/)
    expect(mod).not.toMatch(/webpackExclude:/)
  })

  // `storybook dev` uses the pipelined/lazy import form — it must stay
  // upstream-shaped there too.
  it('also leaves the development (lazy) importFn untouched', async () => {
    const mod = await getStoriesModule(
      createOptions(storiesConfig, 'DEVELOPMENT'),
    )

    expect(mod).toMatch(/webpackInclude:/)
    expect(mod).not.toMatch(/webpackExclude:/)
  })

  // A brace/extglob alternation whose branch is `node_modules` intentionally
  // targets dependency stories; nothing local should rewrite its include.
  it('does not rewrite a glob targeting node_modules as an alternation branch', async () => {
    const mod = await getStoriesModule(
      createOptions([
        { directory: './@(src|node_modules)', files: '**/*.stories.tsx' },
      ]),
    )

    expect(mod).toMatch(/webpackInclude:/)
    expect(mod).not.toMatch(/webpackExclude:/)
  })
})

describe('virtual-module-mapping: config entry imports', () => {
  it('substitutes the csf import with the builder-context path and keeps externalized imports bare', async () => {
    const options = createOptions()
    const { virtualModules, entries } = await getVirtualModules(options, false)
    const entry = virtualModules[entries[0]]

    expect(entry).toBeDefined()
    expect(entry).not.toContain('storybook/internal/csf')
    expect(entry).not.toContain('{{csfImportPath}}')

    const csfImport = entry.match(/^import \{ isPreview \} from '(.+)';?$/m)
    // The template double-escapes `\`; undo it to assert on the evaluated Windows path.
    const csfImportPath = csfImport?.[1].replaceAll('\\\\', '\\')
    expect(csfImportPath).toMatch(/^(?:[A-Za-z]:)?[/\\]/)
    expect(csfImportPath).toMatch(/[/\\]dist[/\\]csf[/\\]index\.js$/)

    expect(entry).toContain("from 'storybook/internal/channels'")
    expect(entry).toContain("from 'storybook/internal/core-events'")
    expect(entry).toContain("from '@storybook/global'")
    expect(entry).toContain("from 'storybook/preview-api'")
  })
})
