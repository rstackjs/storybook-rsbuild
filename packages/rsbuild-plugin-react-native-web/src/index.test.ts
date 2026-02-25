import { describe, expect, it } from '@rstest/core'
import { pluginReactNativeWeb } from './index'

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
})
