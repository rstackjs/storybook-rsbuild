export const BROWSER_TARGETS = [
  'chrome131',
  'edge134',
  'firefox136',
  'safari18.3',
  'ios18.3',
  'opera117',
] as const

// Mirrors upstream environments-support.ts NODE_TARGET ('node20.19').
export const NODE_TARGET = 'node >= 20.19'

export const SUPPORTED_FEATURES = {
  // React Native does not support class static blocks without a specific Babel plugin.
  'class-static-blocks': false,
} as const
