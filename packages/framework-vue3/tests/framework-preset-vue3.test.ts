import { describe, expect, it, rs } from '@rstest/core'
import { logger } from 'storybook/internal/node-logger'
import { rsbuildFinal } from '../src/framework-preset-vue3'
import type { FrameworkOptions } from '../src/types'

type RsbuildFinalOptions = Parameters<NonNullable<typeof rsbuildFinal>>[1]

const createOptions = (docgen?: FrameworkOptions['docgen']) =>
  ({
    presets: {
      apply: async (name: string) => {
        if (name === 'frameworkOptions') {
          return docgen === undefined ? {} : { docgen }
        }
        return undefined
      },
    },
    presetsList: [],
  }) as unknown as RsbuildFinalOptions

describe('rsbuildFinal', () => {
  it('does not inject the Vue docgen loader when docgen is false', async () => {
    const config = await rsbuildFinal!({}, createOptions(false))

    expect(config.tools?.rspack).toBeUndefined()
  })

  it.each([undefined, true])(
    'injects the Vue docgen loader when docgen is %s',
    async (docgen) => {
      const config = await rsbuildFinal!({}, createOptions(docgen))

      expect(config.tools?.rspack).toEqual(expect.any(Function))
    },
  )

  it.each([
    ['string selector', 'vue-component-meta'],
    [
      'plugin config',
      { plugin: 'vue-component-meta', tsconfig: 'tsconfig.app.json' },
    ],
  ] as const)(
    'warns and falls back to vue-docgen-api for a vue-component-meta %s',
    async (_selector, docgen) => {
      const warn = rs.spyOn(logger, 'warn').mockImplementation(() => {})

      const config = await rsbuildFinal!({}, createOptions(docgen))

      expect(warn).toHaveBeenCalledWith(
        'vue-component-meta is not yet supported by storybook-rsbuild; falling back to vue-docgen-api.',
      )
      expect(config.tools?.rspack).toEqual(expect.any(Function))
    },
  )
})
