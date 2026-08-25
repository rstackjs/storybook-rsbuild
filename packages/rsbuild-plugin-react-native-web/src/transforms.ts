/**
 * Code transformation utilities for fixing React Native package compatibility issues
 * Ported from vite-plugin-rnw (https://github.com/dannyhw/vite-plugin-rnw)
 */

import MagicString from 'magic-string'
import { normalize } from 'pathe'

/**
 * Analyzes require statements in code and maps them to module imports.
 * Handles patterns like: varName = require('path').prop or require('path').default
 */
function analyzeRequireStatements(
  originalCode: string,
  exportedVars: string[],
): Map<string, string[]> {
  const importMap = new Map<string, string[]>()

  for (const varName of exportedVars) {
    // Look for patterns like: varName = require('path').prop or require('path').default
    // Search in the original code, handles multiline assignments
    const requirePattern = new RegExp(
      `${varName}\\s*=\\s*[\\s\\S]*?require\\(['"]([^'"]+)['"]\\)(?:\\.([\\w]+))?`,
      'g',
    )
    const requireMatch = requirePattern.exec(originalCode)

    if (requireMatch) {
      const [, modulePath, prop] = requireMatch
      const key = `${modulePath}:${prop || 'default'}`
      if (!importMap.has(key)) {
        importMap.set(key, [])
      }
      importMap.get(key)!.push(varName)
    }
  }

  return importMap
}

/**
 * Generates direct export statements from the import map.
 * Creates modern ESM exports like: export { default as varName } from 'module';
 *
 * @param importMap - Map of module:property to variable names
 * @param resolveModule - Optional function to resolve module paths to absolute paths
 */
function generateDirectExports(
  importMap: Map<string, string[]>,
  resolveModule?: (modulePath: string) => string,
): string {
  let exports = ''

  for (const [key, vars] of importMap) {
    const [modulePath, prop] = key.split(':')
    // Use resolved path if resolver is provided, otherwise use original path
    const resolvedPath = resolveModule ? resolveModule(modulePath) : modulePath

    if (prop === 'default') {
      // Default exports: export { default as varName } from 'module';
      for (const varName of vars) {
        exports += `export { default as ${varName} } from '${resolvedPath}';\n`
      }
    } else {
      // Named exports: export { propName as varName } from 'module';
      for (const varName of vars) {
        exports += `export { ${prop} as ${varName} } from '${resolvedPath}';\n`
      }
    }
  }

  return exports
}

export interface TransformResult {
  code: string
  map: string | null
  changed: boolean
}

export interface TransformReanimatedOptions {
  source?: string
  /**
   * Function to resolve module paths to absolute paths.
   * This is needed for pnpm/monorepo setups where react-native-reanimated
   * cannot resolve react-native-web internal modules.
   */
  resolveModule?: (modulePath: string) => string
}

/**
 * Transforms React Native Reanimated webUtils files to fix problematic
 * export let + try/catch + require patterns by converting them to proper ESM.
 *
 * This transformation handles the incompatible module patterns in React Native Reanimated
 * that cause build errors due to mixing CommonJS require() with ESM exports.
 */
export function transformReanimatedWebUtils(
  code: string,
  id: string,
  _isProduction: boolean,
  opts?: TransformReanimatedOptions,
): TransformResult {
  // Normalize path separators to forward slashes for cross-platform compatibility
  const normalizedId = normalize(id)
  const reanimatedInNodeModules =
    normalizedId.includes('react-native-reanimated') &&
    normalizedId.includes('node_modules')
  // Apply transformation to React Native Reanimated webUtils files
  // This fixes the dynamic require() calls that fail in pnpm/monorepo environments
  // where react-native-reanimated cannot resolve react-native-web internal modules
  // Note: In pnpm, the path may be like node_modules/.pnpm/.../node_modules/react-native-reanimated
  if (
    !reanimatedInNodeModules ||
    !normalizedId.includes('ReanimatedModule/js-reanimated/webUtils') ||
    !code.includes('export let') ||
    !code.includes('try') ||
    !code.includes('require')
  ) {
    return { code, map: null, changed: false }
  }

  // Extract all export let variable names generically
  const exportLetMatches = Array.from(code.matchAll(/export let (\w+);/g))
  const exportedVars = exportLetMatches.map((match) => match[1])

  if (exportedVars.length === 0) {
    return { code, map: null, changed: false }
  }

  // Analyze require statements in original code before removing try/catch blocks
  const importMap = analyzeRequireStatements(code, exportedVars)

  const ms = new MagicString(code)
  let changed = false

  // Remove problematic try/catch + require patterns
  for (const m of code.matchAll(
    /try\s*\{[^{}]*?require\([^)]+\)[^{}]*?\}\s*catch[^{}]*?\{[^{}]*?\}/gs,
  )) {
    const start = m.index!
    const end = start + m[0].length
    ms.remove(start, end)
    changed = true
  }

  // Remove all export let declarations
  for (const m of code.matchAll(/export let \w+;/g)) {
    const start = m.index!
    const end = start + m[0].length
    ms.remove(start, end)
    changed = true
  }

  // Generate clean direct export statements with resolved paths
  const exports = generateDirectExports(importMap, opts?.resolveModule)

  if (exports) {
    ms.append(`\n${exports}`)
    changed = true
  }

  if (!changed) {
    return { code, map: null, changed: false }
  }

  const resultCode = ms.toString()
  const map = ms
    .generateMap({
      source: opts?.source ?? id.split('?')[0],
      includeContent: true,
      hires: true,
    })
    .toString()

  return { code: resultCode, map, changed: true }
}

/**
 * Transforms react-native-css-interop doctor check to always return true.
 * Looks for:
 *   return <react-native-css-interop-jsx-pragma-check /> === true;
 * in node_modules/react-native-css-interop/dist/doctor.js and replaces with:
 *   return true;
 */
export function transformCssInteropDoctorCheck(
  code: string,
  id: string,
  opts?: { source?: string },
): TransformResult {
  // Normalize path separators to forward slashes for cross-platform compatibility
  const normalizedId = normalize(id)
  const isTargetFile = normalizedId.includes(
    'node_modules/react-native-css-interop/dist/doctor.js',
  )

  if (!isTargetFile) {
    return { code, map: null, changed: false }
  }

  const pattern =
    /return\s*<react-native-css-interop-jsx-pragma-check\s*\/>\s*===\s*true\s*;/g

  if (!pattern.test(code)) {
    return { code, map: null, changed: false }
  }

  const ms = new MagicString(code)
  let match: RegExpExecArray | null
  pattern.lastIndex = 0
  while ((match = pattern.exec(code)) !== null) {
    const start = match.index
    const end = start + match[0].length
    ms.overwrite(start, end, 'return true;')
  }

  const resultCode = ms.toString()
  const map = ms
    .generateMap({
      source: opts?.source ?? id.split('?')[0],
      includeContent: true,
      hires: true,
    })
    .toString()

  return { code: resultCode, map, changed: true }
}
