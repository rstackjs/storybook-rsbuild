// Mirrors upstream environments-support.ts BROWSER_TARGETS (chrome131, edge134, firefox136, safari18.3, ios18.3, opera117; ios -> ios_saf).
export const BROWSER_TARGETS = [
  'chrome >= 131',
  'edge >= 134',
  'firefox >= 136',
  'safari >= 18.3',
  'ios_saf >= 18.3',
  'opera >= 117',
] as const

// Mirrors upstream environments-support.ts NODE_TARGET ('node20.19').
export const NODE_TARGET = 'node >= 20.19'

export const SUPPORTED_FEATURES = {
  // React Native does not support class static blocks without a specific Babel plugin.
  'class-static-blocks': false,
} as const
