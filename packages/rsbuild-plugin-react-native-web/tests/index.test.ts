import { createRsbuild } from '@rsbuild/core'
import { afterEach, describe, expect, it } from '@rstest/core'
import { pluginReactNativeWeb } from '../src'

const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
  }
})

const getResolvedDefines = async ({
  define,
  dev,
}: {
  define?: Record<string, string>
  dev?: boolean
} = {}) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      plugins: [pluginReactNativeWeb({ dev })],
      source: { define },
    },
  })

  await rsbuild.initConfigs()
  return rsbuild.getRsbuildConfig().source?.define
}

describe('pluginReactNativeWeb', () => {
  describe('plugin creation', () => {
    it('creates a plugin with default options', () => {
      const plugin = pluginReactNativeWeb()

      expect(plugin).toBeDefined()
      expect(plugin.name).toBe('rsbuild:react-native-web')
      expect(typeof plugin.setup).toBe('function')
    })

    it('creates a plugin with custom modulesToTranspile', () => {
      const plugin = pluginReactNativeWeb({
        modulesToTranspile: ['my-custom-module'],
      })

      expect(plugin).toBeDefined()
      expect(plugin.name).toBe('rsbuild:react-native-web')
    })

    it('creates a plugin with jsxRuntime option', () => {
      const plugin = pluginReactNativeWeb({
        jsxRuntime: 'classic',
      })

      expect(plugin).toBeDefined()
      expect(plugin.name).toBe('rsbuild:react-native-web')
    })

    it('creates a plugin with jsxImportSource option', () => {
      const plugin = pluginReactNativeWeb({
        jsxImportSource: 'nativewind',
      })

      expect(plugin).toBeDefined()
      expect(plugin.name).toBe('rsbuild:react-native-web')
    })

    it('creates a plugin with noTreeshakeModules option', () => {
      const plugin = pluginReactNativeWeb({
        noTreeshakeModules: ['my-side-effect-module'],
      })

      expect(plugin).toBeDefined()
      expect(plugin.name).toBe('rsbuild:react-native-web')
    })

    it('creates a plugin with all options', () => {
      const plugin = pluginReactNativeWeb({
        modulesToTranspile: ['my-module'],
        jsxRuntime: 'automatic',
        jsxImportSource: 'react',
        noTreeshakeModules: ['side-effect-module'],
      })

      expect(plugin).toBeDefined()
      expect(plugin.name).toBe('rsbuild:react-native-web')
    })
  })

  describe('plugin options validation', () => {
    it('accepts empty options', () => {
      expect(() => pluginReactNativeWeb({})).not.toThrow()
    })

    it('accepts undefined options', () => {
      expect(() => pluginReactNativeWeb()).not.toThrow()
    })

    it('accepts valid jsxRuntime values', () => {
      expect(() =>
        pluginReactNativeWeb({ jsxRuntime: 'automatic' }),
      ).not.toThrow()
      expect(() =>
        pluginReactNativeWeb({ jsxRuntime: 'classic' }),
      ).not.toThrow()
    })

    it('accepts empty arrays for module options', () => {
      expect(() =>
        pluginReactNativeWeb({
          modulesToTranspile: [],
          noTreeshakeModules: [],
        }),
      ).not.toThrow()
    })
  })

  describe('environment defines', () => {
    it('uses the dev option for both environment defines', async () => {
      process.env.NODE_ENV = 'production'
      const defines = await getResolvedDefines({ dev: true })

      expect(defines?.['process.env.NODE_ENV']).toBe(
        JSON.stringify('development'),
      )
      expect(defines?.__DEV__).toBe('true')
    })

    it('uses the dev option over a conflicting NODE_ENV define', async () => {
      process.env.NODE_ENV = 'production'
      const defines = await getResolvedDefines({
        dev: true,
        define: {
          'process.env.NODE_ENV': JSON.stringify('production'),
        },
      })

      expect(defines?.['process.env.NODE_ENV']).toBe(
        JSON.stringify('development'),
      )
      expect(defines?.__DEV__).toBe('true')
    })

    it('preserves an existing __DEV__ define when dev is not configured', async () => {
      process.env.NODE_ENV = 'production'
      const defines = await getResolvedDefines({
        define: {
          __DEV__: 'existingDevFlag',
        },
      })

      expect(defines?.['process.env.NODE_ENV']).toBe(
        JSON.stringify('production'),
      )
      expect(defines?.__DEV__).toBe('existingDevFlag')
    })

    it('uses the host environment when dev is not configured', async () => {
      process.env.NODE_ENV = 'test'
      const defines = await getResolvedDefines()

      expect(defines?.['process.env.NODE_ENV']).toBe(JSON.stringify('test'))
      expect(defines?.__DEV__).toBe('true')
    })
  })
})
