import { beforeEach, describe, expect, it, rs } from 'rstack/test'
import * as commonActual from 'storybook/internal/common' with {
  rstest: 'importActual',
}
import {
  getTypeScriptForDocgenError,
  isDocgenServerDisabledInMainConfig,
} from 'storybook/internal/common'
import * as nodeLoggerActual from 'storybook/internal/node-logger' with {
  rstest: 'importActual',
}
import { deprecate } from 'storybook/internal/node-logger'
import { VUE_BUILDER_DOCGEN_DEPRECATION } from '../src/docgen/options'
import { rsbuildFinal } from '../src/framework-preset-vue3'
import type { FrameworkOptions } from '../src/types'

rs.mock('storybook/internal/common', () => ({
  ...commonActual,
  isDocgenServerDisabledInMainConfig: rs.fn(),
  getTypeScriptForDocgenError: rs.fn(),
}))

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
  features: { docgenServer?: boolean } = {},
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
    // Defaults: `docgenServer` is not set in the main config, and `typescript` is usable.
    rs.mocked(isDocgenServerDisabledInMainConfig).mockResolvedValue(false)
    rs.mocked(getTypeScriptForDocgenError).mockReturnValue(undefined)
  })

  it('does not inject the Vue docgen loader or deprecate when docgen is false', async () => {
    const config = await rsbuildFinal!({}, createOptions(false))

    expect(config.tools?.rspack).toBeUndefined()
    expect(deprecate).not.toHaveBeenCalled()
  })

  it.each([undefined, true, 'vue-docgen-api'] as const)(
    'injects the Vue docgen loader and deprecates builder docgen when docgen is %s and the main config sets docgenServer: false',
    async (docgen) => {
      rs.mocked(isDocgenServerDisabledInMainConfig).mockResolvedValue(true)
      const config = await rsbuildFinal!({}, createOptions(docgen))

      expect(config.tools?.rspack).toEqual(expect.any(Function))
      expect(deprecate).toHaveBeenCalledWith(VUE_BUILDER_DOCGEN_DEPRECATION)
    },
  )

  it('injects the Vue docgen loader without deprecating when the docgen server is off by default', async () => {
    const config = await rsbuildFinal!({}, createOptions(undefined))

    expect(config.tools?.rspack).toEqual(expect.any(Function))
    expect(deprecate).not.toHaveBeenCalled()
  })

  it.each(['vue-docgen-api', 'vue-component-meta'] as const)(
    'leaves docgen to the docgen server when it is active and docgen is %s',
    async (docgen) => {
      const config = await rsbuildFinal!(
        {},
        createOptions(docgen, { docgenServer: true }),
      )

      expect(config.tools?.rspack).toBeUndefined()
      expect(deprecate).not.toHaveBeenCalled()
    },
  )

  it('runs no builder docgen and stays quiet in a test build, which turns the server off', async () => {
    const config = await rsbuildFinal!(
      {},
      {
        ...createOptions(undefined, { docgenServer: false }),
        build: { test: { disableDocgen: true } },
      },
    )

    expect(config.tools?.rspack).toBeUndefined()
    expect(deprecate).not.toHaveBeenCalled()
  })

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

  it('falls back to the vue-docgen-api loader when vue-component-meta is selected but typescript is unusable', async () => {
    rs.mocked(getTypeScriptForDocgenError).mockReturnValue(
      new Error('TypeScript 7 has no compiler API') as ReturnType<
        typeof getTypeScriptForDocgenError
      >,
    )
    createVueComponentMetaChecker.mockClear()

    const config = await rsbuildFinal!(
      {},
      createOptions({
        plugin: 'vue-component-meta',
        tsconfig: 'tsconfig.app.json',
      }),
    )

    expect(config.plugins).toBeUndefined()
    expect(config.tools?.rspack).toEqual(expect.any(Function))
    expect(createVueComponentMetaChecker).not.toHaveBeenCalled()
  })

  it('deprecates builder docgen for vue-component-meta only when the main config sets docgenServer: false', async () => {
    rs.mocked(isDocgenServerDisabledInMainConfig).mockResolvedValue(true)

    await rsbuildFinal!(
      {},
      createOptions({
        plugin: 'vue-component-meta',
        tsconfig: 'tsconfig.app.json',
      }),
    )

    expect(deprecate).toHaveBeenCalledWith(VUE_BUILDER_DOCGEN_DEPRECATION)
  })
})
