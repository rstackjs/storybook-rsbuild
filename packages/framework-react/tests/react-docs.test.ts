import { isReactBuilderDocgenPackageInstalled } from '@storybook/react/internal/builder-docgen'
import { beforeEach, describe, expect, it, rs } from 'rstack/test'
import { prepareReactBuilderDocgen } from '../src/builder-docgen'
import { rsbuildFinalDocs } from '../src/react-docs'

rs.mock('../src/builder-docgen', () => ({
  prepareReactBuilderDocgen: rs.fn(),
}))

rs.mock('@storybook/react/internal/builder-docgen', () => ({
  isReactBuilderDocgenPackageInstalled: rs.fn(),
}))

type Options = Parameters<typeof rsbuildFinalDocs>[1]

const createOptions = ({
  features = {},
  typescript = { reactDocgen: 'react-docgen' },
}: {
  features?: { docgenServer?: boolean }
  typescript?: Record<string, unknown>
} = {}) =>
  ({
    loglevel: 'info',
    presets: {
      apply: async (name: string) =>
        name === 'features' ? features : typescript,
    },
  }) as unknown as Options

const rules = (config: Awaited<ReturnType<typeof rsbuildFinalDocs>>) =>
  (
    config.tools as {
      rspack: { module: { rules: { test: RegExp }[] } }
    }
  ).rspack.module.rules

describe('rsbuildFinalDocs', () => {
  beforeEach(() => {
    rs.mocked(prepareReactBuilderDocgen).mockReset()
    rs.mocked(isReactBuilderDocgenPackageInstalled).mockReset()
  })

  it('leaves docgen to the docgen server when it is active', async () => {
    const config = {}
    const result = await rsbuildFinalDocs(
      config,
      createOptions({ features: { docgenServer: true } }),
    )

    expect(result).toBe(config)
    expect(prepareReactBuilderDocgen).not.toHaveBeenCalled()
  })

  it('runs no builder docgen when reactDocgen is false', async () => {
    const config = {}
    const result = await rsbuildFinalDocs(
      config,
      createOptions({ typescript: { reactDocgen: false } }),
    )

    expect(result).toBe(config)
    expect(prepareReactBuilderDocgen).not.toHaveBeenCalled()
  })

  it('runs no builder docgen when its packages are missing', async () => {
    rs.mocked(prepareReactBuilderDocgen).mockResolvedValue(undefined)
    const config = {}

    const result = await rsbuildFinalDocs(config, createOptions())

    expect(result).toBe(config)
    expect(prepareReactBuilderDocgen).toHaveBeenCalledWith(
      expect.objectContaining({ reactDocgen: 'react-docgen' }),
    )
  })

  it('runs the react-docgen loader on every script file in react-docgen mode', async () => {
    rs.mocked(prepareReactBuilderDocgen).mockResolvedValue('react-docgen')

    const result = await rsbuildFinalDocs({}, createOptions())

    expect(rules(result).map((rule) => rule.test.source)).toEqual([
      /\.(cjs|mjs|tsx?|jsx?)$/.source,
    ])
  })

  it('uses the fallback mode that prepareReactBuilderDocgen decides, e.g. react-docgen on TypeScript 7', async () => {
    rs.mocked(prepareReactBuilderDocgen).mockResolvedValue('react-docgen')

    const result = await rsbuildFinalDocs(
      {},
      createOptions({ typescript: { reactDocgen: 'react-docgen-typescript' } }),
    )

    expect(result.plugins).toBeUndefined()
    expect(rules(result)).toHaveLength(1)
  })

  it.each([
    [true, [/\.(cjs|mjs|jsx?)$/.source]],
    [false, []],
  ])(
    'adds the vendored plugin, and the JavaScript-only loader only when react-docgen is installed (installed: %s)',
    async (installed, expectedRules) => {
      rs.mocked(prepareReactBuilderDocgen).mockResolvedValue(
        'react-docgen-typescript',
      )
      rs.mocked(isReactBuilderDocgenPackageInstalled).mockReturnValue(installed)

      const result = await rsbuildFinalDocs(
        {},
        createOptions({
          typescript: { reactDocgen: 'react-docgen-typescript' },
        }),
      )

      expect(rules(result).map((rule) => rule.test.source)).toEqual(
        expectedRules,
      )
      expect(
        (result.plugins as { name: string }[]).map((plugin) => plugin.name),
      ).toEqual(['rsbuild-plugin-react-docgen-typescript'])
    },
  )
})
