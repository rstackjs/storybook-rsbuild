// Mirrors upstream environments-support.ts BROWSER_TARGETS (chrome147, edge150, firefox152, safari26.5, ios26.5; ios -> ios_saf).
export const BROWSER_TARGETS = [
  'chrome >= 147',
  'edge >= 150',
  'firefox >= 152',
  'safari >= 26.5',
  'ios_saf >= 26.5',
] as const

// Mirrors upstream environments-support.ts NODE_TARGET ('node22.12').
export const NODE_TARGET = 'node >= 22.12'

export const SUPPORTED_FEATURES = {
  // React Native does not support class static blocks without a specific Babel plugin.
  'class-static-blocks': false,
} as const
