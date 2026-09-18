import { beforeEach, describe, expect, it, rs } from '@rstest/core'
import * as nodeLoggerActual from 'storybook/internal/node-logger' with {
  rstest: 'importActual',
}
import { deprecate } from 'storybook/internal/node-logger'
import { VUE_DOCGEN_API_DEPRECATION } from '../src/docgen/options'
import { rsbuildFinal } from '../src/framework-preset-vue3'
import type { FrameworkOptions } from '../src/types'

rs.mock('storybook/internal/node-logger', () => ({
  ...nodeLoggerActual,
  deprecate: rs.fn(),
}))

type RsbuildFinalOptions = Parameters<NonNullable<typeof rsbuildFinal>>[1]

const createVueComponentMetaChecker = rs.fn(async () => ({}))
const vueDocgenEngine = {
  componentMeta: async () => ({
    createVueComponentMetaChecker,
    collectComponentMetaSources: async () => [],
  }),
}

const createOptions = (
  docgen?: FrameworkOptions['docgen'],
  features: { experimentalDocgenServer?: boolean } = {},
) =>
  ({
    presets: {
      apply: async (name: string) => {
        if (name === 'frameworkOptions') {
          return docgen === undefined ? {} : { docgen }
        }
        if (name === 'features') {
          return features
        }
        if (name === 'experimental_vueDocgenEngine') {
          return vueDocgenEngine
        }
        return undefined
      },
    },
    presetsList: [],
  }) as unknown as RsbuildFinalOptions

describe('rsbuildFinal', () => {
  beforeEach(() => {
    rs.mocked(deprecate).mockClear()
  })

  it('does not inject the Vue docgen loader or deprecate when docgen is false', async () => {
    const config = await rsbuildFinal!({}, createOptions(false))

    expect(config.tools?.rspack).toBeUndefined()
    expect(deprecate).not.toHaveBeenCalled()
  })

  it.each([undefined, true, 'vue-docgen-api'] as const)(
    'injects the Vue docgen loader and deprecates vue-docgen-api when docgen is %s',
    async (docgen) => {
      const config = await rsbuildFinal!({}, createOptions(docgen))

      expect(config.tools?.rspack).toEqual(expect.any(Function))
      expect(deprecate).toHaveBeenCalledWith(VUE_DOCGEN_API_DEPRECATION)
    },
  )

  it.each(['vue-docgen-api', 'vue-component-meta'] as const)(
    'leaves docgen to the docgen server when it is active and docgen is %s',
    async (docgen) => {
      const config = await rsbuildFinal!(
        {},
        createOptions(docgen, { experimentalDocgenServer: true }),
      )

      expect(config.tools?.rspack).toBeUndefined()
      expect(deprecate).not.toHaveBeenCalled()
    },
  )

  it('adds the vue-component-meta plugin built from docgen.tsconfig', async () => {
    const config = await rsbuildFinal!(
      {},
      createOptions({
        plugin: 'vue-component-meta',
        tsconfig: 'tsconfig.app.json',
      }),
    )

    expect(
      (config.plugins as { name: string }[] | undefined)?.map(
        (plugin) => plugin.name,
      ),
    ).toEqual(['storybook:vue-component-meta-plugin'])
    expect(createVueComponentMetaChecker).toHaveBeenCalledWith(
      'tsconfig.app.json',
    )
    expect(deprecate).not.toHaveBeenCalled()
  })
})
