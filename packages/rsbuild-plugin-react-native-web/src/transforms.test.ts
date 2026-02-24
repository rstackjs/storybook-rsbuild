import { describe, expect, it } from '@rstest/core'
import {
  transformCssInteropDoctorCheck,
  transformReanimatedWebUtils,
} from './transforms'

describe('transformReanimatedWebUtils', () => {
  const webUtilsPath =
    'node_modules/react-native-reanimated/lib/module/ReanimatedModule/js-reanimated/webUtils.web.js'
  // Windows-style path with backslashes
  const webUtilsPathWindows =
    'node_modules\\react-native-reanimated\\lib\\module\\ReanimatedModule\\js-reanimated\\webUtils.web.js'

  describe('when conditions are not met', () => {
    it('returns original code when not a reanimated file', () => {
      const code = 'export let foo;'
      const result = transformReanimatedWebUtils(
        code,
        'some/other/file.js',
        false,
      )
      expect(result.changed).toBe(false)
      expect(result.code).toBe(code)
    })

    it('returns original code when not webUtils file', () => {
      const code = 'export let foo;'
      const result = transformReanimatedWebUtils(
        code,
        'node_modules/react-native-reanimated/some/other/file.js',
        false,
      )
      expect(result.changed).toBe(false)
      expect(result.code).toBe(code)
    })

    it('returns original code when no export let pattern', () => {
      const code = 'export const foo = "bar";'
      const result = transformReanimatedWebUtils(code, webUtilsPath, false)
      expect(result.changed).toBe(false)
      expect(result.code).toBe(code)
    })

    it('returns original code when no try/catch pattern', () => {
      const code = 'export let foo;'
      const result = transformReanimatedWebUtils(code, webUtilsPath, false)
      expect(result.changed).toBe(false)
      expect(result.code).toBe(code)
    })

    it('returns original code when no require pattern', () => {
      const code = 'export let foo;\ntry { foo = "bar"; } catch (e) {}'
      const result = transformReanimatedWebUtils(code, webUtilsPath, false)
      expect(result.changed).toBe(false)
      expect(result.code).toBe(code)
    })
  })

  describe('when transforming React Native Reanimated webUtils', () => {
    it('transforms single export let with default import', () => {
      const originalCode = `'use strict';
export let createReactDOMStyle;
try {
  createReactDOMStyle = require('react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle').default;
} catch (e) {}`

      const result = transformReanimatedWebUtils(
        originalCode,
        webUtilsPath,
        true,
      )

      expect(result.changed).toBe(true)
      expect(result.code).toContain(
        "export { default as createReactDOMStyle } from 'react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle'",
      )
      expect(result.code).not.toContain('export let createReactDOMStyle')
      expect(result.code).not.toContain('try')
    })

    it('transforms single export let with named import', () => {
      const originalCode = `export let createTransformValue;
try {
  createTransformValue = require('react-native-web/dist/exports/StyleSheet/preprocess').createTransformValue;
} catch (e) {}`

      const result = transformReanimatedWebUtils(
        originalCode,
        webUtilsPath,
        true,
      )

      expect(result.changed).toBe(true)
      expect(result.code).toContain(
        "export { createTransformValue as createTransformValue } from 'react-native-web/dist/exports/StyleSheet/preprocess'",
      )
    })

    it('transforms multiple export lets with mixed imports', () => {
      const originalCode = `'use strict';
export let createReactDOMStyle;
export let createTransformValue;
export let createTextShadowValue;
try {
  createReactDOMStyle = require('react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle').default;
} catch (e) {}
try {
  createTransformValue = require('react-native-web/dist/exports/StyleSheet/preprocess').createTransformValue;
} catch (e) {}
try {
  createTextShadowValue = require('react-native-web/dist/exports/StyleSheet/preprocess').createTextShadowValue;
} catch (e) {}`

      const result = transformReanimatedWebUtils(
        originalCode,
        webUtilsPath,
        true,
      )

      expect(result.changed).toBe(true)
      expect(result.code).toContain(
        "export { default as createReactDOMStyle } from 'react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle'",
      )
      expect(result.code).toContain(
        "export { createTransformValue as createTransformValue } from 'react-native-web/dist/exports/StyleSheet/preprocess'",
      )
      expect(result.code).toContain(
        "export { createTextShadowValue as createTextShadowValue } from 'react-native-web/dist/exports/StyleSheet/preprocess'",
      )
    })

    it('handles multiline assignment patterns', () => {
      const originalCode = `export let createReactDOMStyle;
try {
  createReactDOMStyle =
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle').default;
} catch (e) {}`

      const result = transformReanimatedWebUtils(
        originalCode,
        webUtilsPath,
        true,
      )

      expect(result.changed).toBe(true)
      expect(result.code).toContain('export { default as createReactDOMStyle }')
    })

    it('preserves other code while transforming', () => {
      const originalCode = `'use strict';
// Some comment
const someOtherCode = 'hello';
export let createReactDOMStyle;
function doSomething() {
  return 42;
}
try {
  createReactDOMStyle = require('react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle').default;
} catch (e) {}
// More code
console.log('test');`

      const result = transformReanimatedWebUtils(
        originalCode,
        webUtilsPath,
        true,
      )

      expect(result.changed).toBe(true)
      expect(result.code).toContain('someOtherCode')
      expect(result.code).toContain('doSomething')
      expect(result.code).toContain("console.log('test')")
    })

    it('generates source map when code changes', () => {
      const originalCode = `export let createTransformValue;
try {
  createTransformValue = require('react-native-web/dist/exports/StyleSheet/preprocess').createTransformValue;
} catch (e) {}`

      const result = transformReanimatedWebUtils(
        originalCode,
        webUtilsPath,
        true,
      )

      expect(result.changed).toBe(true)
      expect(result.map).not.toBeNull()
    })

    it('does not generate source map when code is unchanged', () => {
      const code = 'export const foo = "bar";'
      const result = transformReanimatedWebUtils(code, webUtilsPath, true)

      expect(result.changed).toBe(false)
      expect(result.map).toBeNull()
    })

    it('uses resolveModule to rewrite import paths when provided', () => {
      const originalCode = `'use strict';
export let createReactDOMStyle;
export let createTransformValue;
try {
  createReactDOMStyle = require('react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle').default;
} catch (e) {}
try {
  createTransformValue = require('react-native-web/dist/exports/StyleSheet/preprocess').createTransformValue;
} catch (e) {}`

      const resolveModule = (modulePath: string) => {
        if (modulePath.startsWith('react-native-web/')) {
          return `/absolute/path/to/node_modules/${modulePath}`
        }
        return modulePath
      }

      const result = transformReanimatedWebUtils(
        originalCode,
        webUtilsPath,
        true,
        { resolveModule },
      )

      expect(result.changed).toBe(true)
      expect(result.code).toContain(
        "export { default as createReactDOMStyle } from '/absolute/path/to/node_modules/react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle'",
      )
      expect(result.code).toContain(
        "export { createTransformValue as createTransformValue } from '/absolute/path/to/node_modules/react-native-web/dist/exports/StyleSheet/preprocess'",
      )
    })

    it('uses resolveModule with Windows-style base path (normalized to forward slashes)', () => {
      const originalCode = `'use strict';
export let createReactDOMStyle;
try {
  createReactDOMStyle = require('react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle').default;
} catch (e) {}`

      // Simulates a Windows path that has been normalized to use forward slashes
      // This is what pathe.normalize() does on Windows paths
      const resolveModule = (modulePath: string) => {
        if (modulePath.startsWith('react-native-web/')) {
          const relativePart = modulePath.slice('react-native-web/'.length)
          // Windows path normalized with forward slashes
          return `D:/a/storybook-rsbuild/node_modules/react-native-web/${relativePart}`
        }
        return modulePath
      }

      const result = transformReanimatedWebUtils(
        originalCode,
        webUtilsPath,
        true,
        { resolveModule },
      )

      expect(result.changed).toBe(true)
      expect(result.code).toContain(
        "export { default as createReactDOMStyle } from 'D:/a/storybook-rsbuild/node_modules/react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle'",
      )
      // Ensure no backslashes in the output
      expect(result.code).not.toContain('\\')
    })

    it('does not rewrite paths when resolveModule is not provided', () => {
      const originalCode = `export let createReactDOMStyle;
try {
  createReactDOMStyle = require('react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle').default;
} catch (e) {}`

      const result = transformReanimatedWebUtils(
        originalCode,
        webUtilsPath,
        true,
        { source: webUtilsPath },
      )

      expect(result.changed).toBe(true)
      expect(result.code).toContain(
        "export { default as createReactDOMStyle } from 'react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle'",
      )
    })

    it('transforms correctly with Windows-style paths (backslashes)', () => {
      const originalCode = `'use strict';
export let createReactDOMStyle;
try {
  createReactDOMStyle = require('react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle').default;
} catch (e) {}`

      const result = transformReanimatedWebUtils(
        originalCode,
        webUtilsPathWindows,
        true,
      )

      expect(result.changed).toBe(true)
      expect(result.code).toContain(
        "export { default as createReactDOMStyle } from 'react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle'",
      )
      expect(result.code).not.toContain('export let createReactDOMStyle')
      expect(result.code).not.toContain('try')
    })
  })
})

describe('transformCssInteropDoctorCheck', () => {
  const doctorPath = 'node_modules/react-native-css-interop/dist/doctor.js'
  // Windows-style path with backslashes
  const doctorPathWindows =
    'node_modules\\react-native-css-interop\\dist\\doctor.js'

  it('returns original code when not the target file', () => {
    const code =
      'return <react-native-css-interop-jsx-pragma-check /> === true;'
    const result = transformCssInteropDoctorCheck(code, 'some/other/file.js')

    expect(result.changed).toBe(false)
    expect(result.code).toBe(code)
  })

  it('returns original code when pattern not found', () => {
    const code = 'const foo = "bar";'
    const result = transformCssInteropDoctorCheck(code, doctorPath)

    expect(result.changed).toBe(false)
    expect(result.code).toBe(code)
  })

  it('transforms the doctor check pattern', () => {
    const originalCode = `function checkJsxPragma() {
  return <react-native-css-interop-jsx-pragma-check /> === true;
}`

    const result = transformCssInteropDoctorCheck(originalCode, doctorPath)

    expect(result.changed).toBe(true)
    expect(result.code).toContain('return true;')
    expect(result.code).not.toContain(
      '<react-native-css-interop-jsx-pragma-check />',
    )
  })

  it('generates source map when code changes', () => {
    const originalCode = `function checkJsxPragma() {
  return <react-native-css-interop-jsx-pragma-check /> === true;
}`

    const result = transformCssInteropDoctorCheck(originalCode, doctorPath)

    expect(result.changed).toBe(true)
    expect(result.map).not.toBeNull()
  })

  it('handles multiple occurrences', () => {
    const originalCode = `function check1() {
  return <react-native-css-interop-jsx-pragma-check /> === true;
}
function check2() {
  return <react-native-css-interop-jsx-pragma-check /> === true;
}`

    const result = transformCssInteropDoctorCheck(originalCode, doctorPath)

    expect(result.changed).toBe(true)
    // Should replace all occurrences
    const matches = result.code.match(/return true;/g)
    expect(matches?.length).toBe(2)
  })

  it('transforms correctly with Windows-style paths (backslashes)', () => {
    const originalCode = `function checkJsxPragma() {
  return <react-native-css-interop-jsx-pragma-check /> === true;
}`

    const result = transformCssInteropDoctorCheck(
      originalCode,
      doctorPathWindows,
    )

    expect(result.changed).toBe(true)
    expect(result.code).toContain('return true;')
    expect(result.code).not.toContain(
      '<react-native-css-interop-jsx-pragma-check />',
    )
  })
})
