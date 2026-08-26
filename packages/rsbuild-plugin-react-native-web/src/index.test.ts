import { createRsbuild } from '@rsbuild/core'
import { describe, expect, it } from '@rstest/core'
import { pluginReactNativeWeb } from './index'

const getResolvedDefines = async (define?: Record<string, string>) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      plugins: [pluginReactNativeWeb()],
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
    it('preserves developmentModeForBuild defines from the framework', async () => {
      const defines = await getResolvedDefines({
        'process.env.NODE_ENV': JSON.stringify('development'),
      })

      expect(defines?.['process.env.NODE_ENV']).toBe(
        JSON.stringify('development'),
      )
      expect(defines?.__DEV__).toBe('true')
    })

    it('uses the host environment when no framework define is present', async () => {
      const defines = await getResolvedDefines()

      expect(defines?.['process.env.NODE_ENV']).toBe(
        JSON.stringify(process.env.NODE_ENV || 'development'),
      )
      expect(defines?.__DEV__).toBe(
        JSON.stringify(process.env.NODE_ENV !== 'production'),
      )
    })

    it('derives __DEV__ from equivalent production literals', async () => {
      const defines = await getResolvedDefines({
        'process.env.NODE_ENV': "'production'",
      })

      expect(defines?.['process.env.NODE_ENV']).toBe("'production'")
      expect(defines?.__DEV__).toBe('false')
    })
  })
})
